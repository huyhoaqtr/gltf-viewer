import { Canvas } from "@react-three/fiber";
import { ViewerScene } from "./ViewerScene";

/** The R3F canvas; fills its (fixed, full-window) parent. */
export function ViewerCanvas() {
  return (
    <Canvas
      shadows="soft"
      dpr={[1, 2]}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
      camera={{ fov: 45, near: 0.01, far: 5000, position: [4, 3, 6] }}
    >
      <ViewerScene />
    </Canvas>
  );
}
