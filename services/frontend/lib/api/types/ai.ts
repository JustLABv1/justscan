export interface AISettings {
  enabled: boolean;
  allowAnonymous: boolean;
  defaultProviderKey: string;
  defaultTimeoutSeconds: number;
  maxContextResults: number;
  supportedProviderCount?: number;
}

export interface AISupportedProvider {
  type: string;
  label: string;
  requiresToken: boolean;
  local: boolean;
  defaultUrl?: string;
  defaultModel?: string;
}

export interface AIProviderAdmin {
  providerKey: string;
  providerType: string;
  label: string;
  baseUrl: string;
  apiPath: string;
  apiVersion: string;
  region: string;
  organization: string;
  chatModel: string;
  embeddingModel: string;
  enabled: boolean;
  isDefault: boolean;
  configured: boolean;
  tokenConfigured: boolean;
  requiresToken: boolean;
  local: boolean;
  timeoutSeconds: number;
  maxContextTokens: number;
  maxOutputTokens: number;
  temperature: number;
}

export interface AIProviderSummary {
  key: string;
  type: string;
  label: string;
  chatModel: string;
  baseUrl?: string;
  default: boolean;
  tokenConfigured: boolean;
  local: boolean;
}

export interface AIMessageSource {
  resourceType: string;
  resourceId: string;
  title: string;
  snippet: string;
  url?: string;
  score?: number;
}

export interface AIToolCall {
  name: string;
  status: string;
  arguments?: Record<string, unknown>;
  result?: Record<string, unknown>;
  confirmationRequired: boolean;
  error?: string;
}

export interface AIMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | string;
  content: string;
  providerKey: string;
  providerType: string;
  model: string;
  promptTokens: number;
  responseTokens: number;
  sources: AIMessageSource[];
  toolCalls: AIToolCall[];
  error: string;
  createdAt: string;
}

export interface AIConversation {
  id: string;
  userId?: string | null;
  ownerUserId?: string | null;
  ownerOrgId?: string | null;
  title: string;
  scopeType: string;
  scopeRef: string;
  createdAt: string;
  updatedAt: string;
  messages?: AIMessage[];
}

export interface AIProviderTestResult {
  result: string;
  providerKey: string;
  providerType: string;
  capabilities: {
    streaming: boolean;
    embeddings: boolean;
    local: boolean;
  };
}