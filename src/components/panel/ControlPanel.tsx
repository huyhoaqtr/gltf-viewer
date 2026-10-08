import { useState, type ReactNode } from "react";
import { useViewerStore } from "../../state/viewerStore";
import { LightingSection } from "./LightingSection";
import { MaterialSection } from "./MaterialSection";
import { OrientationSection } from "./OrientationSection";
import { DisplaySection } from "./DisplaySection";
import { SelectionSection } from "./SelectionSection";
import { BackgroundSection } from "./BackgroundSection";
import { CameraSection } from "./CameraSection";
import { HologramSection } from "./HologramSection";

type Tab = "scene" | "model" | "select";

const TABS: { id: Tab; label: string }[] = [
  { id: "scene", label: "Cảnh" },
  { id: "model", label: "Model" },
  { id: "select", label: "Chọn" },
];

export function ControlPanel() {
  const open = useViewerStore((s) => s.panelOpen);
  const hologram = useViewerStore((s) => s.viewMode === "hologram");
  const selectedName = useViewerStore((s) => s.selectedName);
  const [tab, setTab] = useState<Tab>("scene");

  const content: Record<Tab, ReactNode> = {
    scene: (
      <>
        {hologram && <HologramSection />}
        <LightingSection />
        <BackgroundSection />
        <CameraSection />
      </>
    ),
    model: (
      <>
        <OrientationSection />
        <MaterialSection />
        <DisplaySection />
      </>
    ),
    select: <SelectionSection />,
  };

  return (
    <aside id="panel" className={open ? undefined : "hidden"}>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "select" && selectedName && <span className="tab-dot" />}
          </button>
        ))}
      </div>
      <div className="panel-body">{content[tab]}</div>
    </aside>
  );
}
