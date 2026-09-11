import { BATTERY_SPEC } from '../core/Defaults';
import { clamp } from '../core/MathUtils';

/**
 * Simple but convincing LiPo model.
 *
 * A real pack does two things a pilot notices immediately:
 *  1. the voltage sags under load (I * R_internal) and springs back when the
 *     throttle is chopped — this is what makes the low-voltage warning flicker;
 *  2. as the pack drains, the resting voltage drops, so the motors can no
 *     longer reach full RPM and the quad feels progressively heavier.
 */
export class Battery {
  /** Consumed capacity in mAh. */
  private consumedMah = 0;
  /** Voltage under load, volts. */
  private loadedVoltage = BATTERY_SPEC.cells * BATTERY_SPEC.cellFullVolts;
  private currentAmps = 0;
  /** Smoothed current for the HUD. */
  private displayAmps = 0;

  reset(): void {
    this.consumedMah = 0;
    this.loadedVoltage = BATTERY_SPEC.cells * BATTERY_SPEC.cellFullVolts;
    this.currentAmps = 0;
    this.displayAmps = 0;
  }

  /** Charge level, 0..1, based on consumed capacity. */
  get charge(): number {
    return clamp(1 - this.consumedMah / BATTERY_SPEC.capacityMah, 0, 1);
  }

  get voltage(): number {
    return this.loadedVoltage;
  }

  get amps(): number {
    return this.displayAmps;
  }

  get mah(): number {
    return this.consumedMah;
  }

  get empty(): boolean {
    return this.charge <= 0.0001;
  }

  /** Resting (no load) voltage — LiPo discharge curve approximated with a soft knee. */
  private restingVoltage(): number {
    const c = this.charge;
    const { cellFullVolts, cellEmptyVolts, cells } = BATTERY_SPEC;
    // Flat middle section with a steep drop at both ends, like a real LiPo.
    const shaped = 0.06 * Math.log(1 + 60 * c) + 0.72 * c + 0.22 * c ** 3;
    const normalised = clamp(shaped / (0.06 * Math.log(61) + 0.72 + 0.22), 0, 1);
    return cells * (cellEmptyVolts + (cellFullVolts - cellEmptyVolts) * normalised);
  }

  /**
   * @param motorLoad sum of the four normalised motor commands (0..4)
   * @param dt        seconds
   */
  update(motorLoad: number, dt: number, enabled: boolean): void {
    const normalisedLoad = clamp(motorLoad / 4, 0, 1);
    // Current rises faster than linearly with throttle — power is roughly cubic in RPM.
    this.currentAmps =
      BATTERY_SPEC.idleAmps + (BATTERY_SPEC.maxAmps - BATTERY_SPEC.idleAmps) * normalisedLoad ** 1.8;

    this.displayAmps += (this.currentAmps - this.displayAmps) * clamp(dt * 6, 0, 1);

    if (enabled) {
      this.consumedMah += (this.currentAmps * 1000 * dt) / 3600;
      if (this.consumedMah > BATTERY_SPEC.capacityMah) this.consumedMah = BATTERY_SPEC.capacityMah;
    }

    const resting = enabled ? this.restingVoltage() : BATTERY_SPEC.cells * BATTERY_SPEC.cellFullVolts;
    const target = Math.max(resting - this.currentAmps * BATTERY_SPEC.internalResistance, 0);
    // The pack has some capacitance; sag is fast but not instantaneous.
    this.loadedVoltage += (target - this.loadedVoltage) * clamp(dt * 25, 0, 1);
  }

  /**
   * Thrust scales with the square of the RPM and RPM scales with voltage, so a
   * sagging pack loses thrust quadratically. Returns a 0..1 multiplier.
   */
  thrustScale(enabled: boolean): number {
    if (!enabled) return 1;
    const full = BATTERY_SPEC.cells * BATTERY_SPEC.cellFullVolts;
    const ratio = clamp(this.loadedVoltage / full, 0, 1);
    return clamp(ratio * ratio, 0, 1);
  }
}
