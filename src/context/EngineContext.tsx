import { createContext, useContext } from "react";
import type { ViewerEngine } from "../three/ViewerEngine";

// `null` while the engine is still being constructed (the first render,
// before its mount effect has run). Components must guard with `engine?.`.
export const EngineContext = createContext<ViewerEngine | null>(null);

export function useEngine(): ViewerEngine | null {
  return useContext(EngineContext);
}
