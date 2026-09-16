import { useRef } from "react";
import { useEngine } from "../context/EngineContext";
import { useViewerStore } from "../state/viewerStore";
import { formatCount } from "../utils/format";

export function TopBar() {
  const engine = useEngine();
  const fileName = useViewerStore((s) => s.fileName);
  const stats = useViewerStore((s) => s.stats);
  const panelOpen = useViewerStore((s) => s.panelOpen);
  const togglePanel = useViewerStore((s) => s.togglePanel);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div id="topbar">
      <div className="brand">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <path d="M12 2 3 7v10l9 5 9-5V7z" />
          <path d="M3 7l9 5 9-5M12 12v10" />
        </svg>
        <div className="brand-text">
          <span className="brand-title">GLB Viewer</span>
          <span className="brand-sub">{fileName ?? "Xem model 3D"}</span>
        </div>
      </div>
      <span className="filename">
        {stats ? `${formatCount(stats.meshCount)} mesh · ${formatCount(stats.triangleCount)} tam giác` : ""}
      </span>
      <div className="spacer" />
      <div className="toolbar-pill">
        <button className="btn" onClick={() => inputRef.current?.click()}>
          Mở file .glb / .gltf
        </button>
        <span className="toolbar-divider" />
        <button className="btn" disabled={!fileName} title="Zoom extents" onClick={() => engine?.fitToView()}>
          Fit
        </button>
        <span className="toolbar-divider" />
        <button className="btn toggle" aria-pressed={panelOpen} title="Bảng điều khiển" onClick={togglePanel}>
          Cài đặt
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".glb,.gltf"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) engine?.loadFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
