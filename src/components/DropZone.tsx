import { useRef } from "react";
import { viewerApi } from "../r3f/viewerApi";
import { useViewerStore } from "../state/viewerStore";
import { useWindowFileDrop } from "../hooks/useWindowFileDrop";

export function DropZone() {
  const visible = useViewerStore((s) => s.dropzoneVisible);
  const dragOver = useViewerStore((s) => s.dragOver);
  const inputRef = useRef<HTMLInputElement>(null);

  useWindowFileDrop((file) => viewerApi.loadFile(file));

  const classes = ["", !visible ? "hidden" : "", dragOver ? "dragover" : ""].filter(Boolean).join(" ");

  return (
    <div id="dropzone" className={classes || undefined}>
      <div className="dz-card">
        <div className="dz-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2 3 7v10l9 5 9-5V7z" />
            <path d="M3 7l9 5 9-5M12 12v10" />
          </svg>
        </div>
        <h1>Mở model 3D</h1>
        <div className="dz-formats">
          <span>.GLB</span>
          <span>.GLTF</span>
        </div>
        <div className="dz-or">kéo thả file vào đây hoặc</div>
        <button className="btn primary dz-button" onClick={() => inputRef.current?.click()}>
          <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
          </svg>
          Chọn file
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
