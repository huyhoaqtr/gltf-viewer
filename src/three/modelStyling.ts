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

export interface MaterialStyleOptions {
  roughnessFloor: number;
  flattenMetal: boolean;
  doubleSided: boolean;
}

/**
 * Pushes every mesh's material toward a flatter, more "architectural" look
 * (higher roughness floor, near-zero metalness) instead of raw PBR values
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
      const std = m as THREE.MeshStandardMaterial;
      if ((std as THREE.MeshStandardMaterial).isMeshStandardMaterial || (std as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
        std.roughness = Math.max(std.roughness ?? 1, opts.roughnessFloor);
        if (opts.flattenMetal) std.metalness = Math.min(std.metalness ?? 0, 0.05);
        std.envMapIntensity = 0.6;
      }
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
