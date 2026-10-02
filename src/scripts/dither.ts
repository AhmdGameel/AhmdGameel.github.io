/** Halftone the portrait into a grid of squares sized by tone, like data before decoding. */
export function renderDither(canvas: HTMLCanvasElement, img: HTMLImageElement) {
  const size = canvas.clientWidth;
  if (!size) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const cells = 56;
  const step = size / cells;
  const sample = document.createElement('canvas');
  sample.width = sample.height = cells;
  const s = sample.getContext('2d', { willReadFrequently: true })!;
  s.drawImage(img, 0, 0, cells, cells);
  const data = s.getImageData(0, 0, cells, cells).data;

  const cs = getComputedStyle(document.documentElement);
  const ink = cs.getPropertyValue('--ink').trim();
  const signal = cs.getPropertyValue('--signal').trim();
  const darkTheme = cs.colorScheme.includes('dark');

  // Contrast stretch so the face reads at this resolution.
  let lo = 255, hi = 0;
  const lum: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    lum.push(l); lo = Math.min(lo, l); hi = Math.max(hi, l);
  }

  ctx.clearRect(0, 0, size, size);
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const n = (lum[y * cells + x] - lo) / (hi - lo || 1);
      const tone = darkTheme ? n : 1 - n; // how much ink this cell gets
      const side = step * Math.min(0.92, Math.pow(tone, 1.15));
      if (side < 0.6) continue;
      // A few cells carry the signal color, like records still in flight.
      ctx.fillStyle = (x * 7 + y * 13) % 97 === 0 ? signal : ink;
      const off = (step - side) / 2;
      ctx.fillRect(x * step + off, y * step + off, side, side);
    }
  }
}
