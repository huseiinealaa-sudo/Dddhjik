import { moveTowards } from '../sim/math';
import { emit, type Command } from './bus';

/**
 * Keyboard flying. Keys are digital, so every axis ramps towards the pressed
 * direction and springs back when released; the throttle can either stay where
 * you leave it (like a real radio) or spring back to zero.
 *
 *   W / S   throttle        A / D   yaw
 *   ↑ / ↓   pitch           ← / →   roll
 */

const COMMANDS: Record<string, Command> = {
  Space: 'arm',
  KeyR: 'reset',
  KeyC: 'camera',
  KeyM: 'mode',
  KeyT: 'turtle',
  Escape: 'pause',
  KeyP: 'pause',
  KeyH: 'hud',
  Backspace: 'restart',
  KeyN: 'audio',
};

const FLIGHT_KEYS = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);

export class KeyboardInput {
  roll = 0;
  pitch = 0;
  yaw = 0;
  throttle = 0;
  /** Seconds since a flight key was last pressed. */
  idleTime = Infinity;

  private readonly down = new Set<string>();

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    const command = COMMANDS[e.code];
    if (command) {
      if (!e.repeat) emit(command);
      e.preventDefault();
      return;
    }
    if (FLIGHT_KEYS.has(e.code)) {
      this.down.add(e.code);
      e.preventDefault();
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private readonly onBlur = (): void => this.down.clear();

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  reset(): void {
    this.roll = this.pitch = this.yaw = this.throttle = 0;
    this.down.clear();
  }

  private axis(neg: string, pos: string): number {
    return (this.down.has(pos) ? 1 : 0) - (this.down.has(neg) ? 1 : 0);
  }

  update(dt: number, stickyThrottle: boolean): void {
    // Shift = precision: slower ramps and half deflection.
    const fine = this.down.has('ShiftLeft') || this.down.has('ShiftRight');
    const reach = fine ? 0.45 : 1;
    const rise = fine ? 1.8 : 3.4;
    const fall = 5.5;

    const ramp = (v: number, target: number): number => moveTowards(v, target * reach, (target === 0 ? fall : rise) * dt);
    this.roll = ramp(this.roll, this.axis('ArrowLeft', 'ArrowRight'));
    this.pitch = ramp(this.pitch, this.axis('ArrowDown', 'ArrowUp'));
    this.yaw = ramp(this.yaw, this.axis('KeyA', 'KeyD'));

    const t = this.axis('KeyS', 'KeyW');
    if (stickyThrottle) {
      this.throttle = Math.min(Math.max(this.throttle + t * (fine ? 0.35 : 0.8) * dt, 0), 1);
    } else {
      this.throttle = moveTowards(this.throttle, t > 0 ? 1 : 0, (t > 0 ? 1.4 : 2.5) * dt);
    }

    this.idleTime = this.down.size > 0 ? 0 : this.idleTime + dt;
  }
}
