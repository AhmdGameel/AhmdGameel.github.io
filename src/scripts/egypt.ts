/**
 * Tower Health Stream, replayed in the browser.
 *
 * Every point is a cell tower from /data/towers.bin. The event generator is a straight port of
 * simulator/tower_simulator.py and the rules are the ones in flink_jobs/data_quality.py and
 * flink_jobs/anomaly_detection.py:
 *
 *   valid      -120 <= signal_strength <= 0, latency_ms > 0, connected_users >= 0, else dead letter queue
 *   alert_type CASE WHEN signal < -90 AND users > 800 THEN OVERLOADED
 *                   WHEN signal < -90 THEN WEAK_SIGNAL
 *                   WHEN call_drop_rate > 0.05 THEN HIGH_DROP_RATE
 *                   WHEN latency_ms > 200 THEN HIGH_LATENCY
 *   regional   TUMBLE 10 minutes, GROUP BY area, operator, HAVING COUNT(DISTINCT tower_id) >= 3
 *
 * Events flow at the real rate (one per tower every 5 s). Windows are compressed 60x so a visitor
 * can watch one close.
 */

const OPERATORS = ['Orange', 'Vodafone', 'e&', 'WE'];
const RADIOS = ['GSM', 'UMTS', 'LTE', 'NR', 'CDMA'];
export const TYPES = ['WEAK_SIGNAL', 'HIGH_DROP_RATE', 'HIGH_LATENCY', 'OVERLOADED'] as const;
type AlertType = (typeof TYPES)[number];
const COLOR: Record<AlertType | 'REGIONAL_OUTAGE', string> = {
  WEAK_SIGNAL: '#ffd84a',
  HIGH_DROP_RATE: '#ff5050',
  HIGH_LATENCY: '#ff9a3d',
  OVERLOADED: '#5aa9ff',
  REGIONAL_OUTAGE: '#ffffff',
};
const CYCLE_MS = 5000;
const WINDOW_MS = 10_000; // 10 minutes at 60x
const CITIES: [string, number, number, 'l' | 'r'][] = [
  ['Alexandria', 31.2, 29.92, 'l'], ['Cairo', 30.04, 30.86, 'l'], ['Port Said', 31.26, 32.3, 'r'],
  ['Asyut', 27.18, 31.18, 'l'], ['Luxor', 25.69, 32.64, 'r'], ['Aswan', 24.09, 32.9, 'r'],
  ['Hurghada', 27.26, 33.81, 'r'], ['Sharm El Sheikh', 27.91, 34.33, 'r'],
];

interface Towers {
  n: number; lon: Float32Array; lat: Float32Array; op: Uint8Array; radio: Uint8Array; area: Uint16Array; cell: Uint32Array;
  bbox: [number, number, number, number];
}

export async function loadTowers(url = '/data/towers.bin'): Promise<Towers> {
  const buf = await (await fetch(url)).arrayBuffer();
  const v = new DataView(buf);
  const n = v.getUint32(4, true);
  const bbox: [number, number, number, number] = [v.getFloat32(8, true), v.getFloat32(12, true), v.getFloat32(16, true), v.getFloat32(20, true)];
  const t: Towers = {
    n, bbox,
    lon: new Float32Array(n), lat: new Float32Array(n), op: new Uint8Array(n), radio: new Uint8Array(n),
    area: new Uint16Array(n), cell: new Uint32Array(n),
  };
  for (let i = 0, o = 24; i < n; i++, o += 12) {
    t.lon[i] = bbox[0] + (v.getUint16(o, true) / 65535) * (bbox[2] - bbox[0]);
    t.lat[i] = bbox[1] + (v.getUint16(o + 2, true) / 65535) * (bbox[3] - bbox[1]);
    t.op[i] = v.getUint8(o + 4);
    t.radio[i] = v.getUint8(o + 5);
    t.area[i] = v.getUint16(o + 6, true);
    t.cell[i] = v.getUint32(o + 8, true);
  }
  return t;
}

// ----------------------------------------------------------------- simulator

const U = (a: number, b: number) => a + Math.random() * (b - a);
const RI = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));

export function cairoHour(d = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Africa/Cairo' }).format(d));
}
export const isPeak = (h: number) => (h >= 7 && h <= 9) || (h >= 17 && h <= 19);

interface Event { signal: number; latency: number; users: number; drop: number; anomaly: boolean }

