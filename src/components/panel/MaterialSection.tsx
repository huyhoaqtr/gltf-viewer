import { useEngine } from "../../context/EngineContext";
import { useViewerStore } from "../../state/viewerStore";
import { Slider } from "./Slider";
import { CheckboxRow } from "./CheckboxRow";

export function MaterialSection() {
  const engine = useEngine();
  const settings = useViewerStore((s) => s.settings);
  const updateSetting = useViewerStore((s) => s.updateSetting);

  return (
    <div className="group">
      <h3>Vật liệu</h3>
      <Slider
        id="roughness"
        label="Độ nhám tối thiểu"
        min={0}
        max={1}
        step={0.05}
        value={settings.roughnessFloor}
        format={(v) => v.toFixed(2)}
        onChange={(v) => {
          updateSetting("roughnessFloor", v);
          engine?.setRoughnessFloor(v);
        }}
      />
      <CheckboxRow
        id="flattenMetal"
        label="Ép kim loại về 0 (kiến trúc)"
        checked={settings.flattenMetal}
        onChange={(v) => {
          updateSetting("flattenMetal", v);
          engine?.setFlattenMetal(v);
        }}
      />
      <CheckboxRow
        id="doubleSided"
        label="Hiển thị hai mặt (sửa mặt bị đen/mất)"
        checked={settings.doubleSided}
        onChange={(v) => {
          updateSetting("doubleSided", v);
          engine?.setDoubleSided(v);
        }}
      />
    </div>
  );
}
