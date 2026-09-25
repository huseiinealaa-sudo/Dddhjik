import { useEffect, useRef, useState } from 'react';
import type { Game } from '../game/game';
import { clearRecords } from '../game/records';
import { defaultSettings, resolveRates, type RateStyle, type Settings } from '../game/settings';
import type { StickMode } from '../input/inputManager';
import { CHANNELS, cloneMapping, GAMEPAD_MODE2, RADIO_AETR, type Channel, type GamepadMapping } from '../input/mapping';
import { maxRate, rateFor } from '../sim/fc/rates';
import { PRESETS } from '../sim/presets';
import type { AxisRate, FlightMode } from '../sim/types';
import { useI18n } from './i18n';
import { Icon } from './icons';

interface Props {
  game: Game | null;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}

type Tab = 'flight' | 'controls' | 'camera' | 'sim' | 'system';

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <div className="row-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="row-control">{children}</div>
    </div>
  );
}

function Slider(props: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  const { value, min, max, step, onChange, format } = props;
  return (
    <div className="slider">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{format ? format(value) : value}</output>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const { t } = useI18n();
  return (
    <button className={`toggle ${value ? 'on' : ''}`} role="switch" aria-checked={value} onClick={() => onChange(!value)}>
      <span className="toggle-knob" />
      <span className="sr-only">{value ? t('settings.on') : t('settings.off')}</span>
    </button>
  );
}

function Choice<T extends string>(props: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {props.options.map((o) => (
        <button key={o.value} className={props.value === o.value ? 'selected' : ''} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Rate curve preview: deg/s against stick deflection. */
function RateCurve({ settings }: { settings: Settings }) {
  const rates = resolveRates(settings);
  const w = 220;
  const h = 110;
  const maxAll = Math.max(maxRate(rates, 'roll'), maxRate(rates, 'yaw'), 200);
  const path = (axis: 'roll' | 'yaw'): string => {
    let d = '';
    for (let i = 0; i <= 40; i++) {
      const s = i / 40;
      const v = Math.abs(rateFor(rates, axis, s));
      d += `${i === 0 ? 'M' : 'L'}${(s * w).toFixed(1)},${(h - (v / maxAll) * h).toFixed(1)}`;
    }
    return d;
  };
  return (
    <svg className="rate-curve" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={path('roll')} className="curve-roll" />
      <path d={path('yaw')} className="curve-yaw" />
    </svg>
  );
}

function GamepadSection({ game, settings, onChange }: { game: Game | null; settings: Settings; onChange: Props['onChange'] }) {
  const { t } = useI18n();
  const [, force] = useState(0);
  const [learning, setLearning] = useState<Channel | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const baseline = useRef<number[]>([]);
  const baseButtons = useRef<boolean[]>([]);
  const cal = useRef<Array<{ min: number; max: number }>>([]);
  const mapping = settings.mapping;

  // Poll at ~20 Hz for the live bars and learning.
  useEffect(() => {
    const id = window.setInterval(() => {
      const snap = game?.input.gamepad.snapshot;
      if (snap?.connected) {
        if (learning) {
          let best = -1;
          let bestDelta = 0.45;
          snap.axes.forEach((v, i) => {
            const d = Math.abs(v - (baseline.current[i] ?? 0));
            if (d > bestDelta) {
              bestDelta = d;
              best = i;
            }
          });
          let button = -1;
          snap.buttons.forEach((b, i) => {
            if (b && !baseButtons.current[i]) button = i;
          });
          if (best >= 0 || button >= 0) {
            const m: GamepadMapping = cloneMapping(mapping);
            m.profile = 'custom';
            const prev = m.channels[learning];
            m.channels[learning] =
              best >= 0
                ? { kind: 'axis', index: best, invert: false, min: prev.min, max: prev.max }
                : { kind: 'button', index: button, invert: false, min: -1, max: 1 };
            // Stick axes: moved "up/right" should be positive.
            if (best >= 0 && snap.axes[best] - (baseline.current[best] ?? 0) < 0 && learning !== 'arm' && learning !== 'mode' && learning !== 'turtle') {
              m.channels[learning].invert = true;
            }
            onChange({ mapping: m });
            setLearning(null);
          }
        }
        if (calibrating) {
          snap.axes.forEach((v, i) => {
            const c = (cal.current[i] ??= { min: v, max: v });
            c.min = Math.min(c.min, v);
            c.max = Math.max(c.max, v);
          });
        }
      }
      force((n) => (n + 1) % 1000);
    }, 50);
    return () => window.clearInterval(id);
  }, [game, learning, calibrating, mapping, onChange]);

  const snap = game?.input.gamepad.snapshot;
  if (!snap?.connected) return <p className="muted">{t('settings.gamepad.none')}</p>;

  const startLearn = (c: Channel): void => {
    baseline.current = snap.axes.slice();
    baseButtons.current = snap.buttons.slice();
    setLearning(c);
  };

  const finishCalibration = (): void => {
    const m = cloneMapping(mapping);
    for (const c of CHANNELS) {
      const b = m.channels[c];
      const r = cal.current[b.index];
      if (b.kind === 'axis' && r && r.max - r.min > 0.5) {
        b.min = r.min;
        b.max = r.max;
      }
    }
    onChange({ mapping: m });
    cal.current = [];
    setCalibrating(false);
  };

  const channelValue = (c: Channel): number => {
    const ch = game?.input.gamepad.channels;
    return ch ? ch[c] : 0;
  };

  return (
    <div className="gamepad">
      <p className="muted small">{snap.id}</p>
      <Row label={t('settings.gamepad.profile')}>
        <Choice
          value={mapping.profile}
          options={[
            { value: 'gamepad', label: t('settings.gamepad.profile.gamepad') },
            { value: 'radio', label: t('settings.gamepad.profile.radio') },
            { value: 'custom', label: t('settings.gamepad.profile.custom') },
          ]}
          onChange={(p) => {
            if (p === 'gamepad') onChange({ mapping: cloneMapping(GAMEPAD_MODE2) });
            else if (p === 'radio') onChange({ mapping: cloneMapping(RADIO_AETR) });
            else onChange({ mapping: { ...cloneMapping(mapping), profile: 'custom' } });
          }}
        />
      </Row>
      <div className="channel-list">
        {CHANNELS.map((c) => {
          const b = mapping.channels[c];
          const v = channelValue(c);
          return (
            <div className="channel" key={c}>
              <span className="channel-name">{t(`settings.channel.${c}`)}</span>
              <span className="channel-bind">{b.kind === 'none' ? '—' : `${b.kind === 'axis' ? 'A' : 'B'}${b.index}`}</span>
              <span className="channel-bar">
                <span style={{ insetInlineStart: `${((v + 1) / 2) * 100}%` }} />
              </span>
              <button className="chip small" onClick={() => startLearn(c)}>
                {learning === c ? t('settings.gamepad.learning') : t('settings.gamepad.learn')}
              </button>
              <button
                className={`chip small ${b.invert ? 'selected' : ''}`}
                onClick={() => {
                  const m = cloneMapping(mapping);
                  m.channels[c].invert = !m.channels[c].invert;
                  onChange({ mapping: m });
                }}
              >
                {t('settings.gamepad.invert')}
              </button>
            </div>
          );
        })}
      </div>
      {calibrating ? (
        <div className="calibrate">
          <p>{t('settings.gamepad.calibrating')}</p>
          <button className="btn primary" onClick={finishCalibration}>
            {t('settings.gamepad.done')}
          </button>
        </div>
      ) : (
        <button className="btn" onClick={() => setCalibrating(true)}>
          {t('settings.gamepad.calibrate')}
        </button>
      )}
    </div>
  );
}

export function SettingsPanel({ game, settings, onChange, onClose }: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('flight');
  const [cleared, setCleared] = useState(false);
  const s = settings;
  const preset = PRESETS[s.quad];
  const rates = resolveRates(s);
  const tabs: Tab[] = ['flight', 'controls', 'camera', 'sim', 'system'];

  const setCustomAxis = (axes: Array<'roll' | 'pitch' | 'yaw'>, key: keyof AxisRate, v: number): void => {
    const base = s.rateStyle === 'custom' ? s.customRates : { ...resolveRates(s), type: 'actual' as const };
    const next = JSON.parse(JSON.stringify(base)) as typeof base;
    if (next.type !== 'actual') {
      next.type = 'actual';
      for (const a of ['roll', 'pitch', 'yaw'] as const) next[a] = { center: 200, max: 670, expo: 0.5 };
    }
    for (const a of axes) next[a][key] = v;
    onChange({ rateStyle: 'custom', customRates: next });
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings" role="dialog" aria-label={t('settings.title')}>
        <header className="modal-header">
          <h2>{t('settings.title')}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('settings.close')}>
            <Icon name="close" />
          </button>
        </header>
        <nav className="tabs">
          {tabs.map((k) => (
            <button key={k} className={tab === k ? 'selected' : ''} onClick={() => setTab(k)}>
              {t(`settings.tab.${k}`)}
            </button>
          ))}
        </nav>
        <div className="modal-body">
          {tab === 'flight' && (
            <>
              <Row label={t('settings.flightMode')} hint={t(`mode.${s.flightMode}.blurb`)}>
                <Choice<FlightMode>
                  value={s.flightMode}
                  options={(['angle', 'horizon', 'acro'] as const).map((m) => ({ value: m, label: t(`mode.${m}`) }))}
                  onChange={(v) => onChange({ flightMode: v })}
                />
              </Row>
              <Row
                label={t('settings.rates')}
                hint={t('settings.rates.maxRate', { roll: Math.round(maxRate(rates, 'roll')), yaw: Math.round(maxRate(rates, 'yaw')) })}
              >
                <Choice<RateStyle>
                  value={s.rateStyle}
                  options={(['preset', 'beginner', 'smooth', 'freestyle', 'race', 'custom'] as const).map((r) => ({
                    value: r,
                    label: t(`settings.rates.${r}`),
                  }))}
                  onChange={(v) => onChange({ rateStyle: v })}
                />
              </Row>
              <RateCurve settings={s} />
              {s.rateStyle === 'custom' && s.customRates.type === 'actual' && (
                <div className="rate-grid">
                  {(
                    [
                      ['rollPitch', ['roll', 'pitch']],
                      ['yaw', ['yaw']],
                    ] as const
                  ).map(([name, axes]) => (
                    <div key={name} className="rate-axis">
                      <h4>{t(`settings.rates.${name}`)}</h4>
                      <Row label={t('settings.rates.center')}>
                        <Slider value={s.customRates[axes[0]].center} min={50} max={400} step={5} onChange={(v) => setCustomAxis([...axes], 'center', v)} />
                      </Row>
                      <Row label={t('settings.rates.max')}>
                        <Slider value={s.customRates[axes[0]].max} min={200} max={1800} step={10} onChange={(v) => setCustomAxis([...axes], 'max', v)} />
                      </Row>
                      <Row label={t('settings.rates.expo')}>
                        <Slider value={s.customRates[axes[0]].expo} min={0} max={1} step={0.01} onChange={(v) => setCustomAxis([...axes], 'expo', v)} format={(v) => v.toFixed(2)} />
                      </Row>
                    </div>
                  ))}
                </div>
              )}
              <Row label={t('settings.airmode')} hint={t('settings.airmode.hint')}>
                <Toggle value={s.airmode} onChange={(v) => onChange({ airmode: v })} />
              </Row>
              <Row label={t('settings.angleLimit')}>
                <Slider value={s.angleLimit} min={20} max={80} step={1} onChange={(v) => onChange({ angleLimit: v })} format={(v) => `${v}°`} />
              </Row>
              <Row label={t('settings.throttleMid')}>
                <Slider value={s.throttleMid} min={0.2} max={0.8} step={0.01} onChange={(v) => onChange({ throttleMid: v })} format={(v) => v.toFixed(2)} />
              </Row>
              <Row label={t('settings.throttleExpo')}>
                <Slider value={s.throttleExpo} min={0} max={1} step={0.01} onChange={(v) => onChange({ throttleExpo: v })} format={(v) => v.toFixed(2)} />
              </Row>
            </>
          )}

          {tab === 'controls' && (
            <>
              <Row label={t('settings.stickMode')} hint={t('settings.stickMode.hint')}>
                <Choice<StickMode>
                  value={s.stickMode}
                  options={(['mode1', 'mode2', 'mode3', 'mode4'] as const).map((m) => ({ value: m, label: m.replace('mode', 'Mode ') }))}
                  onChange={(v) => onChange({ stickMode: v })}
                />
              </Row>
              <Row label={t('settings.touchSize')}>
                <Slider value={s.touchSize} min={0.7} max={1.5} step={0.05} onChange={(v) => onChange({ touchSize: v })} format={(v) => `${Math.round(v * 100)}%`} />
              </Row>
              <Row label={t('settings.touchOpacity')}>
                <Slider value={s.touchOpacity} min={0.2} max={1} step={0.05} onChange={(v) => onChange({ touchOpacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
              </Row>
              <Row label={t('settings.touchCenter')}>
                <Toggle value={s.touchThrottleCentering} onChange={(v) => onChange({ touchThrottleCentering: v })} />
              </Row>
              <Row label={t('settings.deadband')}>
                <Slider value={s.deadband} min={0} max={0.15} step={0.01} onChange={(v) => onChange({ deadband: v })} format={(v) => `${Math.round(v * 100)}%`} />
              </Row>
              <Row label={t('settings.haptics')}>
                <Toggle value={s.haptics} onChange={(v) => onChange({ haptics: v })} />
              </Row>
              <Row label={t('settings.stickyThrottle')}>
                <Toggle value={s.stickyThrottle} onChange={(v) => onChange({ stickyThrottle: v })} />
              </Row>
              <h3>{t('settings.keyboard')}</h3>
              <p className="muted small">{t('settings.keyboard.help')}</p>
              <h3>{t('settings.gamepad')}</h3>
              <GamepadSection game={game} settings={s} onChange={onChange} />
            </>
          )}

          {tab === 'camera' && (
            <>
              <Row label={t('settings.fov')}>
                <Slider value={s.fpvFov} min={80} max={150} step={1} onChange={(v) => onChange({ fpvFov: v })} format={(v) => `${v}°`} />
              </Row>
              <Row label={t('settings.tilt')} hint={s.cameraTilt === null ? t('settings.tilt.auto', { deg: preset.cameraTilt }) : undefined}>
                <Slider
                  value={s.cameraTilt ?? preset.cameraTilt}
                  min={-10}
                  max={60}
                  step={1}
                  onChange={(v) => onChange({ cameraTilt: v === preset.cameraTilt ? null : v })}
                  format={(v) => `${v}°`}
                />
              </Row>
              <Row label={t('settings.shake')}>
                <Slider value={s.cameraShake} min={0} max={1} step={0.05} onChange={(v) => onChange({ cameraShake: v })} format={(v) => `${Math.round(v * 100)}%`} />
              </Row>
              <Row label={t('settings.video')}>
                <Choice
                  value={s.videoLook}
                  options={(['clean', 'digital', 'analog'] as const).map((v) => ({ value: v, label: t(`settings.video.${v}`) }))}
                  onChange={(v) => onChange({ videoLook: v })}
                />
              </Row>
              <Row label={t('settings.distortion')}>
                <Toggle value={s.lensDistortion} onChange={(v) => onChange({ lensDistortion: v })} />
              </Row>
              <Row label={t('settings.osd')}>
                <Toggle value={s.osd} onChange={(v) => onChange({ osd: v })} />
              </Row>
              <Row label={t('settings.units')}>
                <Choice
                  value={s.osdUnits}
                  options={(['metric', 'imperial'] as const).map((v) => ({ value: v, label: t(`settings.units.${v}`) }))}
                  onChange={(v) => onChange({ osdUnits: v })}
                />
              </Row>
            </>
          )}

          {tab === 'sim' && (
            <>
              <Row label={t('settings.wind')}>
                <Slider value={s.windSpeed} min={0} max={14} step={0.5} onChange={(v) => onChange({ windSpeed: v })} format={(v) => `${v.toFixed(1)} m/s`} />
              </Row>
              <Row label={t('settings.windFrom')}>
                <Slider value={s.windFrom} min={0} max={355} step={5} onChange={(v) => onChange({ windFrom: v })} format={(v) => `${v}°`} />
              </Row>
              <Row label={t('settings.turbulence')}>
                <Slider value={s.turbulence} min={0} max={1} step={0.05} onChange={(v) => onChange({ turbulence: v })} format={(v) => `${Math.round(v * 100)}%`} />
              </Row>
              <Row label={t('settings.propwash')}>
                <Slider value={s.propwash} min={0} max={1.5} step={0.05} onChange={(v) => onChange({ propwash: v })} format={(v) => `${Math.round(v * 100)}%`} />
              </Row>
              <Row label={t('settings.batterySag')}>
                <Toggle value={s.batterySag} onChange={(v) => onChange({ batterySag: v })} />
              </Row>
              <Row label={t('settings.crash')}>
                <Toggle value={s.crashDetection} onChange={(v) => onChange({ crashDetection: v })} />
              </Row>
              <Row label={t('settings.autoRespawn')}>
                <Toggle value={s.autoRespawn} onChange={(v) => onChange({ autoRespawn: v })} />
              </Row>
              <Row label={t('settings.ghost')}>
                <Toggle value={s.ghost} onChange={(v) => onChange({ ghost: v })} />
              </Row>
            </>
          )}

          {tab === 'system' && (
            <>
              <Row label={t('settings.language')}>
                <Choice
                  value={s.language}
                  options={[
                    { value: 'ar', label: 'العربية' },
                    { value: 'en', label: 'English' },
                  ]}
                  onChange={(v) => onChange({ language: v })}
                />
              </Row>
              <Row label={t('settings.quality')} hint={t('settings.quality.hint')}>
                <Choice
                  value={s.quality}
                  options={(['low', 'medium', 'high'] as const).map((v) => ({ value: v, label: t(`settings.quality.${v}`) }))}
                  onChange={(v) => onChange({ quality: v })}
                />
              </Row>
              <Row label={t('settings.fps')}>
                <Toggle value={s.showFps} onChange={(v) => onChange({ showFps: v })} />
              </Row>
              <Row label={t('settings.volume')}>
                <Slider value={s.masterVolume} min={0} max={1} step={0.05} onChange={(v) => onChange({ masterVolume: v })} format={(v) => `${Math.round(v * 100)}%`} />
              </Row>
              <Row label={t('settings.motorVolume')}>
                <Slider value={s.motorVolume} min={0} max={1} step={0.05} onChange={(v) => onChange({ motorVolume: v })} format={(v) => `${Math.round(v * 100)}%`} />
              </Row>
              <Row label={t('settings.beeps')}>
                <Toggle value={s.beeps} onChange={(v) => onChange({ beeps: v })} />
              </Row>
              <div className="danger-zone">
                <button
                  className="btn"
                  onClick={() => {
                    clearRecords();
                    setCleared(true);
                  }}
                >
                  {cleared ? t('settings.cleared') : t('settings.clearRecords')}
                </button>
                <button className="btn" onClick={() => onChange({ ...defaultSettings(), language: s.language })}>
                  {t('settings.reset')}
                </button>
              </div>
            </>
          )}
        </div>
        <footer className="modal-footer">
          <button className="btn primary" onClick={onClose}>
            {t('settings.close')}
          </button>
        </footer>
      </div>
    </div>
  );
}
