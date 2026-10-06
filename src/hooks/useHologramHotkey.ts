import { useEffect } from "react";
import { useViewerStore } from "../state/viewerStore";

/** `H` toggles hologram mode (ignored while typing or with modifier keys). */
export function useHologramHotkey() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "h" || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      useViewerStore.getState().toggleHologram();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
