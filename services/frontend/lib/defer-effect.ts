export function deferEffect(callback: () => void | Promise<void>) {
  let cancelled = false;

  queueMicrotask(() => {
    if (cancelled) {
      return;
    }

    void callback();
  });

  return () => {
    cancelled = true;
  };
}
