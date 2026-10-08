import * as THREE from "three";
import { CUBE_NAV } from "./constants";

type ZoneKind = "face" | "edge" | "corner";

interface FaceDef {
  dir: THREE.Vector3;
  label: string;
  rot: [number, number, number];
}

const FACES: FaceDef[] = [
  { dir: new THREE.Vector3(1, 0, 0), label: "PHẢI", rot: [0, Math.PI / 2, 0] },
  { dir: new THREE.Vector3(-1, 0, 0), label: "TRÁI", rot: [0, -Math.PI / 2, 0] },
  { dir: new THREE.Vector3(0, 1, 0), label: "TRÊN", rot: [-Math.PI / 2, 0, 0] },
  { dir: new THREE.Vector3(0, -1, 0), label: "DƯỚI", rot: [Math.PI / 2, 0, 0] },
  { dir: new THREE.Vector3(0, 0, 1), label: "TRƯỚC", rot: [0, 0, 0] },
  { dir: new THREE.Vector3(0, 0, -1), label: "SAU", rot: [0, Math.PI, 0] },
];

const COLORS = {
  border: "#cbd5e1",
  text: "#475569",
  faceHover: new THREE.Color(0xbfdbfe),
  zoneHover: 0x3b82f6,
};

/** Thickness of the edge / corner hit zones, in cube units (the cube itself is 1 wide). */
const ZONE = 0.22;
const ZONE_HOVER_OPACITY = 0.55;
/** How far the hit volumes poke out past the faces. */
const HIT_PROUD = 0.02;
/** Highlight patches on the faces: width measured inward from the edge, and slab thickness. */
const PATCH_WIDTH = 0.16;
const PATCH_THICKNESS = 0.004;
/** A zone this far "behind" the cube (dot with the view direction) is not pickable. */
const BACKFACE_PICK_LIMIT = -0.1;
/** Camera counts as looking straight at a face above this alignment. */
const ALIGNED_DOT = 0.995;

export interface CubePickable extends THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  userData: {
    kind: ZoneKind;
    /** Direction from the cube centre to this zone (unit length). */
    dir: THREE.Vector3;
    /** Flat highlight meshes on the cube surface, shown while this zone is hovered (edges / corners only). */
    patches: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
  };
}

interface Patch {
  size: THREE.Vector3;
  pos: THREE.Vector3;
}

/**
 * Small always-on-top view cube (its own mini scene + orthographic camera),
 * rendered into a corner viewport of the main canvas. Light faces with a
 * slate outline and labels, shaded by how directly they face the viewer.
 * Faces, edges and corners are all clickable zones; edges and corners only
 * show up (blue) while hovered. Mirrors the main camera's orientation, and
 * clicking returns the world direction to snap the main camera to.
 */
