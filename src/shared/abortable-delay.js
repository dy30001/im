async function delayWithAbort(ms, signal) {
  await new Promise((resolve) => {
    const normalizedMs = Math.max(0, Number(ms) || 0);
    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const settle = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };

    const onAbort = () => {
      settle();
    };

    timer = setTimeout(() => {
      settle();
    }, normalizedMs);

    if (signal) {
      if (signal.aborted) {
        settle();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

module.exports = {
  delayWithAbort,
};
