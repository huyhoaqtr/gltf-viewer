import * as THREE from "three";
import { CUBE_NAV } from "./constants";

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

export interface CubePickable extends THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  userData: {
    dir: THREE.Vector3;
    baseColor: THREE.Color;
    hoverColor: THREE.Color;
  };
}

/**
 * Small always-on-top orientation gizmo (its own mini scene + orthographic
 * camera), rendered into a corner viewport of the main canvas. Mirrors the
 * main camera's orientation; clicking a face/corner returns the world
 * direction to snap the main camera to.
 */
export class CubeNavigator {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-0.85, 0.85, 0.85, -0.85, 0.1, 10);

  private readonly group = new THREE.Group();
  private readonly pickables: CubePickable[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private hovered: CubePickable | null = null;

  constructor() {
    this.scene.add(this.group);
    this.buildFaces();
    this.buildCorners();
  }

  private makeFaceTexture(label: string): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#232830";
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 250, 250);
    ctx.fillStyle = "#cfd4da";
    ctx.font = "600 30px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private buildFaces() {
    const half = 0.5;
    for (const f of FACES) {
      const mat = new THREE.MeshBasicMaterial({ map: this.makeFaceTexture(f.label) });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 0.94), mat) as unknown as CubePickable;
      mesh.position.copy(f.dir).multiplyScalar(half + 0.001);
      mesh.rotation.set(...f.rot);
      mesh.userData = {
        dir: f.dir.clone(),
        baseColor: new THREE.Color(0xffffff),
        hoverColor: new THREE.Color(0xffcf94),
      };
      this.group.add(mesh);
      this.pickables.push(mesh);
    }
  }

  private buildCorners() {
    const cornerSize = 0.22;
    const cornerOffset = 0.5 + cornerSize / 2 - 0.04;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const dir = new THREE.Vector3(sx, sy, sz).normalize();
          const mat = new THREE.MeshBasicMaterial({ color: 0x2b3038, transparent: true, opacity: 0.6 });
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(cornerSize, cornerSize, cornerSize), mat) as unknown as CubePickable;
          mesh.position.set(sx * cornerOffset, sy * cornerOffset, sz * cornerOffset);
          mesh.userData = {
            dir,
            baseColor: new THREE.Color(0x2b3038),
            hoverColor: new THREE.Color(0xffb454),
          };
          this.group.add(mesh);
          this.pickables.push(mesh);
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
    return (hits[0]?.object as CubePickable | undefined) ?? null;
  }

  setHover(obj: CubePickable | null) {
    if (obj === this.hovered) return;
    if (this.hovered) this.hovered.material.color.copy(this.hovered.userData.baseColor);
    this.hovered = obj;
    if (this.hovered) this.hovered.material.color.copy(this.hovered.userData.hoverColor);
  }

  get isHovering(): boolean {
    return this.hovered !== null;
  }

  /** Rotate the gizmo's camera to match the main camera's current orientation. */
  syncToCamera(mainCamera: THREE.Camera) {
    const dir = new THREE.Vector3();
    mainCamera.getWorldDirection(dir);
    this.camera.position.copy(dir).multiplyScalar(-3);
    this.camera.up.copy(mainCamera.up);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
  }

  /** Render into a small scissored viewport in the corner of the same canvas. */
  render(renderer: THREE.WebGLRenderer) {
    const vpY = window.innerHeight - CUBE_NAV.marginTop - CUBE_NAV.size;
    renderer.setScissorTest(true);
    renderer.setViewport(CUBE_NAV.marginX, vpY, CUBE_NAV.size, CUBE_NAV.size);
    renderer.setScissor(CUBE_NAV.marginX, vpY, CUBE_NAV.size, CUBE_NAV.size);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  }
}
