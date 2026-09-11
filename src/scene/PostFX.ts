import {
  BufferGeometry,
  Float32BufferAttribute,
  LinearFilter,
  Mesh,
  NoBlending,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { createNoiseTexture } from './Textures';

/**
 * A single-pass "analogue video" effect that turns a clean WebGL render into
 * something that looks like it came out of a 5.8 GHz video link and a pair of
 * goggles: barrel distortion from the fisheye lens, chromatic fringing,
 * scanlines, vignetting and static that gets worse as the link degrades.
 *
 * Deliberately implemented without three's EffectComposer — one render target
 * and one fullscreen triangle is all this needs, which matters on a tablet.
 */

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform sampler2D tDiffuse;
  uniform sampler2D tNoise;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uDistortion;
  uniform float uAberration;
  uniform float uVignette;
  uniform float uScanline;
  uniform float uStatic;
  uniform float uGlitch;

  /**
   * Barrel distortion around the centre of the frame.
   *
   * The pre-zoom matters: pushing pixels outwards would otherwise pull the
   * frame away from the corners and leave four black wedges. Scaling the
   * sampling coordinates in first keeps the image edge-to-edge.
   */
  vec2 distort(vec2 uv, float amount) {
    vec2 centred = (uv - 0.5) / (1.0 + amount * 0.62);
    float r2 = dot(centred, centred);
    return centred * (1.0 + amount * r2 + amount * 0.35 * r2 * r2) + 0.5;
  }

  void main() {
    vec2 uv = vUv;

    // Horizontal tearing when the video link is struggling.
    float tear = 0.0;
    if (uGlitch > 0.001) {
      float band = step(1.0 - uGlitch * 0.35, fract(uv.y * 14.0 + uTime * 3.1));
      tear = band * uGlitch * 0.035 * (texture2D(tNoise, vec2(uv.y * 3.0, uTime * 0.7)).r - 0.5);
    }
    uv.x += tear;

    vec2 base = distort(uv, uDistortion);

    // Chromatic aberration grows towards the edge of the lens.
    float edge = length(base - 0.5);
    float shift = uAberration * (0.0002 + edge * 0.0016);
    vec2 dir = normalize(base - 0.5 + 1e-6);

    vec3 colour;
    colour.r = texture2D(tDiffuse, base + dir * shift).r;
    colour.g = texture2D(tDiffuse, base).g;
    colour.b = texture2D(tDiffuse, base - dir * shift).b;

    // Anything sampled outside the frame is black — that is the goggle bezel.
    float inside = step(0.0, base.x) * step(base.x, 1.0) * step(0.0, base.y) * step(base.y, 1.0);
    colour *= inside;

    // Scanlines. A fixed line count (rather than one per physical pixel) keeps
    // the pattern stable instead of turning into moire on a retina display.
    float lines = sin(base.y * 720.0) * 0.5 + 0.5;
    colour *= 1.0 - uScanline * lines * 0.16;

    // Analogue static, driven by the link quality.
    if (uStatic > 0.001) {
      vec2 noiseUv = base * vec2(1.7, 1.1) + vec2(uTime * 7.3, uTime * 11.7);
      float n = texture2D(tNoise, fract(noiseUv)).r;
      colour = mix(colour, vec3(n), uStatic * 0.55);
    }

    // Vignette — wide and soft, so it frames the image without eating it.
    float v = smoothstep(1.08, 0.44, edge);
    colour *= mix(1.0, v, uVignette);

    // Slight contrast/saturation lift so the image reads well in goggles.
    colour = clamp((colour - 0.5) * 1.06 + 0.5, 0.0, 1.0);
    float luma = dot(colour, vec3(0.299, 0.587, 0.114));
    colour = mix(vec3(luma), colour, 1.08);

    gl_FragColor = vec4(colour, 1.0);
  }
`;

export interface PostFXParams {
  distortion: number;
  aberration: number;
  vignette: number;
  scanline: number;
  staticAmount: number;
  glitch: number;
}

export class PostFX {
  private readonly target: WebGLRenderTarget;
  private readonly quadScene = new Scene();
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;
  private readonly noise: Texture;
  private readonly quad: Mesh;

  enabled = true;

  constructor(renderer: WebGLRenderer) {
    const size = renderer.getDrawingBufferSize(new Vector2());
    this.target = new WebGLRenderTarget(Math.max(size.x, 1), Math.max(size.y, 1), {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      format: RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false,
    });

    this.noise = createNoiseTexture(256);

    this.material = new ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture },
        tNoise: { value: this.noise },
        uResolution: { value: new Vector2(size.x, size.y) },
        uTime: { value: 0 },
        uDistortion: { value: 0.15 },
        uAberration: { value: 1 },
        uVignette: { value: 0.5 },
        uScanline: { value: 0.35 },
        uStatic: { value: 0 },
        uGlitch: { value: 0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });

    // Fullscreen triangle — cheaper than a quad and avoids the diagonal seam.
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    geometry.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new Mesh(geometry, this.material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    const w = Math.max(Math.floor(width * pixelRatio), 1);
    const h = Math.max(Math.floor(height * pixelRatio), 1);
    this.target.setSize(w, h);
    (this.material.uniforms.uResolution.value as Vector2).set(w, h);
  }

  setParams(params: Partial<PostFXParams>): void {
    const u = this.material.uniforms;
    if (params.distortion !== undefined) u.uDistortion.value = params.distortion;
    if (params.aberration !== undefined) u.uAberration.value = params.aberration;
    if (params.vignette !== undefined) u.uVignette.value = params.vignette;
    if (params.scanline !== undefined) u.uScanline.value = params.scanline;
    if (params.staticAmount !== undefined) u.uStatic.value = params.staticAmount;
    if (params.glitch !== undefined) u.uGlitch.value = params.glitch;
  }

  render(renderer: WebGLRenderer, scene: Scene, camera: Camera, elapsed: number): void {
    if (!this.enabled) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }

    this.material.uniforms.uTime.value = elapsed;

    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, camera);

    renderer.setRenderTarget(null);
    renderer.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
    this.noise.dispose();
  }
}
