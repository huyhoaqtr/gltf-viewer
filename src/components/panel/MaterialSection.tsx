import { useViewerStore } from "../../state/viewerStore";
import { Section } from "./Section";
import { CheckboxRow } from "./CheckboxRow";

export function MaterialSection() {
  const settings = useViewerStore((s) => s.settings);
  const updateSetting = useViewerStore((s) => s.updateSetting);

  return (
    <Section title="Vật liệu">
      <CheckboxRow
        id="flattenMetal"
        label="Ép kim loại về 0"
        hint="Dùng cho model kiến trúc"
        checked={settings.flattenMetal}
        onChange={(v) => updateSetting("flattenMetal", v)}
      />
      <CheckboxRow
        id="doubleSided"
        label="Hiển thị hai mặt"
        hint="Sửa mặt bị đen / mất"
        checked={settings.doubleSided}
        onChange={(v) => updateSetting("doubleSided", v)}
      />
    </Section>
  );
}
