type DeferredCleanup = void | (() => void);

export function deferEffect(callback: () => DeferredCleanup | Promise<DeferredCleanup>) {
  let cancelled = false;
  let cleanup: DeferredCleanup;

  queueMicrotask(() => {
    if (cancelled) {
      return;
    }

    void Promise.resolve(callback()).then((nextCleanup) => {
      if (cancelled) {
        nextCleanup?.();
        return;
      }

      cleanup = nextCleanup;
    });
  });

  return () => {
    cancelled = true;
    cleanup?.();
  };
}
