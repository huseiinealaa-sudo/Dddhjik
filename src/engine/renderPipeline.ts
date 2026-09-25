import {
  ACESFilmicToneMapping,
  BufferAttribute,
  BufferGeometry,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NoToneMapping,
  OrthographicCamera,
  PCFShadowMap,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
  type Camera,
} from 'three';
import type { Quality } from './environment';
import { POST_FRAGMENT, POST_VERTEX } from './postShader';

export type VideoLook = 'clean' | 'digital' | 'analog';

const LOOK_INDEX: Record<VideoLook, number> = { clean: 0, digital: 1, analog: 2 };

export interface PostState {
  look: VideoLook;
  /** Barrel distortion strength; 0 for non-FPV cameras. */
  distortion: number;
  /** Video link quality, 1 = perfect. */
  signal: number;
  /** Transient static / flash, 0..1. */
  flash: number;
}

/**
 * Owns the WebGL renderer: HDR scene render (MSAA where available) followed by
 * the video-look post pass, with dynamic resolution to hold the frame rate on
 * tablets. Falls back to direct rendering if HDR targets are unsupported.
 */
export class RenderPipeline {
  readonly renderer: WebGLRenderer;
  private target: WebGLRenderTarget | null = null;
  private readonly postScene = new Scene();
  private readonly postCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly postMaterial: ShaderMaterial;
  private readonly size = new Vector2();
  private quality: Quality = 'high';
  private usePost = true;
  /** Fraction of device resolution actually rendered (dynamic). */
  scale = 1;
  private maxScale = 1;
  private frameMs = 16.7;
  private settle = 0;
  private dpr = 1;
  private time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.shadowMap.enabled = true;

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    geo.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.postMaterial = new ShaderMaterial({
      vertexShader: POST_VERTEX,
      fragmentShader: POST_FRAGMENT,
      uniforms: {
        tDiffuse: { value: null },
        uResolution: { value: new Vector2(1, 1) },
        uTime: { value: 0 },
        uDistortion: { value: 0 },
        uAspect: { value: 1 },
        uLook: { value: 0 },
        uSignal: { value: 1 },
        uFlash: { value: 0 },
        uVignette: { value: 0.35 },
        uSaturation: { value: 1.08 },
        uContrast: { value: 1.04 },
        toneMappingExposure: { value: 1.0 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const quad = new Mesh(geo, this.postMaterial);
    quad.frustumCulled = false;
    this.postScene.add(quad);
  }

  get capabilitiesSummary(): string {
    const gl = this.renderer.getContext();
    return `${this.usePost ? 'hdr' : 'ldr'} ${this.target?.samples ?? 0}x ${gl.getParameter(gl.VERSION)}`;
  }

  configure(quality: Quality): void {
    this.quality = quality;
    const r = this.renderer;
    r.shadowMap.enabled = quality !== 'low';
    const canHalf = r.extensions.has('EXT_color_buffer_half_float') || r.extensions.has('EXT_color_buffer_float');
    this.usePost = true;
    const samples = quality === 'high' ? 4 : quality === 'medium' ? 2 : 0;
    this.target?.dispose();
    this.target = new WebGLRenderTarget(1, 1, {
      type: canHalf ? HalfFloatType : UnsignedByteType,
      samples: Math.min(samples, r.capabilities.maxSamples),
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
    });
    // Without float targets the scene must be tone mapped before it is stored.
    r.toneMapping = canHalf ? NoToneMapping : ACESFilmicToneMapping;
    if (!canHalf) this.usePost = false;
    this.maxScale = quality === 'high' ? 1 : quality === 'medium' ? 0.85 : 0.7;
    this.scale = Math.min(this.scale, this.maxScale);
    this.resize(true);
  }

  /** Resize to the canvas' CSS size; cheap when nothing changed. */
  resize(force = false): void {
    const canvas = this.renderer.domElement;
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    // Retina iPads are 2x; beyond ~1.5x the GPU cost isn't worth it for a moving image.
    const dprCap = this.quality === 'high' ? 1.5 : this.quality === 'medium' ? 1.25 : 1;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    if (!force && w === this.size.x && h === this.size.y && dpr === this.dpr) return;
    this.size.set(w, h);
    this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.applyScale();
  }

  private applyScale(): void {
    const w = Math.max(1, Math.round(this.size.x * this.dpr * this.scale));
    const h = Math.max(1, Math.round(this.size.y * this.dpr * this.scale));
    this.target?.setSize(w, h);
    this.postMaterial.uniforms.uResolution.value.set(w, h);
    this.postMaterial.uniforms.uAspect.value = this.size.x / this.size.y;
  }

  get aspect(): number {
    return this.size.x / Math.max(1, this.size.y);
  }

  /** Dynamic resolution: trade pixels for a steady frame rate. */
  private adapt(dtMs: number): void {
    this.frameMs += (Math.min(dtMs, 100) - this.frameMs) * 0.05;
    this.settle -= dtMs;
    if (this.settle > 0 || !this.usePost) return;
    let next = this.scale;
    if (this.frameMs > 20.5) next = Math.max(0.5, this.scale - 0.08);
    else if (this.frameMs < 15.2) next = Math.min(this.maxScale, this.scale + 0.04);
    if (Math.abs(next - this.scale) > 0.001) {
      this.scale = next;
      this.applyScale();
      this.settle = 1200;
    }
  }

  render(scene: Scene, camera: Camera, dt: number, post: PostState): void {
    this.time += dt;
    this.resize();
    this.adapt(dt * 1000);
    const r = this.renderer;
    if (!this.usePost || !this.target) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    const u = this.postMaterial.uniforms;
    u.tDiffuse.value = this.target.texture;
    u.uTime.value = this.time;
    u.uLook.value = LOOK_INDEX[post.look];
    u.uDistortion.value = post.distortion;
    u.uSignal.value = post.signal;
    u.uFlash.value = post.flash;
    u.uVignette.value = post.look === 'clean' ? 0.18 : 0.38;
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCamera);
  }

  dispose(): void {
    this.target?.dispose();
    this.postMaterial.dispose();
    this.renderer.dispose();
  }
}
