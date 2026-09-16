import { useEffect } from "react";
import { useViewerStore } from "../state/viewerStore";

export function ToastBanner() {
  const toast = useViewerStore((s) => s.toast);
  const clearToast = useViewerStore((s) => s.clearToast);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clearToast, 4000);
    return () => clearTimeout(t);
  }, [toast, clearToast]);

  return (
    <div id="toast" className={toast ? "show" : undefined}>
      {toast}
    </div>
  );
}
