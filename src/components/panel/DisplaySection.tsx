import { useViewerStore } from "../../state/viewerStore";
import { Section } from "./Section";
import { CheckboxRow } from "./CheckboxRow";

export function DisplaySection() {
  const settings = useViewerStore((s) => s.settings);
  const updateSetting = useViewerStore((s) => s.updateSetting);

  return (
    <Section title="Hiển thị">
      <CheckboxRow
        id="showEdges"
        label="Đường viền cạnh"
        checked={settings.showEdges}
        onChange={(v) => updateSetting("showEdges", v)}
      />
      <CheckboxRow
        id="antialias"
        label="Khử răng cưa"
        hint="Siêu lấy mẫu: đường mảnh mịn hơn, tốn GPU hơn"
        checked={settings.antialias}
        onChange={(v) => updateSetting("antialias", v)}
      />
      <CheckboxRow
        id="showShadows"
        label="Đổ bóng"
        checked={settings.showShadows}
        onChange={(v) => updateSetting("showShadows", v)}
      />
      <CheckboxRow
        id="lodWhileMoving"
        label="Giảm chi tiết khi xoay"
        hint="Lúc kéo/zoom: giảm độ phân giải, chỉ vẽ bộ phận lớn (viền cạnh vẫn giữ)"
        checked={settings.lodWhileMoving}
        onChange={(v) => updateSetting("lodWhileMoving", v)}
      />
      <CheckboxRow
        id="showFps"
        label="Hiển thị FPS"
        checked={settings.showFps}
        onChange={(v) => updateSetting("showFps", v)}
      />
      <CheckboxRow
        id="autoRotate"
        label="Tự xoay"
        checked={settings.autoRotate}
        onChange={(v) => updateSetting("autoRotate", v)}
      />
    </Section>
  );
}
