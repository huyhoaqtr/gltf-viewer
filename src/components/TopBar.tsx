import { useRef } from "react";
import { viewerApi } from "../r3f/viewerApi";
import { useViewerStore } from "../state/viewerStore";
import { formatCount } from "../utils/format";
import { IconFit, IconHologram, IconOpen, IconPanel } from "./Icons";

export function TopBar() {
  const fileName = useViewerStore((s) => s.fileName);
  const stats = useViewerStore((s) => s.stats);
  const panelOpen = useViewerStore((s) => s.panelOpen);
  const togglePanel = useViewerStore((s) => s.togglePanel);
  const viewMode = useViewerStore((s) => s.viewMode);
  const toggleHologram = useViewerStore((s) => s.toggleHologram);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div id="topbar">
      <div className="file-card">
        <svg className="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <path d="M12 2 3 7v10l9 5 9-5V7z" />
          <path d="M3 7l9 5 9-5M12 12v10" />
        </svg>
        <div className="file-text">
          <span className="file-name" title={fileName ?? undefined}>
            {fileName ?? "GLB Viewer"}
          </span>
          <span className="file-meta">
            {stats
              ? `${formatCount(stats.meshCount)} mesh · ${formatCount(stats.triangleCount)} tam giác`
              : "Chưa mở model"}
          </span>
        </div>
      </div>
      <div className="spacer" />
      <div className="toolbar-pill">
        <button className="btn primary" onClick={() => inputRef.current?.click()}>
          <IconOpen />
          <span className="label">Mở file</span>
        </button>
        <span className="toolbar-divider" />
        <button className="btn" disabled={!fileName} title="Zoom vừa khít model" onClick={() => viewerApi.fitToView()}>
          <IconFit />
          <span className="label">Fit</span>
        </button>
        <button
          className="btn toggle"
          aria-pressed={viewMode === "hologram"}
          title="Chế độ Hologram (H)"
          onClick={toggleHologram}
        >
          <IconHologram />
          <span className="label">Hologram</span>
        </button>
        <span className="toolbar-divider" />
        <button className="btn toggle" aria-pressed={panelOpen} title="Bảng điều khiển" onClick={togglePanel}>
          <IconPanel />
          <span className="label">Cài đặt</span>
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".glb,.gltf"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) viewerApi.loadFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
