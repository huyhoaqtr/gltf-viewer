# GLB Viewer

Viewer glTF/GLB chạy trên trình duyệt, tối ưu cho model xuất từ BIM/CAD
(Revit, IFC, AutoCAD, SketchUp...). Chuyển thể từ bản HTML/JS gốc sang
React + TypeScript + Vite, tách kiến trúc rõ ràng để dễ maintain/scale.

## Chạy thử

```bash
npm install
npm run dev
```

Mở http://localhost:5173, kéo thả file `.glb`/`.gltf` vào cửa sổ hoặc bấm
"Mở file".

## Build production

```bash
npm run build   # type-check (tsc -b) rồi build ra dist/
npm run preview # xem thử bản build
```

## Kiến trúc

Nguyên tắc chính: **logic three.js không phụ thuộc React**, UI React chỉ
gọi vào một API imperative + đọc state qua store. Nhờ vậy phần 3D có thể
test/tái sử dụng độc lập, còn phần UI có thể đổi (thêm màn hình, đổi
layout...) mà không đụng vào engine.

```
src/
├── three/                  Toàn bộ logic three.js, KHÔNG import React
│   ├── ViewerEngine.ts      Orchestrator chính: scene/camera/renderer/loader,
│   │                        expose các method setSunIntensity(), loadFile(),
│   │                        hideSelected()... cho UI gọi vào
│   ├── cubeNavigator.ts     Gizmo góc màn hình (click để snap góc nhìn chuẩn)
│   ├── edgesOverlay.ts      Dựng "đường viền cạnh" theo từng đợt (không
│   │                        đóng băng UI với model nhiều mesh)
│   ├── selection.ts         Chọn / Ẩn / Cô lập object, viền highlight,
│   │                        và xử lý các sibling dạng LINES (BIM/CAD hay
│   │                        bake nét trang trí thành node riêng)
│   ├── orientation.ts       Fix trục lên (Y/Z) + lật gương cho model BIM/CAD
│   ├── modelStyling.ts      Tính stats (mesh/tam giác) + style vật liệu
│   └── constants.ts         Toàn bộ ngưỡng/hằng số có thể tinh chỉnh
│
├── hooks/
│   ├── useViewerEngine.ts   Tạo + dispose ViewerEngine theo vòng đời component
│   └── useWindowFileDrop.ts Kéo-thả file ở cấp window
│
├── context/EngineContext.tsx  Cung cấp instance ViewerEngine cho toàn cây UI
├── state/viewerStore.ts       Zustand store — nguồn sự thật cho mọi input
│                               có kiểm soát trong panel (sync 2 chiều với engine)
│
├── components/              UI thuần React, không có logic three.js
│   ├── TopBar.tsx, DropZone.tsx, LoadingOverlay.tsx, ToastBanner.tsx, Hint.tsx
│   ├── Viewport.tsx          div chứa canvas do engine tự mount vào
│   └── panel/                Mỗi nhóm cài đặt trong panel là 1 file riêng
│       (Lighting, Material, Orientation, Display, Selection, Background, Camera)
│
├── types/viewer.ts          Kiểu dữ liệu + giá trị mặc định dùng chung
└── utils/format.ts          Hàm tiện ích (format số lượng mesh/tam giác)
```

### Thêm 1 tuỳ chọn mới trong panel — quy trình chuẩn

1. Thêm field vào `ViewerSettings` (`types/viewer.ts`) + giá trị mặc định.
2. Thêm method setter tương ứng vào `ViewerEngine` (`three/ViewerEngine.ts`).
3. Thêm control (Slider/CheckboxRow/...) vào đúng section trong
   `components/panel/`, gọi `updateSetting()` (store) và `engine?.setXxx()`
   (engine) trong cùng 1 handler.

### Các ngưỡng hiệu năng (đã audit cho model lớn)

- `EDGE_BUILD_FRAME_BUDGET_MS` — thời gian tối đa mỗi khung hình dành cho
  việc dựng edges (chạy chia nhỏ qua nhiều frame, không chặn main thread).

Việc dựng edges, GLTFLoader (Draco + Meshopt decoder), và style vật liệu khi
kéo slider "Độ nhám" đều đã được viết để không làm đứng hình với model
hàng trăm/nghìn mesh — chi tiết xem comment trong `edgesOverlay.ts` và
`ViewerEngine.ts` (`scheduleRestyle`).

### Lưu ý

- Render loop hiện chạy liên tục ~60fps kể cả khi không tương tác (chưa
  chuyển sang kiểu "chỉ render khi có thay đổi"). Đây là đánh đổi có chủ
  đích để giảm rủi ro lỗi vòng đời khi port sang React — có thể tối ưu thêm
  nếu cần cho scene rất nặng.
- Toàn bộ nhãn UI giữ nguyên tiếng Việt như bản gốc.
