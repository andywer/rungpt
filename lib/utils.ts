// deno-lint-ignore no-explicit-any
export function throttle<F extends (...args: any[]) => any>(fn: F, waitTimeMs: number): F {
  let lastExecution = 0;
  let timeout: number | undefined;

  // deno-lint-ignore no-explicit-any
  return ((...args: any[]) => {
    const now = Date.now();
    const remaining = waitTimeMs - (now - lastExecution);

    if (remaining <= 0) {
      lastExecution = now;
      return fn(...args);
    } else if (!timeout) {
      timeout = setTimeout(() => {
        lastExecution = Date.now();
        timeout = undefined;
        fn(...args);
      }, remaining);
    }
  }) as F;
}
