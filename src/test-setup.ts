/**
 * jsdom has no canvas, and VexFlow probes one for text metrics. It degrades
 * gracefully, but the "not implemented" warnings drown real failures — so give
 * it a stub that answers the only calls it makes.
 */
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => ({
    measureText: (text: string) => ({ width: text.length * 6 }),
    fillText: () => {},
    clearRect: () => {},
    save: () => {},
    restore: () => {},
    scale: () => {},
    translate: () => {},
    beginPath: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    moveTo: () => {},
    lineTo: () => {},
newPath: () => {},
  })) as unknown as HTMLCanvasElement['getContext'];
}