function generateEvent(peak: boolean): Event {
  const anomaly = Math.random() < 0.05;
  let signal = U(-90, -60), latency = U(20, 60), users = RI(50, 300), drop = U(0.01, 0.05);
  if (peak) { signal -= U(5, 15); latency += U(10, 40); users += RI(100, 400); }
  if (anomaly) { signal -= U(20, 40); latency += U(50, 150); drop += U(0.1, 0.3); }
  return { signal, latency, users, drop, anomaly };
}

const isValid = (e: Event) => e.signal >= -120 && e.signal <= 0 && e.latency > 0 && e.users >= 0;

function classify(e: Event): AlertType | null {
  if (!(e.signal < -90 || e.drop > 0.05 || e.latency > 200)) return null;
  if (e.signal < -90 && e.users > 800) return 'OVERLOADED';
  if (e.signal < -90) return 'WEAK_SIGNAL';
  if (e.drop > 0.05) return 'HIGH_DROP_RATE';
  if (e.latency > 200) return 'HIGH_LATENCY';
  return null;
}

// -------------------------------------------------------------------- render

interface Spark { x: number; y: number; t0: number; c: string; big: number }

export function startEgypt(root: HTMLElement) {
  const canvas = root.querySelector<HTMLCanvasElement>('canvas')!;
  const ctx = canvas.getContext('2d')!;
  const tip = root.querySelector<HTMLElement>('[data-tip]');
  const ticker = root.querySelector<HTMLOListElement>('[data-ticker]');
  const pauseBtn = root.querySelector<HTMLButtonElement>('[data-pause]');
  const stat = (k: string) => root.querySelectorAll<HTMLElement>(`[data-stat="${k}"]`);
  const setStat = (k: string, v: string) => stat(k).forEach((el) => { if (el.textContent !== v) el.textContent = v; });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const illustrative = root.dataset.source === 'illustrative';

  let T: Towers | null = null;
  let W = 0, H = 0, dpr = 1, scale = 1, ox = 0, oy = 0, kx = 1;
  let px = new Float32Array(0), py = new Float32Array(0);
  let staticLayer: HTMLCanvasElement | null = null;
  let grid = new Map<number, number[]>();
  const GRID = 8;

  // last event per tower, for the tooltip
  let lastSig = new Float32Array(0), lastLat = new Float32Array(0), lastUsers = new Uint16Array(0), lastType = new Int8Array(0);

  // stream state
  let cursor = 0, acc = 0, total = 0, dlq = 0;
  const byType: Record<string, number> = Object.fromEntries(TYPES.map((t) => [t, 0]));
  const recent: number[] = []; // timestamps of the last second
  let windowStart = performance.now(), windowAlerts = 0, lastOutages = 0, windowsClosed = 0;
  let groups = new Map<number, Set<number>>();
  const sparks: Spark[] = [];
  let outages: { x: number; y: number; t0: number; label: string }[] = [];
  let feed: { t: string; type: string; text: string }[] = [];
  let pendingFeed: { type: AlertType; i: number; e: Event } | null = null;
  let lastFeed = 0, lastHud = 0;
  let running = false, paused = reduce, visible = true, last = 0;
  let hover = -1;
  let peak = isPeak(cairoHour());

  const project = (lon: number, lat: number): [number, number] => [ox + (lon - T!.bbox[0]) * kx * scale, oy + (T!.bbox[3] - lat) * scale];

  function layout() {
    if (!T) return;
    // CSS decides the box, the bitmap follows it.
    const r = canvas.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    const [lon0, lat0, lon1, lat1] = T.bbox;
    kx = Math.cos((((lat0 + lat1) / 2) * Math.PI) / 180);
    const gw = (lon1 - lon0) * kx, gh = lat1 - lat0;
    const wide = W > 700 && root.dataset.layout !== 'center';
    const [pt, pr, pb, pl] = wide ? [76, 12, 44, 12] : [18, 12, 18, 12];
    scale = Math.min((W - pl - pr) / gw, (H - pt - pb) / gh);
    ox = pl + (W - pl - pr - gw * scale) * (wide ? 0.85 : 0.5);
    oy = pt + (H - pt - pb - gh * scale) / 2;

    px = new Float32Array(T.n); py = new Float32Array(T.n);
    grid = new Map();
    for (let i = 0; i < T.n; i++) {
      const [x, y] = project(T.lon[i], T.lat[i]);
      px[i] = x; py[i] = y;
      const key = Math.floor(x / GRID) * 4096 + Math.floor(y / GRID);
      const cell = grid.get(key);
      if (cell) cell.push(i); else grid.set(key, [i]);
    }
    drawStatic();
    frame(performance.now(), true);
  }

  function drawStatic() {
    if (!T) return;
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);

    // graticule
    g.strokeStyle = 'rgba(238,235,228,0.05)';
    g.lineWidth = 1;
    g.setLineDash([2, 5]);
    g.font = `9px ${getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace'}`;
    g.fillStyle = 'rgba(238,235,228,0.28)';
    for (let lon = 26; lon <= 36; lon += 2) {
      const [x] = project(lon, 0);
      const [, y0] = project(0, T.bbox[3]);
      const [, y1] = project(0, T.bbox[1]);
      g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke();
      g.fillText(`${lon}°E`, x + 4, y1 - 4);
    }
    for (let lat = 22; lat <= 30; lat += 2) {
      const [, y] = project(0, lat);
      const [x0] = project(T.bbox[0], 0);
      const [x1] = project(T.bbox[2], 0);
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
      g.fillText(`${lat}°N`, x0 + 4, y - 4);
    }
    g.setLineDash([]);

    // glow, then cores, additive so dense cities burn white
    const size = Math.max(6, scale * 0.15);
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = Math.ceil(size * 2);
    const s = sprite.getContext('2d')!;
    const grad = s.createRadialGradient(size, size, 0, size, size, size);
    grad.addColorStop(0, 'rgba(255,170,60,0.9)');
    grad.addColorStop(0.35, 'rgba(255,140,40,0.25)');
    grad.addColorStop(1, 'rgba(255,120,30,0)');
    s.fillStyle = grad;
    s.fillRect(0, 0, size * 2, size * 2);

    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.022;
    for (let i = 0; i < T.n; i++) g.drawImage(sprite, px[i] - size, py[i] - size);
    g.globalAlpha = 0.7;
    g.fillStyle = '#ffb648';
    const d = W < 600 ? 1.1 : 1.35;
    for (let i = 0; i < T.n; i++) g.fillRect(px[i] - d / 2, py[i] - d / 2, d, d);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    // a few places to hold on to
    g.font = `500 10px ${getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace'}`;
    g.shadowColor = '#08090c';
    g.shadowBlur = 6;
    for (const [name, lat, lon, side] of CITIES) {
      if (W < 600 && !['Cairo', 'Alexandria', 'Aswan', 'Luxor', 'Hurghada'].includes(name)) continue;
      const [x, y] = project(lon, lat);
      g.fillStyle = 'rgba(238,235,228,0.55)';
      g.fillRect(x - 1, y - 1, 2, 2);
      g.fillStyle = 'rgba(238,235,228,0.62)';
      const w = g.measureText(name).width;
      g.fillText(name, side === 'l' ? x - w - 9 : x + 9, y + 3.5);
      g.fillStyle = 'rgba(238,235,228,0.25)';
      g.fillRect(side === 'l' ? x - 7 : x + 3, y, 4, 1);
    }
    g.shadowBlur = 0;
    staticLayer = c;
  }

  // ---------------------------------------------------------------- stream

  function step(now: number, dt: number) {
    if (!T) return;
    acc += dt * (T.n / CYCLE_MS);
    let k = Math.floor(acc);
    acc -= k;
    const budget = W < 600 ? 3 : 6; // sparks per frame, the rest is counted but not drawn
    let drawn = 0;
    while (k-- > 0) {
      const i = cursor;
      cursor = (cursor + 1) % T.n;
      if (cursor === 0) peak = isPeak(cairoHour());
      const e = generateEvent(peak);
      total++;
      recent.push(now);
      if (!isValid(e)) { dlq++; continue; }
      lastSig[i] = e.signal; lastLat[i] = e.latency; lastUsers[i] = e.users;
      const type = classify(e);
      lastType[i] = type ? TYPES.indexOf(type) : -1;
      if (e.signal < -90 || e.drop > 0.05) {
        const key = T.area[i] * 8 + T.op[i];
        let set = groups.get(key);
        if (!set) groups.set(key, (set = new Set()));
        set.add(i);
      }
      if (!type) {
        if (Math.random() < 0.012) sparks.push({ x: px[i], y: py[i], t0: now, c: '#fff4dc', big: 0 });
        continue;
      }
      byType[type]++;
      windowAlerts++;
      if (drawn < budget || type !== 'WEAK_SIGNAL') {
        sparks.push({ x: px[i], y: py[i], t0: now, c: COLOR[type], big: type === 'WEAK_SIGNAL' ? 1 : 1.6 });
        drawn++;
      }
      if (!pendingFeed || type !== 'WEAK_SIGNAL' || Math.random() < 0.08) pendingFeed = { type, i, e };
    }
    while (recent.length && recent[0] < now - 1000) recent.shift();

    if (now - windowStart >= WINDOW_MS) closeWindow(now);
  }

  function closeWindow(now: number) {
    if (!T) return;
    const hits: { key: number; n: number; members: Set<number> }[] = [];
    groups.forEach((members, key) => { if (members.size >= 3) hits.push({ key, n: members.size, members }); });
    hits.sort((a, b) => b.n - a.n);
    lastOutages = hits.length;
    windowsClosed++;
    outages = hits.slice(0, 3).map((h) => {
      let x = 0, y = 0;
      h.members.forEach((i) => { x += px[i]; y += py[i]; });
      const first = h.members.values().next().value as number;
      return { x: x / h.members.size, y: y / h.members.size, t0: now, label: `area ${T!.area[first]} ${OPERATORS[T!.op[first]]}, ${h.n} towers` };
    });
    if (hits[0]) {
      const first = hits[0].members.values().next().value as number;
      pushFeed('REGIONAL_OUTAGE', `area ${T.area[first]}, ${OPERATORS[T.op[first]]}, ${hits[0].n} towers`);
    }
    groups = new Map();
    windowStart = now;
    windowAlerts = 0;
  }

  const clock = () => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'Africa/Cairo' }).format(new Date());

  function pushFeed(type: string, text: string) {
    feed.unshift({ t: clock(), type, text });
    feed = feed.slice(0, 5);
    if (!ticker) return;
    ticker.innerHTML = feed
      .map((f) => `<li><span class="t">${f.t}</span><span class="ty" style="--c:${COLOR[f.type as AlertType] ?? '#fff'}">${f.type}</span><span class="tx">${f.text}</span></li>`)
      .join('');
  }

  function hud(now: number) {
    if (now - lastHud < 250) return;
    lastHud = now;
    setStat('eps', recent.length.toLocaleString('en-US'));
    setStat('total', total.toLocaleString('en-US'));
    setStat('dlq', dlq.toLocaleString('en-US'));
    setStat('window-alerts', windowAlerts.toLocaleString('en-US'));
    setStat('outages', lastOutages.toLocaleString('en-US'));
    setStat('peak', peak ? 'peak hour in Cairo' : 'off peak in Cairo');
    for (const t of TYPES) setStat(t, byType[t].toLocaleString('en-US'));
    const p = Math.min(1, (now - windowStart) / WINDOW_MS);
    root.querySelectorAll<HTMLElement>('[data-window]').forEach((el) => el.style.setProperty('--p', String(p)));
    setStat('window-left', `${Math.ceil((1 - p) * 10)} min`);

    if (pendingFeed && now - lastFeed > 650 && T) {
      const { type, i, e } = pendingFeed;
      const v = type === 'HIGH_DROP_RATE' ? `${(e.drop * 100).toFixed(1)}% drops` : type === 'HIGH_LATENCY' ? `${e.latency.toFixed(0)} ms` : `${e.signal.toFixed(1)} dBm`;
      pushFeed(type, `${OPERATORS[T.op[i]] ?? '?'} ${RADIOS[T.radio[i]] ?? ''}, ${v}`);
      pendingFeed = null;
      lastFeed = now;
    }
  }

  // ---------------------------------------------------------------- frame

  function frame(now: number, still = false) {
    if (!staticLayer) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(staticLayer, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.globalCompositeOperation = 'lighter';
    for (let s = sparks.length - 1; s >= 0; s--) {
      const sp = sparks[s];
      const life = sp.big ? 1100 : 380;
      const t = (now - sp.t0) / life;
      if (t >= 1) { sparks.splice(s, 1); continue; }
      const a = 1 - t;
      ctx.globalAlpha = a;
      ctx.fillStyle = sp.c;
      if (sp.big) {
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 1.6 + 0.6 * sp.big, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = sp.c;
        ctx.lineWidth = 1;
        ctx.globalAlpha = a * 0.7;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 2 + t * 9 * sp.big, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillRect(sp.x - 1, sp.y - 1, 2, 2);
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    for (let o = outages.length - 1; o >= 0; o--) {
      const out = outages[o];
      const t = (now - out.t0) / 2600;
      if (t >= 1) { outages.splice(o, 1); continue; }
      const a = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      ctx.globalAlpha = Math.max(0, a);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      for (const r of [10 + t * 26, 4 + t * 14]) { ctx.beginPath(); ctx.arc(out.x, out.y, r, 0, Math.PI * 2); ctx.stroke(); }
      if (o === 0 && W > 600) {
        ctx.font = `500 10px ${getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace'}`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText('REGIONAL_OUTAGE', out.x + 18, out.y - 6);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText(out.label, out.x + 18, out.y + 8);
      }
    }
    ctx.globalAlpha = 1;

    if (hover >= 0) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(px[hover], py[hover], 6, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.arc(px[hover], py[hover], 11, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (!still) hud(now);
  }

  function loop(now: number) {
    if (!running) return;
    const dt = Math.min(64, now - (last || now));
    last = now;
    step(now, dt);
    frame(now);
    requestAnimationFrame(loop);
  }
  function play() {
    if (running || paused || !visible || !T) return;
    running = true;
    last = 0;
    windowStart = performance.now() - ((performance.now() - windowStart) % WINDOW_MS);
    requestAnimationFrame(loop);
  }
  function stop() { running = false; }

  // ---------------------------------------------------------------- input

  function nearest(x: number, y: number): number {
    let best = -1, bd = 14 * 14;
    const cx = Math.floor(x / GRID), cy = Math.floor(y / GRID);
    for (let gx = cx - 2; gx <= cx + 2; gx++) for (let gy = cy - 2; gy <= cy + 2; gy++) {
      const cell = grid.get(gx * 4096 + gy);
      if (!cell) continue;
      for (const i of cell) {
        const d = (px[i] - x) ** 2 + (py[i] - y) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  }

  function showTip(i: number, x: number, y: number) {
    if (!tip || !T) return;
    hover = i;
    if (i < 0) { tip.hidden = true; if (!running) frame(performance.now(), true); return; }
    const type = lastType[i] >= 0 ? TYPES[lastType[i]] : null;
    const seen = lastSig[i] !== 0;
    tip.innerHTML =
      `<b>${OPERATORS[T.op[i]] ?? 'Unknown'} <span>${RADIOS[T.radio[i]] ?? ''}</span></b>` +
      `<span>cell ${T.cell[i]} &middot; area ${T.area[i]}</span>` +
      `<span>${T.lat[i].toFixed(3)}&deg;N ${T.lon[i].toFixed(3)}&deg;E</span>` +
      (seen
        ? `<span class="v">${lastSig[i].toFixed(1)} dBm &middot; ${lastLat[i].toFixed(0)} ms &middot; ${lastUsers[i]} users</span>` +
          `<span class="st" style="--c:${type ? COLOR[type] : '#43d18a'}">${type ?? 'healthy'}</span>`
        : `<span class="v">waiting for its next event</span>`) +
      (illustrative ? `<i>illustrative position</i>` : '');
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(W - r.width - 8, x + 14)}px`;
    tip.style.top = `${Math.max(8, Math.min(H - r.height - 8, y - r.height / 2))}px`;
    if (!running) frame(performance.now(), true);
  }

  root.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    showTip(nearest(x, y), x, y);
  });
  root.addEventListener('pointerleave', () => showTip(-1, 0, 0));

  pauseBtn?.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.setAttribute('aria-pressed', String(paused));
    pauseBtn.setAttribute('aria-label', paused ? 'Play the stream' : 'Pause the stream');
    root.classList.toggle('paused', paused);
    paused ? stop() : play();
  });
  if (paused) { root.classList.add('paused'); pauseBtn?.setAttribute('aria-pressed', 'true'); pauseBtn?.setAttribute('aria-label', 'Play the stream'); }

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? play() : stop(); }).observe(root);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else play(); });

  let resizeTimer = 0, lastW = 0;
  new ResizeObserver(([entry]) => {
    const w = Math.round(entry.contentRect.width);
    if (!w || w === lastW) return;
    lastW = w;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(layout, T ? 120 : 0);
  }).observe(root);

  loadTowers()
    .then((t) => {
      T = t;
      lastSig = new Float32Array(t.n); lastLat = new Float32Array(t.n); lastUsers = new Uint16Array(t.n); lastType = new Int8Array(t.n).fill(-1);
      root.dataset.ready = 'true';
      setStat('towers', t.n.toLocaleString('en-US'));
      layout();
      if (paused) {
        // A still frame that still tells the story: one window's worth of alerts.
        const now = performance.now();
        step(now, 600);
        frame(now);
        hud(now + 1000);
      }
      play();
    })
    .catch(() => root.classList.add('failed'));
}
