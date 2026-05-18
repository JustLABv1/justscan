'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type AIPageContext = {
  scopeType: string;
  scopeRef: string;
  title?: string;
  description?: string;
};

type AIContextBridgeValue = {
  routeContext: AIPageContext;
  overlayContext: AIPageContext | null;
  activeContext: AIPageContext;
  setRouteContext: (context: AIPageContext) => void;
  setOverlayContext: (context: AIPageContext | null) => void;
};

const AIContextBridge = createContext<AIContextBridgeValue | null>(null);

export function AIContextBridgeProvider({ children }: { children: ReactNode }) {
  const [routeContext, setRouteContextState] = useState<AIPageContext>({
    scopeType: 'global',
    scopeRef: '',
  });
  const [overlayContext, setOverlayContextState] = useState<AIPageContext | null>(null);

  const setRouteContext = useCallback((context: AIPageContext) => {
    setRouteContextState(context);
  }, []);

  const setOverlayContext = useCallback((context: AIPageContext | null) => {
    setOverlayContextState(context);
  }, []);

  const value = useMemo<AIContextBridgeValue>(
    () => ({
      routeContext,
      overlayContext,
      activeContext: overlayContext ?? routeContext,
      setRouteContext,
      setOverlayContext,
    }),
    [overlayContext, routeContext, setOverlayContext, setRouteContext]
  );

  return <AIContextBridge.Provider value={value}>{children}</AIContextBridge.Provider>;
}

export function useAIContextBridge() {
  const context = useContext(AIContextBridge);
  if (!context) {
    throw new Error('useAIContextBridge must be used within AIContextBridgeProvider');
  }
  return context;
}
