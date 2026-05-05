'use client';

import { Button, Drawer, useOverlayState } from '@heroui/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { KeyboardEvent, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useToast } from '@/components/toast';
import { heroTextAreaClassName, nativeFieldClassName } from '@/components/ui/form-styles';
import {
    createAIConversation,
    createScans,
    deleteAIConversation,
    getAIConversation,
    getAISettings,
    getScan,
    getVulnerabilityContextAnalysis,
    getWorkScope,
    listAIConversations,
    listAIProviders,
    listArtifactoryRepositories,
    listRegistriesWithCapabilities,
    listVulnerabilities,
    reScan,
    sendAIConversationMessage,
    type AIConversation,
    type AIMessageSource,
    type AIProviderSummary,
    type AISettings,
    type AIToolCall,
    type RegistryWithHealth,
    type Scan,
    type Vulnerability
} from '@/lib/api';
import { timeAgo } from '@/lib/time';

const inputCls = nativeFieldClassName;
const textAreaCls = heroTextAreaClassName;

type ScopeContext = {
  title: string;
  description: string;
  context: string;
  sources: AIMessageSource[];
  openHref?: string;
  rescanId?: string;
};

type LocalAssistantPrompt = {
  id: string;
  role: 'assistant';
  content: string;
  toolCalls: AIToolCall[];
};

type PendingChatState = {
  userMessage: string;
  awaitingAssistant: boolean;
};

type DisplayMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls: AIToolCall[];
  thinking?: boolean;
};

type AssistantActionResult =
  | { kind: 'ignored' }
  | { kind: 'executed' }
  | { kind: 'follow-up'; prompt: LocalAssistantPrompt };

type ScanIntent = {
  images: string[];
  wantsXray: boolean;
  xrayRepository?: string;
};

