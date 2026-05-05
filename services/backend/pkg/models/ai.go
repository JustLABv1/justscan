package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type AIProviderSettings struct {
	bun.BaseModel `bun:"table:ai_provider_settings,alias:aip"`

	ProviderKey      string    `bun:"provider_key,pk" json:"providerKey"`
	ProviderType     string    `bun:"provider_type,notnull,default:'openai-compatible'" json:"providerType"`
	Label            string    `bun:"label,notnull,default:''" json:"label"`
	BaseURL          string    `bun:"base_url,notnull,default:''" json:"baseUrl"`
	APIPath          string    `bun:"api_path,notnull,default:''" json:"apiPath"`
	APIVersion       string    `bun:"api_version,notnull,default:''" json:"apiVersion"`
	Region           string    `bun:"region,notnull,default:''" json:"region"`
	Organization     string    `bun:"organization,notnull,default:''" json:"organization"`
	ChatModel        string    `bun:"chat_model,notnull,default:''" json:"chatModel"`
	EmbeddingModel   string    `bun:"embedding_model,notnull,default:''" json:"embeddingModel"`
	EncryptedToken   string    `bun:"encrypted_token,notnull,default:''" json:"-"`
	TokenNonce       string    `bun:"token_nonce,notnull,default:''" json:"-"`
	TokenKeyVersion  string    `bun:"token_key_version,notnull,default:'v1'" json:"tokenKeyVersion"`
	TokenConfigured  bool      `bun:"token_configured,notnull,default:false" json:"tokenConfigured"`
	Enabled          bool      `bun:"enabled,notnull,default:true" json:"enabled"`
	IsDefault        bool      `bun:"is_default,notnull,default:false" json:"isDefault"`
	TimeoutSeconds   int       `bun:"timeout_seconds,notnull,default:30" json:"timeoutSeconds"`
	MaxContextTokens int       `bun:"max_context_tokens,notnull,default:6000" json:"maxContextTokens"`
	MaxOutputTokens  int       `bun:"max_output_tokens,notnull,default:1200" json:"maxOutputTokens"`
	Temperature      float64   `bun:"temperature,notnull,default:0.2" json:"temperature"`
	CreatedAt        time.Time `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`
	UpdatedAt        time.Time `bun:"updated_at,notnull,default:current_timestamp" json:"updatedAt"`
}

type AIProviderAdminResponse struct {
	ProviderKey      string  `json:"providerKey"`
	ProviderType     string  `json:"providerType"`
	Label            string  `json:"label"`
	BaseURL          string  `json:"baseUrl"`
	APIPath          string  `json:"apiPath"`
	APIVersion       string  `json:"apiVersion"`
	Region           string  `json:"region"`
	Organization     string  `json:"organization"`
	ChatModel        string  `json:"chatModel"`
	EmbeddingModel   string  `json:"embeddingModel"`
	Enabled          bool    `json:"enabled"`
	IsDefault        bool    `json:"isDefault"`
	Configured       bool    `json:"configured"`
	TokenConfigured  bool    `json:"tokenConfigured"`
	RequiresToken    bool    `json:"requiresToken"`
	Local            bool    `json:"local"`
	TimeoutSeconds   int     `json:"timeoutSeconds"`
	MaxContextTokens int     `json:"maxContextTokens"`
	MaxOutputTokens  int     `json:"maxOutputTokens"`
	Temperature      float64 `json:"temperature"`
}

type AIProviderSummary struct {
	Key             string `json:"key"`
	Type            string `json:"type"`
	Label           string `json:"label"`
	ChatModel       string `json:"chatModel"`
	BaseURL         string `json:"baseUrl,omitempty"`
	Default         bool   `json:"default"`
	TokenConfigured bool   `json:"tokenConfigured"`
	Local           bool   `json:"local"`
}

type AISupportedProvider struct {
	Type          string `json:"type"`
	Label         string `json:"label"`
	RequiresToken bool   `json:"requiresToken"`
	Local         bool   `json:"local"`
	DefaultURL    string `json:"defaultUrl,omitempty"`
	DefaultModel  string `json:"defaultModel,omitempty"`
}

