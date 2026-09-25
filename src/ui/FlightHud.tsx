import { useSyncExternalStore } from 'react';
import type { Game, UiState } from '../game/game';
import { emit, type Command } from '../input/bus';
import { formatLapTime } from '../sim/math';
import { useI18n } from './i18n';
import { Icon } from './icons';

export function useTelemetry(game: Game) {
  return useSyncExternalStore(game.telemetry.subscribe, game.telemetry.get);
}

function fmtDelta(d: number | null): { text: string; cls: string } | null {
  if (d === null) return null;
  return { text: `${d <= 0 ? '−' : '+'}${Math.abs(d).toFixed(2)}`, cls: d <= 0 ? 'delta-good' : 'delta-bad' };
}

export function RaceHud({ game }: { game: Game }) {
  const tel = useTelemetry(game);
  const { t } = useI18n();
  const r = tel.race;
  if (!r) return null;
  const delta = fmtDelta(r.delta);
  return (
    <>
      <div className="race-hud">
        <div className="race-cell">
          <span className="race-label">{t('race.lapOf')}</span>
          <span className="race-value">
            {r.lap}/{r.laps}
          </span>
        </div>
        <div className="race-cell race-main">
          <span className="race-time">{formatLapTime(r.phase === 'running' ? r.lapTime : 0)}</span>
          {delta && <span className={`race-delta ${delta.cls}`}>{delta.text}</span>}
        </div>
        <div className="race-cell">
          <span className="race-label">{t('race.gate')}</span>
          <span className="race-value">
            {Math.min(r.gate + 1, r.gates)}/{r.gates}
          </span>
        </div>
        <div className="race-cell race-small">
          <span className="race-label">{t('race.best')}</span>
          <span className="race-value">{r.bestLap !== null ? formatLapTime(r.bestLap) : '—'}</span>
        </div>
      </div>
      {r.phase === 'countdown' && r.countdown > 0 && (
        <div className="countdown" key={Math.ceil(r.countdown)}>
          {Math.ceil(r.countdown)}
        </div>
      )}
    </>
  );
}

export function DrillHud({ game }: { game: Game }) {
  const tel = useTelemetry(game);
  const { t } = useI18n();
  const d = tel.drill;
  if (!d) return null;
  return (
    <div className="drill-hud">
      <div className="drill-title">
        {t(`drill.${d.id}`)} · {t('drill.next', { n: Math.min(d.index + 1, d.count), total: d.count })}
      </div>
      <div className="drill-bar">
        <div className="drill-fill" style={{ width: `${d.progress * 100}%` }} />
        <div className="drill-hold" style={{ width: `${d.hold * 100}%` }} />
      </div>
      <div className="drill-time">{formatLapTime(d.time)}</div>
    </div>
  );
}

export function Toasts({ ui }: { ui: UiState }) {
  const { t } = useI18n();
  return (
    <div className="toasts" aria-live="polite">
      {ui.toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.tone}`}>
          {t(toast.key, toast.params)}
        </div>
      ))}
    </div>
  );
}

interface ButtonsProps {
  ui: UiState;
  touch: boolean;
}

/** On-screen switch bank: the buttons a pilot has as switches on a radio. */
export function HudButtons({ ui, touch }: ButtonsProps) {
  const { t } = useI18n();
  const press = (c: Command) => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    emit(c);
  };
  const modeLabel = ui.mode === 'acro' ? 'ACRO' : ui.mode === 'angle' ? 'ANGLE' : 'HORIZON';
  return (
    <>
      <div className={`hud-switches ${touch ? 'hud-switches-touch' : ''}`}>
        <button className="hud-btn" onPointerDown={press('pause')} aria-label={t('hud.pause')}>
          <Icon name="pause" />
        </button>
        <button className="hud-btn hud-btn-wide" onPointerDown={press('mode')} aria-label={t('hud.mode')}>
          <span className="hud-btn-small">{t('hud.mode')}</span>
          <span>{modeLabel}</span>
        </button>
        <button
          className={`hud-btn hud-arm ${ui.armed ? 'hud-arm-on' : ''}`}
          onPointerDown={press('arm')}
          aria-pressed={ui.armed}
        >
          {ui.armed ? t('hud.disarm') : t('hud.arm')}
        </button>
        <button className="hud-btn" onPointerDown={press('camera')} aria-label={t('hud.camera')}>
          <Icon name="camera" />
        </button>
        <button className="hud-btn" onPointerDown={press('reset')} aria-label={t('hud.reset')}>
          <Icon name="reset" />
        </button>
        {(ui.canTurtle || ui.turtle) && (
          <button className={`hud-btn hud-btn-wide ${ui.turtle ? 'hud-arm-on' : 'hud-attention'}`} onPointerDown={press('turtle')}>
            <Icon name="turtle" />
            <span>{t('hud.turtle')}</span>
          </button>
        )}
        <button className="hud-btn" onPointerDown={press('audio')} aria-label="sound">
          <Icon name={ui.muted ? 'mute' : 'sound'} />
        </button>
      </div>
    </>
  );
}
