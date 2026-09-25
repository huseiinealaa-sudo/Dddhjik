/**
 * Gamepad / RC-transmitter channel mapping.
 *
 * A radio in USB-joystick mode (EdgeTX, OpenTX, ELRS handsets…) shows up as a
 * gamepad whose axes are the RC channels. A console controller shows up with
 * the "standard" layout. Both are described by the same structure, so a pilot
 * can bind anything to anything and the choice is persisted.
 */

export type Channel = 'roll' | 'pitch' | 'yaw' | 'throttle' | 'arm' | 'mode' | 'turtle';

export const CHANNELS: Channel[] = ['throttle', 'yaw', 'pitch', 'roll', 'arm', 'mode', 'turtle'];

export interface Binding {
  kind: 'axis' | 'button' | 'none';
  index: number;
  invert: boolean;
  /** Calibrated range of a raw axis (radios rarely reach exactly ±1). */
  min: number;
  max: number;
}

export interface GamepadMapping {
  profile: 'gamepad' | 'radio' | 'custom';
  channels: Record<Channel, Binding>;
  /** Buttons that fire commands (index -> command). Radio profile leaves this empty. */
  buttons: Partial<Record<number, 'arm' | 'reset' | 'camera' | 'mode' | 'turtle' | 'pause'>>;
}

const axis = (index: number, invert = false): Binding => ({ kind: 'axis', index, invert, min: -1, max: 1 });
const none = (): Binding => ({ kind: 'none', index: 0, invert: false, min: -1, max: 1 });

/**
 * Console controller, Mode 2. Browsers report +1 for a stick pulled *down*,
 * so the vertical axes are inverted to make "up" positive.
 */
export const GAMEPAD_MODE2: GamepadMapping = {
  profile: 'gamepad',
  channels: {
    throttle: axis(1, true),
    yaw: axis(0),
    pitch: axis(3, true),
    roll: axis(2),
    arm: none(),
    mode: none(),
    turtle: none(),
  },
  buttons: { 0: 'arm', 1: 'reset', 2: 'camera', 3: 'mode', 4: 'turtle', 9: 'pause' },
};

/**
 * RC radio in joystick mode with the usual AETR channel order:
 * CH1 roll, CH2 pitch, CH3 throttle, CH4 yaw, CH5 arm switch, CH6 flight mode.
 */
export const RADIO_AETR: GamepadMapping = {
  profile: 'radio',
  channels: {
    roll: axis(0),
    pitch: axis(1),
    throttle: axis(2),
    yaw: axis(3),
    arm: axis(4),
    mode: axis(5),
    turtle: none(),
  },
  buttons: {},
};

export function cloneMapping(m: GamepadMapping): GamepadMapping {
  return JSON.parse(JSON.stringify(m)) as GamepadMapping;
}

/** Normalise a raw axis to ±1 using its calibration, then apply inversion. */
export function readAxis(raw: number, b: Binding): number {
  const span = b.max - b.min;
  let v = span > 1e-3 ? ((raw - b.min) / span) * 2 - 1 : raw;
  v = v < -1 ? -1 : v > 1 ? 1 : v;
  return b.invert ? -v : v;
}

/** Heuristic: RC radios expose 6-8 axes and very few buttons. */
export function looksLikeRadio(pad: Gamepad): boolean {
  const id = pad.id.toLowerCase();
  if (/edgetx|opentx|frsky|radiomaster|jumper|tbs|tango|zorro|boxer|taranis|betafpv|elrs|expresslrs|rc ?joystick|flysky/.test(id)) {
    return true;
  }
  return pad.mapping !== 'standard' && pad.axes.length >= 6 && pad.buttons.length <= 24;
}
