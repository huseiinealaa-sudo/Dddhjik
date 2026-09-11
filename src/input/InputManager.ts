import { applyDeadband, clamp, clampUnit } from '../core/MathUtils';
import type { ControlInput, SimSettings, StickMode } from '../core/Types';
import { GamepadInput } from './GamepadInput';
import { KeyboardInput } from './KeyboardInput';
import { touchSticks } from './InputState';

/**
 * Merges every input source (virtual sticks, keyboard, gamepad) into one set
 * of normalised pilot commands and applies the transmitter stick mode.
 *
 * Sources are summed and clamped, so a pilot can start a manoeuvre on the
 * touch sticks and finish it on the keyboard without anything snapping.
 */

interface StickPair {
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
}

/**
 * Stick mode lookup. Each entry says which logical channel is driven by which
 * physical axis, and whether the vertical axis is the (non-centring) throttle.
 */
const STICK_MODES: Record<
  StickMode,
  { leftY: 'throttle' | 'pitch'; leftX: 'yaw' | 'roll'; rightY: 'throttle' | 'pitch'; rightX: 'yaw' | 'roll' }
> = {
  mode1: { leftY: 'pitch', leftX: 'yaw', rightY: 'throttle', rightX: 'roll' },
  mode2: { leftY: 'throttle', leftX: 'yaw', rightY: 'pitch', rightX: 'roll' },
  mode3: { leftY: 'pitch', leftX: 'roll', rightY: 'throttle', rightX: 'yaw' },
  mode4: { leftY: 'throttle', leftX: 'roll', rightY: 'pitch', rightX: 'yaw' },
};

export class InputManager {
  readonly keyboard = new KeyboardInput();
  readonly gamepad = new GamepadInput();

  /** Final, shaped pilot command. */
  readonly control: ControlInput = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };

  /** Raw combined stick positions, exposed so the HUD can draw stick indicators. */
  readonly sticks: StickPair = { leftX: 0, leftY: 0, rightX: 0, rightY: 0 };

  private touchThrottle = 0;

  attach(): void {
    this.keyboard.attach();
  }

  detach(): void {
    this.keyboard.detach();
  }

  reset(): void {
    this.keyboard.reset();
    this.touchThrottle = 0;
    this.control.roll = this.control.pitch = this.control.yaw = 0;
    this.control.throttle = 0;
  }

  update(dt: number, settings: SimSettings): ControlInput {
    this.keyboard.update(dt, settings.stickyThrottle);
    this.gamepad.update();

    const map = STICK_MODES[settings.stickMode] ?? STICK_MODES.mode2;

    // The throttle axis on a touch screen has no spring, so remember where the
    // pilot left it when `stickyThrottle` is on and the finger lifts.
    const throttleSide = map.leftY === 'throttle' ? 'left' : 'right';
    const touchThrottleRaw = throttleSide === 'left' ? touchSticks.leftY : touchSticks.rightY;
    const throttleActive = throttleSide === 'left' ? touchSticks.leftActive : touchSticks.rightActive;

    if (throttleActive) {
      this.touchThrottle = (touchThrottleRaw + 1) * 0.5;
    } else if (!settings.stickyThrottle) {
      this.touchThrottle = 0;
    }

    // Combine sources.
    const leftX = clampUnit(touchSticks.leftX + this.gamepad.leftX);
    const rightX = clampUnit(touchSticks.rightX + this.gamepad.rightX);
    const leftY = clampUnit(touchSticks.leftY + this.gamepad.leftY);
    const rightY = clampUnit(touchSticks.rightY + this.gamepad.rightY);

    this.sticks.leftX = leftX;
    this.sticks.leftY = leftY;
    this.sticks.rightX = rightX;
    this.sticks.rightY = rightY;

    let roll = 0;
    let pitch = 0;
    let yaw = 0;
    let throttle = 0;

    // Horizontal axes are always self-centring control channels.
    if (map.leftX === 'yaw') yaw += leftX;
    else roll += leftX;
    if (map.rightX === 'yaw') yaw += rightX;
    else roll += rightX;

    // Vertical axes: one is the throttle, the other is pitch.
    if (map.leftY === 'throttle') {
      throttle += stickToThrottle(leftY, this.touchThrottle, this.gamepad.connected);
      pitch += rightY;
    } else {
      throttle += stickToThrottle(rightY, this.touchThrottle, this.gamepad.connected);
      pitch += leftY;
    }

    // Keyboard is always mapped in logical channels, independent of stick mode.
    roll += this.keyboard.roll;
    pitch += this.keyboard.pitch;
    yaw += this.keyboard.yaw;
    throttle = clamp(throttle + this.keyboard.throttle, 0, 1);

    if (settings.invertThrottleStick) throttle = 1 - throttle;

    const deadband = settings.deadband;
    this.control.roll = applyDeadband(clampUnit(roll), deadband);
    this.control.pitch = applyDeadband(clampUnit(pitch), deadband);
    this.control.yaw = applyDeadband(clampUnit(yaw), deadband);
    this.control.throttle = clamp(throttle, 0, 1);

    return this.control;
  }
}

/**
 * Convert a ±1 vertical stick into a 0..1 throttle.
 * With a gamepad the physical stick position wins; on a touch screen we use the
 * remembered "sticky" value so lifting a finger does not chop the throttle.
 */
function stickToThrottle(stick: number, sticky: number, gamepadConnected: boolean): number {
  if (gamepadConnected) return clamp((stick + 1) * 0.5, 0, 1);
  return clamp(sticky, 0, 1);
}
