import { req } from './core';
import type { AIConversation, AIMessage, AIMessageSource, AIProviderSummary, AISettings } from './types/ai';

export const getAISettings = () =>
  req<AISettings>('GET', '/api/v1/ai/settings');

export const listAIProviders = () =>
  req<{ providers: AIProviderSummary[] }>('GET', '/api/v1/ai/providers').then((result) => result.providers ?? []);

export const listAIConversations = (scopeType?: string, scopeRef?: string) => {
  const params = new URLSearchParams();
  if (scopeType) params.set('scopeType', scopeType);
  if (scopeRef) params.set('scopeRef', scopeRef);
  const suffix = params.toString() ? `?${params}` : '';
  return req<{ conversations: AIConversation[] }>('GET', `/api/v1/ai/conversations${suffix}`).then((result) => result.conversations ?? []);
};

export const createAIConversation = (data: { title?: string; scopeType?: string; scopeRef?: string }) =>
  req<AIConversation>('POST', '/api/v1/ai/conversations', data);

export const getAIConversation = (id: string) =>
  req<AIConversation>('GET', `/api/v1/ai/conversations/${encodeURIComponent(id)}`);

export const deleteAIConversation = (id: string) =>
  req<{ result: string }>('DELETE', `/api/v1/ai/conversations/${encodeURIComponent(id)}`);

export const sendAIConversationMessage = (id: string, data: { providerKey?: string; message: string; context?: string; sources?: AIMessageSource[] }) =>
  req<{ conversation: AIConversation; message: AIMessage }>('POST', `/api/v1/ai/conversations/${encodeURIComponent(id)}/messages`, data);