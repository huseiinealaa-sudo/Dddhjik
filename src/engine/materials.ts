import { Color, MeshStandardMaterial, type Texture } from 'three';

/**
 * Tri-planar texturing in world space. Buildings are made of hundreds of
 * boxes of every size; projecting the texture from the world instead of the
 * boxes' own UVs keeps the concrete grain the same size everywhere and hides
 * every seam between pieces.
 */
export function triplanarMaterial(
  map: Texture,
  opts: { scale?: number; color?: string; roughness?: number; metalness?: number; instanced?: boolean } = {},
): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    color: new Color(opts.color ?? '#ffffff'),
    roughness: opts.roughness ?? 0.9,
    metalness: opts.metalness ?? 0,
  });
  const scale = opts.scale ?? 0.25;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tTri = { value: map };
    shader.uniforms.uTriScale = { value: scale };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTriPos;
        varying vec3 vTriNormal;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 triWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          triWorld = instanceMatrix * triWorld;
        #endif
        triWorld = modelMatrix * triWorld;
        vTriPos = triWorld.xyz;
        vec3 triN = objectNormal;
        #ifdef USE_INSTANCING
          triN = mat3(instanceMatrix) * triN;
        #endif
        vTriNormal = normalize(mat3(modelMatrix) * triN);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tTri;
        uniform float uTriScale;
        varying vec3 vTriPos;
        varying vec3 vTriNormal;`,
      )
      .replace(
        '#include <map_fragment>',
        `vec3 tw = abs(normalize(vTriNormal));
        tw = pow(tw, vec3(4.0));
        tw /= (tw.x + tw.y + tw.z);
        vec3 tri = texture2D(tTri, vTriPos.zy * uTriScale).rgb * tw.x
                 + texture2D(tTri, vTriPos.xz * uTriScale).rgb * tw.y
                 + texture2D(tTri, vTriPos.xy * uTriScale).rgb * tw.z;
        diffuseColor.rgb *= tri;`,
      );
  };
  // Distinct programs per scale so three.js does not share a cached one.
  mat.customProgramCacheKey = () => `tri-${scale}`;
  return mat;
}

/** Shared uniform clock for every animated material (wind, water, flags). */
export const worldClock = { value: 0 };
