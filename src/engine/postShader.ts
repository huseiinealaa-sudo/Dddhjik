/**
 * Final full-screen pass: lens distortion, the look of the video link
 * (clean / digital HD / analog), tone mapping and output encoding.
 *
 * The scene is rendered in linear HDR; everything that makes the picture look
 * like it came through an FPV camera and radio link happens here, in one pass.
 */
export const POST_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const POST_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uTime;
uniform float uDistortion;   // barrel strength (0 = rectilinear)
uniform float uAspect;
uniform int uLook;           // 0 clean, 1 digital, 2 analog
uniform float uSignal;       // 1 = perfect link, 0 = lost
uniform float uFlash;        // impact / static burst
uniform float uVignette;
uniform float uSaturation;
uniform float uContrast;

#include <tonemapping_pars_fragment>

varying vec2 vUv;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 distort(vec2 uv) {
  if (uDistortion <= 0.0) return uv;
  vec2 c = (uv - 0.5) * vec2(uAspect, 1.0);
  float r2 = dot(c, c);
  float corner = 0.25 * (uAspect * uAspect + 1.0);
  // Barrel: sample further out towards the edges, then zoom so the corners stay filled.
  c *= (1.0 + uDistortion * r2) / (1.0 + uDistortion * corner);
  return c / vec2(uAspect, 1.0) + 0.5;
}

vec3 sampleHdr(vec2 uv) {
  return texture2D(tDiffuse, clamp(uv, vec2(0.0005), vec2(0.9995))).rgb;
}

vec3 grade(vec3 hdr) {
  vec3 c = ACESFilmicToneMapping(hdr);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  c = (c - 0.5) * uContrast + 0.5;
  return clamp(c, 0.0, 1.0);
}

void main() {
  vec2 uv = distort(vUv);
  vec2 px = 1.0 / uResolution;
  float t = uTime;
  vec3 col;
  float lost = 1.0 - uSignal;

  if (uLook == 2) {
    // ---------------------------------------------------------------- analog
    float row = floor(uv.y * 240.0);
    float tear = (hash12(vec2(row, floor(t * 30.0))) - 0.5) * lost * lost * 0.08;
    float roll = smoothstep(0.96, 1.0, sin(uv.y * 3.0 - t * 2.3)) * lost * 0.02;
    vec2 auv = uv + vec2(tear + roll, 0.0);
    float bleed = 1.6 + lost * 3.0;
    vec3 a = sampleHdr(auv);
    vec3 b = sampleHdr(auv - vec2(px.x * bleed * 2.0, 0.0));
    vec3 cc = sampleHdr(auv + vec2(px.x * bleed * 2.0, 0.0));
    col = grade(a * 0.5 + (b + cc) * 0.25);
    // Chroma is carried at lower bandwidth than luma: smear it.
    vec3 chroma = grade(sampleHdr(auv + vec2(px.x * 5.0, 0.0)));
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, luma + (chroma - dot(chroma, vec3(0.299, 0.587, 0.114))), 0.35);
    col = mix(vec3(luma), col, 0.82);
    // Scanlines and luminance noise that grows as the signal fades.
    col *= 0.93 + 0.07 * sin(vUv.y * uResolution.y * 1.5708);
    float n = hash12(vUv * uResolution + fract(t * 61.0) * 500.0);
    col += (n - 0.5) * (0.05 + lost * 0.65);
    // Sparkles (dropouts) and full static when the link is gone.
    float sparkle = step(1.0 - lost * lost * 0.05, hash12(vec2(floor(vUv.x * 160.0), row) + t));
    col = mix(col, vec3(n), clamp(sparkle + smoothstep(0.75, 1.0, lost) + uFlash, 0.0, 1.0));
  } else if (uLook == 1) {
    // --------------------------------------------------------------- digital
    vec2 duv = uv;
    // Low bitrate: the encoder falls back to big blocks.
    float block = mix(1.0, 18.0, smoothstep(0.35, 0.95, lost));
    if (block > 1.5) duv = (floor(uv * uResolution / block) + 0.5) * block / uResolution;
    vec3 c0 = sampleHdr(duv);
    vec3 s = sampleHdr(duv + vec2(px.x, 0.0)) + sampleHdr(duv - vec2(px.x, 0.0)) +
             sampleHdr(duv + vec2(0.0, px.y)) + sampleHdr(duv - vec2(0.0, px.y));
    col = grade(max(c0 + (c0 - s * 0.25) * 0.35, 0.0));
    col = mix(col, vec3(dot(col, vec3(0.333))), smoothstep(0.85, 1.0, lost) * 0.8);
    col = mix(col, col * 0.2, smoothstep(0.92, 1.0, lost));
    col += uFlash * 0.25;
  } else {
    // ----------------------------------------------------------------- clean
    col = grade(sampleHdr(uv));
  }

  // Lens vignette.
  vec2 v = (vUv - 0.5) * vec2(uAspect, 1.0);
  col *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(v) * 1.1);

  // Encode, then dither to kill banding in the sky.
  vec4 outCol = sRGBTransferOETF(vec4(col, 1.0));
  outCol.rgb += (hash12(gl_FragCoord.xy + fract(t) * 17.0) - 0.5) / 255.0;
  gl_FragColor = vec4(outCol.rgb, 1.0);
}
`;
