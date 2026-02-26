import { useEffect, useRef } from "react";

/**
 * Animated blue dot grid background for the landing page.
 * Renders a subtle grid of small blue dots that pulse gently
 * at staggered intervals — like a sheet rippling in the breeze.
 *
 * IMPLEMENTATION NOTE: Uses canvas for performance (~700 dots).
 * Each dot gets a unique phase offset derived from its grid position
 * so the pulsing feels organic, not uniform.
 */

const DOT_SPACING = 36;        // px between dots
const DOT_RADIUS = 1.1;        // base radius in px
const BASE_ALPHA = 0.18;       // resting opacity
const PULSE_ALPHA = 0.12;      // extra opacity at peak pulse
const DRIFT_PX = 1.8;          // max positional drift in px
const SPEED = 0.0004;          // animation speed (lower = slower)

export function BlueDotBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;

    /** Resize canvas to match its CSS dimensions */
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    /** Animation loop */
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);

      const cols = Math.ceil(w / DOT_SPACING) + 1;
      const rows = Math.ceil(h / DOT_SPACING) + 1;

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          // Unique phase per dot — combines row/col for organic offset
          const phase = (col * 0.7 + row * 1.3) * 1.618;

          // Sine-wave pulse for opacity
          const pulse = Math.sin(t * SPEED + phase) * 0.5 + 0.5; // 0→1
          const alpha = BASE_ALPHA + pulse * PULSE_ALPHA;

          // Gentle positional drift (wind effect)
          const driftX = Math.sin(t * SPEED * 0.7 + phase * 0.5) * DRIFT_PX;
          const driftY = Math.cos(t * SPEED * 0.6 + phase * 0.8) * DRIFT_PX * 0.6;

          const x = col * DOT_SPACING + driftX;
          const y = row * DOT_SPACING + driftY;

          ctx.beginPath();
          ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(29, 99, 237, ${alpha})`;
          ctx.fill();
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
      aria-hidden="true"
    />
  );
}