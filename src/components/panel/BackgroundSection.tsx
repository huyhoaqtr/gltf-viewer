import { useEngine } from "../../context/EngineContext";
import { useViewerStore } from "../../state/viewerStore";
import { BACKGROUND_LABELS, BACKGROUND_SWATCHES } from "../../types/viewer";

export function BackgroundSection() {
  const engine = useEngine();
  const settings = useViewerStore((s) => s.settings);
  const updateSetting = useViewerStore((s) => s.updateSetting);

  return (
    <div className="group">
      <h3>Nền</h3>
      <div className="swatch-row">
        {BACKGROUND_SWATCHES.map((hex) => (
          <button
            key={hex}
            type="button"
            className="swatch"
            style={{ background: hex }}
            aria-pressed={settings.background === hex}
            title={BACKGROUND_LABELS[hex]}
            onClick={() => {
              updateSetting("background", hex);
              engine?.setBackground(hex);
            }}
          />
        ))}
      </div>
    </div>
  );
}
