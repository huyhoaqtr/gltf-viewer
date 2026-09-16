import { useEngine } from "../../context/EngineContext";
import { useViewerStore } from "../../state/viewerStore";
import type { CameraMode } from "../../types/viewer";

export function CameraSection() {
  const engine = useEngine();
  const settings = useViewerStore((s) => s.settings);
  const updateSetting = useViewerStore((s) => s.updateSetting);

  return (
    <div className="group">
      <h3>Camera</h3>
      <select
        value={settings.cameraMode}
        onChange={(e) => {
          const v = e.target.value as CameraMode;
          updateSetting("cameraMode", v);
          engine?.setCameraMode(v);
        }}
      >
        <option value="persp">Phối cảnh (Perspective)</option>
        <option value="ortho">Song song (Ortho)</option>
      </select>
    </div>
  );
}
