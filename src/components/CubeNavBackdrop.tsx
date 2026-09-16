import { CUBE_NAV } from "../three/constants";

/**
 * Purely decorative soft backdrop behind the cube navigator gizmo, which is
 * drawn by the engine directly into the WebGL canvas (not a DOM element).
 * Position/size come from the same constants the engine uses, so the two
 * always line up.
 */
export function CubeNavBackdrop() {
  const pad = 14;
  const style: React.CSSProperties = {
    left: CUBE_NAV.marginX - pad,
    top: CUBE_NAV.marginTop - pad,
    width: CUBE_NAV.size + pad * 2,
    height: CUBE_NAV.size + pad * 2,
  };
  return <div className="cube-nav-backdrop" style={style} aria-hidden="true" />;
}
