import { Color, Mesh, MeshStandardMaterial, Vector2, type Texture } from 'three';
import { worldClock } from '../materials';
import { lakeGeometry } from './terrain';

/**
 * Lake surface: a glossy PBR plane that reflects the sky environment, with two
 * scrolling ripple layers blended in the shader so the pattern never repeats.
 */
export function buildWater(normalMap: Texture): Mesh {
  const mat = new MeshStandardMaterial({
    color: new Color('#0d2f3b'),
    roughness: 0.07,
    metalness: 0.0,
    normalMap,
    normalScale: new Vector2(0.28, 0.28),
    envMapIntensity: 1.25,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = worldClock;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vWaterXZ;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\nvWaterXZ = (modelMatrix * vec4(transformed, 1.0)).xz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying vec2 vWaterXZ;`)
      .replace(
        '#include <normal_fragment_maps>',
        `vec3 n1 = texture2D(normalMap, vWaterXZ * 0.045 + vec2(uTime * 0.012, uTime * 0.007)).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(normalMap, vWaterXZ * 0.11 - vec2(uTime * 0.017, -uTime * 0.011)).xyz * 2.0 - 1.0;
        vec3 mapN = normalize(vec3((n1.xy + n2.xy) * normalScale, 1.0));
        normal = normalize(tbn * mapN);`,
      );
  };
  const mesh = new Mesh(lakeGeometry(), mat);
  mesh.receiveShadow = true;
  mesh.name = 'lake';
  return mesh;
}
