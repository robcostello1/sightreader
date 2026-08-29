import { useEffect, useRef } from 'react';

export interface WaveformProps {
  /** Null before the microphone is open; the line rests flat until it is. */
  analyser: AnalyserNode | null;
  width?: number;
  height?: number;
  /**
   * Curve applied to amplitude. Higher lifts quiet signal further; 0 would be
   * linear. See shape().
   */
  compression?: number;
}

/**
 * Logarithmic amplitude shaping, so quiet playing is still visible.
 *
 * A guitar into a laptop microphone spends most of its time near the bottom of
 * the scale, where a linear waveform is a flat line. This maps 0 to 0 and 1 to
 * 1 while lifting everything between — at compression 60, a sample at 1% of
 * full scale draws at about 11% of the height instead of 1%.
 */
function shape(sample: number, compression: number): number {
  const magnitude = Math.min(1, Math.abs(sample));
  const scaled = Math.log1p(compression * magnitude) / Math.log1p(compression);
  return Math.sign(sample) * scaled;
}

/**
 * Draws the live input as a line, so it is visible that audio is arriving even
 * when no pitch is confident enough to name. Reads the analyser per animation
 * frame rather than accumulating anything — the current frame is the whole
 * picture, and nothing here should cost the detection path.
 */
export function Waveform({
  analyser,
  width = 100,
  height = 36,
  compression = 60,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    // Silence stands in until the microphone opens, so the slot holds its shape
    // rather than appearing from nowhere when a session starts.
    const samples = new Float32Array(analyser?.fftSize ?? 1024);
    let frame = requestAnimationFrame(function draw() {
      frame = requestAnimationFrame(draw);

      // Match the backing store to the element, allowing for a retina display.
      const ratio = window.devicePixelRatio || 1;
      const pixelWidth = Math.max(1, Math.floor(width * ratio));
      const pixelHeight = Math.max(1, Math.floor(height * ratio));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }

      analyser?.getFloatTimeDomainData(samples);

      context.clearRect(0, 0, pixelWidth, pixelHeight);
      // Follows the page's text colour, so it works in either theme.
      context.strokeStyle = getComputedStyle(canvas).color;
      context.lineWidth = Math.max(1, ratio);
      context.beginPath();

      const middle = pixelHeight / 2;
      const perColumn = samples.length / pixelWidth;

      for (let column = 0; column < pixelWidth; column++) {
        // Far more samples than pixels, so take the column's signed peak. Taking
        // whichever sample happens to land on the pixel would alias the shape
        // into noise at this width.
        const from = Math.floor(column * perColumn);
        const to = Math.max(from + 1, Math.floor((column + 1) * perColumn));
        let peak = 0;
        for (let i = from; i < to && i < samples.length; i++) {
          if (Math.abs(samples[i]) > Math.abs(peak)) peak = samples[i];
        }

        const y = middle - shape(peak, compression) * middle * 0.9;
        if (column === 0) context.moveTo(0, y);
        else context.lineTo(column, y);
      }
      context.stroke();
    });

    return () => cancelAnimationFrame(frame);
  }, [analyser, width, height, compression]);

  return (
    <canvas
      ref={canvasRef}
      className="waveform"
      style={{ width, height }}
      aria-label="Live microphone input"
    />
  );
}
