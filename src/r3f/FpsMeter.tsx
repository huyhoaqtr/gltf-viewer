import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useViewerStore } from "../state/viewerStore";
import { useSceneRuntime } from "./runtime";

const SAMPLE_MS = 500;

/** Samples the render loop and publishes FPS to the store a couple of times a second. */
export function FpsMeter() {
  const rt = useSceneRuntime();
  const enabled = useViewerStore((s) => s.settings.showFps);
  const acc = useRef({ frames: 0, start: 0 });

  useFrame(() => {
    if (!enabled) return;
    const now = performance.now();
    const a = acc.current;
    if (a.start === 0) a.start = now;
    a.frames++;
    const dt = now - a.start;
    if (dt < SAMPLE_MS) return;
    useViewerStore.getState().setFpsStats({
      fps: (a.frames * 1000) / dt,
      ms: dt / a.frames,
      calls: rt.mainRender.calls,
      triangles: rt.mainRender.triangles,
    });
    a.frames = 0;
    a.start = now;
  });

  return null;
}
