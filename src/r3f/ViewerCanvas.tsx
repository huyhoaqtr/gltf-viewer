import { Canvas } from "@react-three/fiber";
import { useViewerStore } from "../state/viewerStore";
import { ViewerScene } from "./ViewerScene";

/** Supersampled render scale: at least 2x on standard screens, 1.5x of the device ratio (max 3) on hi-dpi. */
function supersampledDpr() {
  return Math.max(2, Math.min(window.devicePixelRatio * 1.5, 3));
}

/** The R3F canvas; fills its (fixed, full-window) parent. */
export function ViewerCanvas() {
  const antialias = useViewerStore((s) => s.settings.antialias);
  return (
    <Canvas
      shadows="soft"
      dpr={antialias ? supersampledDpr() : [1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      camera={{ fov: 45, near: 0.01, far: 5000, position: [4, 3, 6] }}
    >
      <ViewerScene />
    </Canvas>
  );
}
