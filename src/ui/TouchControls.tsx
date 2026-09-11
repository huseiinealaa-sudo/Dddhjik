import { useMemo } from 'react';
import type { SimSettings, StickMode } from '../core/Types';
import { emitCommand } from '../input/InputState';
import { VirtualStick } from './VirtualStick';

/** Channel assignment per transmitter mode, mirroring `InputManager`. */
const STICK_LABELS: Record<StickMode, { left: [string, string]; right: [string, string] }> = {
  mode1: { left: ['YAW', 'PITCH'], right: ['ROLL', 'THR'] },
  mode2: { left: ['YAW', 'THR'], right: ['ROLL', 'PITCH'] },
  mode3: { left: ['ROLL', 'PITCH'], right: ['YAW', 'THR'] },
  mode4: { left: ['ROLL', 'THR'], right: ['YAW', 'PITCH'] },
};

export interface TouchControlsProps {
  settings: SimSettings;
  armed: boolean;
  canArm: boolean;
  onOpenMenu: () => void;
}

/**
 * The on-screen transmitter: two sticks plus the buttons a pilot actually
 * needs mid-session (arm, reset, camera, flight mode).
 */
export function TouchControls({
  settings,
  armed,
  canArm,
  onOpenMenu,
}: TouchControlsProps): React.JSX.Element {
  const labels = STICK_LABELS[settings.stickMode] ?? STICK_LABELS.mode2;
  const leftIsThrottle = labels.left[1] === 'THR';
  const baseSize = useMemo(() => 168 * settings.stickSize, [settings.stickSize]);

  return (
    <div className="controls">
      <VirtualStick
        side="left"
        labelX={labels.left[0]}
        labelY={labels.left[1]}
        verticalIsThrottle={leftIsThrottle}
        selfCenterY={leftIsThrottle ? !settings.stickyThrottle : true}
        size={baseSize}
      />
      <VirtualStick
        side="right"
        labelX={labels.right[0]}
        labelY={labels.right[1]}
        verticalIsThrottle={!leftIsThrottle}
        selfCenterY={!leftIsThrottle ? !settings.stickyThrottle : true}
        size={baseSize}
      />

      <div className="actions">
        <button
          type="button"
          className={`btn ${armed ? 'btn--disarm' : 'btn--arm'}`}
          onPointerDown={(event) => {
            event.preventDefault();
            emitCommand('toggleArm');
          }}
          disabled={!armed && !canArm}
        >
          {armed ? 'DISARM' : 'ARM'}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onPointerDown={(event) => {
            event.preventDefault();
            emitCommand('reset');
          }}
        >
          RESET
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onPointerDown={(event) => {
            event.preventDefault();
            emitCommand('cycleCamera');
          }}
        >
          {settings.cameraMode.toUpperCase()}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onPointerDown={(event) => {
            event.preventDefault();
            emitCommand('cycleMode');
          }}
        >
          {settings.mode.toUpperCase()}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onPointerDown={(event) => {
            event.preventDefault();
            onOpenMenu();
          }}
        >
          MENU
        </button>
      </div>
    </div>
  );
}
