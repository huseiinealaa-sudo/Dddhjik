/**
 * Raw, un-mapped stick positions shared between the React touch UI and the
 * simulator. Using a plain mutable object (instead of React state) keeps the
 * 500 Hz physics loop completely free of React re-renders.
 *
 * Axis convention for both sticks: x is +1 to the right, y is +1 upwards.
 */
export interface RawSticks {
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
  leftActive: boolean;
  rightActive: boolean;
}

export const touchSticks: RawSticks = {
  leftX: 0,
  leftY: 0,
  rightX: 0,
  rightY: 0,
  leftActive: false,
  rightActive: false,
};

export function resetTouchSticks(): void {
  touchSticks.leftX = 0;
  touchSticks.leftY = 0;
  touchSticks.rightX = 0;
  touchSticks.rightY = 0;
  touchSticks.leftActive = false;
  touchSticks.rightActive = false;
}

/** Commands that can be triggered from the keyboard, the HUD or a gamepad. */
export type SimCommand =
  | 'toggleArm'
  | 'reset'
  | 'cycleCamera'
  | 'cycleMode'
  | 'toggleHud'
  | 'toggleMenu'
  | 'restartCourse'
  | 'toggleAudio';

type CommandListener = (command: SimCommand) => void;

const listeners = new Set<CommandListener>();

export function onCommand(listener: CommandListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitCommand(command: SimCommand): void {
  for (const listener of listeners) listener(command);
}
