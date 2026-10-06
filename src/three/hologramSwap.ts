import * as THREE from "three";

/**
 * Swaps every regular mesh's material for one shared override material and
 * back. Originals are kept in a WeakMap and are never disposed here.
 *
 * Optionally adds a depth pre-pass: a child mesh per swapped mesh that shares
 * its geometry and only writes depth (opaque pass, drawn before the additive
 * transparent pass), so only the surface nearest the camera glows instead of
 * every layer behind it stacking up. Pre-pass children are marked
 * `userData.isHologramPrepass`, never raycast, and removed on restore.
 *
 * Skipped on purpose: skinned / morph-target meshes (the shader has no
 * skinning/morph support, so they keep their original look), instanced
 * meshes (no pre-pass, since the child would need the instances too), and the
 * selection outline (LineSegments2 is a Mesh subclass).
 */
export class MaterialSwapper {
  private originals = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private swapped = new Set<THREE.Mesh>();
  private prepassMeshes = new Map<THREE.Mesh, THREE.Mesh>();

  constructor(
    private override: THREE.Material,
    private depthMaterial: THREE.Material
  ) {}

  /** Idempotent: meshes that are already swapped are left alone. */
  apply(root: THREE.Object3D, prepass: boolean) {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh & { isLineSegments2?: boolean; isSkinnedMesh?: boolean; isInstancedMesh?: boolean };
      if (!mesh.isMesh || !mesh.geometry || mesh.isLineSegments2 || mesh.isSkinnedMesh) return;
      if (mesh.userData.isHologramPrepass) return;
      if (mesh.morphTargetInfluences?.length) return;
      if (this.swapped.has(mesh)) return;
      this.originals.set(mesh, mesh.material);
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(() => this.override) : this.override;
      this.swapped.add(mesh);
      if (prepass && !mesh.isInstancedMesh) this.prepassMeshes.set(mesh, this.makePrepass(mesh));
    });
  }

  private makePrepass(mesh: THREE.Mesh): THREE.Mesh {
    const depth = new THREE.Mesh(mesh.geometry, this.depthMaterial);
    depth.userData.isHologramPrepass = true;
    depth.raycast = () => {};
    depth.renderOrder = -1;
    depth.frustumCulled = mesh.frustumCulled;
    depth.matrixAutoUpdate = false; // identity: it follows the parent
    mesh.add(depth);
    return depth;
  }

  /** Puts the exact original materials back. Returns how many meshes were restored. */
  restore(): number {
    this.prepassMeshes.forEach((depth) => depth.removeFromParent());
    this.prepassMeshes.clear();
    const count = this.swapped.size;
    this.swapped.forEach((mesh) => {
      const original = this.originals.get(mesh);
      if (original) mesh.material = original;
      this.originals.delete(mesh);
    });
    this.swapped.clear();
    return count;
  }
}
