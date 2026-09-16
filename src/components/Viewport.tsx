interface ViewportProps {
  containerRef: React.RefObject<HTMLDivElement>;
}

/** The three.js canvas is appended into this div by ViewerEngine on mount. */
export function Viewport({ containerRef }: ViewportProps) {
  return <div id="viewport" ref={containerRef} />;
}
