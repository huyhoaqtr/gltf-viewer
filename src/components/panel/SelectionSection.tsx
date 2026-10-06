import { viewerApi } from "../../r3f/viewerApi";
import { useViewerStore } from "../../state/viewerStore";

export function SelectionSection() {
  const selectedName = useViewerStore((s) => s.selectedName);
  const hasHidden = useViewerStore((s) => s.hasHidden);

  return (
    <div className="group">
      <h3>Đối tượng đã chọn</h3>
      <span className="selection-name">{selectedName ?? "Chưa chọn gì"}</span>
      <div className="btn-row">
        <button className="btn" disabled={!selectedName} onClick={() => viewerApi.hideSelected()}>
          Ẩn
        </button>
        <button className="btn" disabled={!selectedName} onClick={() => viewerApi.isolateSelected()}>
          Cô lập
        </button>
        <button className="btn" disabled={!hasHidden} onClick={() => viewerApi.showAllObjects()}>
          Hiện tất cả
        </button>
      </div>
      <p className="hint-text">
        Click vào 1 bộ phận trong model để chọn (viền cam). Click khoảng trống hoặc nhấn Esc để bỏ chọn.
      </p>
    </div>
  );
}
