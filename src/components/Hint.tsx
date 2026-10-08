import { useState } from "react";

const STORAGE_KEY = "hint-collapsed";

const HINTS: [key: string, action: string][] = [
  ["Chuột trái", "Xoay"],
  ["Cuộn", "Zoom"],
  ["Chuột phải", "Pan"],
  ["Click", "Chọn"],
  ["Esc", "Bỏ chọn"],
  ["H", "Hologram"],
];

function readCollapsed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function Hint() {
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // storage unavailable: the choice just won't persist
    }
  };

  return (
    <div id="hint" className={collapsed ? "collapsed" : undefined}>
      <button
        type="button"
        className="hint-toggle"
        aria-expanded={!collapsed}
        title={collapsed ? "Hiện hướng dẫn thao tác" : "Thu gọn hướng dẫn"}
        onClick={toggle}
      >
        <svg className="icon icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m15 6-6 6 6 6" />
        </svg>
        <svg className="icon icon-help" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" />
        </svg>
      </button>
      <div className="hint-items" aria-hidden={collapsed}>
        <div className="hint-items-inner">
          {HINTS.map(([key, action]) => (
            <span key={key}>
              <kbd>{key}</kbd> {action}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
