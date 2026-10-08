import { useViewerStore } from "../../state/viewerStore";
import type { CameraMode } from "../../types/viewer";
import { Section } from "./Section";

const MODES: { id: CameraMode; label: string; title: string }[] = [
  { id: "persp", label: "Phối cảnh", title: "Perspective" },
  { id: "ortho", label: "Song song", title: "Orthographic" },
];

export function CameraSection() {
  const cameraMode = useViewerStore((s) => s.settings.cameraMode);
  const updateSetting = useViewerStore((s) => s.updateSetting);

  return (
    <Section title="Camera">
      <div className="segmented" role="radiogroup" aria-label="Chế độ camera">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={cameraMode === m.id}
            title={m.title}
            onClick={() => updateSetting("cameraMode", m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
    </Section>
  );
}
