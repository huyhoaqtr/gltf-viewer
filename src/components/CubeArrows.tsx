import { cubeApi, type CubeStep } from "../r3f/cubeApi";
import { useViewerStore } from "../state/viewerStore";
import { CUBE_NAV } from "../three/constants";

const ARROWS: { step: CubeStep; label: string }[] = [
  { step: "up", label: "Xem mặt phía trên" },
  { step: "down", label: "Xem mặt phía dưới" },
  { step: "left", label: "Xem mặt bên trái" },
  { step: "right", label: "Xem mặt bên phải" },
];

/**
 * Arrow buttons around the view cube. They appear only while the camera looks
 * straight at a face and the pointer is over the cube, and step the view to the
 * neighbouring face in that screen direction.
 */
export function CubeArrows() {
  const visible = useViewerStore((s) => s.cubeAligned && s.cubeHover);
  const style: React.CSSProperties = {
    left: CUBE_NAV.marginX,
    top: CUBE_NAV.marginTop,
    width: CUBE_NAV.size,
    height: CUBE_NAV.size,
  };

  return (
    <div className={`cube-arrows${visible ? " show" : ""}`} style={style}>
      {ARROWS.map((a) => (
        <button
          key={a.step}
          type="button"
          className={`cube-arrow ${a.step}`}
          aria-label={a.label}
          title={a.label}
          tabIndex={visible ? 0 : -1}
          onClick={() => cubeApi.step(a.step)}
        />
      ))}
    </div>
  );
}