export default function AssistantPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [providers, setProviders] = useState<AIProviderSummary[]>([]);
  const [providerKey, setProviderKey] = useState('');
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [conversation, setConversation] = useState<AIConversation | null>(null);
  const [scopeContext, setScopeContext] = useState<ScopeContext | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [toolCallState, setToolCallState] = useState<Record<string, { status: string; error?: string }>>({});
  const [localAssistantPrompt, setLocalAssistantPrompt] = useState<LocalAssistantPrompt | null>(null);
  const [pendingChat, setPendingChat] = useState<PendingChatState | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const conversationsDrawer = useOverlayState();
  const contextDrawer = useOverlayState();

  const scopeType = searchParams.get('scopeType')?.trim() || 'global';
  const scopeRef = searchParams.get('scopeRef')?.trim() || '';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conversation?.messages?.length, localAssistantPrompt?.id, pendingChat?.userMessage, pendingChat?.awaitingAssistant]);

  useEffect(() => {
    async function loadAssistant() {
      setLoading(true);
      try {
        const [nextSettings, nextProviders, nextConversations, nextScopeContext] = await Promise.all([
          getAISettings(),
          listAIProviders(),
          listAIConversations(scopeType, scopeRef || undefined),
          buildScopeContext(scopeType, scopeRef),
        ]);
        setSettings(nextSettings);
        setProviders(nextProviders);
        setProviderKey(nextProviders.find((provider) => provider.default)?.key ?? nextProviders[0]?.key ?? '');
        setConversations(nextConversations);
        setScopeContext(nextScopeContext);

        if (nextConversations[0]) {
          const fullConversation = await getAIConversation(nextConversations[0].id);
          setConversation(fullConversation);
        } else {
          setConversation(null);
        }
      } catch (error: unknown) {
        toast.error(error instanceof Error ? error.message : 'Failed to load assistant');
      } finally {
        setLoading(false);
      }
    }

    void loadAssistant();
  }, [scopeRef, scopeType]);

  useEffect(() => {
    setLocalAssistantPrompt(null);
  }, [conversation?.id, scopeRef, scopeType]);

  const suggestions = useMemo(() => {
    if (scopeType === 'scan') {
      return [
        'Summarize the highest-risk findings in this scan.',
        'Which packages should I remediate first and why?',
        'Explain the current scan status and next action.',
      ];
    }
    if (scopeType === 'vulnerability') {
      return [
        'Explain this finding in plain language.',
        'What is the likely remediation path for this vulnerability?',
        'How urgent is this issue in the current scan context?',
      ];
    }
    return [
      'How do I start a new scan?',
      'Where do I manage suppressions and status pages?',
      'Explain the difference between registries, watchlist, and vuln KB.',
    ];
  }, [scopeType]);

  async function refreshConversations(selectedID?: string) {
    const nextConversations = await listAIConversations(scopeType, scopeRef || undefined);
    setConversations(nextConversations);
    const targetID = selectedID ?? nextConversations[0]?.id;
    if (targetID) {
      setConversation(await getAIConversation(targetID));
    } else {
      setConversation(null);
    }
  }

  async function ensureConversation(seed: string) {
    if (conversation) {
      return conversation;
    }

    const nextConversation = await createAIConversation({
      title: seed,
      scopeType,
      scopeRef,
    });
    await refreshConversations(nextConversation.id);
    return nextConversation;
  }

  async function handleSend() {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      return;
    }

    setSending(true);
    try {
      const actionResult = await runAssistantAction(trimmedMessage, {
        router,
        scopeContext,
        onQueuedScans: (count) => {
          toast.success(`${count} image${count === 1 ? '' : 's'} queued`);
        },
        onQueuedRescan: () => {
          toast.success('Re-scan queued');
        },
      });
      if (actionResult.kind === 'executed') {
        setLocalAssistantPrompt(null);
        setMessage('');
        setPendingChat(null);
        return;
      }
      if (actionResult.kind === 'follow-up') {
        setLocalAssistantPrompt(actionResult.prompt);
        setMessage('');
        setPendingChat(null);
        return;
      }

      setLocalAssistantPrompt(null);
      setPendingChat({ userMessage: trimmedMessage, awaitingAssistant: true });
      setMessage('');
      const targetConversation = await ensureConversation(trimmedMessage);
      const response = await sendAIConversationMessage(targetConversation.id, {
        providerKey,
        message: trimmedMessage,
        context: scopeContext?.context,
      });
      await refreshConversations(response.conversation.id);
      setPendingChat(null);
    } catch (error: unknown) {
      setPendingChat(null);
      setMessage(trimmedMessage);
      toast.error(error instanceof Error ? error.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  async function handleOpenConversation(id: string) {
    try {
      setPendingChat(null);
      setConversation(await getAIConversation(id));
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to load conversation');
    }
  }

  async function handleDeleteConversation(id: string) {
    if (!window.confirm('Delete this conversation?')) {
      return;
    }
    try {
      await deleteAIConversation(id);
      toast.success('Conversation deleted');
      await refreshConversations(conversation?.id === id ? undefined : conversation?.id);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete conversation');
    }
  }

  async function handleRescan() {
    if (!scopeContext?.rescanId) {
      return;
    }
    setRescanning(true);
    try {
      const nextScan = await reScan(scopeContext.rescanId);
      toast.success('Re-scan queued');
      router.push(`/scans/${nextScan.id}`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to queue re-scan');
    } finally {
      setRescanning(false);
    }
  }

  async function handleToolCall(toolCall: AIToolCall, messageID: string, index: number) {
    const key = toolCallKey(messageID, index);
    setToolCallState((current) => ({ ...current, [key]: { status: 'running' } }));
    try {
      const result = await executeAssistantToolCall(toolCall, {
        router,
        scopeContext,
        onQueuedScans: (count) => {
          toast.success(`${count} image${count === 1 ? '' : 's'} queued`);
        },
        onQueuedRescan: () => {
          toast.success('Re-scan queued');
        },
      });

      if (result.kind === 'ignored') {
        throw new Error('This action is not available in the current context');
      }
      if (result.kind === 'follow-up') {
        setLocalAssistantPrompt(result.prompt);
        setToolCallState((current) => ({ ...current, [key]: { status: 'needs-input' } }));
        return;
      }

      if (localAssistantPrompt?.id === messageID) {
        setLocalAssistantPrompt(null);
      }
      setToolCallState((current) => ({ ...current, [key]: { status: 'completed' } }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to run action';
      setToolCallState((current) => ({ ...current, [key]: { status: 'error', error: message } }));
      toast.error(message);
    }
  }

  const currentMessages = conversation?.messages ?? [];
  const displayMessages: DisplayMessage[] = [
    ...currentMessages
      .filter((item) => item.role === 'user' || item.role === 'assistant')
      .map((item) => ({
      id: item.id,
      role: item.role === 'user' ? 'user' as const : 'assistant' as const,
      content: item.content,
      toolCalls: item.toolCalls,
    })),
    ...(pendingChat ? [{
      id: 'pending-user',
      role: 'user' as const,
      content: pendingChat.userMessage,
      toolCalls: [],
    }] : []),
    ...(pendingChat?.awaitingAssistant ? [{
      id: 'pending-assistant',
      role: 'assistant' as const,
      content: '',
      toolCalls: [],
      thinking: true,
    }] : []),
    ...(localAssistantPrompt ? [localAssistantPrompt] : []),
  ];
  const hasMessages = displayMessages.length > 0;
  const scopeLabel = scopeContext?.title ?? 'Global workspace';
  const scopeDescription = scopeContext?.description ?? 'General JustScan routes and workflows.';
  const conversationLabel = conversation?.title?.trim() || 'New conversation';
  const hasMeaningfulContext = scopeType !== 'global' || Boolean(scopeRef);
  const conversationItems = loading ? (
    <div className="rounded-2xl border px-4 py-5 text-sm text-zinc-500" style={{ borderColor: 'var(--glass-border)', background: 'var(--row-hover)' }}>
      Loading conversations…
    </div>
  ) : conversations.length === 0 ? (
    <div className="rounded-2xl border px-4 py-5 text-sm text-zinc-500" style={{ borderColor: 'var(--glass-border)', background: 'var(--row-hover)' }}>
      No conversations yet for this scope.
    </div>
  ) : conversations.map((item) => (
    <div key={item.id} className="rounded-2xl border p-3 transition-colors" style={{ borderColor: conversation?.id === item.id ? 'rgba(124,58,237,0.35)' : 'var(--glass-border)', background: 'var(--row-hover)' }}>
      <button type="button" className="w-full text-left" onClick={() => {
        conversationsDrawer.close();
        void handleOpenConversation(item.id);
      }}>
        <p className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{item.title}</p>
        <p className="mt-1 text-xs text-zinc-500">Updated {timeAgo(item.updatedAt)}</p>
      </button>
      <div className="mt-3 flex justify-end">
        <button className="text-xs font-medium text-rose-300 hover:text-rose-200" onClick={() => void handleDeleteConversation(item.id)} type="button">
          Delete
        </button>
      </div>
    </div>
  ));
  const contextSummary = scopeContext ? (
    <div className="space-y-4">
      <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--glass-border)', background: 'var(--row-hover)' }}>
        <p className="text-sm font-semibold text-zinc-900 dark:text-white">{scopeContext.title}</p>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{scopeContext.description}</p>
      </div>
      <div className="space-y-2">
        {scopeContext.sources.map((source) => (
          <div key={`${source.resourceType}-${source.resourceId}-${source.title}`} className="rounded-2xl border p-3 text-sm" style={{ borderColor: 'var(--glass-border)', background: 'var(--row-hover)' }}>
            <p className="font-semibold text-zinc-900 dark:text-zinc-100">{source.title}</p>
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">{source.snippet}</p>
            {source.url ? <Link className="mt-2 inline-flex text-violet-500 hover:text-violet-400 dark:text-violet-300 dark:hover:text-violet-200" href={source.url}>Open resource</Link> : null}
          </div>
        ))}
      </div>
    </div>
  ) : (
    <div className="rounded-2xl border px-4 py-5 text-sm text-zinc-500" style={{ borderColor: 'var(--glass-border)', background: 'var(--row-hover)' }}>
      This assistant is running without a specific resource scope.
    </div>
  );

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    event.preventDefault();
    if (!sending && message.trim()) {
      void handleSend();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-0 py-0 md:px-2 md:py-2">
      <div className="mx-auto flex min-h-0 w-full max-w-[132rem] flex-1 overflow-hidden rounded-[28px] border" style={{ borderColor: 'var(--glass-border)', background: 'linear-gradient(180deg, rgba(18,18,24,0.72) 0%, rgba(12,12,16,0.62) 100%)' }}>
        <aside className="hidden min-h-0 w-[300px] shrink-0 border-r lg:flex lg:flex-col" style={{ borderColor: 'var(--glass-border)', background: 'rgba(9,9,12,0.34)' }}>
          <div className="space-y-4 border-b px-4 py-4" style={{ borderColor: 'var(--glass-border)' }}>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: 'var(--text-faint)' }}>Assistant</p>
              <p className="mt-1 text-sm font-semibold text-zinc-950 dark:text-zinc-50">Threads</p>
            </div>
            <Button className="btn-secondary w-full justify-center" onPress={() => setConversation(null)} variant="secondary">New conversation</Button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
            {conversationItems}
          </div>
        </aside>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 md:px-5" style={{ borderColor: 'var(--glass-border)' }}>
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <div className="lg:hidden">
                <Button className="btn-secondary" onPress={conversationsDrawer.open} variant="secondary">Threads</Button>
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">{conversationLabel}</p>
                <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                  <span>JustScan Assistant</span>
                  {hasMeaningfulContext ? <span className="hidden sm:inline">•</span> : null}
                  {hasMeaningfulContext ? <span className="truncate">{scopeLabel}</span> : null}
                </div>
              </div>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 rounded-2xl border px-3 py-2" style={{ borderColor: 'var(--glass-border)', background: 'var(--row-hover)' }}>
                <span className="text-xs font-medium uppercase tracking-[0.16em]" style={{ color: 'var(--text-faint)' }}>Provider</span>
                <select className={`${inputCls} min-w-[8.5rem] border-0 bg-transparent px-0 py-0 text-sm shadow-none`} value={providerKey} onChange={(event) => setProviderKey(event.target.value)}>
                  {providers.map((provider) => (
                    <option key={provider.key} value={provider.key}>{provider.label}</option>
                  ))}
                </select>
              </label>
              <Link className="btn-secondary" href="/scans?new=1">New scan</Link>
            </div>
          </div>

          {settings?.enabled && providers.length > 0 && hasMeaningfulContext ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 md:px-5" style={{ borderColor: 'var(--glass-border)', background: 'rgba(255,255,255,0.015)' }}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{scopeLabel}</p>
                <p className="truncate text-xs" style={{ color: 'var(--text-faint)' }}>{scopeDescription}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="hidden items-center rounded-full border px-3 py-1 text-xs font-medium md:inline-flex" style={{ borderColor: 'var(--glass-border)', background: 'var(--row-hover)', color: 'var(--text-secondary)' }}>
                  {scopeType}{scopeRef ? `: ${scopeRef}` : ''}
                </span>
                <Button className="btn-secondary" onPress={contextDrawer.open} variant="secondary">Details</Button>
                {scopeContext?.openHref ? <Link className="btn-secondary" href={scopeContext.openHref}>Open scope</Link> : null}
                {scopeContext?.rescanId ? (
                  <Button className="btn-primary" isDisabled={rescanning} onPress={handleRescan} variant="primary">
                    {rescanning ? 'Queueing…' : 'Re-scan'}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {!settings?.enabled ? (
              <div className="m-4 rounded-3xl border px-5 py-6 text-sm text-zinc-500 md:m-6" style={{ borderColor: 'var(--glass-border)', background: 'var(--row-hover)' }}>
                AI is disabled on this instance.
              </div>
            ) : providers.length === 0 ? (
              <div className="m-4 rounded-3xl border px-5 py-6 text-sm text-zinc-500 md:m-6" style={{ borderColor: 'var(--glass-border)', background: 'var(--row-hover)' }}>
                No enabled provider is configured. Ask an administrator to configure one in <Link href="/admin/ai" className="text-violet-300 hover:text-violet-200">Admin → AI</Link>.
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-4 py-4 md:px-8 md:py-6">
                  <div className="mx-auto flex min-h-full w-full max-w-[72rem] flex-col">
                    {!hasMessages ? (
                      <div className="flex min-h-full flex-1 flex-col justify-center py-4">
                        <div className="rounded-[28px] border px-5 py-5 md:px-6 md:py-6" style={{ borderColor: 'var(--glass-border)', background: 'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)' }}>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: 'var(--text-faint)' }}>Ready</p>
                          <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">Start a thread.</h2>
                          <p className="mt-2 max-w-2xl text-sm leading-6" style={{ color: 'var(--text-faint)' }}>
                            Ask about a scan, navigate to a workflow, or trigger an action. Context and history stay one click away.
                          </p>
                          <div className="mt-4 flex flex-wrap gap-2.5">
                            <span className="rounded-full border px-3 py-1 text-xs font-medium" style={{ borderColor: 'var(--glass-border)', background: 'var(--row-hover)', color: 'var(--text-secondary)' }}>Scoped to {scopeType}{scopeRef ? `: ${scopeRef}` : ''}</span>
                            <span className="rounded-full border px-3 py-1 text-xs font-medium" style={{ borderColor: 'var(--glass-border)', background: 'var(--row-hover)', color: 'var(--text-secondary)' }}>Provider {providerKey || 'unselected'}</span>
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2.5">
                        {suggestions.map((suggestion) => (
                          <button key={suggestion} className="rounded-full border px-4 py-2.5 text-sm text-zinc-700 transition hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white" style={{ borderColor: 'var(--glass-border)', background: 'var(--row-hover)' }} onClick={() => setMessage(suggestion)} type="button">
                            {suggestion}
                          </button>
                        ))}
                      </div>
                      </div>
                    ) : (
                      <div className="space-y-6 pb-2">
                        {displayMessages.map((item) => (
                          <div key={item.id} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`w-full max-w-[min(100%,68rem)] ${item.role === 'user' ? 'rounded-[24px] border border-violet-500/30 bg-violet-500/12 px-5 py-4' : 'px-1 py-1'}`} style={item.role === 'user' ? undefined : undefined}>
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{item.role === 'user' ? 'You' : 'Assistant'}</p>
                              </div>
                              {item.thinking ? (
                                <div className="flex items-center gap-2 py-2 text-sm" style={{ color: 'var(--text-faint)' }}>
                                  <span>Thinking</span>
                                  <span className="flex gap-1">
                                    <span className="h-2 w-2 animate-pulse rounded-full bg-zinc-400 [animation-delay:0ms]" />
                                    <span className="h-2 w-2 animate-pulse rounded-full bg-zinc-400 [animation-delay:150ms]" />
                                    <span className="h-2 w-2 animate-pulse rounded-full bg-zinc-400 [animation-delay:300ms]" />
                                  </span>
                                </div>
                              ) : (
                                <div className="space-y-3 text-[15px] leading-7 text-zinc-800 dark:text-zinc-100">
                                  {renderMessageContent(item.content)}
                                </div>
                              )}
                              {item.role === 'assistant' && item.toolCalls.length > 0 ? (
                                <div className="mt-5 flex flex-wrap gap-2.5">
                                  {item.toolCalls.map((toolCall, index) => {
                                    const key = toolCallKey(item.id, index);
                                    const execution = toolCallState[key];
                                    const status = execution?.status ?? toolCall.status;
                                    return (
                                      <div className="space-y-1" key={key}>
                                        <Button
                                          className={status === 'completed' ? 'btn-secondary' : 'btn-primary'}
                                          isDisabled={status === 'running' || status === 'completed' || status === 'needs-input'}
                                          onPress={() => {
                                            void handleToolCall(toolCall, item.id, index);
                                          }}
                                          variant={status === 'completed' ? 'secondary' : 'primary'}
                                        >
                                          {toolCallLabel(toolCall, status)}
                                        </Button>
                                        {execution?.error ? <p className="text-xs text-rose-500">{execution.error}</p> : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </div>

                <div className="border-t px-4 pb-4 pt-4 md:px-8 md:pb-6" style={{ borderColor: 'var(--glass-border)', background: 'rgba(12,12,16,0.52)' }}>
                  <div className="mx-auto max-w-[72rem] rounded-[24px] border px-4 py-4 md:px-5" style={{ borderColor: 'var(--glass-border)', background: 'linear-gradient(180deg, rgba(255,255,255,0.038) 0%, rgba(255,255,255,0.018) 100%)' }}>
                    <textarea className={`${textAreaCls} min-h-[5.25rem] resize-none`} onKeyDown={handleComposerKeyDown} placeholder="Ask JustScan AI about this scope, a navigation path, or a remediation plan…" rows={2} value={message} onChange={(event) => setMessage(event.target.value)} />
                    <div className="mt-3 flex flex-col gap-3 border-t pt-3 md:flex-row md:items-center md:justify-between" style={{ borderColor: 'var(--glass-border)' }}>
                      <p className="text-xs leading-5 text-zinc-500">Direct actions also work here: `scan nginx:latest`, `scan nginx:latest with xray`, `open scans`, `rescan this scan`.</p>
                      <div className="flex items-center gap-2 self-end md:self-auto">
                        <div className="lg:hidden">
                          <Button className="btn-secondary" onPress={conversationsDrawer.open} variant="secondary">History</Button>
                        </div>
                        <Button className="btn-primary" isDisabled={sending || !message.trim()} onPress={handleSend} variant="primary">
                          {sending ? 'Working…' : 'Send'}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        <Drawer state={conversationsDrawer}>
          <Drawer.Backdrop variant="blur">
            <Drawer.Content placement="left">
            <Drawer.Dialog className="flex h-full w-[min(92vw,360px)] flex-col sidebar-glass">
              <Drawer.Header className="flex items-center justify-between px-4 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <div>
                  <Drawer.Heading className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Conversations</Drawer.Heading>
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Scoped to {scopeType}{scopeRef ? `: ${scopeRef}` : ''}.</p>
                </div>
                <Drawer.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Drawer.Header>
              <Drawer.Body className="flex-1 overflow-y-auto px-4 py-4">
                <div className="space-y-4">
                  <Button className="btn-secondary w-full justify-center" onPress={() => {
                    setConversation(null);
                    conversationsDrawer.close();
                  }} variant="secondary">New conversation</Button>
                  {conversationItems}
                </div>
              </Drawer.Body>
            </Drawer.Dialog>
            </Drawer.Content>
          </Drawer.Backdrop>
        </Drawer>

        <Drawer state={contextDrawer}>
          <Drawer.Backdrop variant="blur">
            <Drawer.Content placement="right">
            <Drawer.Dialog className="flex h-full w-[min(92vw,380px)] flex-col sidebar-glass">
              <Drawer.Header className="flex items-center justify-between px-4 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <div>
                  <Drawer.Heading className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Current context</Drawer.Heading>
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>The assistant uses this scope summary for the current thread.</p>
                </div>
                <Drawer.CloseTrigger className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300" />
              </Drawer.Header>
              <Drawer.Body className="flex-1 overflow-y-auto px-4 py-4">
                {contextSummary}
              </Drawer.Body>
            </Drawer.Dialog>
            </Drawer.Content>
          </Drawer.Backdrop>
        </Drawer>
      </div>
    </div>
  );
}

async function buildScopeContext(scopeType: string, scopeRef: string): Promise<ScopeContext | null> {
  if (scopeType === 'scan' && scopeRef) {
    const scan = await getScan(scopeRef);
    const vulnerabilities = (await listVulnerabilities(scopeRef, 1, 12, undefined, undefined, undefined, undefined, 'severity', 'desc')).data ?? [];
    return buildScanContext(scan, vulnerabilities);
  }

  if (scopeType === 'vulnerability' && scopeRef.includes(':')) {
    const [scanId, vulnerabilityId] = scopeRef.split(':', 2);
    const scan = await getScan(scanId);
    const vulnerabilities = (await listVulnerabilities(scanId, 1, 100)).data ?? [];
    const vulnerability = vulnerabilities.find((item) => item.id === vulnerabilityId);
    if (!vulnerability) {
      return buildScanContext(scan, vulnerabilities.slice(0, 12));
    }
    const analysis = await getVulnerabilityContextAnalysis(scanId, vulnerabilityId).catch(() => null);
    const summaryLines = [
      `Scan image: ${scan.image_name}:${scan.image_tag}`,
      `Finding: ${vulnerability.vuln_id}`,
      `Package: ${vulnerability.pkg_name}`,
      `Severity: ${vulnerability.severity}`,
      vulnerability.fixed_version ? `Fixed version: ${vulnerability.fixed_version}` : 'Fixed version: none reported',
      vulnerability.title ? `Title: ${vulnerability.title}` : '',
      vulnerability.description ? `Description: ${truncate(vulnerability.description, 900)}` : '',
      analysis?.summary ? `Context analysis: ${analysis.summary}` : '',
      analysis?.message ? `Provider message: ${analysis.message}` : '',
    ].filter(Boolean);
    return {
      title: vulnerability.vuln_id || 'Vulnerability scope',
      description: `${vulnerability.severity} finding in ${scan.image_name}:${scan.image_tag}`,
      context: summaryLines.join('\n'),
      openHref: `/scans/${scanId}`,
      sources: [
        { resourceType: 'scan', resourceId: scan.id, title: `${scan.image_name}:${scan.image_tag}`, snippet: `Status ${scan.status}. ${scan.critical_count} critical, ${scan.high_count} high.`, url: `/scans/${scan.id}` },
        { resourceType: 'vulnerability', resourceId: vulnerability.id, title: vulnerability.vuln_id, snippet: truncate(vulnerability.description || vulnerability.title || 'No description available', 180) },
      ],
    };
  }

  return {
    title: 'Global workspace context',
    description: 'General JustScan routes and workflows.',
    context: [
      'Core routes: /dashboard, /scans, /watchlist, /vulnkb, /suppressions, /registries, /tags, /orgs, /settings.',
      'Admin route: /admin for administrative users.',
      'New scan flow: /scans?new=1.',
      'Use /watchlist for recurring image monitoring, /vulnkb for vulnerability research, and /suppressions to review accepted risks.',
    ].join('\n'),
    sources: [
      { resourceType: 'route', resourceId: 'scans', title: 'Scans', snippet: 'Create, inspect, compare, and re-run image scans.', url: '/scans' },
      { resourceType: 'route', resourceId: 'registries', title: 'Registries', snippet: 'Manage registry connectivity and credentials.', url: '/registries' },
      { resourceType: 'route', resourceId: 'vulnkb', title: 'Vulnerability KB', snippet: 'Look up curated vulnerability details.', url: '/vulnkb' },
    ],
  };
}

function buildScanContext(scan: Scan, vulnerabilities: Vulnerability[]): ScopeContext {
  const lines = [
    `Image: ${scan.image_name}:${scan.image_tag}`,
    `Status: ${scan.status}`,
    `Digest: ${scan.image_digest || 'unknown'}`,
    `Critical: ${scan.critical_count}`,
    `High: ${scan.high_count}`,
    `Medium: ${scan.medium_count}`,
    `Low: ${scan.low_count}`,
    `Suppressed: ${scan.suppressed_count}`,
  ];

  if (vulnerabilities.length > 0) {
    lines.push('Top findings:');
    for (const vulnerability of vulnerabilities.slice(0, 8)) {
      lines.push(`- ${vulnerability.vuln_id} | ${vulnerability.severity} | ${vulnerability.pkg_name} | fixed ${vulnerability.fixed_version || 'unavailable'}`);
    }
  }

  return {
    title: `${scan.image_name}:${scan.image_tag}`,
    description: `Scan ${scan.status} with ${scan.critical_count + scan.high_count + scan.medium_count + scan.low_count + scan.unknown_count} recorded findings.`,
    context: lines.join('\n'),
    openHref: `/scans/${scan.id}`,
    rescanId: scan.id,
    sources: [
      { resourceType: 'scan', resourceId: scan.id, title: `${scan.image_name}:${scan.image_tag}`, snippet: `Status ${scan.status}. Critical ${scan.critical_count}, High ${scan.high_count}, Medium ${scan.medium_count}.`, url: `/scans/${scan.id}` },
      ...vulnerabilities.slice(0, 3).map((vulnerability) => ({ resourceType: 'vulnerability', resourceId: vulnerability.id, title: vulnerability.vuln_id, snippet: `${vulnerability.severity} in ${vulnerability.pkg_name}. Fixed version: ${vulnerability.fixed_version || 'unavailable'}.` })),
    ],
  };
}

function truncate(value: string, limit: number) {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit).trim()}...`;
}

function renderMessageContent(content: string) {
  return content
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      if (/^#{1,6}\s+/.test(block)) {
        return (
          <p className="text-base font-semibold text-zinc-900 dark:text-zinc-50" key={`${block}-${index}`}>
            {renderInlineMarkdown(block.replace(/^#{1,6}\s+/, ''))}
          </p>
        );
      }

      const lines = block.split('\n');
      if (lines.every((line) => /^[-*]\s+/.test(line.trim()))) {
        return (
          <ul className="list-disc space-y-1 pl-5" key={`${block}-${index}`}>
            {lines.map((line, itemIndex) => (
              <li key={`${line}-${itemIndex}`}>{renderInlineMarkdown(line.trim().replace(/^[-*]\s+/, ''))}</li>
            ))}
          </ul>
        );
      }

      return <p className="whitespace-pre-wrap" key={`${block}-${index}`}>{renderInlineMarkdown(block)}</p>;
    });
}

function renderInlineMarkdown(value: string): ReactNode[] {
  const result: ReactNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\/[a-z0-9?=/_-]+)/gi;
  let lastIndex = 0;

  for (const match of value.matchAll(pattern)) {
    const fullMatch = match[0];
    const start = match.index ?? 0;

    if (start > lastIndex) {
      result.push(value.slice(lastIndex, start));
    }

    if (match[2]) {
      result.push(<strong className="font-semibold text-zinc-900 dark:text-zinc-50" key={`${fullMatch}-${start}`}>{match[2]}</strong>);
    } else if (match[3]) {
      result.push(<code className="rounded bg-zinc-950/5 px-1.5 py-0.5 font-mono text-[0.95em] text-zinc-900 dark:bg-white/10 dark:text-zinc-50" key={`${fullMatch}-${start}`}>{match[3]}</code>);
    } else if (match[4] && match[5]) {
      result.push(renderLinkNode(match[5], match[4], `${fullMatch}-${start}`));
    } else {
      result.push(renderLinkNode(fullMatch, fullMatch, `${fullMatch}-${start}`));
    }

    lastIndex = start + fullMatch.length;
  }

  if (lastIndex < value.length) {
    result.push(value.slice(lastIndex));
  }

  return result;
}

function renderLinkNode(href: string, label: string, key: string) {
  if (/^\/[a-z0-9?=/_-]+$/i.test(href)) {
    return <Link className="text-violet-500 hover:text-violet-400 dark:text-violet-300 dark:hover:text-violet-200" href={href} key={key}>{label}</Link>;
  }
  if (/^https?:\/\//i.test(href)) {
    return <a className="text-violet-500 hover:text-violet-400 dark:text-violet-300 dark:hover:text-violet-200" href={href} key={key} rel="noreferrer" target="_blank">{label}</a>;
  }
  return <span key={key}>{label}</span>;
}

type AssistantActionContext = {
  router: ReturnType<typeof useRouter>;
  scopeContext: ScopeContext | null;
  onQueuedScans: (count: number) => void;
  onQueuedRescan: () => void;
};

async function runAssistantAction(message: string, context: AssistantActionContext): Promise<AssistantActionResult> {
  const directToolCall = parseDirectAssistantToolCall(message, context.scopeContext);
  if (directToolCall) {
    return executeAssistantToolCall(directToolCall, context);
  }

  return { kind: 'ignored' };
}

function parseDirectAssistantToolCall(message: string, scopeContext: ScopeContext | null): AIToolCall | null {
  const scanIntent = extractScanIntent(message);
  if (scanIntent) {
    return {
      name: 'start_scan',
      status: 'pending',
      arguments: {
        images: scanIntent.images,
        wantsXray: scanIntent.wantsXray,
        xrayRepository: scanIntent.xrayRepository,
      },
      confirmationRequired: false,
    };
  }

  if (scopeContext?.rescanId && /^(?:\/rescan|rescan(?: this| current)? scan|rerun(?: this| current)? scan|run this scan again)$/i.test(message.trim())) {
    return {
      name: 'rescan_scope',
      status: 'pending',
      arguments: {},
      confirmationRequired: false,
    };
  }

  const route = resolveAssistantRoute(message, scopeContext);
  if (!route) {
    return null;
  }

  return {
    name: 'open_route',
    status: 'pending',
    arguments: { route },
    confirmationRequired: false,
  };
}

function extractScanIntent(message: string): ScanIntent | null {
  const trimmed = message.trim();
  const wantsXray = /\b(?:xray|artifactory)\b/i.test(trimmed);
  const match = trimmed.match(/^(?:(?:\/scan|scan|start scan|run scan|create scan)(?:\s+(?:for\s+)?)?|(?:start |run |create )?xray scan\s+)(.+)$/i);
  if (!match?.[1]) {
    return null;
  }

  let requestBody = match[1].trim();
  const repositoryMatch = requestBody.match(/\b(?:repo|repository)\s+([a-z0-9._/-]+)\b/i);
  const xrayRepository = repositoryMatch?.[1]?.trim();
  if (repositoryMatch) {
    requestBody = `${requestBody.slice(0, repositoryMatch.index).trim()} ${requestBody.slice((repositoryMatch.index ?? 0) + repositoryMatch[0].length).trim()}`.trim();
  }
  requestBody = requestBody.replace(/\b(?:with|via|using)\s+(?:artifactory\s+)?xray\b/gi, '').trim();

  const images = requestBody
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (images.length === 0) {
    return null;
  }

  return { images, wantsXray, xrayRepository };
}

function resolveAssistantRoute(message: string, scopeContext: ScopeContext | null): string {
  const normalized = message.trim().toLowerCase();
  const routeMap: Array<[RegExp, string]> = [
    [/^(?:\/open|open|go to|navigate to)\s+assistant$/i, '/assistant'],
    [/^(?:\/open|open|go to|navigate to)\s+dashboard$/i, '/dashboard'],
    [/^(?:\/open|open|go to|navigate to)\s+scans?$/i, '/scans'],
    [/^(?:\/open|open|go to|navigate to)\s+registr(?:y|ies)$/i, '/registries'],
    [/^(?:\/open|open|go to|navigate to)\s+watchlist$/i, '/watchlist'],
    [/^(?:\/open|open|go to|navigate to)\s+(?:vuln kb|vulnerability kb|vulnkb)$/i, '/vulnkb'],
    [/^(?:\/open|open|go to|navigate to)\s+suppressions$/i, '/suppressions'],
    [/^(?:\/open|open|go to|navigate to)\s+tags$/i, '/tags'],
    [/^(?:\/open|open|go to|navigate to)\s+orgs?$/i, '/orgs'],
    [/^(?:\/open|open|go to|navigate to)\s+settings$/i, '/settings'],
    [/^(?:\/open|open|go to|navigate to)\s+admin$/i, '/admin'],
    [/^(?:\/open|open|go to|navigate to)\s+admin ai$/i, '/admin/ai'],
    [/^(?:\/open|open|go to|navigate to)\s+admin notifications$/i, '/admin/notifications'],
    [/^(?:\/open|open|go to|navigate to)\s+admin identity$/i, '/admin/identity'],
    [/^(?:\/open|open|go to|navigate to)\s+admin registr(?:y|ies)$/i, '/admin/registries'],
    [/^(?:\/open|open|go to|navigate to)\s+new scan$/i, '/scans?new=1'],
  ];

  const matched = routeMap.find(([pattern]) => pattern.test(normalized))?.[1];
  if (matched) {
    return matched;
  }

  if (/^(?:\/open|open|go to|navigate to)\s+(?:current scope|this scope)$/i.test(normalized)) {
    return scopeContext?.openHref ?? '';
  }
  if (/^(?:\/open|open|go to|navigate to)\s+(?:current scan|this scan)$/i.test(normalized) && scopeContext?.openHref?.startsWith('/scans/')) {
    return scopeContext.openHref;
  }
  const scanMatch = normalized.match(/^(?:\/open|open|go to|navigate to)\s+scan\s+([0-9a-f-]{36})$/i);
  if (scanMatch?.[1]) {
    return `/scans/${scanMatch[1]}`;
  }

  return '';
}

async function executeAssistantToolCall(toolCall: AIToolCall, context: AssistantActionContext): Promise<AssistantActionResult> {
  if (toolCall.name === 'open_route') {
    const route = typeof toolCall.arguments?.route === 'string' ? toolCall.arguments.route.trim() : '';
    if (!route.startsWith('/')) {
      return { kind: 'ignored' };
    }
    context.router.push(route);
    return { kind: 'executed' };
  }

  if (toolCall.name === 'start_scan') {
    const images = Array.isArray(toolCall.arguments?.images)
      ? toolCall.arguments.images.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)
      : [];
    if (images.length === 0) {
      return { kind: 'ignored' };
    }

    const wantsXray = toolCall.arguments?.wantsXray === true;
    const explicitRegistryID = typeof toolCall.arguments?.registryId === 'string' ? toolCall.arguments.registryId.trim() : '';
    const explicitXrayRepository = typeof toolCall.arguments?.xrayRepository === 'string' ? toolCall.arguments.xrayRepository.trim() : '';
    const { data: registries, capabilities } = await listRegistriesWithCapabilities();
    const selectedRegistry = await resolveAssistantScanRegistry({
      capabilities,
      explicitRegistryID,
      images,
      registries,
      wantsXray,
    });

    if (selectedRegistry.kind === 'follow-up') {
      return selectedRegistry;
    }

    let registryID: string | undefined;
    let xrayRepository = explicitXrayRepository;
    if (selectedRegistry.registry) {
      registryID = selectedRegistry.registry.id;
      if (selectedRegistry.registry.scan_provider === 'artifactory_xray') {
        if (!xrayRepository) {
          xrayRepository = selectedRegistry.registry.xray_repository?.trim() || '';
        }
        if (!xrayRepository) {
          const repositoryResolution = await resolveAssistantXrayRepository(selectedRegistry.registry, images);
          if (repositoryResolution.kind === 'follow-up') {
            return repositoryResolution;
          }
          xrayRepository = repositoryResolution.xrayRepository;
        }
      }
    }

    const workScope = getWorkScope();
    const result = await createScans(
      images,
      registryID,
      undefined,
      undefined,
      workScope.kind === 'org' ? workScope.orgId : undefined,
      xrayRepository || undefined,
    );
    const createdScans = Array.isArray(result.scans) ? result.scans : [];
    if (createdScans.length === 0) {
      throw new Error('No scans were queued');
    }
    context.onQueuedScans(createdScans.length);
    context.router.push(createdScans.length === 1 ? `/scans/${createdScans[0].id}` : '/scans');
    return { kind: 'executed' };
  }

  if (toolCall.name === 'rescan_scope' && context.scopeContext?.rescanId) {
    const nextScan = await reScan(context.scopeContext.rescanId);
    context.onQueuedRescan();
    context.router.push(`/scans/${nextScan.id}`);
    return { kind: 'executed' };
  }

  return { kind: 'ignored' };
}

async function resolveAssistantScanRegistry(input: {
  capabilities: { enable_trivy: boolean };
  explicitRegistryID: string;
  images: string[];
  registries: RegistryWithHealth[];
  wantsXray: boolean;
}): Promise<{ kind: 'resolved'; registry: RegistryWithHealth | null } | { kind: 'follow-up'; prompt: LocalAssistantPrompt }> {
  if (input.explicitRegistryID) {
    const explicitRegistry = input.registries.find((registry) => registry.id === input.explicitRegistryID) ?? null;
    return { kind: 'resolved', registry: explicitRegistry };
  }

  if (!input.wantsXray && input.capabilities.enable_trivy) {
    return { kind: 'resolved', registry: null };
  }

  const xrayRegistries = input.registries.filter((registry) => registry.scan_provider === 'artifactory_xray');
  const defaultRegistry = xrayRegistries.find((registry) => registry.is_default) ?? null;
  if (defaultRegistry) {
    return { kind: 'resolved', registry: defaultRegistry };
  }
  if (xrayRegistries.length === 1) {
    return { kind: 'resolved', registry: xrayRegistries[0] };
  }
  if (xrayRegistries.length === 0) {
    return {
      kind: 'follow-up',
      prompt: buildAssistantPrompt(
        `I can't start ${describeImages(input.images)} through Xray yet because no accessible Artifactory Xray registry is configured in this workspace.`,
        [
          { name: 'open_route', status: 'pending', arguments: { route: '/registries' }, confirmationRequired: false },
          { name: 'open_route', status: 'pending', arguments: { route: '/scans?new=1' }, confirmationRequired: false },
        ],
      ),
    };
  }

  return {
    kind: 'follow-up',
    prompt: buildAssistantPrompt(
      `Local Trivy scanning is unavailable here, so I need an Artifactory Xray registry for ${describeImages(input.images)}. Which registry should I use?`,
      [
        ...xrayRegistries.slice(0, 6).map((registry): AIToolCall => ({
          name: 'start_scan',
          status: 'pending',
          arguments: {
            images: input.images,
            registryId: registry.id,
            registryLabel: registry.name,
            wantsXray: true,
            xrayRepository: registry.xray_repository,
          },
          confirmationRequired: false,
        })),
        {
          name: 'open_route',
          status: 'pending',
          arguments: { route: '/registries' },
          confirmationRequired: false,
        },
      ],
    ),
  };
}

async function resolveAssistantXrayRepository(registry: RegistryWithHealth, images: string[]): Promise<{ kind: 'resolved'; xrayRepository: string } | { kind: 'follow-up'; prompt: LocalAssistantPrompt }> {
  const repositories = await listArtifactoryRepositories(registry.id).catch(() => []);
  if (repositories.length === 1) {
    return { kind: 'resolved', xrayRepository: repositories[0].key };
  }
  if (repositories.length > 1) {
    return {
      kind: 'follow-up',
      prompt: buildAssistantPrompt(
        `${registry.name} does not have a default Artifactory repo for ${describeImages(images)}. Which repo should I use?`,
        [
          ...repositories.slice(0, 6).map((repository): AIToolCall => ({
            name: 'start_scan',
            status: 'pending',
            arguments: {
              images,
              registryId: registry.id,
              registryLabel: registry.name,
              wantsXray: true,
              xrayRepository: repository.key,
            },
            confirmationRequired: false,
          })),
          {
            name: 'open_route',
            status: 'pending',
            arguments: { route: '/registries' },
            confirmationRequired: false,
          },
        ],
      ),
    };
  }

  return {
    kind: 'follow-up',
    prompt: buildAssistantPrompt(
      `${registry.name} needs an Artifactory repo before I can queue ${describeImages(images)} through Xray. Reply with something like \`scan ${images[0]} with xray repo docker-remote\`, or open Registries to verify the repo key.`,
      [{ name: 'open_route', status: 'pending', arguments: { route: '/registries' }, confirmationRequired: false }],
    ),
  };
}

function buildAssistantPrompt(content: string, toolCalls: AIToolCall[]): LocalAssistantPrompt {
  return {
    id: `local-${Math.random().toString(36).slice(2, 10)}`,
    role: 'assistant',
    content,
    toolCalls,
  };
}

function describeImages(images: string[]) {
  if (images.length === 0) {
    return 'this scan';
  }
  if (images.length === 1) {
    return `scan ${images[0]}`;
  }
  return `${images.length} scans`;
}

function toolCallKey(messageID: string, index: number) {
  return `${messageID}:${index}`;
}

function toolCallLabel(toolCall: AIToolCall, status: string) {
  if (status === 'running') {
    return 'Running…';
  }
  if (status === 'completed') {
    return 'Completed';
  }
  if (status === 'needs-input') {
    return 'Needs info';
  }

  if (toolCall.name === 'start_scan') {
    const images = Array.isArray(toolCall.arguments?.images)
      ? toolCall.arguments.images.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)
      : [];
    const registryLabel = typeof toolCall.arguments?.registryLabel === 'string' ? toolCall.arguments.registryLabel.trim() : '';
    const xrayRepository = typeof toolCall.arguments?.xrayRepository === 'string' ? toolCall.arguments.xrayRepository.trim() : '';
    if (registryLabel && xrayRepository) {
      return `Use ${registryLabel} / ${xrayRepository}`;
    }
    if (registryLabel) {
      return `Use ${registryLabel}`;
    }
    return images.length > 1 ? `Start ${images.length} scans` : `Start scan${images[0] ? `: ${images[0]}` : ''}`;
  }
  if (toolCall.name === 'open_route') {
    const route = typeof toolCall.arguments?.route === 'string' ? toolCall.arguments.route : '';
    return route ? `Open ${route}` : 'Open route';
  }
  if (toolCall.name === 'rescan_scope') {
    return 'Re-scan current scope';
  }
  return 'Run action';
}