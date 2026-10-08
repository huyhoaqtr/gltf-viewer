/** Lets the DOM arrow buttons around the view cube drive the camera owned by the R3F scene. */
export type CubeStep = "up" | "down" | "left" | "right";

let impl: ((step: CubeStep) => void) | null = null;

export function registerCubeApi(fn: ((step: CubeStep) => void) | null) {
  impl = fn;
}

export const cubeApi = {
  step: (step: CubeStep) => impl?.(step),
};
