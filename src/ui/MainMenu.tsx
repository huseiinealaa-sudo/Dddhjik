import { useMemo, useState } from 'react';
import type { SessionSpec } from '../game/game';
import { getRecord } from '../game/records';
import type { Settings } from '../game/settings';
import { formatLapTime } from '../sim/math';
import { PRESET_ORDER, PRESETS, thrustToWeight, type PresetId } from '../sim/presets';
import { TRACKS } from '../sim/tracks';
import type { FlightMode } from '../sim/types';
import { useI18n } from './i18n';
import { Icon } from './icons';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onStart: (spec: SessionSpec) => void;
  onSettings: () => void;
  onFullscreen: () => void;
}

type Tab = 'free' | 'race' | 'training';

/** Rough flight time at a gentle cruise: capacity over hover current plus margin. */
function estimateMinutes(id: PresetId): number {
  const p = PRESETS[id];
  const hoverW = (p.mass * 9.81) ** 1.5 / Math.sqrt(2 * 1.225 * 4 * Math.PI * (p.propDiameter / 2) ** 2) / 0.55;
  const volts = p.battery.cells * (p.battery.chemistry === 'lipo' ? 3.8 : 3.6);
  const amps = (hoverW / volts) * 1.35;
  return Math.round(((p.battery.capacityMah / 1000) * 0.8 * 60) / amps);
}

export function MainMenu({ settings, onChange, onStart, onSettings, onFullscreen }: Props) {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<Tab>('free');
  const records = useMemo(
    () => Object.fromEntries(TRACKS.map((tr) => [tr.id, getRecord(tr.id, settings.quad)])),
    [settings.quad],
  );

  const modes: FlightMode[] = ['angle', 'horizon', 'acro'];

  return (
    <div className="menu">
      <header className="menu-header">
        <div className="brand">
          <Icon name="drone" size={34} />
          <div>
            <h1>{t('app.title')}</h1>
            <p>{t('app.subtitle')}</p>
          </div>
        </div>
        <div className="menu-header-actions">
          <button className="chip" onClick={() => onChange({ language: lang === 'ar' ? 'en' : 'ar' })}>
            <Icon name="globe" size={18} /> {lang === 'ar' ? 'English' : 'العربية'}
          </button>
          <button className="chip" onClick={onFullscreen} aria-label="Fullscreen">
            <Icon name="fullscreen" size={18} />
          </button>
          <button className="chip" onClick={onSettings}>
            <Icon name="settings" size={18} /> {t('menu.settings')}
          </button>
        </div>
      </header>

      <div className="menu-body">
        <section className="panel menu-setup">
          <h2>{t('menu.quad')}</h2>
          <div className="quad-list">
            {PRESET_ORDER.map((id) => {
              const p = PRESETS[id];
              return (
                <button
                  key={id}
                  className={`quad-card ${settings.quad === id ? 'selected' : ''}`}
                  onClick={() => onChange({ quad: id })}
                  style={{ '--accent': p.look.accent } as React.CSSProperties}
                >
                  <span className="quad-name">{p.name[lang]}</span>
                  <span className="quad-stats">
                    <span>
                      {t('menu.weight')} <b>{Math.round(p.mass * 1000)} g</b>
                    </span>
                    <span>
                      {t('menu.tw')} <b>{thrustToWeight(p).toFixed(1)}:1</b>
                    </span>
                    <span>
                      {t('menu.flightTime')} <b>~{estimateMinutes(id)} min</b>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="muted small">{PRESETS[settings.quad].blurb[lang]}</p>

          <h2>{t('menu.mode')}</h2>
          <div className="segmented">
            {modes.map((m) => (
              <button key={m} className={settings.flightMode === m ? 'selected' : ''} onClick={() => onChange({ flightMode: m })}>
                {t(`mode.${m}`)}
              </button>
            ))}
          </div>
          <p className="muted small">{t(`mode.${settings.flightMode}.blurb`)}</p>
        </section>

        <section className="panel menu-play">
          <div className="tabs">
            {(['free', 'race', 'training'] as Tab[]).map((k) => (
              <button key={k} className={tab === k ? 'selected' : ''} onClick={() => setTab(k)}>
                {t(k === 'free' ? 'menu.free' : k === 'race' ? 'menu.race' : 'menu.training')}
              </button>
            ))}
          </div>

          {tab === 'free' && (
            <div className="cards">
              {(['field', 'yard'] as const).map((area) => (
                <button key={area} className={`play-card play-${area}`} onClick={() => onStart({ kind: 'free', area })}>
                  <span className="play-title">{t(`menu.free.${area}`)}</span>
                  <span className="play-blurb">{t(`menu.free.${area}.blurb`)}</span>
                  <span className="play-go">{t('menu.fly')} ›</span>
                </button>
              ))}
            </div>
          )}

          {tab === 'race' && (
            <div className="cards">
              {TRACKS.map((tr) => {
                const rec = records[tr.id];
                return (
                  <button key={tr.id} className={`play-card play-${tr.id}`} onClick={() => onStart({ kind: 'race', track: tr.id })}>
                    <span className="play-title">
                      {tr.name[lang]} <span className={`difficulty d${tr.difficulty}`}>{t(`menu.difficulty.${tr.difficulty}`)}</span>
                    </span>
                    <span className="play-blurb">{tr.blurb[lang]}</span>
                    <span className="play-meta">
                      {t('menu.gates', { n: tr.gates.length })} · {t('menu.laps', { n: tr.laps })} ·{' '}
                      <Icon name="trophy" size={14} /> {rec?.bestLap ? formatLapTime(rec.bestLap) : t('menu.noRecord')}
                    </span>
                    <span className="play-go">{t('menu.start')} ›</span>
                  </button>
                );
              })}
            </div>
          )}

          {tab === 'training' && (
            <div className="cards">
              {(['hover', 'landing', 'orbit'] as const).map((d) => (
                <button key={d} className={`play-card play-drill`} onClick={() => onStart({ kind: 'drill', drill: d })}>
                  <span className="play-title">
                    <Icon name="target" size={18} /> {t(`drill.${d}`)}
                  </span>
                  <span className="play-blurb">{t(`drill.${d}.blurb`)}</span>
                  <span className="play-go">{t('menu.start')} ›</span>
                </button>
              ))}
            </div>
          )}
          <p className="muted small keyboard-help">{t('settings.keyboard.help')}</p>
          <p className="muted small install-tip">{t('menu.install')}</p>
        </section>
      </div>
    </div>
  );
}