type AIConversation struct {
	bun.BaseModel `bun:"table:ai_conversations,alias:aic"`

	ID          uuid.UUID   `bun:"id,pk,type:uuid,default:gen_random_uuid()" json:"id"`
	UserID      *uuid.UUID  `bun:"user_id,type:uuid" json:"userId,omitempty"`
	OwnerUserID *uuid.UUID  `bun:"owner_user_id,type:uuid" json:"ownerUserId,omitempty"`
	OwnerOrgID  *uuid.UUID  `bun:"owner_org_id,type:uuid" json:"ownerOrgId,omitempty"`
	Title       string      `bun:"title,notnull,default:''" json:"title"`
	ScopeType   string      `bun:"scope_type,notnull,default:''" json:"scopeType"`
	ScopeRef    string      `bun:"scope_ref,notnull,default:''" json:"scopeRef"`
	CreatedAt   time.Time   `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`
	UpdatedAt   time.Time   `bun:"updated_at,notnull,default:current_timestamp" json:"updatedAt"`
	Messages    []AIMessage `bun:"rel:has-many,join:id=conversation_id" json:"messages,omitempty"`
}

type AIMessageSource struct {
	ResourceType string  `json:"resourceType"`
	ResourceID   string  `json:"resourceId"`
	Title        string  `json:"title"`
	Snippet      string  `json:"snippet"`
	URL          string  `json:"url,omitempty"`
	Score        float64 `json:"score,omitempty"`
}

type AIToolCall struct {
	Name                 string         `json:"name"`
	Status               string         `json:"status"`
	Arguments            map[string]any `json:"arguments,omitempty"`
	Result               map[string]any `json:"result,omitempty"`
	ConfirmationRequired bool           `json:"confirmationRequired"`
	Error                string         `json:"error,omitempty"`
}

type AIMessage struct {
	bun.BaseModel `bun:"table:ai_messages,alias:aim"`

	ID             uuid.UUID         `bun:"id,pk,type:uuid,default:gen_random_uuid()" json:"id"`
	ConversationID uuid.UUID         `bun:"conversation_id,type:uuid,notnull" json:"conversationId"`
	Role           string            `bun:"role,notnull" json:"role"`
	Content        string            `bun:"content,notnull" json:"content"`
	ProviderKey    string            `bun:"provider_key,notnull,default:''" json:"providerKey"`
	ProviderType   string            `bun:"provider_type,notnull,default:''" json:"providerType"`
	Model          string            `bun:"model,notnull,default:''" json:"model"`
	PromptTokens   int               `bun:"prompt_tokens,notnull,default:0" json:"promptTokens"`
	ResponseTokens int               `bun:"response_tokens,notnull,default:0" json:"responseTokens"`
	Sources        []AIMessageSource `bun:"sources,type:jsonb,notnull,default:'[]'" json:"sources"`
	ToolCalls      []AIToolCall      `bun:"tool_calls,type:jsonb,notnull,default:'[]'" json:"toolCalls"`
	Error          string            `bun:"error,notnull,default:''" json:"error"`
	CreatedAt      time.Time         `bun:"created_at,notnull,default:current_timestamp" json:"createdAt"`
}

type AIKnowledgeChunk struct {
	bun.BaseModel `bun:"table:ai_knowledge_chunks,alias:aikc"`

	ID                 uuid.UUID         `bun:"id,pk,type:uuid,default:gen_random_uuid()" json:"id"`
	OwnerUserID        *uuid.UUID        `bun:"owner_user_id,type:uuid" json:"ownerUserId,omitempty"`
	OwnerOrgID         *uuid.UUID        `bun:"owner_org_id,type:uuid" json:"ownerOrgId,omitempty"`
	ResourceType       string            `bun:"resource_type,notnull" json:"resourceType"`
	ResourceID         string            `bun:"resource_id,notnull" json:"resourceId"`
	ParentResourceType string            `bun:"parent_resource_type,notnull,default:''" json:"parentResourceType"`
	ParentResourceID   string            `bun:"parent_resource_id,notnull,default:''" json:"parentResourceId"`
	Title              string            `bun:"title,notnull,default:''" json:"title"`
	Content            string            `bun:"content,notnull" json:"content"`
	SearchText         string            `bun:"search_text,notnull,default:''" json:"searchText"`
	Metadata           map[string]string `bun:"metadata,type:jsonb,notnull,default:'{}'" json:"metadata"`
	ContentHash        string            `bun:"content_hash,notnull" json:"contentHash"`
	SourceUpdatedAt    time.Time         `bun:"source_updated_at,nullzero" json:"sourceUpdatedAt"`
	IndexedAt          time.Time         `bun:"indexed_at,notnull,default:current_timestamp" json:"indexedAt"`
}
