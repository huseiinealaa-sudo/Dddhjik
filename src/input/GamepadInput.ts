import { emitCommand } from './InputState';

/**
 * Gamepad / RC-transmitter support through the Web Gamepad API.
 *
 * Most USB radio adapters (and every game controller) expose four analogue
 * axes in the same order as a Mode 2 transmitter, so the raw axes are handed
 * to the input manager untouched and mapped there.
 */
export class GamepadInput {
  leftX = 0;
  leftY = 0;
  rightX = 0;
  rightY = 0;
  connected = false;
  name = '';

  private previousButtons: boolean[] = [];

  update(): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) {
      this.connected = false;
      return;
    }

    const pads = navigator.getGamepads();
    let pad: Gamepad | null = null;
    for (const candidate of pads) {
      if (candidate && candidate.connected) {
        pad = candidate;
        break;
      }
    }

    if (!pad) {
      this.connected = false;
      this.name = '';
      this.leftX = this.leftY = this.rightX = this.rightY = 0;
      return;
    }

    this.connected = true;
    this.name = pad.id;

    // Browser axes are +1 downwards on the vertical sticks; flip to "up = +1".
    this.leftX = pad.axes[0] ?? 0;
    this.leftY = -(pad.axes[1] ?? 0);
    this.rightX = pad.axes[2] ?? 0;
    this.rightY = -(pad.axes[3] ?? 0);

    // Face buttons: A = arm, B = reset, X = camera, Y = flight mode.
    const commands = ['toggleArm', 'reset', 'cycleCamera', 'cycleMode'] as const;
    for (let i = 0; i < commands.length; i++) {
      const pressed = pad.buttons[i]?.pressed ?? false;
      if (pressed && !this.previousButtons[i]) emitCommand(commands[i]);
      this.previousButtons[i] = pressed;
    }
  }
}
