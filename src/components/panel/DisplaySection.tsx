import { useEngine } from "../../context/EngineContext";
import { useViewerStore } from "../../state/viewerStore";
import { CheckboxRow } from "./CheckboxRow";

export function DisplaySection() {
  const engine = useEngine();
  const settings = useViewerStore((s) => s.settings);
  const updateSetting = useViewerStore((s) => s.updateSetting);

  return (
    <div className="group">
      <h3>Hiển thị</h3>
      <CheckboxRow
        id="showEdges"
        label="Đường viền cạnh (edges)"
        checked={settings.showEdges}
        onChange={(v) => {
          updateSetting("showEdges", v);
          engine?.setShowEdges(v);
        }}
      />
      <CheckboxRow
        id="showShadows"
        label="Đổ bóng"
        checked={settings.showShadows}
        onChange={(v) => {
          updateSetting("showShadows", v);
          engine?.setShowShadows(v);
        }}
      />
      <CheckboxRow
        id="autoRotate"
        label="Tự xoay"
        checked={settings.autoRotate}
        onChange={(v) => {
          updateSetting("autoRotate", v);
          engine?.setAutoRotate(v);
        }}
      />
    </div>
  );
}
