import { useViewerStore } from "../../state/viewerStore";
import { CheckboxRow } from "./CheckboxRow";
import { Section } from "./Section";
import type { UpAxis } from "../../types/viewer";

export function OrientationSection() {
  const settings = useViewerStore((s) => s.settings);
  const updateSetting = useViewerStore((s) => s.updateSetting);
  const resetOrientationSettings = useViewerStore((s) => s.resetOrientationSettings);

  return (
    <Section title="Hướng model (BIM/CAD)">
      <div className="field">
        <label className="field-head" htmlFor="upAxis">
          Trục lên (up axis)
        </label>
        <select
          id="upAxis"
          value={settings.upAxis}
          onChange={(e) => updateSetting("upAxis", e.target.value as UpAxis)}
        >
          <option value="y">Y — chuẩn glTF</option>
          <option value="z">Z — Revit / CAD</option>
        </select>
      </div>
      <CheckboxRow id="flipX" label="Lật gương trục X" checked={settings.flipX} onChange={(v) => updateSetting("flipX", v)} />
      <CheckboxRow id="flipZ" label="Lật gương trục Z" checked={settings.flipZ} onChange={(v) => updateSetting("flipZ", v)} />
      <CheckboxRow
        id="spin180"
        label="Xoay 180°"
        hint="Đổi trước / sau"
        checked={settings.spin180}
        onChange={(v) => updateSetting("spin180", v)}
      />
      <button type="button" className="btn block" onClick={() => resetOrientationSettings()}>
        Đặt lại hướng
      </button>
      <p className="hint-text">
        Model từ Revit/IFC/AutoCAD thường lệch trục hoặc bị lật do khác chuẩn hệ trục với glTF. Thử lần lượt các tùy
        chọn trên tới khi đúng hướng.
      </p>
    </Section>
  );
}
