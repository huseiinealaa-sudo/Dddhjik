/**
 * Motor layout shared by the physics, the flight controller, the renderer and
 * the audio. Order matches the Betaflight Quad-X mixer rows used here:
 *
 *   0 = front-left   1 = front-right   2 = rear-left   3 = rear-right
 *
 * Nose is -z. `spin` is +1 for props turning clockwise seen from above; their
 * drag torque pushes the frame counter-clockwise (+y).
 */
export const MOTOR_X = [-1, 1, -1, 1] as const;
export const MOTOR_Z = [-1, -1, 1, 1] as const;
export const MOTOR_SPIN = [1, -1, -1, 1] as const;

/**
 * Mixer factors for [roll, pitch, yaw] in pilot axes
 * (roll right +, pitch forward/nose-down +, yaw right +).
 * Identical to Betaflight's QUADX table.
 */
export const MIX_ROLL = [1, -1, 1, -1] as const;
export const MIX_PITCH = [-1, -1, 1, 1] as const;
export const MIX_YAW = [-1, 1, 1, -1] as const;
