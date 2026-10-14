import { useViewerStore } from "../../state/viewerStore";
import { Section } from "./Section";

export function CommentSection() {
  const commentMode = useViewerStore((s) => s.commentMode);
  const toggleCommentMode = useViewerStore((s) => s.toggleCommentMode);
  const comments = useViewerStore((s) => s.comments);
  const activeId = useViewerStore((s) => s.activeCommentId);
  const setActive = useViewerStore((s) => s.setActiveComment);
  const remove = useViewerStore((s) => s.removeComment);
  const clear = useViewerStore((s) => s.clearComments);

  return (
    <Section title="Comment">
      <button type="button" className="btn block toggle" aria-pressed={commentMode} onClick={toggleCommentMode}>
        {commentMode ? "Đang đặt ghi chú — bấm để tắt" : "Bật chế độ comment"}
      </button>
      <p className="hint-text">
        Bật chế độ comment rồi click lên model để ghim ghi chú. Kéo chuột vẫn xoay/di chuyển camera bình thường.
      </p>
      {comments.length === 0 ? (
        <span className="selection-name empty">Chưa có ghi chú</span>
      ) : (
        <ul className="comment-list">
          {comments.map((m, i) => (
            <li key={m.id} className={m.id === activeId ? "active" : undefined}>
              <button type="button" className="comment-item" onClick={() => setActive(m.id)}>
                <span className="comment-dot sm">{i + 1}</span>
                <span className="comment-item-text">{m.text || "(trống)"}</span>
              </button>
              <button type="button" className="comment-del" title="Xóa" onClick={() => remove(m.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn block" disabled={comments.length === 0} onClick={clear}>
        Xóa tất cả
      </button>
    </Section>
  );
}
