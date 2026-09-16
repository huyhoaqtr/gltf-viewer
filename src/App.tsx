import { useRef } from "react";
import { EngineContext } from "./context/EngineContext";
import { useViewerEngine } from "./hooks/useViewerEngine";
import { Viewport } from "./components/Viewport";
import { CubeNavBackdrop } from "./components/CubeNavBackdrop";
import { TopBar } from "./components/TopBar";
import { ControlPanel } from "./components/panel/ControlPanel";
import { DropZone } from "./components/DropZone";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { ToastBanner } from "./components/ToastBanner";
import { Hint } from "./components/Hint";

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const engine = useViewerEngine(containerRef);

  return (
    <EngineContext.Provider value={engine}>
      <Viewport containerRef={containerRef} />
      <CubeNavBackdrop />
      <TopBar />
      <ControlPanel />
      <DropZone />
      <LoadingOverlay />
      <ToastBanner />
      <Hint />
    </EngineContext.Provider>
  );
}
