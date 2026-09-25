import { clamp, clamp01, deadband } from '../sim/math';
import type { FlightMode, Sticks } from '../sim/types';
import { touchSticks } from './bus';
import { GamepadInput } from './gamepad';
import { KeyboardInput } from './keyboard';
import type { GamepadMapping } from './mapping';

export type StickMode = 'mode1' | 'mode2' | 'mode3' | 'mode4';
export type InputSource = 'touch' | 'keyboard' | 'gamepad';

export interface InputConfig {
  stickMode: StickMode;
  deadband: number;
  stickyThrottle: boolean;
  mapping: GamepadMapping;
}

/** Which physical axis drives which channel, per transmitter mode. */
export const STICK_LAYOUT: Record<StickMode, { leftX: 'yaw' | 'roll'; leftY: 'throttle' | 'pitch'; rightX: 'yaw' | 'roll'; rightY: 'throttle' | 'pitch' }> = {
  mode1: { leftX: 'yaw', leftY: 'pitch', rightX: 'roll', rightY: 'throttle' },
  mode2: { leftX: 'yaw', leftY: 'throttle', rightX: 'roll', rightY: 'pitch' },
  mode3: { leftX: 'roll', leftY: 'pitch', rightX: 'yaw', rightY: 'throttle' },
  mode4: { leftX: 'roll', leftY: 'throttle', rightX: 'yaw', rightY: 'pitch' },
};

interface ChannelSet {
  roll: number;
  pitch: number;
  yaw: number;
  throttle: number;
}

function fromPhysical(mode: StickMode, lx: number, ly: number, rx: number, ry: number, out: ChannelSet): ChannelSet {
  const l = STICK_LAYOUT[mode];
  out.roll = out.pitch = out.yaw = 0;
  out.throttle = 0;
  out[l.leftX] += lx;
  out[l.rightX] += rx;
  if (l.leftY === 'throttle') {
    out.throttle = (ly + 1) / 2;
    out.pitch = ry;
  } else {
    out.throttle = (ry + 1) / 2;
    out.pitch = ly;
  }
  return out;
}

/**
 * Merges touch, keyboard and gamepad/radio into one pilot command.
 *
 * Roll, pitch and yaw are summed (idle sources contribute zero). The throttle
 * is different — a gamepad resting on the table still reports 50 %, which must
 * not fight the touch stick — so it follows whichever source moved last.
 */
export class InputManager {
  readonly keyboard = new KeyboardInput();
  readonly gamepad = new GamepadInput();
  readonly sticks: Sticks = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
  switches: { arm: boolean | null; mode: FlightMode | null; turtle: boolean | null } = { arm: null, mode: null, turtle: null };
  throttleSource: InputSource = 'touch';

  private readonly touch: ChannelSet = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
  private readonly pad: ChannelSet = { roll: 0, pitch: 0, yaw: 0, throttle: 0 };
  private lastTouchThrottle = 0;
  private lastPadThrottle = -1;
  private lastKeyThrottle = 0;

  attach(): void {
    this.keyboard.attach();
  }

  detach(): void {
    this.keyboard.detach();
  }

  reset(): void {
    this.keyboard.reset();
    this.sticks.roll = this.sticks.pitch = this.sticks.yaw = this.sticks.throttle = 0;
  }

  update(dt: number, cfg: InputConfig): Sticks {
    this.keyboard.update(dt, cfg.stickyThrottle);
    this.gamepad.poll(cfg.mapping);

    fromPhysical(cfg.stickMode, touchSticks.leftX, touchSticks.leftY, touchSticks.rightX, touchSticks.rightY, this.touch);

    const gp = this.gamepad;
    const padConnected = gp.snapshot.connected;
    if (padConnected) {
      if (cfg.mapping.profile === 'gamepad') {
        fromPhysical(cfg.stickMode, gp.leftX, gp.leftY, gp.rightX, gp.rightY, this.pad);
      } else {
        this.pad.roll = gp.channels.roll;
        this.pad.pitch = gp.channels.pitch;
        this.pad.yaw = gp.channels.yaw;
        this.pad.throttle = (gp.channels.throttle + 1) / 2;
      }
    } else {
      this.pad.roll = this.pad.pitch = this.pad.yaw = 0;
      this.pad.throttle = 0;
    }

    // Throttle follows the source that moved most recently.
    if (Math.abs(this.touch.throttle - this.lastTouchThrottle) > 0.01) this.throttleSource = 'touch';
    if (padConnected && this.lastPadThrottle >= 0 && Math.abs(this.pad.throttle - this.lastPadThrottle) > 0.03) this.throttleSource = 'gamepad';
    if (Math.abs(this.keyboard.throttle - this.lastKeyThrottle) > 0.001) this.throttleSource = 'keyboard';
    this.lastTouchThrottle = this.touch.throttle;
    this.lastPadThrottle = padConnected ? this.pad.throttle : -1;
    this.lastKeyThrottle = this.keyboard.throttle;

    let throttle: number;
    switch (this.throttleSource) {
      case 'gamepad':
        throttle = this.pad.throttle;
        break;
      case 'keyboard':
        throttle = this.keyboard.throttle;
        break;
      default:
        throttle = this.touch.throttle;
    }

    const db = cfg.deadband;
    this.sticks.roll = deadband(clamp(this.touch.roll + this.pad.roll + this.keyboard.roll, -1, 1), db);
    this.sticks.pitch = deadband(clamp(this.touch.pitch + this.pad.pitch + this.keyboard.pitch, -1, 1), db);
    this.sticks.yaw = deadband(clamp(this.touch.yaw + this.pad.yaw + this.keyboard.yaw, -1, 1), db);
    this.sticks.throttle = clamp01(throttle);

    this.switches.arm = gp.armSwitch(cfg.mapping);
    this.switches.mode = gp.modeSwitch(cfg.mapping);
    this.switches.turtle = gp.turtleSwitch(cfg.mapping);
    return this.sticks;
  }

  /** Put the (sticky) touch throttle back to zero, e.g. after a reset. */
  zeroTouchThrottle(stickMode: StickMode): void {
    if (STICK_LAYOUT[stickMode].leftY === 'throttle') touchSticks.leftY = -1;
    else touchSticks.rightY = -1;
    this.keyboard.throttle = 0;
  }
}
