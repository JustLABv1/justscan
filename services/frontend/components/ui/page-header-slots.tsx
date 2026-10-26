'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

const PageHeaderSlotsContext = createContext<{
  heading: HTMLDivElement | null;
  actions: HTMLDivElement | null;
  setHeading: (node: HTMLDivElement | null) => void;
  setActions: (node: HTMLDivElement | null) => void;
} | null>(null);

export function PageHeaderSlotsProvider({ children }: { children: ReactNode }) {
  const [heading, setHeading] = useState<HTMLDivElement | null>(null);
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const value = useMemo(() => ({ heading, actions, setHeading, setActions }), [heading, actions]);
  return (
    <PageHeaderSlotsContext.Provider value={value}>{children}</PageHeaderSlotsContext.Provider>
  );
}

export const usePageHeaderSlots = () => useContext(PageHeaderSlotsContext);

export function PageHeadingSlot({ fallback }: { fallback: ReactNode }) {
  const slots = usePageHeaderSlots();
  return (
    <div className="flex min-w-0 items-center gap-2 [&:has(>[data-page-heading]:not(:empty))>[data-fallback]]:hidden">
      <div ref={slots?.setHeading} data-page-heading className="min-w-0 empty:hidden" />
      <span data-fallback className="truncate font-medium">
        {fallback}
      </span>
    </div>
  );
}

export function PageActionsSlot() {
  const slots = usePageHeaderSlots();
  return (
    <div
      ref={slots?.setActions}
      className="flex flex-wrap items-center justify-end gap-2 empty:hidden"
    />
  );
}
