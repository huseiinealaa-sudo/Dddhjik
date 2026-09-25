/**
 * Shared, mutable input state and the command bus.
 *
 * The React touch sticks write straight into `touchSticks` and the game loop
 * reads it — no React state, no re-renders at 120 Hz. Discrete actions from any
 * device (keyboard, gamepad buttons, on-screen buttons) go through `emit`.
 */

export interface TouchSticks {
  /** Physical stick positions, ±1, +y = pushed up/forward. */
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
  leftActive: boolean;
  rightActive: boolean;
}

export const touchSticks: TouchSticks = {
  leftX: 0,
  leftY: -1,
  rightX: 0,
  rightY: 0,
  leftActive: false,
  rightActive: false,
};

export type Command =
  | 'arm'
  | 'reset'
  | 'camera'
  | 'mode'
  | 'turtle'
  | 'pause'
  | 'hud'
  | 'restart'
  | 'audio';

type Listener = (command: Command) => void;
const listeners = new Set<Listener>();

export function onCommand(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit(command: Command): void {
  for (const l of listeners) l(command);
}
