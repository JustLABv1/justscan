'use client';

import { useAIContextBridge } from '@/components/assistant/ai-context-bridge';
import { AssistantExperience } from '@/components/assistant/assistant-experience';
import { getAISettings } from '@/lib/api/ai';
import { Button, Modal, Tooltip, useOverlayState } from '@heroui/react';
import { Cancel01Icon } from 'hugeicons-react';
import { useEffect, useState } from 'react';

export function FloatingAIChat() {
  const state = useOverlayState();
  const { activeContext } = useAIContextBridge();
  const [aiEnabled, setAIEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getAISettings()
      .then((settings) => {
        if (cancelled) {
          return;
        }
        setAIEnabled(settings.enabled);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setAIEnabled(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (aiEnabled === false && state.isOpen) {
      state.close();
    }
  }, [aiEnabled, state]);

  if (!aiEnabled) {
    return null;
  }

  return (
    <>
      <div className="pointer-events-none fixed bottom-4 right-4 z-[120] md:bottom-6 md:right-6">
        <Tooltip delay={0}>
          <Tooltip.Trigger aria-label="Open AI Assistant" className="pointer-events-auto block">
            <Button
              aria-label="Open AI Assistant"
              className="border-2 border-white/20 text-white"
              size="lg"
              isIconOnly
              onPress={state.open}
              variant="primary"
            >
              <span aria-hidden className="text-[11px] font-bold tracking-[0.12em]">
                AI
              </span>
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content placement="left">Ask AI</Tooltip.Content>
        </Tooltip>
      </div>

      <Modal.Backdrop isOpen={state.isOpen} onOpenChange={state.setOpen} variant="blur">
        <Modal.Container placement="auto" size="full">
          <Modal.Dialog className="relative h-[min(92dvh,980px)] w-[min(96vw,1320px)] max-w-none overflow-hidden rounded-2xl p-0">
            <Button
              aria-label="Close AI chat"
              className="absolute right-3 top-3 z-[10]"
              isIconOnly
              onPress={state.close}
              variant="secondary"
            >
              <Cancel01Icon size={16} />
            </Button>
            <Modal.Body className="min-h-0 p-0">
              <AssistantExperience
                embedded
                forcedScopeRef={activeContext.scopeRef}
                forcedScopeType={activeContext.scopeType}
              />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
