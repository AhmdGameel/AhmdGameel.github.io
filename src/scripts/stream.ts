/**
 * Hero stream. Records travel along Kafka style partitions (lanes), leave their lane
 * at the right moment, and land on a pixel of the name. When every pixel has landed,
 * the view "ahmed_gameel" is materialized. Afterwards the stream keeps flowing at a
 * low rate and occasionally upserts a pixel that is already there.
 */

type Particle = {
  x: number; y: number;
  tx: number; ty: number;
  hx: number; hy: number;
  homeX: number;
  speed: number;
  t0: number; dur: number;
  phase: 0 | 1 | 2; // lane, homing, landed (flashing)
  flashUntil: number;
  passThrough: boolean;
};

const TARGET_RATE = 2038; // events per second, same as Tower Health Stream
const LANES = 7;

export function startStream() {
  const hero = document.getElementById('source') as HTMLElement | null;
  const canvas = document.getElementById('stream') as HTMLCanvasElement | null;
  const name = document.getElementById('hero-name') as HTMLElement | null;
  if (!hero || !canvas || !name) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const records: { skill: string; group: string }[] = JSON.parse(hero.dataset.records || '[]');

  const layer = document.createElement('canvas');
  const lctx = layer.getContext('2d')!;

  const $ = (id: string) => document.getElementById(id);
  const mRecords = $('m-records'), mTput = $('m-tput'), mLat = $('m-lat'), mLag = $('m-lag');
  const recBody = $('rec-body'), recOffset = $('rec-offset');
  const steps = [...hero.querySelectorAll<HTMLLIElement>('.strip li')];

  let W = 0, H = 0, dpr = 1, cell = 4;
  let targets: { x: number; y: number }[] = [];
  let lanes: number[] = [];
  let queue = 0; // index of next target to assign
  let landed = 0;
  let particles: Particle[] = [];
  let colors = readColors();
  let processed = 0;
  let arrivals = 0;
  let tput = 0;
  let lat = 132;
  let done = false;
  let spawnBudget = 0;
  let ambientBudget = 0;
  let nextUpsert = 0;
  let visible = true;
  let last = performance.now();

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    return { ink: v('--ink'), ink3: v('--ink-3'), line: v('--line'), signal: v('--signal') };
  }

  function measure() {
    const r = hero!.getBoundingClientRect();
    W = r.width; H = r.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [canvas!, layer]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lanes = Array.from({ length: LANES }, (_, i) => Math.round(H * (0.12 + (0.78 * i) / (LANES - 1))) + 0.5);
    targets = sampleName(r);
  }

  /** Rasterize the h1 lines exactly where the browser laid them out and sample a grid. */
  function sampleName(heroRect: DOMRect) {
    const cs = getComputedStyle(name!);
    const size = parseFloat(cs.fontSize);
    cell = Math.max(3, Math.round(size / 40));
    const off = document.createElement('canvas');
    off.width = Math.ceil(W); off.height = Math.ceil(H);
    const o = off.getContext('2d', { willReadFrequently: true })!;
    o.fillStyle = '#000';
    o.font = `${cs.fontWeight} ${size}px ${cs.fontFamily}`;
    o.textBaseline = 'alphabetic';
    try { (o as any).letterSpacing = cs.letterSpacing; } catch {}
    for (const line of name!.querySelectorAll<HTMLElement>('.line')) {
      const lr = line.getBoundingClientRect();
      const m = o.measureText(line.textContent || '');
      const asc = m.fontBoundingBoxAscent ?? size * 0.9;
      const desc = m.fontBoundingBoxDescent ?? size * 0.25;
      const baseline = lr.top - heroRect.top + (lr.height - (asc + desc)) / 2 + asc;
      o.fillText(line.textContent || '', lr.left - heroRect.left, baseline);
    }
    const img = o.getImageData(0, 0, off.width, off.height).data;
    const pts: { x: number; y: number; k: number }[] = [];
    for (let y = 0; y < off.height; y += cell) {
      for (let x = 0; x < off.width; x += cell) {
        if (img[(y * off.width + x) * 4 + 3] > 128) pts.push({ x, y, k: x + Math.random() * W * 0.35 });
      }
    }
    // Fill roughly left to right, like a stream catching up, but never perfectly ordered.
    pts.sort((a, b) => a.k - b.k);
    return pts.map(({ x, y }) => ({ x, y }));
  }

  function bake(t: { x: number; y: number }) {
    lctx.fillStyle = colors.ink;
    lctx.fillRect(t.x, t.y, cell - 1, cell - 1);
  }

  function rebakeAll(upTo: number) {
    lctx.clearRect(0, 0, W, H);
    for (let i = 0; i < upTo; i++) bake(targets[i]);
  }

  function spawn(target: { x: number; y: number } | null, now: number) {
    const lane = lanes[(Math.random() * lanes.length) | 0];
    const speed = 520 + Math.random() * 520;
    const p: Particle = {
      x: -8, y: lane,
      tx: target?.x ?? 0, ty: target?.y ?? 0,
      hx: 0, hy: 0,
      homeX: target ? Math.max(0, target.x - (60 + Math.random() * 280)) : Infinity,
      speed, t0: now, dur: 380 + Math.random() * 300,
      phase: 0, flashUntil: 0,
      passThrough: !target,
    };
    particles.push(p);
  }

  function updateSteps(progress: number) {
    const idx = done ? 4 : progress < 0.04 ? 0 : progress < 0.3 ? 1 : progress < 0.6 ? 2 : progress < 0.88 ? 3 : 4;
    steps.forEach((li, i) => {
      li.classList.toggle('on', i <= idx);
      li.classList.toggle('live', i === idx && !done);
      li.classList.toggle('done', done && i === 4);
    });
  }

  function showRecord() {
    if (!recBody || !records.length) return;
    const r = records[(Math.random() * records.length) | 0];
    const part = (Math.random() * LANES) | 0;
    recBody.textContent = `key        skill\npartition  ${part}\nname       ${r.skill}\ngroup      ${r.group}`;
    if (recOffset) recOffset.textContent = `offset ${processed.toLocaleString('en-US')}`;
  }

  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!visible) { requestAnimationFrame(frame); return; }

    // Spawn
    if (!done) {
      const total = targets.length;
      const rate = Math.min(TARGET_RATE, total / 1.4);
      spawnBudget += rate * dt;
      while (spawnBudget >= 1 && queue < total) { spawn(targets[queue++], now); spawnBudget -= 1; }
    } else {
      ambientBudget += 26 * dt;
      while (ambientBudget >= 1) { spawn(null, now); ambientBudget -= 1; }
      if (now > nextUpsert && targets.length) {
        spawn(targets[(Math.random() * targets.length) | 0], now);
        nextUpsert = now + 120 + Math.random() * 380;
      }
    }

    ctx!.clearRect(0, 0, W, H);

    // Lanes (partitions)
    ctx!.strokeStyle = colors.line;
    ctx!.lineWidth = 1;
    ctx!.setLineDash([2, 6]);
    ctx!.beginPath();
    for (const y of lanes) { ctx!.moveTo(0, y); ctx!.lineTo(W, y); }
    ctx!.stroke();
    ctx!.setLineDash([]);

    ctx!.drawImage(layer, 0, 0, W, H);

    // Particles
    const s = cell - 1;
    let write = 0;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.phase === 0) {
        p.x += p.speed * dt;
        ctx!.fillStyle = colors.ink3;
        ctx!.fillRect(p.x - 14, p.y - 0.75, 14, 1.5);
        if (p.x >= p.homeX) { p.phase = 1; p.hx = p.x; p.hy = p.y; p.t0 = now; }
        if (p.passThrough && p.x > W + 20) { processed++; arrivals++; continue; }
      } else if (p.phase === 1) {
        const t = Math.min(1, (now - p.t0) / p.dur);
        const ex = 1 - Math.pow(1 - t, 3);
        const ey = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        p.x = p.hx + (p.tx - p.hx) * ex;
        p.y = p.hy + (p.ty - p.hy) * ey;
        ctx!.fillStyle = colors.signal;
        ctx!.fillRect(p.x, p.y, s, s);
        if (t >= 1) { p.phase = 2; p.flashUntil = now + 420; processed++; arrivals++; }
      } else {
        if (now >= p.flashUntil) { bake(p); landed++; continue; }
        ctx!.globalAlpha = (p.flashUntil - now) / 420;
        ctx!.fillStyle = colors.signal;
        ctx!.fillRect(p.tx, p.ty, s, s);
        ctx!.globalAlpha = 1;
      }
      particles[write++] = p;
    }
    particles.length = write;

    if (!done && landed >= targets.length && targets.length) {
      done = true;
    }

    requestAnimationFrame(frame);
  }

  // Metrics refresh at a human pace, not per frame
  setInterval(() => {
    if (!visible) return;
    tput = tput * 0.5 + arrivals * 4 * 0.5;
    arrivals = 0;
    lat = Math.max(108, Math.min(149, lat + (Math.random() - 0.5) * 12));
    const lag = Math.max(0, targets.length - landed);
    if (mRecords) mRecords.textContent = processed.toLocaleString('en-US');
    if (mTput) mTput.textContent = `${Math.round(tput).toLocaleString('en-US')} /s`;
    if (mLat) mLat.textContent = `${Math.round(lat)} ms`;
    if (mLag) mLag.textContent = lag.toLocaleString('en-US');
    updateSteps(targets.length ? landed / targets.length : 0);
  }, 250);
  setInterval(() => visible && showRecord(), 900);

  function init(animate: boolean) {
    measure();
    particles = [];
    if (animate) {
      queue = 0; landed = 0; done = false;
      lctx.clearRect(0, 0, W, H);
    } else {
      queue = landed = targets.length;
      processed = Math.max(processed, targets.length);
      done = true;
      rebakeAll(targets.length);
    }
    name!.classList.add('drawn');
  }

  const go = () => {
    init(!reduce);
    showRecord();
    updateSteps(0);
    if (!reduce) requestAnimationFrame((t) => { last = t; frame(t); });
    else {
      // Static render: lanes and the materialized name only.
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(layer, 0, 0, W, H);
    }
  };

  // Start once fonts are ready and the hero has a size (it can be 0 in a hidden tab).
  let started = false;
  let lastWidth = 0;
  let resizeTimer = 0;
  const fontsReady = document.fonts.ready;
  new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width);
    if (!w || w === lastWidth) return; // ignore mobile toolbar height changes
    const first = !started;
    lastWidth = w;
    started = true;
    if (first) { fontsReady.then(go); return; }
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      init(false);
      if (reduce) { ctx.clearRect(0, 0, W, H); ctx.drawImage(layer, 0, 0, W, H); }
    }, 150);
  }).observe(hero);

  const recolor = () => {
    colors = readColors();
    rebakeAll(done ? targets.length : landed);
    if (reduce) { ctx.clearRect(0, 0, W, H); ctx.drawImage(layer, 0, 0, W, H); }
  };
  addEventListener('themechange', recolor);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(hero);

  // Click the hero to produce a burst of upserts.
  hero.addEventListener('pointerdown', (e) => {
    if (reduce || !done || (e.target as HTMLElement).closest('a,button')) return;
    const now = performance.now();
    for (let i = 0; i < 160; i++) spawn(targets[(Math.random() * targets.length) | 0], now);
  });
}
