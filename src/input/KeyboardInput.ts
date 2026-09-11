import { clampUnit, moveTowards } from '../core/MathUtils';
import { emitCommand, type SimCommand } from './InputState';

/**
 * Keyboard flying.
 *
 * Digital keys make terrible sticks, so every axis is ramped towards the key
 * state and springs back to centre when released. The ramp rates are tuned so
 * the quad is genuinely controllable with a keyboard while still feeling snappy.
 */

const AXIS_RISE = 3.4; // units per second towards the held direction
const AXIS_FALL = 5.2; // units per second back to centre
const THROTTLE_RATE = 1.15;

const COMMAND_KEYS: Record<string, SimCommand> = {
  Space: 'toggleArm',
  KeyR: 'reset',
  KeyC: 'cycleCamera',
  KeyM: 'cycleMode',
  KeyH: 'toggleHud',
  Escape: 'toggleMenu',
  KeyT: 'restartCourse',
  KeyN: 'toggleAudio',
};

export class KeyboardInput {
  private readonly pressed = new Set<string>();

  roll = 0;
  pitch = 0;
  yaw = 0;
  throttle = 0;

  /** True while any flight key is held — lets the mixer know keyboard is live. */
  active = false;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

    const command = COMMAND_KEYS[event.code];
    if (command) {
      event.preventDefault();
      emitCommand(command);
      return;
    }
    if (FLIGHT_KEYS.has(event.code)) {
      event.preventDefault();
      this.pressed.add(event.code);
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.pressed.clear();
  };

  attach(target: Window = window): void {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
  }

  detach(target: Window = window): void {
    target.removeEventListener('keydown', this.onKeyDown);
    target.removeEventListener('keyup', this.onKeyUp);
    target.removeEventListener('blur', this.onBlur);
  }

  private axis(negative: string[], positive: string[]): number {
    let value = 0;
    for (const key of negative) if (this.pressed.has(key)) value -= 1;
    for (const key of positive) if (this.pressed.has(key)) value += 1;
    return clampUnit(value);
  }

  update(dt: number, stickyThrottle: boolean): void {
    const rollTarget = this.axis(['ArrowLeft'], ['ArrowRight']);
    const pitchTarget = this.axis(['ArrowDown'], ['ArrowUp']);
    const yawTarget = this.axis(['KeyA'], ['KeyD']);
    const throttleTarget = this.axis(['KeyS'], ['KeyW']);

    this.roll = rampAxis(this.roll, rollTarget, dt);
    this.pitch = rampAxis(this.pitch, pitchTarget, dt);
    this.yaw = rampAxis(this.yaw, yawTarget, dt);

    if (stickyThrottle) {
      // W/S nudge the throttle up and down and it stays where you leave it,
      // exactly like the ratcheted throttle stick on a real radio.
      this.throttle = Math.min(Math.max(this.throttle + throttleTarget * THROTTLE_RATE * dt, 0), 1);
    } else {
      this.throttle = Math.min(Math.max(rampAxis(this.throttle, Math.max(throttleTarget, 0), dt), 0), 1);
    }

    this.active = this.pressed.size > 0;
  }

  reset(): void {
    this.roll = this.pitch = this.yaw = 0;
    this.throttle = 0;
    this.pressed.clear();
  }
}

const FLIGHT_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'KeyA',
  'KeyD',
  'KeyW',
  'KeyS',
]);

function rampAxis(current: number, target: number, dt: number): number {
  const rate = target === 0 ? AXIS_FALL : AXIS_RISE;
  return moveTowards(current, target, rate * dt);
}
