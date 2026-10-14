import { ViewerCanvas } from "../r3f/ViewerCanvas";
import { useViewerStore } from "../state/viewerStore";

export function Viewport() {
  const commentMode = useViewerStore((s) => s.commentMode);
  const drawing = useViewerStore((s) => s.markupTool !== "off");
  return (
    <div id="viewport" className={commentMode ? "comment-mode" : drawing ? "drawing" : undefined}>
      <ViewerCanvas />
    </div>
  );
}
