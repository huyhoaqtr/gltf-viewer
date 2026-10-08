import { useViewerStore } from "../../state/viewerStore";
import { DEFAULT_HOLOGRAM_SETTINGS } from "../../types/viewer";
import { CheckboxRow } from "./CheckboxRow";
import { Section } from "./Section";
import { Slider } from "./Slider";

export function HologramSection() {
  const h = useViewerStore((s) => s.hologramSettings);
  const update = useViewerStore((s) => s.updateHologramSetting);

  return (
    <Section title="Hologram">
      <div className="field">
        <div className="field-head">
          <span>Màu</span>
          <button type="button" className="link-btn" onClick={() => update("color", DEFAULT_HOLOGRAM_SETTINGS.color)}>
            Mặc định
          </button>
        </div>
        <input type="color" className="color-input" value={h.color} onChange={(e) => update("color", e.target.value)} />
      </div>
      <Slider
        id="holoOpacity"
        label="Độ trong suốt"
        min={0.05}
        max={1}
        step={0.05}
        value={h.opacity}
        format={(v) => v.toFixed(2)}
        onChange={(v) => update("opacity", v)}
      />
      <Slider
        id="holoRim"
        label="Viền sáng (rim)"
        min={0.5}
        max={6}
        step={0.1}
        value={h.rimPower}
        format={(v) => v.toFixed(1)}
        onChange={(v) => update("rimPower", v)}
      />
      <Slider
        id="holoBloom"
        label="Bloom"
        min={0}
        max={3}
        step={0.1}
        value={h.bloomIntensity}
        format={(v) => v.toFixed(1)}
        onChange={(v) => update("bloomIntensity", v)}
      />
      <Slider
        id="holoScanDensity"
        label="Mật độ scanline"
        min={0}
        max={200}
        step={1}
        value={h.scanlineDensity}
        format={(v) => String(Math.round(v))}
        onChange={(v) => update("scanlineDensity", v)}
      />
      <Slider
        id="holoScanSpeed"
        label="Tốc độ scanline"
        min={0}
        max={2}
        step={0.05}
        value={h.scanlineSpeed}
        format={(v) => v.toFixed(2)}
        onChange={(v) => update("scanlineSpeed", v)}
      />
      <Slider
        id="holoFlicker"
        label="Nhấp nháy"
        min={0}
        max={1}
        step={0.05}
        value={h.flickerIntensity}
        format={(v) => v.toFixed(2)}
        onChange={(v) => update("flickerIntensity", v)}
      />
      <CheckboxRow id="holoGrid" label="Lưới nền (grid)" checked={h.showGrid} onChange={(v) => update("showGrid", v)} />
      <CheckboxRow id="holoEdges" label="Đường viền cạnh" checked={h.showEdges} onChange={(v) => update("showEdges", v)} />
      <CheckboxRow
        id="holoPrepass"
        label="Chỉ phát sáng mặt gần"
        hint="Tắt = nhìn xuyên (X-ray)"
        checked={h.depthPrepass}
        onChange={(v) => update("depthPrepass", v)}
      />
    </Section>
  );
}
