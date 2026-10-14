import * as THREE from "three";
import type { ModelStats } from "../types/viewer";

export function computeStats(root: THREE.Object3D): ModelStats {
  let meshCount = 0;
  let triangleCount = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    meshCount++;
    const geo = mesh.geometry;
    const count = geo.index ? geo.index.count : geo.attributes.position?.count ?? 0;
    triangleCount += count / 3;
  });
  return { meshCount, triangleCount: Math.round(triangleCount) };
}

/** Shared by every model material's patched shader, so changing it needs no recompile. */
export const modelContrast = { value: 1 };

/** Adds a contrast adjustment (around mid-grey, in display space) to the material's final colour. */
function patchContrast(m: THREE.Material) {
  if (m.userData.contrastPatched) return;
  m.userData.contrastPatched = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev?.call(m, shader, renderer);
    shader.uniforms.uContrast = modelContrast;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform float uContrast;\nvoid main() {")
      .replace(
        "#include <colorspace_fragment>",
        "#include <colorspace_fragment>\n  gl_FragColor.rgb = clamp((gl_FragColor.rgb - 0.5) * uContrast + 0.5, 0.0, 1.0);"
      );
  };
  const prevKey = m.customProgramCacheKey;
  m.customProgramCacheKey = () => `${prevKey.call(m)}|contrast`;
}

/**
 * Makes a flat-shaded variant of a material for merged batches that carry no normal attribute
 * (see mergeWorker.ts): `flatShading` takes the normal from screen-space derivatives. three.js
 * also offsets the shadow lookup along the *vertex* normal (`shadow.normalBias`) to avoid acne;
 * with no vertex normal that offset moves to the fragment shader, where it uses the same
 * (face) normal. The offset is linear in position, so the result is the same as the per-vertex one.
 */
export function createFlatVariant(source: THREE.Material): THREE.Material {
  const m = source.clone() as THREE.MeshStandardMaterial;
  m.flatShading = true;
  m.userData.contrastPatched = false; // clone() copies userData but not onBeforeCompile
  patchContrast(m);
  patchFlatShadows(m);
  m.userData.isFlatVariant = true;
  m.needsUpdate = true;
  return m;
}

function patchFlatShadows(m: THREE.Material) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev?.call(m, shader, renderer);
    const vertexOffset = "vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 )";
    const fragmentLookup = "directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] )";
    const vertexChunk = THREE.ShaderChunk.shadowmap_vertex;
    const fragmentChunk = THREE.ShaderChunk.lights_fragment_begin;
    if (!vertexChunk.includes(vertexOffset) || !fragmentChunk.includes(fragmentLookup)) {
      console.warn("[flat shading] three.js shadow shader chunks changed; flat batches will use the unbiased shadow lookup");
      return;
    }
    shader.vertexShader = shader.vertexShader.replace(
      "#include <shadowmap_vertex>",
      vertexChunk.replace(vertexOffset, "vec4( 0.0 )")
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <shadowmap_pars_fragment>",
        `#include <shadowmap_pars_fragment>
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
#endif`
      )
      .replace(
        "#include <lights_fragment_begin>",
        `vec3 flatShadowNormal = inverseTransformDirection( normal * faceDirection, viewMatrix );
` +
          fragmentChunk.replace(
            fragmentLookup,
            "directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] + directionalShadowMatrix[ i ] * vec4( flatShadowNormal * directionalLightShadow.shadowNormalBias, 0.0 ) )"
          )
      );
  };
  const prevKey = m.customProgramCacheKey;
  m.customProgramCacheKey = () => `${prevKey.call(m)}|flatshadow`;
}

export interface MaterialStyleOptions {
  flattenMetal: boolean;
  doubleSided: boolean;
}

/**
 * Pushes every mesh's material toward a flatter, more "architectural" look
 * (near-zero metalness, the file's own roughness) instead of raw PBR values
 * some exporters ship, and applies the double-sided fallback for BIM/CAD
 * parts with inverted normals.
 */
export function applyMaterialStyle(root: THREE.Object3D, opts: MaterialStyleOptions) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => {
      // The shared hologram material (see materials/HologramMaterial.ts) must
      // not be restyled; the originals are restyled again on restore.
      if (m.userData.isHologram) return;
      const std = m as THREE.MeshStandardMaterial;
      if ((std as THREE.MeshStandardMaterial).isMeshStandardMaterial || (std as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
        // Metalness is derived from the file's own value: the style is re-applied whenever a setting
        // changes, so working from the already-restyled value would make "flatten metal" one-way.
        const origMetalness = (std.userData.styleOriginalMetalness ??= std.metalness ?? 0) as number;
        std.metalness = opts.flattenMetal ? Math.min(origMetalness, 0.05) : origMetalness;
        std.envMapIntensity = 0.35;
      }
      patchContrast(m);
      m.side = opts.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
      m.needsUpdate = true;
    });
  });
}

/**
 * Forces per-object frustum culling on and eagerly computes each mesh's
 * bounding sphere/box instead of leaving that to three.js's lazy fallback
 * (computed on that mesh's first frustum test). three.js already culls
 * off-screen meshes by default via `Object3D.frustumCulled` — this just makes
 * the guarantee explicit for every mesh streamed into the viewport, instead
 * of relying on nothing ever having turned it off and on the lazy compute
 * landing before that mesh's first appearance on screen.
 */
export function hardenFrustumCulling(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    mesh.frustumCulled = true;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  });
}

/** Releases GPU geometry/texture/material resources for a subtree, whether or not it's currently in the scene. */
export function disposeObject3D(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) {
      // Frees the bounds tree's own typed arrays (see bvhSetup.ts /
      // meshMerging.ts) — geometry.dispose() only releases GPU buffers, not this.
      mesh.geometry.disposeBoundsTree?.();
      mesh.geometry.dispose();
    }
    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => {
        const std = m as THREE.MeshStandardMaterial;
        (["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"] as const).forEach((key) => {
          (std[key] as THREE.Texture | null)?.dispose();
        });
        m.dispose();
      });
    }
  });
}
