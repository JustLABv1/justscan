'use client';

import { createContext, useContext } from 'react';

// Keep nested collection/date overlays inside a modal's focus scope.
export const OverlayPortalContext = createContext<HTMLElement | null>(null);
export function useOverlayPortal() {
  return useContext(OverlayPortalContext) ?? undefined;
}
