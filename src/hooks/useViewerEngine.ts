import { useEffect, useState } from "react";
import { ViewerEngine } from "../three/ViewerEngine";
import { useViewerStore } from "../state/viewerStore";

/**
 * Creates one ViewerEngine bound to the given container on mount, wires its
 * callbacks into the zustand store, and disposes it on unmount. Returns
 * `null` until the engine is ready (the very first render only).
 */
export function useViewerEngine(containerRef: React.RefObject<HTMLDivElement>): ViewerEngine | null {
  const [engine, setEngine] = useState<ViewerEngine | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const instance = new ViewerEngine(containerRef.current, {
      onStats: (stats) => useViewerStore.getState().setStats(stats),
      onLoadingProgress: (loading, text) => useViewerStore.getState().setLoading(loading, text),
      onSelectionChange: (name) => useViewerStore.getState().setSelectedName(name),
      onHiddenChange: (v) => useViewerStore.getState().setHasHidden(v),
      onToast: (msg) => useViewerStore.getState().showToast(msg),
      onFileName: (name) => {
        useViewerStore.getState().setFileName(name);
        useViewerStore.getState().setDropzoneVisible(!name);
      },
    });
    setEngine(instance);

    return () => {
      instance.dispose();
      setEngine(null);
    };
    // Intentionally run once: the engine owns its own imperative lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return engine;
}
