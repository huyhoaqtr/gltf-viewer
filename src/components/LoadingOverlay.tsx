import { useViewerStore } from "../state/viewerStore";

export function LoadingOverlay() {
  const loading = useViewerStore((s) => s.loading);
  const text = useViewerStore((s) => s.loadingText);
  return (
    <div id="loading" className={loading ? "show" : undefined}>
      <div className="spinner" />
      <span>{text}</span>
    </div>
  );
}
