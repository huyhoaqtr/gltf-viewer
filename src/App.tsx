import { Viewport } from "./components/Viewport";
import { CubeArrows } from "./components/CubeArrows";
import { TopBar } from "./components/TopBar";
import { ControlPanel } from "./components/panel/ControlPanel";
import { DropZone } from "./components/DropZone";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { ToastBanner } from "./components/ToastBanner";
import { useHologramHotkey } from "./hooks/useHologramHotkey";
import { FpsPanel } from "./components/FpsPanel";
import { Hint } from "./components/Hint";

export default function App() {
  useHologramHotkey();
  return (
    <>
      <Viewport />
      <CubeArrows />
      <TopBar />
      <ControlPanel />
      <DropZone />
      <LoadingOverlay />
      <ToastBanner />
      <FpsPanel />
      <Hint />
    </>
  );
}
