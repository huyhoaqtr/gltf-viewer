import { useViewerStore } from "../state/viewerStore";

/** Thin bar fixed to the top edge showing how far opening the model has got (0 → 100%). */
export function LoadProgressBar() {
  const progress = useViewerStore((s) => s.loadProgress);
  const visible = progress !== null;
  const pct = Math.round((progress ?? 0) * 100);
  return (
    <div
      id="load-progress"
      className={visible ? "show" : undefined}
      role="progressbar"
      aria-label="Tiến độ mở model"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={visible ? pct : undefined}
      aria-hidden={!visible}
    >
      <div className="load-progress-fill" style={{ transform: `scaleX(${progress ?? 0})` }} />
    </div>
  );
}
