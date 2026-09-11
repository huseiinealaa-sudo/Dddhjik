import { memo, useMemo } from 'react';
import { clamp, formatTime } from '../core/MathUtils';
import type { Telemetry } from '../core/Types';

/**
 * Goggle-style OSD.
 *
 * Values arrive from the simulator at 20 Hz through an external store, so this
 * tree re-renders 20 times a second at most — never in step with the 60–120 fps
 * render loop.
 */

interface HudProps {
  telemetry: Telemetry;
  visible: boolean;
  gamepadConnected: boolean;
}

function batteryColour(percent: number, voltage: number): string {
  const cellVoltage = voltage / 6;
  if (percent < 12 || cellVoltage < 3.45) return 'var(--danger)';
  if (percent < 30 || cellVoltage < 3.6) return 'var(--warn)';
  return 'var(--ok)';
}

export const Hud = memo(function Hud({ telemetry, visible, gamepadConnected }: HudProps): React.JSX.Element {
  const {
    armed,
    mode,
    cameraMode,
    speedKmh,
    verticalSpeed,
    altitude,
    distance,
    batteryPercent,
    voltage,
    amps,
    mah,
    throttle,
    rollDeg,
    pitchDeg,
    headingDeg,
    gForce,
    motors,
    fps,
    flightTime,
    blockedBy,
    lap,
    linkQuality,
    gateBearing,
    gateDistance,
  } = telemetry;

  const battColour = batteryColour(batteryPercent, voltage);
  const isFpv = cameraMode === 'fpv';

  return (
    <div className={`hud${visible ? '' : ' hud--hidden'}`} aria-hidden={!visible}>
      {/* ---------------------------------------------------- top left */}
      <div className="hud__corner hud__corner--tl">
        <div className={`chip ${armed ? 'chip--armed' : 'chip--disarmed'}`}>
          <span className="chip__value">{armed ? '● ARMED' : '○ DISARMED'}</span>
        </div>
        <div className="chip">
          <span className="chip__label">MODE</span>
          <span className="chip__value" style={{ color: mode === 'acro' ? 'var(--warn)' : 'var(--accent)' }}>
            {mode.toUpperCase()}
          </span>
        </div>
        <div className="chip">
          <span className="chip__label">CAM</span>
          <span className="chip__value">{cameraMode.toUpperCase()}</span>
        </div>
        {gamepadConnected ? (
          <div className="chip">
            <span className="chip__label">TX</span>
            <span className="chip__value" style={{ color: 'var(--ok)' }}>
              GAMEPAD
            </span>
          </div>
        ) : null}
      </div>

      {/* --------------------------------------------------- top right */}
      <div className="hud__corner hud__corner--tr">
        <div className="readout readout--wide">
          <span className="readout__key">BATT</span>
          <span className="readout__val" style={{ color: battColour }}>
            <span className="battery">
              <span className="battery__cell">
                <span
                  className="battery__fill"
                  style={{ width: `${clamp(batteryPercent, 0, 100)}%`, background: battColour }}
                />
              </span>
              {batteryPercent.toFixed(0)}%
            </span>
          </span>

          <span className="readout__key">VOLTS</span>
          <span className="readout__val" style={{ color: battColour }}>
            {voltage.toFixed(2)}V
          </span>

          <span className="readout__key">CURRENT</span>
          <span className="readout__val">{amps.toFixed(1)}A</span>

          <span className="readout__key">USED</span>
          <span className="readout__val">{mah.toFixed(0)}mAh</span>
        </div>

        <div className="readout">
          <span className="readout__key">LINK</span>
          <span
            className="readout__val"
            style={{ color: linkQuality < 35 ? 'var(--danger)' : linkQuality < 65 ? 'var(--warn)' : 'var(--ok)' }}
          >
            {linkQuality.toFixed(0)}%
          </span>
          <span className="readout__key">FPS</span>
          <span className="readout__val">{fps.toFixed(0)}</span>
        </div>
      </div>

      {/* ----------------------------------------------------- compass */}
      <Compass heading={headingDeg} />

      {/* -------------------------------------------------- lap timing */}
      {lap.totalGates > 0 ? (
        <div className="lap">
          <div className="chip">
            <span className="chip__label">GATE</span>
            <span className="chip__value" style={{ color: 'var(--accent)' }}>
              {lap.nextGate + 1}/{lap.totalGates}
            </span>
          </div>
          <div className="chip">
            <span className="chip__label">LAP</span>
            <span className="chip__value">{formatTime(lap.currentLapTime)}</span>
          </div>
          <div className="chip">
            <span className="chip__label">BEST</span>
            <span className="chip__value" style={{ color: 'var(--ok)' }}>
              {lap.bestLapTime === null ? '--:--.--' : formatTime(lap.bestLapTime)}
            </span>
          </div>
          {lap.lapsCompleted > 0 ? (
            <div className="chip">
              <span className="chip__label">LAPS</span>
              <span className="chip__value">{lap.lapsCompleted}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ------------------------------------------- centre reticle/AHI */}
      <ArtificialHorizon roll={rollDeg} pitch={pitchDeg} compact={isFpv} />
      <GateArrow bearing={gateBearing} distance={gateDistance} />

      {/* -------------------------------------------------- bottom left */}
      <div className="hud__corner hud__corner--bl">
        <div className="bars">
          <div className="bars__item bars__throttle" title="Throttle">
            <span className="bars__fill" style={{ height: `${clamp(throttle * 100, 0, 100)}%` }} />
          </div>
          {motors.map((motor, index) => (
            <div className="bars__item" key={index} title={`Motor ${index + 1}`}>
              <span className="bars__fill" style={{ height: `${clamp(motor * 100, 0, 100)}%` }} />
            </div>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------- bottom right */}
      <div className="hud__corner hud__corner--br">
        <div className="readout">
          <span className="readout__key">SPD</span>
          <span className="readout__val readout__val--big readout__val--accent">
            {speedKmh.toFixed(0)}
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}> km/h</span>
          </span>

          <span className="readout__key">ALT</span>
          <span className="readout__val">{altitude.toFixed(1)} m</span>

          <span className="readout__key">VS</span>
          <span
            className="readout__val"
            style={{ color: verticalSpeed > 0.4 ? 'var(--ok)' : verticalSpeed < -0.4 ? 'var(--warn)' : undefined }}
          >
            {verticalSpeed >= 0 ? '+' : ''}
            {verticalSpeed.toFixed(1)}
          </span>

          <span className="readout__key">DIST</span>
          <span className="readout__val">{distance.toFixed(0)} m</span>

          <span className="readout__key">G</span>
          <span className="readout__val" style={{ color: gForce > 4 ? 'var(--warn)' : undefined }}>
            {gForce.toFixed(1)}
          </span>

          <span className="readout__key">TIME</span>
          <span className="readout__val">{formatTime(flightTime)}</span>
        </div>
      </div>

      {blockedBy && !armed ? <div className="warning-banner">{blockedBy}</div> : null}
    </div>
  );
});

/** Scrolling compass tape with cardinal points. */
const Compass = memo(function Compass({ heading }: { heading: number }): React.JSX.Element {
  const ticks = useMemo(() => {
    const result: Array<{ angle: number; label: string; cardinal: boolean }> = [];
    for (let angle = 0; angle < 360; angle += 15) {
      const cardinal = angle % 90 === 0;
      const label = cardinal
        ? ['N', 'E', 'S', 'W'][angle / 90]
        : angle % 45 === 0
          ? ['NE', 'SE', 'SW', 'NW'][Math.floor(angle / 90)]
          : String(angle);
      result.push({ angle, label, cardinal });
    }
    return result;
  }, []);

  const pixelsPerDegree = 2.6;

  return (
    <div className="compass" aria-label={`Heading ${heading.toFixed(0)} degrees`}>
      <div className="compass__strip" style={{ transform: `translateX(${-heading * pixelsPerDegree}px)` }}>
        {ticks.map((tick) =>
          [-360, 0, 360].map((wrap) => (
            <span
              key={`${tick.angle}-${wrap}`}
              className={`compass__tick${tick.cardinal ? ' compass__tick--cardinal' : ''}`}
              style={{ left: `calc(50% + ${(tick.angle + wrap) * pixelsPerDegree}px)`, top: '50%', marginTop: -6 }}
            >
              {tick.label}
            </span>
          )),
        )}
      </div>
      <div className="compass__needle" />
    </div>
  );
});

/**
 * Betaflight-style artificial horizon. In FPV the camera already shows the real
 * horizon, so only a small reticle plus a roll ladder is drawn; in the external
 * views the full instrument is shown.
 */
const ArtificialHorizon = memo(function ArtificialHorizon({
  roll,
  pitch,
  compact,
}: {
  roll: number;
  pitch: number;
  compact: boolean;
}): React.JSX.Element {
  const pixelsPerDegree = 1.5;
  const offset = clamp(pitch * pixelsPerDegree, -60, 60);

  return (
    <svg className="crosshair" viewBox="-60 -60 120 120" width={compact ? 120 : 190} height={compact ? 120 : 190}>
      <g transform={`rotate(${-roll}) translate(0 ${offset})`} opacity={compact ? 0.55 : 0.85}>
        <line x1="-52" y1="0" x2="-16" y2="0" stroke="var(--accent)" strokeWidth="1.6" />
        <line x1="16" y1="0" x2="52" y2="0" stroke="var(--accent)" strokeWidth="1.6" />
        {[-30, -20, -10, 10, 20, 30].map((deg) => (
          <line
            key={deg}
            x1={-12}
            x2={12}
            y1={-deg * pixelsPerDegree}
            y2={-deg * pixelsPerDegree}
            stroke="rgba(230,241,251,0.4)"
            strokeWidth="0.9"
          />
        ))}
      </g>
      {/* Fixed aircraft symbol. */}
      <g stroke="#fbbf24" strokeWidth="2" fill="none">
        <line x1="-13" y1="0" x2="-4" y2="0" />
        <line x1="4" y1="0" x2="13" y2="0" />
        <circle cx="0" cy="0" r="1.6" fill="#fbbf24" stroke="none" />
      </g>
    </svg>
  );
});

/** Chevron around the reticle pointing at the next gate. */
const GateArrow = memo(function GateArrow({
  bearing,
  distance,
}: {
  bearing: number;
  distance: number;
}): React.JSX.Element | null {
  if (distance <= 0.5) return null;
  const radius = 78;
  const angle = (bearing - 90) * (Math.PI / 180);
  const x = Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius;
  const onScreen = Math.abs(bearing) < 22;

  return (
    <svg className="gate-arrow" viewBox="-95 -95 190 190" aria-hidden="true">
      <g transform={`translate(${x} ${y}) rotate(${bearing})`} opacity={onScreen ? 0.45 : 0.95}>
        <path d="M 0 -11 L 8 6 L 0 2 L -8 6 Z" fill="var(--accent)" />
      </g>
      <text
        x={x * 0.82}
        y={y * 0.82 + 22}
        textAnchor="middle"
        fill="var(--accent)"
        fontSize="11"
        fontFamily="var(--font-mono)"
        opacity="0.85"
      >
        {distance.toFixed(0)}m
      </text>
    </svg>
  );
});
