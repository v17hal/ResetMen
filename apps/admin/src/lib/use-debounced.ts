'use client';

import { useEffect, useState } from 'react';

/**
 * Delays a fast-changing value.
 *
 * Used for search boxes so typing "9404" issues one request rather than four. The timer is
 * cleared on every change, so only a pause actually produces a new value.
 */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
