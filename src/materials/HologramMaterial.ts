import * as THREE from "three";
import { shaderMaterial } from "@react-three/drei";

const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vWorldY;

  void main() {
    vec4 localPos = vec4(position, 1.0);
    vec3 localNormal = normal;
    #ifdef USE_INSTANCING
      localPos = instanceMatrix * localPos;
      localNormal = mat3(instanceMatrix) * localNormal;
    #endif
    vec4 worldPos = modelMatrix * localPos;
    vWorldY = worldPos.y;
    vNormal = normalize(mat3(modelMatrix) * localNormal);
    vViewDir = cameraPosition - worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uRimPower;
  uniform float uOpacity;
  uniform float uScanlineDensity;
  uniform float uScanlineSpeed;
  uniform float uFlicker;
  uniform float uReveal;
  uniform vec2 uBoundsY;

  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vWorldY;

  void main() {
    // Reveal sweep: everything above the plane is cut away (1.0 = fully revealed).
    if (uReveal < 1.0 && vWorldY > mix(uBoundsY.x, uBoundsY.y, uReveal)) discard;

    // abs() so back faces (double-sided) glow the same as front faces.
    float facing = abs(dot(normalize(vNormal), normalize(vViewDir)));
    float fresnel = pow(1.0 - clamp(facing, 0.0, 1.0), uRimPower);

    float scan = 0.5 + 0.5 * sin(vWorldY * uScanlineDensity - uTime * uScanlineSpeed * 6.2831853);
    scan = mix(0.45, 1.0, smoothstep(0.2, 0.95, scan));

    float flicker = 1.0 + uFlicker * (0.5 * sin(uTime * 47.0) + 0.5 * sin(uTime * 13.0 + 1.7));

    vec3 color = mix(uColor * 0.55, uColor, fresnel) + uColor * fresnel * 0.6;
    float alpha = uOpacity * (0.3 + 0.7 * fresnel) * scan * flicker;

    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const HologramShaderMaterial = shaderMaterial(
  {
    uTime: 0,
    uColor: new THREE.Color("#00E5FF"),
    uRimPower: 2.5,
    uOpacity: 0.55,
    uScanlineDensity: 40,
    uScanlineSpeed: 0.6,
    uFlicker: 0.08,
    uReveal: 1,
    uBoundsY: new THREE.Vector2(0, 1),
  },
  vertexShader,
  fragmentShader
);

export type HologramMaterial = THREE.ShaderMaterial;

/**
 * The ONE hologram material shared by every swapped mesh. Instancing is picked
 * up automatically (three defines USE_INSTANCING for instanced meshes).
 */
export function createHologramMaterial(): HologramMaterial {
  const material = new HologramShaderMaterial() as unknown as HologramMaterial;
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.side = THREE.DoubleSide;
  material.fog = false;
  material.userData.isHologram = true;
  return material;
}

/**
 * Depth-only twin used by the optional pre-pass: writes depth, no colour. The
 * polygon offset pushes it slightly back so the glowing surface (and the edges
 * lying on it) still pass the depth test.
 */
export function createHologramDepthMaterial(): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: true,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  material.userData.isHologram = true;
  return material;
}
