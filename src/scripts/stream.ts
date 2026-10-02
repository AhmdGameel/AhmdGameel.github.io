/**
 * Hero name as a dot matrix that is written by a stream of records.
 *
 * Each dot is a record. It glides in along its own row and lands in place, column by
 * column from left to right, so the name "prints" like a table being materialized.
 * Afterwards the dots react softly to the pointer, and every few seconds a single new
 * record arrives and upserts one dot.
 */

type Dot = {
  x: number; y: number;        // home position
  sx: number;                  // start x of the glide
  t0: number; dur: number;     // glide timing (ms)
  ox: number; oy: number;      // pointer displacement
  vx: number; vy: number;      // displacement velocity
  flash: number;               // time of last landing, drives the color fade
};

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

export function startStream() {
  const box = document.querySelector<HTMLElement>('#top .name-box');
  const canvas = document.getElementById('stream') as HTMLCanvasElement | null;
  const name = document.getElementById('hero-name');
  if (!box || !canvas || !name) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, cell = 4, size = 3;
  let dots: Dot[] = [];
  let colors = readColors();
  let running = false;
  let pointer: { x: number; y: number } | null = null;
  let ambientTimer = 0;

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    return { ink: cs.getPropertyValue('--ink').trim(), signal: cs.getPropertyValue('--signal').trim() };
  }

  function layout(animate: boolean) {
    const br = box!.getBoundingClientRect();
    const lines = [...name!.querySelectorAll<HTMLElement>('.line')];
    const right = Math.max(...lines.map((l) => l.getBoundingClientRect().right)) - br.left;
    W = Math.ceil(Math.max(br.width, right) + 4);
    H = Math.ceil(br.height + 4);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas!.width = Math.round(W * dpr);
    canvas!.height = Math.round(H * dpr);
    canvas!.style.width = `${W}px`;
    canvas!.style.height = `${H}px`;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Rasterize the lines exactly where the browser laid them out, then sample a grid.
    const cs = getComputedStyle(name!);
    const fs = parseFloat(cs.fontSize);
    cell = Math.max(3, Math.round(fs / 34));
    size = Math.max(2, cell - 1);
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const o = off.getContext('2d', { willReadFrequently: true })!;
    o.font = `${cs.fontWeight} ${fs}px ${cs.fontFamily}`;
    o.textBaseline = 'alphabetic';
    try { (o as any).letterSpacing = cs.letterSpacing; } catch {}
    for (const line of lines) {
      const lr = line.getBoundingClientRect();
      const m = o.measureText(line.textContent || '');
      const asc = m.fontBoundingBoxAscent ?? fs * 0.9;
      const desc = m.fontBoundingBoxDescent ?? fs * 0.25;
      o.fillText(line.textContent || '', lr.left - br.left, lr.top - br.top + (lr.height - (asc + desc)) / 2 + asc);
    }
    const img = o.getImageData(0, 0, W, H).data;
    const now = performance.now();
    const spread = 1250; // ms for the write head to sweep the whole name
    dots = [];
    for (let y = 0; y < H; y += cell) {
      for (let x = 0; x < W; x += cell) {
        if (img[(y * W + x) * 4 + 3] < 128) continue;
        const travel = 90 + Math.random() * 170;
        dots.push({
          x, y,
          sx: x - travel,
          t0: animate ? now + 250 + (x / W) * spread + Math.random() * 220 : -1e9,
          dur: 560 + Math.random() * 280,
          ox: 0, oy: 0, vx: 0, vy: 0,
          flash: animate ? 0 : -1e9,
        });
      }
    }
    name!.classList.add('drawn');
  }

  function draw(now: number) {
    ctx!.clearRect(0, 0, W, H);
    let active = false;
    const R = 64, R2 = R * R;
    for (const d of dots) {
      if (now < d.t0) { active = true; continue; }
      if (now < d.t0 + d.dur) {
        // Gliding in along its row, with a short motion trail.
        const t = (now - d.t0) / d.dur;
        const e = ease(t);
        const x = d.sx + (d.x - d.sx) * e;
        const alpha = Math.min(1, t * 4);
        const trail = (1 - e) * 28;
        ctx!.fillStyle = colors.signal;
        ctx!.globalAlpha = alpha * 0.35;
        ctx!.fillRect(x - trail, d.y + size / 2 - 0.5, trail, 1);
        ctx!.globalAlpha = alpha;
        ctx!.fillRect(x, d.y, size, size);
        ctx!.globalAlpha = 1;
        active = true;
        continue;
      }
      if (d.flash === 0) d.flash = d.t0 + d.dur;

      // Soft pointer field with a spring back home.
      if (pointer) {
        const dx = d.x + d.ox - pointer.x, dy = d.y + d.oy - pointer.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < R2) {
          const dist = Math.sqrt(dist2) || 1;
          const f = (1 - dist / R) * 2.2;
          d.vx += (dx / dist) * f;
          d.vy += (dy / dist) * f;
        }
      }
      if (d.ox || d.oy || d.vx || d.vy) {
        d.vx = (d.vx - d.ox * 0.08) * 0.82;
        d.vy = (d.vy - d.oy * 0.08) * 0.82;
        d.ox += d.vx; d.oy += d.vy;
        if (Math.abs(d.ox) + Math.abs(d.oy) + Math.abs(d.vx) + Math.abs(d.vy) < 0.1) {
          d.ox = d.oy = d.vx = d.vy = 0;
        } else active = true;
      }

      const since = now - d.flash;
      if (since < 650) active = true;
      ctx!.fillStyle = since < 650 ? colors.signal : colors.ink;
      ctx!.fillRect(d.x + d.ox, d.y + d.oy, size, size);
    }
    return active || !!pointer;
  }

  function loop(now: number) {
    if (draw(now)) requestAnimationFrame(loop);
    else running = false;
  }
  function kick() {
    if (running || reduce) return;
    running = true;
    requestAnimationFrame(loop);
  }

  // Every few seconds one new record arrives and upserts a dot.
  function ambient() {
    clearTimeout(ambientTimer);
    ambientTimer = window.setTimeout(() => {
      if (dots.length && document.visibilityState === 'visible') {
        const d = dots[(Math.random() * dots.length) | 0];
        d.sx = d.x - 160 - Math.random() * 200;
        d.t0 = performance.now();
        d.dur = 900;
        d.flash = 0;
        kick();
      }
      ambient();
    }, 1600 + Math.random() * 1800);
  }

  function start() {
    layout(!reduce);
    if (reduce) { draw(performance.now()); return; }
    kick();
    ambient();
  }

  box.addEventListener('pointermove', (e) => {
    if (reduce || e.pointerType === 'touch') return;
    const r = box.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    kick();
  });
  box.addEventListener('pointerleave', () => { pointer = null; kick(); });

  // Start once fonts are ready and the box has a size (it can be 0 in a hidden tab).
  let lastWidth = 0;
  let timer = 0;
  const fonts = document.fonts.ready;
  new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width);
    if (!w || w === lastWidth) return;
    const first = lastWidth === 0;
    lastWidth = w;
    if (first) { fonts.then(start); return; }
    clearTimeout(timer);
    timer = window.setTimeout(() => { layout(false); draw(performance.now()); }, 120);
  }).observe(box);

  const recolor = () => { colors = readColors(); draw(performance.now()); kick(); };
  addEventListener('themechange', recolor);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
}
