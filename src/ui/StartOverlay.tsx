import { updateSettings } from '../core/SettingsStore';
import type { FlightMode, SimSettings } from '../core/Types';
import { Segmented } from './Controls';

interface StartOverlayProps {
  settings: SimSettings;
  hasTouch: boolean;
  onStart: () => void;
  onOpenSettings: () => void;
}

/**
 * First screen. It doubles as the "how do I fly this" page, because an FPV
 * simulator that does not explain arming is a simulator nobody gets off the
 * ground.
 */
export function StartOverlay({
  settings,
  hasTouch,
  onStart,
  onOpenSettings,
}: StartOverlayProps): React.JSX.Element {
  return (
    <div className="overlay">
      <div className="panel start">
        <h1 className="start__logo">FPV SIM</h1>
        <p className="start__tagline">Quadcopter Flight Simulator</p>

        <div className="start__grid">
          <div className="card">
            <div className="card__title">1 · ARM</div>
            <div className="card__body">
              Throttle all the way down, then press <strong>ARM</strong> (or {hasTouch ? 'tap' : 'press'}{' '}
              <kbd>Space</kbd>). The motors will idle.
            </div>
          </div>
          <div className="card">
            <div className="card__title">2 · HOVER</div>
            <div className="card__body">
              Raise the throttle to about <strong>40%</strong>. A quad hovers far lower on the stick than
              most people expect.
            </div>
          </div>
          <div className="card">
            <div className="card__title">3 · FLY THE GATES</div>
            <div className="card__body">
              Follow the glowing cyan gate. Passing gate&nbsp;1 starts the lap timer.
            </div>
          </div>
        </div>

        <div style={{ margin: '18px 0' }}>
          <div className="card__title" style={{ marginBottom: 8 }}>
            START IN
          </div>
          <Segmented<FlightMode>
            value={settings.mode}
            options={[
              { value: 'angle', label: 'ANGLE · EASY' },
              { value: 'horizon', label: 'HORIZON' },
              { value: 'acro', label: 'ACRO · REAL' },
            ]}
            onChange={(mode) => updateSettings({ mode })}
          />
          <p className="card__body" style={{ marginTop: 8 }}>
            {settings.mode === 'angle'
              ? 'Angle mode keeps the aircraft level when you let go of the sticks and limits how far it can bank. Start here.'
              : settings.mode === 'horizon'
                ? 'Horizon self-levels around the stick centre but lets you flip at full deflection.'
                : 'Acro has no self-levelling at all. The sticks command rotation rate, exactly like a real FPV quad — this is the mode to learn if you plan to fly hardware.'}
          </p>
        </div>

        {!hasTouch ? (
          <div className="card" style={{ textAlign: 'left', marginBottom: 18 }}>
            <div className="card__title">KEYBOARD</div>
            <div className="keys" style={{ marginTop: 8 }}>
              <span>
                <kbd>W</kbd> <kbd>S</kbd>
              </span>
              <span>Throttle up / down</span>
              <span>
                <kbd>A</kbd> <kbd>D</kbd>
              </span>
              <span>Yaw left / right</span>
              <span>
                <kbd>↑</kbd> <kbd>↓</kbd>
              </span>
              <span>Pitch forward / back</span>
              <span>
                <kbd>←</kbd> <kbd>→</kbd>
              </span>
              <span>Roll left / right</span>
              <span>
                <kbd>Space</kbd>
              </span>
              <span>Arm / disarm</span>
              <span>
                <kbd>R</kbd>
              </span>
              <span>Reset to last gate</span>
              <span>
                <kbd>C</kbd> / <kbd>M</kbd>
              </span>
              <span>Camera view / flight mode</span>
              <span>
                <kbd>T</kbd> / <kbd>H</kbd>
              </span>
              <span>Restart course / toggle HUD</span>
              <span>
                <kbd>Esc</kbd>
              </span>
              <span>Settings</span>
            </div>
          </div>
        ) : (
          <div className="card" style={{ textAlign: 'left', marginBottom: 18 }}>
            <div className="card__title">TOUCH</div>
            <div className="card__body">
              Two virtual sticks appear at the bottom of the screen. They drag <em>relatively</em>, so
              re-gripping the throttle never causes a jump. A USB or Bluetooth game controller works too
              and is picked up automatically.
            </div>
          </div>
        )}

        <div className="panel__actions" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn btn--ghost" onClick={onOpenSettings}>
            SETTINGS
          </button>
          <button type="button" className="btn btn--primary" onClick={onStart} style={{ minWidth: 160 }}>
            START FLYING
          </button>
        </div>
      </div>
    </div>
  );
}
