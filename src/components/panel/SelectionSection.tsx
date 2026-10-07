import { viewerApi } from "../../r3f/viewerApi";
import { useViewerStore } from "../../state/viewerStore";
import { DEFAULT_SETTINGS } from "../../types/viewer";

export function SelectionSection() {
  const selectedName = useViewerStore((s) => s.selectedName);
  const hasHidden = useViewerStore((s) => s.hasHidden);
  const selectionColor = useViewerStore((s) => s.settings.selectionColor) ?? DEFAULT_SETTINGS.selectionColor;
  const selectionFillColor = useViewerStore((s) => s.settings.selectionFillColor) ?? DEFAULT_SETTINGS.selectionFillColor;
  const updateSetting = useViewerStore((s) => s.updateSetting);

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
      <div className="color-row">
        <label>
          Màu viền
          <input type="color" value={selectionColor} onChange={(e) => updateSetting("selectionColor", e.target.value)} />
        </label>
        <label>
          Màu mặt (fill)
          <input
            type="color"
            value={selectionFillColor}
            onChange={(e) => updateSetting("selectionFillColor", e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn"
          onClick={() => {
            updateSetting("selectionColor", DEFAULT_SETTINGS.selectionColor);
            updateSetting("selectionFillColor", DEFAULT_SETTINGS.selectionFillColor);
          }}
        >
          Mặc định
        </button>
      </div>
      <p className="hint-text">
        Click vào 1 bộ phận trong model để chọn (viền cam). Click khoảng trống hoặc nhấn Esc để bỏ chọn.
      </p>
    </div>
  );
}
