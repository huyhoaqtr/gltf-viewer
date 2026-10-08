import { useViewerStore } from "../../state/viewerStore";
import { BACKGROUND_LABELS, BACKGROUND_SWATCHES } from "../../types/viewer";
import { Section } from "./Section";

export function BackgroundSection() {
  const settings = useViewerStore((s) => s.settings);
  const updateSetting = useViewerStore((s) => s.updateSetting);

  return (
    <Section title="Nền">
      <div className="swatch-row">
        {BACKGROUND_SWATCHES.map((hex) => (
          <button
            key={hex}
            type="button"
            className="swatch"
            style={{ background: hex }}
            aria-pressed={settings.background === hex}
            aria-label={BACKGROUND_LABELS[hex]}
            title={BACKGROUND_LABELS[hex]}
            onClick={() => updateSetting("background", hex)}
          />
        ))}
      </div>
    </Section>
  );
}
