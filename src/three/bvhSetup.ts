import * as THREE from "three";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";

/**
 * Side-effect module, imported once for its effects: patches three.js's
 * default (brute-force, per-triangle) raycasting with three-mesh-bvh's
 * bounds-tree-accelerated version, globally for every Mesh. A mesh whose
 * geometry never had `computeBoundsTree()` called on it (i.e. the vast
 * majority of meshes in the app — small ones aren't worth the tree-build
 * cost) transparently falls back to the exact same brute-force path as
 * before, so this is safe to apply everywhere rather than gated per-mesh.
 *
 * Click-to-select (see ModelController.handleModelClick) is the only per-model
 * raycast in this app, but on a large CAD/BIM import — tens of thousands of
 * parts folded into a handful of merged-by-material batches (see
 * meshMerging.ts), each still tens of millions of triangles — a brute-force
 * scan of every batch's full triangle list on every click is slow enough to
 * feel laggy. The bounds tree for each merged batch is built lazily (see
 * ensureBoundsTree in meshMerging.ts): in idle time after loading, and right
 * before any raycast if it isn't there yet — building them all during the
 * merge froze the tab on big models.
 */
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
