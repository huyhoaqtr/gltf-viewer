import type * as THREE from "three";
import { createContext, useContext } from "react";
import type { OrbitControls } from "three-stdlib";
import type { ModelController, FrameInfo } from "../three/ModelController";

/** Mutable handles shared between the scene's components (not React state). */
export interface SceneRuntime {
  controls: OrbitControls | null;
  controller: ModelController | null;
  frame: FrameInfo;
  /** Orbit target stashed across a camera swap (see Controls). */
  /** Draw calls / triangles of the main scene pass only (the gizmo pass would overwrite gl.info). */
  mainRender: { calls: number; triangles: number };
  savedTarget: THREE.Vector3 | null;
}

export const SceneRuntimeContext = createContext<SceneRuntime | null>(null);

export function useSceneRuntime(): SceneRuntime {
  const rt = useContext(SceneRuntimeContext);
  if (!rt) throw new Error("useSceneRuntime must be used inside <ViewerScene>");
  return rt;
}
