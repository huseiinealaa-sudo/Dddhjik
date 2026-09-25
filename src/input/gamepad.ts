import type { FlightMode } from '../sim/types';
import { emit } from './bus';
import { readAxis, type Channel, type GamepadMapping } from './mapping';

export interface GamepadSnapshot {
  connected: boolean;
  id: string;
  axes: number[];
  buttons: boolean[];
}

/**
 * Web Gamepad API reader. Keeps a raw snapshot (for the mapping screen and
 * "move a stick to bind" learning) and the mapped channel values.
 */
export class GamepadInput {
  readonly snapshot: GamepadSnapshot = { connected: false, id: '', axes: [], buttons: [] };
  readonly channels: Record<Channel, number> = { roll: 0, pitch: 0, yaw: 0, throttle: 0, arm: 0, mode: 0, turtle: 0 };
  /** Physical stick positions for the console-controller profile (+y = up). */
  leftX = 0;
  leftY = 0;
  rightX = 0;
  rightY = 0;
  private prevButtons: boolean[] = [];

  poll(mapping: GamepadMapping): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    const snap = this.snapshot;
    if (!pad) {
      snap.connected = false;
      snap.id = '';
      snap.axes.length = 0;
      snap.buttons.length = 0;
      this.leftX = this.leftY = this.rightX = this.rightY = 0;
      return;
    }

    snap.connected = true;
    snap.id = pad.id;
    snap.axes.length = pad.axes.length;
    for (let i = 0; i < pad.axes.length; i++) snap.axes[i] = pad.axes[i];
    snap.buttons.length = pad.buttons.length;
    for (let i = 0; i < pad.buttons.length; i++) snap.buttons[i] = pad.buttons[i]?.pressed ?? false;

    this.leftX = pad.axes[0] ?? 0;
    this.leftY = -(pad.axes[1] ?? 0);
    this.rightX = pad.axes[2] ?? 0;
    this.rightY = -(pad.axes[3] ?? 0);

    for (const [name, b] of Object.entries(mapping.channels) as [Channel, (typeof mapping.channels)[Channel]][]) {
      if (b.kind === 'axis') this.channels[name] = readAxis(pad.axes[b.index] ?? 0, b);
      else if (b.kind === 'button') {
        const pressed = pad.buttons[b.index]?.pressed ?? false;
        this.channels[name] = (pressed ? 1 : -1) * (b.invert ? -1 : 1);
      } else this.channels[name] = 0;
    }

    for (const [indexText, command] of Object.entries(mapping.buttons)) {
      const i = Number(indexText);
      const pressed = snap.buttons[i] ?? false;
      if (command && pressed && !this.prevButtons[i]) emit(command);
    }
    this.prevButtons = snap.buttons.slice();
  }

  /** Arm switch state, or null when no arm channel is bound. */
  armSwitch(mapping: GamepadMapping): boolean | null {
    if (!this.snapshot.connected || mapping.channels.arm.kind === 'none') return null;
    return this.channels.arm > 0.3;
  }

  modeSwitch(mapping: GamepadMapping): FlightMode | null {
    if (!this.snapshot.connected || mapping.channels.mode.kind === 'none') return null;
    const v = this.channels.mode;
    return v < -0.33 ? 'acro' : v > 0.33 ? 'angle' : 'horizon';
  }

  turtleSwitch(mapping: GamepadMapping): boolean | null {
    if (!this.snapshot.connected || mapping.channels.turtle.kind === 'none') return null;
    return this.channels.turtle > 0.3;
  }
}
