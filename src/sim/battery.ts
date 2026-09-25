import { clamp } from './math';

/**
 * Lithium pack model: open-circuit voltage from state of charge, an ohmic
 * resistance for the instant sag, and an RC branch for the slower polarisation
 * sag that makes a pack "recover" a few seconds after you chop the throttle.
 */

// [state of charge, volts per cell]
const LIPO: ReadonlyArray<readonly [number, number]> = [
  [-0.15, 2.7],
  [0, 3.27],
  [0.05, 3.5],
  [0.1, 3.62],
  [0.15, 3.68],
  [0.2, 3.72],
  [0.3, 3.77],
  [0.4, 3.81],
  [0.5, 3.85],
  [0.6, 3.89],
  [0.7, 3.95],
  [0.8, 4.02],
  [0.9, 4.1],
  [1, 4.2],
];

const LIION: ReadonlyArray<readonly [number, number]> = [
  [-0.15, 2.5],
  [0, 2.9],
  [0.05, 3.1],
  [0.1, 3.25],
  [0.2, 3.4],
  [0.3, 3.5],
  [0.4, 3.6],
  [0.5, 3.68],
  [0.6, 3.76],
  [0.7, 3.85],
  [0.8, 3.95],
  [0.9, 4.06],
  [1, 4.18],
];

function interpolate(table: ReadonlyArray<readonly [number, number]>, soc: number): number {
  if (soc <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [s1, v1] = table[i];
    if (soc <= s1) {
      const [s0, v0] = table[i - 1];
      return v0 + ((v1 - v0) * (soc - s0)) / (s1 - s0);
    }
  }
  return table[table.length - 1][1];
}

export interface BatterySpec {
  cells: number;
  capacityMah: number;
  resistance: number;
  chemistry: 'lipo' | 'liion';
}

export class Battery {
  /** State of charge; goes slightly negative when a pack is run flat. */
  soc = 1;
  mahUsed = 0;
  current = 0;
  voltage: number;
  private polarisation = 0;
  private readonly table: ReadonlyArray<readonly [number, number]>;
  readonly fullVoltage: number;

  constructor(private readonly spec: BatterySpec) {
    this.table = spec.chemistry === 'liion' ? LIION : LIPO;
    this.fullVoltage = spec.cells * interpolate(this.table, 1);
    this.voltage = this.fullVoltage;
  }

  reset(): void {
    this.soc = 1;
    this.mahUsed = 0;
    this.current = 0;
    this.polarisation = 0;
    this.voltage = this.fullVoltage;
  }

  get cells(): number {
    return this.spec.cells;
  }

  get cellVoltage(): number {
    return this.voltage / this.spec.cells;
  }

  get percent(): number {
    return clamp(this.soc, 0, 1) * 100;
  }

  /**
   * @param amps  total current draw this step
   * @param drain false for "infinite battery" practice: voltage still sags,
   *              but no capacity is consumed
   */
  update(amps: number, dt: number, drain: boolean): void {
    this.current = amps;
    if (drain) {
      this.mahUsed += (amps * dt) / 3.6;
      this.soc = Math.max(1 - this.mahUsed / this.spec.capacityMah, -0.15);
    }
    const rp = this.spec.resistance * 0.6;
    this.polarisation += (amps * rp - this.polarisation) * (1 - Math.exp(-dt / 6));
    const ocv = this.spec.cells * interpolate(this.table, this.soc);
    this.voltage = Math.max(ocv - amps * this.spec.resistance - this.polarisation, this.spec.cells * 2.2);
  }
}
