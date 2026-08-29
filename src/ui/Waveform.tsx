import { useEffect, useRef } from 'react';

export interface WaveformProps {
  analyser: AnalyserNode;
  height?: number;
  /**
   * Vertical exaggeration. A guitar into a laptop microphone sits well below
   * full scale, so drawn true to size the line barely moves.
   */
  gain?: number;
}

/**
 * Draws the live input as a line, so it is visible that audio is arriving even
 * when no pitch is confident enough to name. Reads the analyser per animation
 * frame rather than accumulating anything — the current frame is the whole
 * picture, and nothing here should cost the detection path.
 */
export function Waveform({ analyser, height = 56, gain = 3 }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const samples = new Float32Array(analyser.fftSize);
    let frame = requestAnimationFrame(function draw() {
      frame = requestAnimationFrame(draw);

      // Match the backing store to the element, allowing for a retina display.
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
      const pixelHeight = Math.max(1, Math.floor(height * ratio));
      if (canvas.width !== width || canvas.height !== pixelHeight) {
        canvas.width = width;
        canvas.height = pixelHeight;
      }

      analyser.getFloatTimeDomainData(samples);

      context.clearRect(0, 0, width, pixelHeight);
      // Follows the page's text colour, so it works in either theme.
      context.strokeStyle = getComputedStyle(canvas).color;
      context.lineWidth = 1.5 * ratio;
      context.beginPath();

      const middle = pixelHeight / 2;
      for (let i = 0; i < samples.length; i++) {
        const x = (i / (samples.length - 1)) * width;
        // Clamped so a loud transient flattens against the edge rather than
        // disappearing off it.
        const offset = Math.max(-1, Math.min(1, samples[i] * gain));
        const y = middle - offset * middle * 0.9;
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    });

    return () => cancelAnimationFrame(frame);
  }, [analyser, height, gain]);

  return (
    <canvas
      ref={canvasRef}
      className="waveform"
      style={{ height }}
      aria-label="Live microphone input"
    />
  );
}
