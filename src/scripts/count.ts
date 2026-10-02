/** Count numbers up once when they scroll into view. */
export function countUp(els: NodeListOf<HTMLElement> | HTMLElement[]) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        const el = e.target as HTMLElement;
        const to = Number(el.dataset.count);
        const dec = Number(el.dataset.decimals || 0);
        const pre = el.dataset.prefix || '';
        const suf = el.dataset.suffix || '';
        const t0 = performance.now();
        const dur = 1400;
        const tick = (now: number) => {
          const t = Math.min(1, (now - t0) / dur);
          const v = to * (1 - Math.pow(1 - t, 4));
          el.textContent = `${pre}${v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}${suf}`;
          if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    { threshold: 0.6 },
  );
  els.forEach((el) => io.observe(el));
}
