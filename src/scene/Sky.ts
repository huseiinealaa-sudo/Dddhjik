import {
  BackSide,
  BufferGeometry,
  Color,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';

/**
 * Analytic sky dome: a vertical gradient with a warm band at the horizon and a
 * sun disc with a soft glow. Cheap (one draw call, no textures) and it gives
 * the scene a believable outdoor light without an HDRI download.
 */

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldDirection;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldDirection = normalize(worldPosition.xyz - cameraPosition);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position.z = gl_Position.w; // always render at the far plane
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vWorldDirection;

  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uSunSize;

  void main() {
    vec3 dir = normalize(vWorldDirection);
    float h = dir.y;

    // Sky gradient: ground haze below the horizon, warm band at it, deep blue up top.
    float up = clamp(h, 0.0, 1.0);
    vec3 sky = mix(uHorizon, uZenith, pow(up, 0.42));
    vec3 below = mix(uHorizon, uGround, clamp(-h * 3.0, 0.0, 1.0));
    vec3 colour = h > 0.0 ? sky : below;

    // Sun disc + glow.
    float cosAngle = dot(dir, normalize(uSunDirection));
    float disc = smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.35, cosAngle);
    float glow = pow(clamp(cosAngle, 0.0, 1.0), 180.0) * 0.7
               + pow(clamp(cosAngle, 0.0, 1.0), 12.0) * 0.28;
    colour += uSunColor * (disc * 1.6 + glow);

    // Subtle horizon haze so distant geometry melts into the sky.
    colour = mix(colour, uHorizon, pow(1.0 - abs(h), 14.0) * 0.55);

    gl_FragColor = vec4(colour, 1.0);
  }
`;

export interface SkyOptions {
  zenith?: Color;
  horizon?: Color;
  ground?: Color;
  sunColor?: Color;
}

export class Sky {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;

  constructor(sunDirection: Vector3, options: SkyOptions = {}) {
    const material = new ShaderMaterial({
      uniforms: {
        uZenith: { value: options.zenith ?? new Color('#3d7fd0') },
        uHorizon: { value: options.horizon ?? new Color('#c8dcee') },
        uGround: { value: options.ground ?? new Color('#6d7360') },
        uSunDirection: { value: sunDirection.clone().normalize() },
        uSunColor: { value: options.sunColor ?? new Color('#fff3d6') },
        uSunSize: { value: 0.00009 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });

    this.mesh = new Mesh(new SphereGeometry(1, 32, 16), material);
    this.mesh.frustumCulled = false;
    // Draw first, before anything else writes to the depth buffer.
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';
  }

  setSunDirection(direction: Vector3): void {
    (this.mesh.material.uniforms.uSunDirection.value as Vector3).copy(direction).normalize();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
