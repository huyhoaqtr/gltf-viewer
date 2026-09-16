import { useRef } from "react";
import { useEngine } from "../context/EngineContext";
import { useViewerStore } from "../state/viewerStore";
import { useWindowFileDrop } from "../hooks/useWindowFileDrop";

export function DropZone() {
  const engine = useEngine();
  const visible = useViewerStore((s) => s.dropzoneVisible);
  const dragOver = useViewerStore((s) => s.dragOver);
  const inputRef = useRef<HTMLInputElement>(null);

  useWindowFileDrop((file) => engine?.loadFile(file));

  const classes = ["", !visible ? "hidden" : "", dragOver ? "dragover" : ""].filter(Boolean).join(" ");

  return (
    <div id="dropzone" className={classes || undefined}>
      <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4}>
        <path d="M12 2 3 7v10l9 5 9-5V7z" />
        <path d="M3 7l9 5 9-5" />
        <path d="M12 12v10" />
      </svg>
      <h1>Kéo thả file .glb hoặc .gltf vào đây</h1>
      <p>
        Hoặc bấm nút "Mở file" ở góc trên. Xem trực tiếp trong trình duyệt, không upload lên đâu cả — mọi thứ xử lý
        ngay trên máy bạn.
      </p>
      <button className="btn primary" onClick={() => inputRef.current?.click()}>
        Chọn file để mở
      </button>
      <span className="hint">Hỗ trợ .glb / .gltf (kèm .bin, texture nếu bạn kéo cả thư mục dưới dạng .glb đã gộp)</span>
      <input
        ref={inputRef}
        type="file"
        accept=".glb,.gltf"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) engine?.loadFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
