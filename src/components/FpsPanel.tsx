import { useViewerStore } from "../state/viewerStore";
import { formatCount } from "../utils/format";

export function FpsPanel() {
  const show = useViewerStore((s) => s.settings.showFps);
  const stats = useViewerStore((s) => s.fpsStats);
  if (!show) return null;

  const fps = stats ? Math.round(stats.fps) : null;
  const level = fps === null ? "" : fps >= 50 ? "good" : fps >= 30 ? "warn" : "bad";

  return (
    <div id="fps" aria-label="Hiệu năng">
      <div className={`fps-main ${level}`}>
        <strong>{fps ?? "--"}</strong>
        <span>FPS</span>
      </div>
      <div className="fps-sub">
        <span>{stats ? `${stats.ms.toFixed(1)} ms` : "-- ms"}</span>
        <span>{stats ? `${formatCount(stats.calls)} calls` : "-- calls"}</span>
        <span>{stats ? `${formatCount(stats.triangles)} tris` : "-- tris"}</span>
      </div>
    </div>
  );
}
