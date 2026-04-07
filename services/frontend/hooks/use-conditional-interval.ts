import { useEffect, useRef } from 'react';

export function useConditionalInterval(callback: () => void, enabled: boolean, delayMs: number) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => callbackRef.current(), delayMs);
    return () => clearInterval(interval);
  }, [delayMs, enabled]);
}