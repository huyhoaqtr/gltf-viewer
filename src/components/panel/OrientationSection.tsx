import { useEngine } from "../../context/EngineContext";
import { useViewerStore } from "../../state/viewerStore";
import { CheckboxRow } from "./CheckboxRow";
import type { UpAxis } from "../../types/viewer";

export function OrientationSection() {
  const engine = useEngine();
  const settings = useViewerStore((s) => s.settings);
  const updateSetting = useViewerStore((s) => s.updateSetting);
  const resetOrientationSettings = useViewerStore((s) => s.resetOrientationSettings);

  return (
    <div className="group">
      <h3>Hướng model (BIM/CAD)</h3>
      <div className="row">
        <label htmlFor="upAxis">Trục lên (up axis)</label>
        <select
          id="upAxis"
          value={settings.upAxis}
          onChange={(e) => {
            const v = e.target.value as UpAxis;
            updateSetting("upAxis", v);
            engine?.setUpAxis(v);
          }}
        >
          <option value="y">Y — chuẩn glTF</option>
          <option value="z">Z — Revit / CAD</option>
        </select>
      </div>
      <CheckboxRow
        id="flipX"
        label="Lật gương (trục X)"
        checked={settings.flipX}
        onChange={(v) => {
          updateSetting("flipX", v);
          engine?.setFlipX(v);
        }}
      />
      <CheckboxRow
        id="flipZ"
        label="Lật gương (trục Z)"
        checked={settings.flipZ}
        onChange={(v) => {
          updateSetting("flipZ", v);
          engine?.setFlipZ(v);
        }}
      />
      <CheckboxRow
        id="spin180"
        label="Xoay 180° (trước/sau)"
        checked={settings.spin180}
        onChange={(v) => {
          updateSetting("spin180", v);
          engine?.setSpin180(v);
        }}
      />
      <button
        className="btn"
        style={{ alignSelf: "flex-start" }}
        onClick={() => {
          resetOrientationSettings();
          engine?.resetOrientation();
        }}
      >
        Đặt lại hướng
      </button>
      <p className="hint-text">
        Model từ Revit/IFC/AutoCAD thường lệch trục hoặc bị lật gương do khác chuẩn hệ trục với glTF. Thử lần lượt
        các tùy chọn trên tới khi đúng hướng.
      </p>
    </div>
  );
}
