import { useEffect } from "react";
import { useViewerStore } from "../state/viewerStore";

/**
 * Listens for drag-and-drop of a .glb/.gltf file anywhere on the window and
 * forwards the dropped file to `onFile`. Also drives the dropzone's
 * open/dragover visual state in the store.
 */
export function useWindowFileDrop(onFile: (file: File) => void) {
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      useViewerStore.getState().setDropzoneVisible(true);
      useViewerStore.getState().setDragOver(true);
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      useViewerStore.getState().setDropzoneVisible(true);
      useViewerStore.getState().setDragOver(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.target !== document.getElementById("dropzone")) return;
      useViewerStore.getState().setDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      useViewerStore.getState().setDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) {
        onFile(file);
      } else if (!useViewerStore.getState().fileName) {
        useViewerStore.getState().setDropzoneVisible(true);
      }
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [onFile]);
}
