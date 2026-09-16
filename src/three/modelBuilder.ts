import * as THREE from "three";
import { MODEL_BUILD_FRAME_BUDGET_MS } from "./constants";
import { applyMaterialStyle, disposeObject3D, hardenFrustumCulling, type MaterialStyleOptions } from "./modelStyling";

/**
 * Reparents a loaded model's top-level parts onto `root` a few at a time,
 * spread across animation frames (same time-boxed pattern as the edges
 * overlay), so a big model streams into view part-by-part instead of
 * freezing the tab for one big attach.
 *
 * Deliberately does NOT call renderer.compileAsync() per batch: it has to
 * re-scan the whole (growing) scene for lights/materials on every call plus
 * a 10ms polling wait, which made loading slower overall than just letting
 * the render loop upload each small batch lazily on its first draw.
 */
export class ModelBuilder {
  built = false;

  private token = 0;

  /** Cancels any build currently in progress and disposes parts not yet attached. */
  cancel() {
    this.token++;
  }

  build(root: THREE.Object3D, styleOpts: MaterialStyleOptions, onBatch: () => void, onDone: () => void) {
    this.token++;
    const token = this.token;
    this.built = false;

    const pending = [...root.children];
    root.clear();

    const step = () => {
      if (token !== this.token) {
        pending.forEach((child) => disposeObject3D(child));
        return;
      }
      const deadline = performance.now() + MODEL_BUILD_FRAME_BUDGET_MS;
      while (pending.length > 0 && performance.now() < deadline) {
        const child = pending.shift()!;
        applyMaterialStyle(child, styleOpts);
        hardenFrustumCulling(child);
        root.add(child);
      }
      onBatch();
      if (pending.length > 0) {
        requestAnimationFrame(step);
      } else {
        this.built = true;
        onDone();
      }
    };
    step();
  }
}
