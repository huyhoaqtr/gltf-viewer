import { useViewerStore } from "../../state/viewerStore";
import { LightingSection } from "./LightingSection";
import { MaterialSection } from "./MaterialSection";
import { OrientationSection } from "./OrientationSection";
import { DisplaySection } from "./DisplaySection";
import { SelectionSection } from "./SelectionSection";
import { BackgroundSection } from "./BackgroundSection";
import { CameraSection } from "./CameraSection";

export function ControlPanel() {
  const open = useViewerStore((s) => s.panelOpen);

  return (
    <aside id="panel" className={open ? undefined : "hidden"}>
      <LightingSection />
      <hr className="sep" />
      <MaterialSection />
      <hr className="sep" />
      <OrientationSection />
      <hr className="sep" />
      <DisplaySection />
      <hr className="sep" />
      <SelectionSection />
      <hr className="sep" />
      <BackgroundSection />
      <hr className="sep" />
      <CameraSection />
    </aside>
  );
}
