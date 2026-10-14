import { useEffect, useRef, useState } from "react";
import { useStore, useThree } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import * as THREE from "three";
import { useViewerStore } from "../state/viewerStore";
import type { MarkupTool } from "../types/viewer";
import { useSceneRuntime } from "./runtime";

type Pts = [number, number, number][];

const CIRCLE_SEGMENTS = 64;
const PEN_MIN_PX = 2;
/** The text box stops growing at this many characters (longer text scrolls inside it). */
const TEXT_MAX_CHARS = 28;

/** Label font size in px for a given line-width setting (1–12 → 11–22px). */
const textSize = (width: number) => Math.round(10 + width * 1);

/**
 * Shapes drawn on a plane through the first clicked surface point, facing the camera
 * at that moment. Points are stored in pivot-local space, so the drawing stays attached
 * to the model and is still there after orbiting.
 *
 * Rendered as a child of the model pivot; the wrapper group is identity within it.
 */
export function MarkupLayer() {
  const rt = useSceneRuntime();
  const store = useStore();
  const gl = useThree((s) => s.gl);
  const groupRef = useRef<THREE.Group>(null);
  const strokes = useViewerStore((s) => s.strokes);
  const tool = useViewerStore((s) => s.markupTool);
  const color = useViewerStore((s) => s.markupColor);
  const width = useViewerStore((s) => s.markupWidth);
  const [draft, setDraft] = useState<Pts | null>(null);
  const [textDraft, setTextDraft] = useState<[number, number, number] | null>(null);

  useEffect(() => {
    if (tool === "off") return;
    const dom = gl.domElement;
    const group = groupRef.current!;
    const raycaster = new THREE.Raycaster();
    let drawing: {
      plane: THREE.Plane;
      right: THREE.Vector3;
      up: THREE.Vector3;
      normal: THREE.Vector3;
      start: THREE.Vector3; // world
      points: THREE.Vector3[]; // world
      lastPx: { x: number; y: number };
      startPx: { x: number; y: number };
      px: { x: number; y: number }[]; // pen samples in screen space
    } | null = null;

    const toLocal = (p: THREE.Vector3): [number, number, number] => {
      const l = group.worldToLocal(p.clone());
      return [l.x, l.y, l.z];
    };

    const planePoint = (x: number, y: number, plane: THREE.Plane): THREE.Vector3 | null => {
      const rect = dom.getBoundingClientRect();
      const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, store.getState().camera);
      return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    };

    const build = (t: MarkupTool, d: NonNullable<typeof drawing>, end: THREE.Vector3): THREE.Vector3[] => {
      const a = d.start;
      const delta = end.clone().sub(a);
      switch (t) {
        case "pen":
          return d.points;
        case "line":
          return [a, end];
        case "arrow": {
          const len = delta.length();
          if (len < 1e-9) return [a, end];
          const back = delta.clone().multiplyScalar(-0.2);
          const h1 = back.clone().applyAxisAngle(d.normal, Math.PI / 7).add(end);
          const h2 = back.clone().applyAxisAngle(d.normal, -Math.PI / 7).add(end);
          return [a, end, h1, end, h2];
        }
        case "rect": {
          const du = delta.dot(d.right);
          const dv = delta.dot(d.up);
          const c2 = a.clone().addScaledVector(d.right, du);
          const c4 = a.clone().addScaledVector(d.up, dv);
          return [a, c2, end, c4, a.clone()];
        }
        case "circle": {
          const r = delta.length();
          const pts: THREE.Vector3[] = [];
          for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
            const th = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
            pts.push(
              a.clone().addScaledVector(d.right, Math.cos(th) * r).addScaledVector(d.up, Math.sin(th) * r)
            );
          }
          return pts;
        }
        default:
          return [];
      }
    };

    /**
     * Depth for the finished shape: the median depth of the model surface found inside the
     * area the shape covers. Anchoring on the first click alone fails when the stroke starts
     * on empty space (e.g. circling a treetop), which leaves the shape floating at the wrong
     * depth so it drifts away from the model once the camera orbits.
     */
    const pickDepth = (d: NonNullable<typeof drawing>, endPx: { x: number; y: number }): number | null => {
      const camera = store.getState().camera;
      const xs = [d.startPx.x, endPx.x, ...d.px.map((q) => q.x)];
      const ys = [d.startPx.y, endPx.y, ...d.px.map((q) => q.y)];
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const samples: { x: number; y: number }[] = [d.startPx, endPx, ...d.px];
      if (tool === "rect" || tool === "circle" || tool === "pen") {
        const N = 6;
        for (let i = 0; i < N; i++)
          for (let j = 0; j < N; j++) samples.push({ x: x0 + ((x1 - x0) * (i + 0.5)) / N, y: y0 + ((y1 - y0) * (j + 0.5)) / N });
      }
      if (tool === "circle") {
        // the circle is centred on the start point with radius |end - start|
        const r = Math.hypot(endPx.x - d.startPx.x, endPx.y - d.startPx.y);
        for (let i = 0; i < 6; i++)
          for (let j = 0; j < 6; j++)
            samples.push({ x: d.startPx.x + r * (((i + 0.5) / 3) - 1), y: d.startPx.y + r * (((j + 0.5) / 3) - 1) });
      }
      // Cap work for very long pen strokes.
      const step = Math.max(1, Math.ceil(samples.length / 80));
      const depths: number[] = [];
      for (let i = 0; i < samples.length; i += step) {
        const local = rt.controller?.pickLocalPoint(samples[i].x, samples[i].y, dom);
        if (!local) continue;
        const w = group.localToWorld(local.clone());
        depths.push(w.sub(camera.position).dot(d.normal));
      }
      if (!depths.length) return null;
      depths.sort((a, b) => a - b);
      return depths[Math.floor(depths.length / 2)];
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || drawing) return;
      const camera = store.getState().camera;
      if (tool === "text") {
        // Label sits on the model surface under the click (or at the orbit target over empty space).
        const hit = rt.controller?.pickLocalPoint(e.clientX, e.clientY, dom);
        if (hit) return setTextDraft([hit.x, hit.y, hit.z]);
        const normal = camera.getWorldDirection(new THREE.Vector3());
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, rt.controls?.target ?? new THREE.Vector3());
        const p = planePoint(e.clientX, e.clientY, plane);
        if (p) setTextDraft(toLocal(p));
        return;
      }
      const local = rt.controller?.pickLocalPoint(e.clientX, e.clientY, dom);
      const anchor = local
        ? group.localToWorld(local.clone())
        : rt.controls?.target.clone() ?? new THREE.Vector3();
      const normal = camera.getWorldDirection(new THREE.Vector3());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, anchor);
      const start = planePoint(e.clientX, e.clientY, plane);
      if (!start) return;
      camera.updateMatrixWorld();
      drawing = {
        plane,
        normal,
        right: new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0),
        up: new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1),
        start,
        points: [start],
        lastPx: { x: e.clientX, y: e.clientY },
        startPx: { x: e.clientX, y: e.clientY },
        px: [{ x: e.clientX, y: e.clientY }],
      };
    };

    const onMove = (e: PointerEvent) => {
      if (!drawing) return;
      const end = planePoint(e.clientX, e.clientY, drawing.plane);
      if (!end) return;
      if (tool === "pen") {
        if (Math.hypot(e.clientX - drawing.lastPx.x, e.clientY - drawing.lastPx.y) < PEN_MIN_PX) return;
        drawing.lastPx = { x: e.clientX, y: e.clientY };
        drawing.points.push(end);
        drawing.px.push({ x: e.clientX, y: e.clientY });
      }
      setDraft(build(tool, drawing, end).map(toLocal));
    };

    const onUp = (e: PointerEvent) => {
      if (!drawing || e.button !== 0) return;
      const d = drawing;
      drawing = null;
      setDraft(null);
      const endPx = { x: e.clientX, y: e.clientY };
      if (tool === "pen") d.px.push(endPx);
      // A bare click (no drag) is not a shape.
      if (Math.hypot(endPx.x - d.startPx.x, endPx.y - d.startPx.y) < 3) return;

      // Re-project the shape onto a camera-facing plane at the depth of the surface it covers.
      // Same screen rays, so it looks identical from this view — only its depth changes.
      const camera = store.getState().camera;
      const depth = pickDepth(d, endPx);
      const plane =
        depth === null
          ? d.plane
          : new THREE.Plane().setFromNormalAndCoplanarPoint(
              d.normal,
              camera.position.clone().addScaledVector(d.normal, depth)
            );
      const start = planePoint(d.startPx.x, d.startPx.y, plane);
      const end = planePoint(endPx.x, endPx.y, plane);
      if (!start || !end) return;
      const final = { ...d, plane, start, points: tool === "pen" ? d.px.map((q) => planePoint(q.x, q.y, plane)!).filter(Boolean) : [start] };
      const pts = build(tool, final, end);
      if (pts.length < 2) return;
      useViewerStore.getState().addStroke({
        color: useViewerStore.getState().markupColor,
        width: useViewerStore.getState().markupWidth,
        points: pts.map(toLocal),
      });
    };

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        useViewerStore.getState().undoStroke();
      } else if (e.key === "Escape") {
        drawing = null;
        setDraft(null);
        setTextDraft(null);
        useViewerStore.getState().setMarkupTool("off");
      }
    };

    dom.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      dom.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
      setDraft(null);
      setTextDraft(null);
    };
  }, [tool, gl, rt, store]);

  return (
    <group ref={groupRef}>
      {strokes.map((s) =>
        s.text ? (
          <Html key={s.id} position={s.points[0]} center zIndexRange={[20, 10]}>
            <div className="markup-text" style={{ color: s.color, fontSize: textSize(s.width) }}>
              {s.text}
            </div>
          </Html>
        ) : (
        <Line
          key={s.id}
          points={s.points}
          color={s.color}
          lineWidth={s.width}
          depthTest={false}
          transparent
          renderOrder={999}
        />
        )
      )}
      {textDraft && (
        <Html position={textDraft} center zIndexRange={[30, 20]}>
          <input
            className="markup-text-input"
            autoFocus
            size={8}
            maxLength={200}
            onInput={(e) => (e.currentTarget.size = Math.min(TEXT_MAX_CHARS, Math.max(8, e.currentTarget.value.length + 1)))}
            style={{ color, fontSize: textSize(width) }}
            placeholder="Nhập chữ…"
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") setTextDraft(null);
              else if (e.key === "Enter") e.currentTarget.blur();
            }}
            onBlur={(e) => {
              const text = e.currentTarget.value.trim();
              setTextDraft(null);
              if (text) useViewerStore.getState().addStroke({ color, width, points: [textDraft], text });
            }}
          />
        </Html>
      )}
      {draft && draft.length >= 2 && (
        <Line points={draft} color={color} lineWidth={width} depthTest={false} transparent renderOrder={999} />
      )}
    </group>
  );
}
