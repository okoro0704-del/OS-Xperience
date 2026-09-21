/**
 * Double-tap to summon the Experience Switcher.
 * Attaches to edge strips so iframe content keeps one-finger ownership.
 */

export interface DoubleTapOptions {
  maxIntervalMs?: number;
  maxMovePx?: number;
}

export function classifyDoubleTap(
  taps: { t: number; x: number; y: number }[],
  options: DoubleTapOptions = {},
): boolean {
  const maxInterval = options.maxIntervalMs ?? 320;
  const maxMove = options.maxMovePx ?? 28;
  if (taps.length < 2) return false;
  const a = taps[taps.length - 2]!;
  const b = taps[taps.length - 1]!;
  if (b.t - a.t > maxInterval || b.t - a.t < 30) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy) <= maxMove;
}

export function attachDoubleTap(
  target: HTMLElement,
  onDoubleTap: () => void,
  options: DoubleTapOptions = {},
): () => void {
  const taps: { t: number; x: number; y: number }[] = [];

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    taps.push({ t: performance.now(), x: event.clientX, y: event.clientY });
    if (taps.length > 3) taps.shift();
    if (classifyDoubleTap(taps, options)) {
      taps.length = 0;
      onDoubleTap();
    }
  };

  const onDblClick = (event: MouseEvent) => {
    event.preventDefault();
    taps.length = 0;
    onDoubleTap();
  };

  target.addEventListener("pointerup", onPointerUp);
  target.addEventListener("dblclick", onDblClick);
  return () => {
    target.removeEventListener("pointerup", onPointerUp);
    target.removeEventListener("dblclick", onDblClick);
  };
}
