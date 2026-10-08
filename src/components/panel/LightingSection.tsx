import { useViewerStore } from "../../state/viewerStore";
import { Section } from "./Section";
import { Slider } from "./Slider";

export function LightingSection() {
  const settings = useViewerStore((s) => s.settings);
  const updateSetting = useViewerStore((s) => s.updateSetting);

  return (
    <Section title="Ánh sáng">
      <Slider
        id="sunIntensity"
        label="Nắng (sun)"
        min={0}
        max={6}
        step={0.1}
        value={settings.sunIntensity}
        format={(v) => v.toFixed(1)}
        onChange={(v) => updateSetting("sunIntensity", v)}
      />
      <Slider
        id="skyIntensity"
        label="Bầu trời"
        min={0}
        max={4}
        step={0.1}
        value={settings.skyIntensity}
        format={(v) => v.toFixed(1)}
        onChange={(v) => updateSetting("skyIntensity", v)}
      />
      <Slider
        id="exposure"
        label="Exposure"
        min={0.2}
        max={2.5}
        step={0.05}
        value={settings.exposure}
        format={(v) => v.toFixed(2)}
        onChange={(v) => updateSetting("exposure", v)}
      />
      <Slider
        id="contrast"
        label="Độ tương phản"
        min={0.5}
        max={1.8}
        step={0.05}
        value={settings.contrast}
        format={(v) => v.toFixed(2)}
        onChange={(v) => updateSetting("contrast", v)}
      />
      <Slider
        id="sunAngle"
        label="Góc nắng"
        min={0}
        max={360}
        step={1}
        value={settings.sunAngle}
        format={(v) => `${Math.round(v)}°`}
        onChange={(v) => updateSetting("sunAngle", v)}
      />
    </Section>
  );
}
