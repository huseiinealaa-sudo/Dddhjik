import { useState } from 'react';
import { BEGINNER_RATES, DEFAULT_PID, DEFAULT_RATES } from '../core/Defaults';
import { resetSettings, updateSettings } from '../core/SettingsStore';
import { maxRate } from '../flight/Rates';
import type {
  CameraMode,
  FlightMode,
  PidAxisGains,
  QualityLevel,
  SimSettings,
  StickMode,
} from '../core/Types';
import { Field, Section, Segmented, Slider, Toggle } from './Controls';

interface SettingsPanelProps {
  settings: SimSettings;
  onClose: () => void;
  onRestartCourse: () => void;
}

type Tab = 'flight' | 'camera' | 'tuning' | 'world' | 'graphics';

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'flight', label: 'FLIGHT' },
  { value: 'camera', label: 'CAMERA' },
  { value: 'tuning', label: 'TUNING' },
  { value: 'world', label: 'WORLD' },
  { value: 'graphics', label: 'SYSTEM' },
];

export function SettingsPanel({ settings, onClose, onRestartCourse }: SettingsPanelProps): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('flight');

  const ratePreset =
    settings.rates.roll.rcRate === BEGINNER_RATES.roll.rcRate
      ? 'beginner'
      : settings.rates.roll.rcRate === DEFAULT_RATES.roll.rcRate
        ? 'standard'
        : 'custom';

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Simulator settings">
      <div className="panel">
        <h2 className="panel__title">Settings</h2>
        <p className="panel__subtitle">
          Everything is saved to this device automatically. Press <kbd>Esc</kbd> to go back to flying.
        </p>

        <div style={{ marginBottom: 18 }}>
          <Segmented value={tab} options={TABS} onChange={setTab} />
        </div>

        {tab === 'flight' ? (
          <>
            <Section title="Flight mode">
              <Field
                label="Mode"
                hint="Angle self-levels and limits the bank angle. Horizon self-levels only near the stick centre. Acro gives the pilot full, unassisted control — this is what real FPV pilots fly."
              >
                <Segmented<FlightMode>
                  value={settings.mode}
                  options={[
                    { value: 'angle', label: 'ANGLE' },
                    { value: 'horizon', label: 'HORIZON' },
                    { value: 'acro', label: 'ACRO' },
                  ]}
                  onChange={(mode) => updateSettings({ mode })}
                />
              </Field>
              <Field label="Max bank angle" hint="Angle mode only.">
                <Slider
                  label="Max bank angle"
                  value={settings.pid.angleLimitDeg}
                  min={15}
                  max={80}
                  step={1}
                  onChange={(angleLimitDeg) =>
                    updateSettings({ pid: { ...settings.pid, angleLimitDeg } })
                  }
                  format={(v) => `${v.toFixed(0)}°`}
                />
              </Field>
              <Field label="Air mode" hint="Keeps full attitude authority even at zero throttle.">
                <Toggle
                  label="Air mode"
                  checked={settings.airMode}
                  onChange={(airMode) => updateSettings({ airMode })}
                />
              </Field>
              <Field
                label="Auto recover"
                hint="Puts the aircraft back at the last gate a moment after a crash."
              >
                <Toggle
                  label="Auto recover"
                  checked={settings.autoRecover}
                  onChange={(autoRecover) => updateSettings({ autoRecover })}
                />
              </Field>
            </Section>

            <Section title="Rates">
              <Field label="Preset" hint="How fast the aircraft rotates at full stick.">
                <Segmented
                  value={ratePreset}
                  options={[
                    { value: 'beginner', label: 'BEGINNER' },
                    { value: 'standard', label: 'STANDARD' },
                    { value: 'custom', label: 'CUSTOM' },
                  ]}
                  onChange={(preset) => {
                    if (preset === 'beginner') updateSettings({ rates: BEGINNER_RATES });
                    else if (preset === 'standard') updateSettings({ rates: DEFAULT_RATES });
                  }}
                />
              </Field>
              {(['roll', 'pitch', 'yaw'] as const).map((axis) => (
                <Field
                  key={axis}
                  label={`${axis[0].toUpperCase()}${axis.slice(1)} rate`}
                  hint={`Maximum ${maxRate(settings.rates[axis]).toFixed(0)} °/s at full stick`}
                >
                  <Slider
                    label={`${axis} rate`}
                    value={settings.rates[axis].rcRate}
                    min={0.3}
                    max={2.2}
                    step={0.05}
                    onChange={(rcRate) =>
                      updateSettings({
                        rates: { ...settings.rates, [axis]: { ...settings.rates[axis], rcRate } },
                      })
                    }
                  />
                </Field>
              ))}
              <Field label="Expo" hint="Softens the centre of the sticks for finer corrections.">
                <Slider
                  label="Expo"
                  value={settings.rates.roll.expo}
                  min={0}
                  max={0.85}
                  step={0.01}
                  onChange={(expo) =>
                    updateSettings({
                      rates: {
                        roll: { ...settings.rates.roll, expo },
                        pitch: { ...settings.rates.pitch, expo },
                        yaw: { ...settings.rates.yaw, expo: expo * 0.8 },
                      },
                    })
                  }
                />
              </Field>
            </Section>

            <Section title="Transmitter">
              <Field label="Stick mode" hint="Mode 2 is the most common layout worldwide.">
                <Segmented<StickMode>
                  value={settings.stickMode}
                  options={[
                    { value: 'mode1', label: 'M1' },
                    { value: 'mode2', label: 'M2' },
                    { value: 'mode3', label: 'M3' },
                    { value: 'mode4', label: 'M4' },
                  ]}
                  onChange={(stickMode) => updateSettings({ stickMode })}
                />
              </Field>
              <Field
                label="Sticky throttle"
                hint="The touch throttle keeps its position when you lift your finger, like a real radio."
              >
                <Toggle
                  label="Sticky throttle"
                  checked={settings.stickyThrottle}
                  onChange={(stickyThrottle) => updateSettings({ stickyThrottle })}
                />
              </Field>
              <Field label="Dead-band" hint="Ignores tiny movements around the stick centre.">
                <Slider
                  label="Dead-band"
                  value={settings.deadband}
                  min={0}
                  max={0.15}
                  step={0.005}
                  onChange={(deadband) => updateSettings({ deadband })}
                  format={(v) => `${(v * 100).toFixed(1)}%`}
                />
              </Field>
              <Field label="Stick size" hint="Scale the on-screen sticks to fit your hands.">
                <Slider
                  label="Stick size"
                  value={settings.stickSize}
                  min={0.7}
                  max={1.4}
                  step={0.05}
                  onChange={(stickSize) => updateSettings({ stickSize })}
                  format={(v) => `${(v * 100).toFixed(0)}%`}
                />
              </Field>
            </Section>
          </>
        ) : null}

        {tab === 'camera' ? (
          <Section title="Camera">
            <Field label="View" hint="FPV is the onboard camera; chase and orbit are external views.">
              <Segmented<CameraMode>
                value={settings.cameraMode}
                options={[
                  { value: 'fpv', label: 'FPV' },
                  { value: 'chase', label: 'CHASE' },
                  { value: 'orbit', label: 'ORBIT' },
                ]}
                onChange={(cameraMode) => updateSettings({ cameraMode })}
              />
            </Field>
            <Field
              label="Camera tilt"
              hint="More up-tilt lets you fly faster before the horizon drops out of frame."
            >
              <Slider
                label="Camera tilt"
                value={settings.cameraTiltDeg}
                min={0}
                max={55}
                step={1}
                onChange={(cameraTiltDeg) => updateSettings({ cameraTiltDeg })}
                format={(v) => `${v.toFixed(0)}°`}
              />
            </Field>
            <Field label="Field of view" hint="Horizontal FOV. Real FPV cameras sit around 110–130°.">
              <Slider
                label="Field of view"
                value={settings.fovDeg}
                min={70}
                max={155}
                step={1}
                onChange={(fovDeg) => updateSettings({ fovDeg })}
                format={(v) => `${v.toFixed(0)}°`}
              />
            </Field>
            <Field label="Analogue video look" hint="Barrel distortion, scanlines, static and vignetting.">
              <Toggle
                label="Analogue video look"
                checked={settings.analogLook}
                onChange={(analogLook) => updateSettings({ analogLook })}
              />
            </Field>
            <Field label="Flight trail" hint="Draws the path you have flown (external views).">
              <Toggle
                label="Flight trail"
                checked={settings.showTrail}
                onChange={(showTrail) => updateSettings({ showTrail })}
              />
            </Field>
          </Section>
        ) : null}

        {tab === 'tuning' ? (
          <Section title="PID tuning">
            <p className="panel__subtitle" style={{ marginTop: 0 }}>
              These are the same numbers you would type into Betaflight. P sets the strength of the
              correction, I holds the attitude against wind, D damps the overshoot and FF makes the
              aircraft follow the sticks instantly.
            </p>
            {(['roll', 'pitch', 'yaw'] as const).map((axis) => (
              <div key={axis} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 4 }}>
                  {axis.toUpperCase()}
                </div>
                {(['p', 'i', 'd', 'f'] as const).map((term) => (
                  <Field key={term} label={term.toUpperCase()}>
                    <Slider
                      label={`${axis} ${term}`}
                      value={settings.pid[axis][term]}
                      min={0}
                      max={term === 'f' ? 250 : term === 'i' ? 200 : term === 'd' ? 90 : 120}
                      step={1}
                      onChange={(next) => {
                        const axisGains: PidAxisGains = { ...settings.pid[axis], [term]: next };
                        updateSettings({ pid: { ...settings.pid, [axis]: axisGains } });
                      }}
                      format={(v) => v.toFixed(0)}
                    />
                  </Field>
                ))}
              </div>
            ))}
            <Field label="Angle strength" hint="How hard Angle mode pulls back to level.">
              <Slider
                label="Angle strength"
                value={settings.pid.angleP}
                min={2}
                max={20}
                step={0.5}
                onChange={(angleP) => updateSettings({ pid: { ...settings.pid, angleP } })}
                format={(v) => v.toFixed(1)}
              />
            </Field>
            <div className="panel__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => updateSettings({ pid: DEFAULT_PID })}
              >
                RESTORE STOCK PIDS
              </button>
            </div>
          </Section>
        ) : null}

        {tab === 'world' ? (
          <Section title="Conditions">
            <Field label="Wind" hint="Steady breeze plus gusts. Great practice for holding a line.">
              <Slider
                label="Wind"
                value={settings.windSpeed}
                min={0}
                max={12}
                step={0.5}
                onChange={(windSpeed) => updateSettings({ windSpeed })}
                format={(v) => `${v.toFixed(1)} m/s`}
              />
            </Field>
            <Field label="Time scale" hint="Slow motion makes it much easier to learn a new trick.">
              <Slider
                label="Time scale"
                value={settings.timeScale}
                min={0.25}
                max={1}
                step={0.05}
                onChange={(timeScale) => updateSettings({ timeScale })}
                format={(v) => `${(v * 100).toFixed(0)}%`}
              />
            </Field>
            <Field label="Battery simulation" hint="Turn off for unlimited flight time while practising.">
              <Toggle
                label="Battery simulation"
                checked={settings.batteryEnabled}
                onChange={(batteryEnabled) => updateSettings({ batteryEnabled })}
              />
            </Field>
            <div className="panel__actions">
              <button type="button" className="btn btn--ghost" onClick={onRestartCourse}>
                RESTART COURSE
              </button>
            </div>
          </Section>
        ) : null}

        {tab === 'graphics' ? (
          <>
            <Section title="Graphics">
              <Field label="Quality" hint="Lower this if the frame rate drops on your device.">
                <Segmented<QualityLevel>
                  value={settings.quality}
                  options={[
                    { value: 'low', label: 'LOW' },
                    { value: 'medium', label: 'MED' },
                    { value: 'high', label: 'HIGH' },
                  ]}
                  onChange={(quality) => updateSettings({ quality })}
                />
              </Field>
              <Field label="Show HUD">
                <Toggle
                  label="Show HUD"
                  checked={settings.hudEnabled}
                  onChange={(hudEnabled) => updateSettings({ hudEnabled })}
                />
              </Field>
            </Section>
            <Section title="Audio">
              <Field label="Sound" hint="Motors, wind and impacts are synthesised in real time.">
                <Toggle
                  label="Sound"
                  checked={settings.audioEnabled}
                  onChange={(audioEnabled) => updateSettings({ audioEnabled })}
                />
              </Field>
              <Field label="Volume">
                <Slider
                  label="Volume"
                  value={settings.masterVolume}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(masterVolume) => updateSettings({ masterVolume })}
                  format={(v) => `${(v * 100).toFixed(0)}%`}
                />
              </Field>
            </Section>
            <Section title="Reset">
              <div className="panel__actions" style={{ justifyContent: 'flex-start' }}>
                <button type="button" className="btn btn--ghost" onClick={resetSettings}>
                  RESTORE ALL DEFAULTS
                </button>
              </div>
            </Section>
          </>
        ) : null}

        <div className="panel__actions">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            BACK TO FLYING
          </button>
        </div>
      </div>
    </div>
  );
}
