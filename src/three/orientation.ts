import * as THREE from "three";
import type { UpAxis } from "../types/viewer";

export interface OrientationState {
  upAxis: UpAxis;
  flipX: boolean;
  flipZ: boolean;
  spin180: boolean;
}

export const DEFAULT_ORIENTATION: OrientationState = {
  upAxis: "z",
  flipX: false,
  flipZ: false,
  spin180: false,
};

/**
 * BIM/CAD exports (Revit, IFC, AutoCAD…) often use a different up-axis or
 * handedness than glTF's Y-up convention, which shows up as a model lying on
 * its side or mirrored left-right. We apply axis/mirror fixes to a wrapper
 * group (the "pivot") instead of the loaded scene, so it's easy to try
 * combinations and reset. three.js automatically flips face-culling winding
 * when an object's world matrix has a negative determinant, so mirroring via
 * negative scale here renders correctly without any manual normal fixes.
 */
export function applyOrientation(pivot: THREE.Group, state: OrientationState) {
  pivot.rotation.set(0, 0, 0);
  pivot.scale.set(1, 1, 1);
  if (state.upAxis === "z") pivot.rotation.x = -Math.PI / 2;
  if (state.spin180) pivot.rotation.y += Math.PI;
  pivot.scale.x = state.flipX ? -1 : 1;
  pivot.scale.z = state.flipZ ? -1 : 1;
  pivot.updateMatrixWorld(true);
}
