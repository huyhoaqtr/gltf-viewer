import { Html } from "@react-three/drei";
import { useViewerStore } from "../state/viewerStore";

/**
 * Pins pinned to the model surface. Rendered as a child of the model pivot, so the
 * positions (pivot-local) follow orientation changes, and being real scene objects
 * they stay attached while orbiting / panning / zooming.
 */
export function CommentLayer() {
  const comments = useViewerStore((s) => s.comments);
  const activeId = useViewerStore((s) => s.activeCommentId);
  const setActive = useViewerStore((s) => s.setActiveComment);
  const update = useViewerStore((s) => s.updateComment);
  const remove = useViewerStore((s) => s.removeComment);

  return (
    <>
      {comments.map((m, i) => {
        const active = m.id === activeId;
        return (
          <Html key={m.id} position={m.position} center zIndexRange={active ? [30, 20] : [20, 10]}>
            <div className={`comment-pin${active ? " active" : ""}`}>
              <button
                type="button"
                className="comment-dot"
                title={m.text || `Ghi chú ${i + 1}`}
                onClick={() => setActive(active ? null : m.id)}
              >
                {i + 1}
              </button>
              {active ? (
                <div className="comment-bubble" onPointerDown={(e) => e.stopPropagation()}>
                  <textarea
                    autoFocus
                    rows={3}
                    placeholder="Nhập ghi chú…"
                    value={m.text}
                    onChange={(e) => update(m.id, e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Escape") setActive(null);
                    }}
                  />
                  <div className="comment-actions">
                    <button type="button" className="btn" onClick={() => setActive(null)}>
                      Xong
                    </button>
                    <button type="button" className="btn danger" onClick={() => remove(m.id)}>
                      Xóa
                    </button>
                  </div>
                </div>
              ) : (
                m.text && <div className="comment-label">{m.text}</div>
              )}
            </div>
          </Html>
        );
      })}
    </>
  );
}
