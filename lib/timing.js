const enabled =
  process.env.FALA_TIMING === '1' ||
  (
    process.env.FALA_TIMING !== '0' &&
    process.env.NODE_ENV !== 'production'
  );

export function createTimer(label) {
  const started = performance.now();
  let previous = started;
  const stages = [];

  return {
    async stage(name, fn) {
      const stageStarted = performance.now();
      try {
        return await fn();
      } finally {
        const now = performance.now();
        stages.push({ name, ms: Math.round(now - stageStarted) });
        previous = now;
      }
    },
    mark(name) {
      const now = performance.now();
      stages.push({ name, ms: Math.round(now - previous) });
      previous = now;
    },
    log(extra = {}) {
      if (!enabled) return;
      const total = Math.round(performance.now() - started);
      console.log(`[Fala timing: ${label}]`, JSON.stringify({ total, stages, ...extra }));
    },
  };
}
