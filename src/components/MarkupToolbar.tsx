import { useViewerStore } from "../state/viewerStore";
import type { MarkupTool } from "../types/viewer";

const TOOLS: { id: Exclude<MarkupTool, "off">; label: string; path: string }[] = [
  { id: "pen", label: "Bút vẽ", path: "M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3" },
  { id: "line", label: "Đường thẳng", path: "M5 19L19 5" },
  { id: "arrow", label: "Mũi tên", path: "M5 19L19 5M10 5h9v9" },
  { id: "rect", label: "Chữ nhật", path: "M4 6h16v12H4z" },
  { id: "circle", label: "Hình tròn", path: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z" },
];

function ToolIcon({ path }: { path: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

/** Floating tool strip, shown only while a markup tool is active. */
export function MarkupToolbar() {
  const tool = useViewerStore((s) => s.markupTool);
  const color = useViewerStore((s) => s.markupColor);
  const width = useViewerStore((s) => s.markupWidth);
  const count = useViewerStore((s) => s.strokes.length);
  const { setMarkupTool, setMarkupColor, setMarkupWidth, undoStroke, clearStrokes } = useViewerStore.getState();

  if (tool === "off") return null;
  return (
    <div className="markup-toolbar" role="toolbar" aria-label="Markup">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          className="btn toggle"
          aria-pressed={tool === t.id}
          title={t.label}
          onClick={() => setMarkupTool(t.id)}
        >
          <ToolIcon path={t.path} />
        </button>
      ))}
      <span className="toolbar-divider" />
      <input type="color" className="markup-color" title="Màu" value={color} onChange={(e) => setMarkupColor(e.target.value)} />
      <input
        type="range"
        className="markup-width"
        title={`Độ dày: ${width}px`}
        min={1}
        max={12}
        step={1}
        value={width}
        onChange={(e) => setMarkupWidth(Number(e.target.value))}
      />
      <span className="toolbar-divider" />
      <button type="button" className="btn" disabled={count === 0} title="Hoàn tác (Ctrl+Z)" aria-label="Hoàn tác" onClick={undoStroke}>
        <ToolIcon path="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />
      </button>
      <button type="button" className="btn danger" disabled={count === 0} title="Xóa hết" aria-label="Xóa hết" onClick={clearStrokes}>
        <ToolIcon path="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
      </button>
      <button type="button" className="btn primary" title="Xong (Esc)" aria-label="Xong" onClick={() => setMarkupTool("off")}>
        <ToolIcon path="m5 12 5 5 9-10" />
      </button>
      <span className="markup-hint">Chuột phải: xoay · Lăn: zoom</span>
    </div>
  );
}
