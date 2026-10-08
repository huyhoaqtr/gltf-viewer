import { viewerApi } from "../../r3f/viewerApi";
import { useViewerStore } from "../../state/viewerStore";
import { DEFAULT_SETTINGS } from "../../types/viewer";
import { Section } from "./Section";

export function SelectionSection() {
  const selectedName = useViewerStore((s) => s.selectedName);
  const hasHidden = useViewerStore((s) => s.hasHidden);
  const selectionColor = useViewerStore((s) => s.settings.selectionColor) ?? DEFAULT_SETTINGS.selectionColor;
  const selectionFillColor = useViewerStore((s) => s.settings.selectionFillColor) ?? DEFAULT_SETTINGS.selectionFillColor;
  const updateSetting = useViewerStore((s) => s.updateSetting);

  return (
    <>
      <Section title="Đối tượng đã chọn">
        <span className={`selection-name${selectedName ? "" : " empty"}`} title={selectedName ?? undefined}>
          {selectedName ?? "Chưa chọn gì"}
        </span>
        <div className="btn-row">
          <button type="button" className="btn" disabled={!selectedName} onClick={() => viewerApi.hideSelected()}>
            Ẩn
          </button>
          <button type="button" className="btn" disabled={!selectedName} onClick={() => viewerApi.isolateSelected()}>
            Cô lập
          </button>
        </div>
        <button type="button" className="btn block" disabled={!hasHidden} onClick={() => viewerApi.showAllObjects()}>
          Hiện tất cả
        </button>
        <p className="hint-text">Click vào một bộ phận trong model để chọn. Click khoảng trống hoặc nhấn Esc để bỏ chọn.</p>
      </Section>
      <Section title="Màu chọn">
        <div className="color-grid">
          <label className="field">
            <span className="field-head">Màu viền</span>
            <input
              type="color"
              className="color-input"
              value={selectionColor}
              onChange={(e) => updateSetting("selectionColor", e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-head">Màu mặt (fill)</span>
            <input
              type="color"
              className="color-input"
              value={selectionFillColor}
              onChange={(e) => updateSetting("selectionFillColor", e.target.value)}
            />
          </label>
        </div>
        <button
          type="button"
          className="btn block"
          onClick={() => {
            updateSetting("selectionColor", DEFAULT_SETTINGS.selectionColor);
            updateSetting("selectionFillColor", DEFAULT_SETTINGS.selectionFillColor);
          }}
        >
          Màu mặc định
        </button>
      </Section>
    </>
  );
}