export class CubeNavigator {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1.05, 1.05, 1.05, -1.05, 0.1, 10);

  private readonly group = new THREE.Group();
  private readonly faces: CubePickable[] = [];
  private readonly pickables: CubePickable[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly viewDir = new THREE.Vector3();
  private hovered: CubePickable | null = null;

  constructor() {
    this.scene.add(this.group);
    this.buildFaces();
    this.buildEdges();
    this.buildCorners();
  }

  private makeFaceTexture(label: string): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, 248, 248);
    ctx.fillStyle = COLORS.text;
    ctx.font = '700 40px "Segoe UI", Inter, Arial, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 128, 132);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  private buildFaces() {
    for (const f of FACES) {
      const mat = new THREE.MeshBasicMaterial({ map: this.makeFaceTexture(f.label) });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat) as unknown as CubePickable;
      mesh.position.copy(f.dir).multiplyScalar(0.5);
      mesh.rotation.set(...f.rot);
      mesh.userData = { kind: "face", dir: f.dir.clone(), patches: [] };
      this.group.add(mesh);
      this.faces.push(mesh);
      this.pickables.push(mesh);
    }
  }

  /**
   * Hit volume (never drawn) plus flat highlight patches lying on the cube's
   * surface: the zone looks like part of the cube, nothing sticks out.
   */
  private addZone(kind: "edge" | "corner", dir: THREE.Vector3, hitSize: THREE.Vector3, patches: Patch[]) {
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(hitSize.x, hitSize.y, hitSize.z),
      new THREE.MeshBasicMaterial({ visible: false })
    ) as unknown as CubePickable;
    // Reaches only slightly past the faces (so it wins the ray test there), then inward.
    hit.position.copy(dir).multiplyScalar(0.5 - ZONE / 2 + HIT_PROUD);
    hit.userData = { kind, dir: dir.clone().normalize(), patches: [] };

    for (const p of patches) {
      const mat = new THREE.MeshBasicMaterial({
        color: COLORS.zoneHover,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.size.x, p.size.y, p.size.z), mat);
      mesh.position.copy(p.pos);
      this.group.add(mesh);
      hit.userData.patches.push(mesh);
    }
    this.group.add(hit);
    this.pickables.push(hit);
  }

  /** A thin slab on the face with normal axis `n` (sign `sn`), spanning `span` along the other two axes at `centre`. */
  private patch(n: number, sn: number, centre: THREE.Vector3, span: THREE.Vector3): Patch {
    const size = span.clone().setComponent(n, PATCH_THICKNESS);
    const pos = centre.clone().setComponent(n, sn * (0.5 + PATCH_THICKNESS / 2));
    return { size, pos };
  }

  private buildEdges() {
    for (let axis = 0; axis < 3; axis++) {
      const a = (axis + 1) % 3;
      const b = (axis + 2) % 3;
      for (const sa of [-1, 1]) {
        for (const sb of [-1, 1]) {
          const dir = new THREE.Vector3().setComponent(a, sa).setComponent(b, sb);
          const hitSize = new THREE.Vector3()
            .setComponent(axis, 1 - ZONE)
            .setComponent(a, ZONE)
            .setComponent(b, ZONE);
          // On the face with normal `a`: a strip along `axis` hugging the edge shared with face `b` (and vice versa).
          const stripA = new THREE.Vector3().setComponent(axis, 1 - 2 * PATCH_WIDTH).setComponent(b, PATCH_WIDTH);
          const stripB = new THREE.Vector3().setComponent(axis, 1 - 2 * PATCH_WIDTH).setComponent(a, PATCH_WIDTH);
          const onA = this.patch(a, sa, new THREE.Vector3().setComponent(b, sb * (0.5 - PATCH_WIDTH / 2)), stripA);
          const onB = this.patch(b, sb, new THREE.Vector3().setComponent(a, sa * (0.5 - PATCH_WIDTH / 2)), stripB);
          this.addZone("edge", dir, hitSize, [onA, onB]);
        }
      }
    }
  }

  private buildCorners() {
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const signs = [sx, sy, sz];
          const dir = new THREE.Vector3(sx, sy, sz);
          const patches: Patch[] = [];
          for (let n = 0; n < 3; n++) {
            // Square at the corner on face `n`.
            const centre = new THREE.Vector3(
              signs[0] * (0.5 - PATCH_WIDTH / 2),
              signs[1] * (0.5 - PATCH_WIDTH / 2),
              signs[2] * (0.5 - PATCH_WIDTH / 2)
            );
            patches.push(this.patch(n, signs[n], centre, new THREE.Vector3(PATCH_WIDTH, PATCH_WIDTH, PATCH_WIDTH)));
          }
          this.addZone("corner", dir, new THREE.Vector3(ZONE, ZONE, ZONE), patches);
        }
      }
    }
  }

  private ndcFromClient(clientX: number, clientY: number): THREE.Vector2 | null {
    const lx = clientX - CUBE_NAV.marginX;
    const ly = clientY - CUBE_NAV.marginTop;
    if (lx < 0 || lx > CUBE_NAV.size || ly < 0 || ly > CUBE_NAV.size) return null;
    return new THREE.Vector2((lx / CUBE_NAV.size) * 2 - 1, -((ly / CUBE_NAV.size) * 2 - 1));
  }

  isOver(clientX: number, clientY: number): boolean {
    return this.ndcFromClient(clientX, clientY) !== null;
  }

  pick(clientX: number, clientY: number): CubePickable | null {
    const ndc = this.ndcFromClient(clientX, clientY);
    if (!ndc) return null;
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    for (const hit of hits) {
      const obj = hit.object as CubePickable;
      if (obj.userData.dir.dot(this.viewDir) > BACKFACE_PICK_LIMIT) return obj;
    }
    return null;
  }

  setHover(obj: CubePickable | null) {
    if (obj === this.hovered) return;
    this.hovered = obj;
    for (const mesh of this.pickables) {
      for (const patch of mesh.userData.patches) patch.material.opacity = mesh === obj ? ZONE_HOVER_OPACITY : 0;
    }
    // Face tint is applied in syncToCamera, together with the facing shade.
  }

  get isHovering(): boolean {
    return this.hovered !== null;
  }

  /** Axis direction of the face the camera is looking straight at, if any. */
  get alignedFace(): THREE.Vector3 | null {
    for (const f of this.faces) {
      if (f.userData.dir.dot(this.viewDir) > ALIGNED_DOT) return f.userData.dir;
    }
    return null;
  }

  /** Rotate the gizmo's camera to match the main camera, and re-shade the faces by how directly they face it. */
  syncToCamera(mainCamera: THREE.Camera) {
    mainCamera.getWorldDirection(this.viewDir);
    this.viewDir.negate(); // from the cube towards the viewer
    this.camera.position.copy(this.viewDir).multiplyScalar(3);
    this.camera.up.copy(mainCamera.up);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();

    for (const f of this.faces) {
      const facing = Math.max(0, f.userData.dir.dot(this.viewDir));
      const shade = 0.88 + facing * 0.12;
      f.material.color.setRGB(shade, shade, shade);
      if (f === this.hovered) f.material.color.multiply(COLORS.faceHover);
    }
  }

  dispose() {
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      mesh.material.map?.dispose();
      mesh.material.dispose();
    });
  }

  /** Render into a small scissored viewport in the corner of the same canvas. */
  render(renderer: THREE.WebGLRenderer) {
    const vpY = window.innerHeight - CUBE_NAV.marginTop - CUBE_NAV.size;
    renderer.setScissorTest(true);
    renderer.setViewport(CUBE_NAV.marginX, vpY, CUBE_NAV.size, CUBE_NAV.size);
    renderer.setScissor(CUBE_NAV.marginX, vpY, CUBE_NAV.size, CUBE_NAV.size);
    renderer.clearDepth();
    // Keep the main image behind the gizmo instead of wiping the corner.
    const autoClearColor = renderer.autoClearColor;
    renderer.autoClearColor = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClearColor = autoClearColor;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  }
}
