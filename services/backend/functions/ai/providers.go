package ai

import (
	"context"
	"errors"
	"strings"

	"justscan-backend/config"
	"justscan-backend/pkg/models"

	"github.com/uptrace/bun"
)

var ErrProviderNotConfigured = errors.New("no enabled AI provider is configured")

const (
	ProviderTypeOpenAI           = "openai"
	ProviderTypeAzureOpenAI      = "azure-openai"
	ProviderTypeAnthropic        = "anthropic"
	ProviderTypeGemini           = "gemini"
	ProviderTypeMistral          = "mistral"
	ProviderTypeCohere           = "cohere"
	ProviderTypeOllama           = "ollama"
	ProviderTypeVLLM             = "vllm"
	ProviderTypeOpenAICompatible = "openai-compatible"
	ProviderTypeOpenRouter       = "openrouter"
	ProviderTypeLMStudio         = "lmstudio"
	ProviderTypeTogether         = "together"
)

func NormalizeProviderType(providerType string) string {
	normalized := strings.ToLower(strings.TrimSpace(providerType))
	normalized = strings.ReplaceAll(normalized, "_", "-")
	normalized = strings.ReplaceAll(normalized, " ", "-")
	switch normalized {
	case "", "custom", "compatible":
		return ProviderTypeOpenAICompatible
	case "azure", "azure-open-ai":
		return ProviderTypeAzureOpenAI
	case "google", "google-gemini":
		return ProviderTypeGemini
	case "lm-studio":
		return ProviderTypeLMStudio
	default:
		return normalized
	}
}

func IsProviderTypeSupported(providerType string) bool {
	switch NormalizeProviderType(providerType) {
	case ProviderTypeOpenAI, ProviderTypeAzureOpenAI, ProviderTypeAnthropic, ProviderTypeGemini, ProviderTypeMistral, ProviderTypeCohere, ProviderTypeOllama, ProviderTypeVLLM, ProviderTypeOpenAICompatible, ProviderTypeOpenRouter, ProviderTypeLMStudio, ProviderTypeTogether:
		return true
	default:
		return false
	}
}

func ProviderTypeRequiresToken(providerType string) bool {
	switch NormalizeProviderType(providerType) {
	case ProviderTypeOllama, ProviderTypeVLLM, ProviderTypeLMStudio, ProviderTypeOpenAICompatible:
		return false
	default:
		return true
	}
}

func ProviderTypeIsLocal(providerType string) bool {
	switch NormalizeProviderType(providerType) {
	case ProviderTypeOllama, ProviderTypeVLLM, ProviderTypeLMStudio:
		return true
	default:
		return false
	}
}

func DefaultBaseURL(providerType string) string {
	switch NormalizeProviderType(providerType) {
	case ProviderTypeOpenAI:
		return "https://api.openai.com/v1"
	case ProviderTypeAnthropic:
		return "https://api.anthropic.com"
	case ProviderTypeGemini:
		return "https://generativelanguage.googleapis.com"
	case ProviderTypeMistral:
		return "https://api.mistral.ai/v1"
	case ProviderTypeCohere:
		return "https://api.cohere.com"
	case ProviderTypeOllama:
		return "http://localhost:11434"
	case ProviderTypeVLLM:
		return "http://localhost:8000/v1"
	case ProviderTypeOpenRouter:
		return "https://openrouter.ai/api/v1"
	case ProviderTypeLMStudio:
		return "http://localhost:1234/v1"
	case ProviderTypeTogether:
		return "https://api.together.xyz/v1"
	default:
		return ""
	}
}

func DefaultChatModel(providerType string) string {
	switch NormalizeProviderType(providerType) {
	case ProviderTypeOpenAI, ProviderTypeOpenAICompatible, ProviderTypeOpenRouter, ProviderTypeTogether:
		return "gpt-4o-mini"
	case ProviderTypeAnthropic:
		return "claude-3-5-haiku-latest"
	case ProviderTypeGemini:
		return "gemini-1.5-flash"
	case ProviderTypeMistral:
		return "mistral-small-latest"
	case ProviderTypeCohere:
		return "command-r"
	case ProviderTypeOllama:
		return "llama3.1"
	case ProviderTypeVLLM, ProviderTypeLMStudio:
		return "local-model"
	default:
		return ""
	}
}

func SupportedProviders() []models.AISupportedProvider {
	providerTypes := []string{
		ProviderTypeOpenAI,
		ProviderTypeAzureOpenAI,
		ProviderTypeAnthropic,
		ProviderTypeGemini,
		ProviderTypeMistral,
		ProviderTypeCohere,
		ProviderTypeOllama,
		ProviderTypeVLLM,
		ProviderTypeOpenAICompatible,
		ProviderTypeOpenRouter,
		ProviderTypeLMStudio,
		ProviderTypeTogether,
	}

	providers := make([]models.AISupportedProvider, 0, len(providerTypes))
	for _, providerType := range providerTypes {
		providers = append(providers, models.AISupportedProvider{
			Type:          providerType,
			Label:         ProviderTypeLabel(providerType),
			RequiresToken: ProviderTypeRequiresToken(providerType),
			Local:         ProviderTypeIsLocal(providerType),
			DefaultURL:    DefaultBaseURL(providerType),
			DefaultModel:  DefaultChatModel(providerType),
		})
	}
	return providers
}

func ProviderTypeLabel(providerType string) string {
	switch NormalizeProviderType(providerType) {
	case ProviderTypeAzureOpenAI:
		return "Azure OpenAI"
	case ProviderTypeOpenAICompatible:
		return "OpenAI Compatible"
	case ProviderTypeOpenRouter:
		return "OpenRouter"
	case ProviderTypeLMStudio:
		return "LM Studio"
	default:
		normalized := NormalizeProviderType(providerType)
		parts := strings.Split(normalized, "-")
		for index, part := range parts {
			if part == "ai" {
				parts[index] = "AI"
				continue
			}
			parts[index] = strings.ToUpper(part[:1]) + part[1:]
		}
		return strings.Join(parts, " ")
	}
}

func ProviderLabel(record models.AIProviderSettings) string {
	label := strings.TrimSpace(record.Label)
	if label != "" {
		return label
	}
	if strings.TrimSpace(record.ProviderKey) != "" {
		return record.ProviderKey
	}
	return ProviderTypeLabel(record.ProviderType)
}

func ListProviderSettings(ctx context.Context, db *bun.DB) ([]models.AIProviderSettings, error) {
	providers := make([]models.AIProviderSettings, 0)
	if db == nil {
		return providers, nil
	}
	if err := db.NewSelect().Model(&providers).Order("provider_key ASC").Scan(ctx); err != nil {
		return nil, err
	}
	return providers, nil
}

func LoadProviderSettings(ctx context.Context, db *bun.DB, providerKey string) (models.AIProviderSettings, bool, error) {
	var provider models.AIProviderSettings
	if err := db.NewSelect().Model(&provider).Where("LOWER(provider_key) = LOWER(?)", strings.TrimSpace(providerKey)).Scan(ctx); err != nil {
		if strings.Contains(err.Error(), "no rows") {
			return models.AIProviderSettings{}, false, nil
		}
		return models.AIProviderSettings{}, false, err
	}
	return provider, true, nil
}

func ListAdminProviders(ctx context.Context, db *bun.DB) ([]models.AIProviderAdminResponse, error) {
	providers, err := ListProviderSettings(ctx, db)
	if err != nil {
		return nil, err
	}

	response := make([]models.AIProviderAdminResponse, 0, len(providers))
	for _, provider := range providers {
		response = append(response, ToAdminResponse(provider))
	}
	return response, nil
}

func ListEnabledProviderSummaries(ctx context.Context, db *bun.DB) ([]models.AIProviderSummary, error) {
	providers, err := ListProviderSettings(ctx, db)
	if err != nil {
		return nil, err
	}

	summaries := make([]models.AIProviderSummary, 0, len(providers))
	for _, provider := range providers {
		providerType := NormalizeProviderType(provider.ProviderType)
		if !provider.Enabled {
			continue
		}
		if ProviderTypeRequiresToken(providerType) && !providerHasToken(provider) {
			continue
		}
		summaries = append(summaries, ToSummary(provider))
	}
	return summaries, nil
}

func RuntimeFromRecord(conf *config.RestfulConf, record models.AIProviderSettings) (ProviderRuntime, error) {
	providerType := NormalizeProviderType(record.ProviderType)
	if !record.Enabled {
		return ProviderRuntime{}, errors.New("provider is disabled")
	}
	if ProviderTypeRequiresToken(providerType) && !providerHasToken(record) {
		return ProviderRuntime{}, errors.New("provider token is not configured")
	}

	token, err := DecryptProviderToken(conf, record.EncryptedToken, record.TokenNonce, record.TokenKeyVersion)
	if err != nil {
		return ProviderRuntime{}, err
	}

	timeoutSeconds := providerTimeout(record.TimeoutSeconds)
	if conf != nil && conf.AI.DefaultTimeoutSeconds > 0 && record.TimeoutSeconds <= 0 {
		timeoutSeconds = conf.AI.DefaultTimeoutSeconds
	}

	return ProviderRuntime{
		Key:              strings.TrimSpace(record.ProviderKey),
		Type:             providerType,
		Label:            ProviderLabel(record),
		BaseURL:          providerBaseURL(providerType, record.BaseURL),
		APIPath:          strings.TrimSpace(record.APIPath),
		APIVersion:       strings.TrimSpace(record.APIVersion),
		Region:           strings.TrimSpace(record.Region),
		Organization:     strings.TrimSpace(record.Organization),
		Token:            strings.TrimSpace(token),
		ChatModel:        providerChatModel(providerType, record.ChatModel),
		EmbeddingModel:   strings.TrimSpace(record.EmbeddingModel),
		Enabled:          record.Enabled,
		IsDefault:        record.IsDefault,
		TimeoutSeconds:   timeoutSeconds,
		MaxContextTokens: providerMaxContextTokens(record.MaxContextTokens),
		MaxOutputTokens:  providerMaxOutputTokens(record.MaxOutputTokens),
		Temperature:      providerTemperature(record.Temperature),
	}, nil
}

func ResolveProvider(ctx context.Context, db *bun.DB, requestedKey string) (ProviderRuntime, error) {
	record, err := ResolveProviderRecord(ctx, db, requestedKey)
	if err != nil {
		return ProviderRuntime{}, err
	}
	return RuntimeFromRecord(config.GetConfigInstance(), record)
}

func ResolveProviderRecord(ctx context.Context, db *bun.DB, requestedKey string) (models.AIProviderSettings, error) {
	if db == nil {
		return models.AIProviderSettings{}, ErrProviderNotConfigured
	}

	trimmedKey := strings.TrimSpace(requestedKey)
	if trimmedKey != "" {
		record, found, err := LoadProviderSettings(ctx, db, trimmedKey)
		if err != nil {
			return models.AIProviderSettings{}, err
		}
		if !found {
			return models.AIProviderSettings{}, ErrProviderNotConfigured
		}
		return record, nil
	}

	providers, err := ListProviderSettings(ctx, db)
	if err != nil {
		return models.AIProviderSettings{}, err
	}

	conf := config.GetConfigInstance()
	defaultKey := ""
	if conf != nil {
		defaultKey = strings.TrimSpace(conf.AI.DefaultProviderKey)
	}

	var fallback *models.AIProviderSettings
	for index := range providers {
		provider := providers[index]
		providerType := NormalizeProviderType(provider.ProviderType)
		if !provider.Enabled {
			continue
		}
		if ProviderTypeRequiresToken(providerType) && !providerHasToken(provider) {
			continue
		}
		if defaultKey != "" && strings.EqualFold(provider.ProviderKey, defaultKey) {
			return provider, nil
		}
		if provider.IsDefault {
			return provider, nil
		}
		if fallback == nil {
			fallback = &providers[index]
		}
	}

	if fallback != nil {
		return *fallback, nil
	}
	return models.AIProviderSettings{}, ErrProviderNotConfigured
}

func ToAdminResponse(record models.AIProviderSettings) models.AIProviderAdminResponse {
	providerType := NormalizeProviderType(record.ProviderType)
	tokenConfigured := providerHasToken(record)
	return models.AIProviderAdminResponse{
		ProviderKey:      strings.TrimSpace(record.ProviderKey),
		ProviderType:     providerType,
		Label:            ProviderLabel(record),
		BaseURL:          providerBaseURL(providerType, record.BaseURL),
		APIPath:          strings.TrimSpace(record.APIPath),
		APIVersion:       strings.TrimSpace(record.APIVersion),
		Region:           strings.TrimSpace(record.Region),
		Organization:     strings.TrimSpace(record.Organization),
		ChatModel:        providerChatModel(providerType, record.ChatModel),
		EmbeddingModel:   strings.TrimSpace(record.EmbeddingModel),
		Enabled:          record.Enabled,
		IsDefault:        record.IsDefault,
		Configured:       record.Enabled && (!ProviderTypeRequiresToken(providerType) || tokenConfigured),
		TokenConfigured:  tokenConfigured,
		RequiresToken:    ProviderTypeRequiresToken(providerType),
		Local:            ProviderTypeIsLocal(providerType),
		TimeoutSeconds:   providerTimeout(record.TimeoutSeconds),
		MaxContextTokens: providerMaxContextTokens(record.MaxContextTokens),
		MaxOutputTokens:  providerMaxOutputTokens(record.MaxOutputTokens),
		Temperature:      providerTemperature(record.Temperature),
	}
}

func ToSummary(record models.AIProviderSettings) models.AIProviderSummary {
	providerType := NormalizeProviderType(record.ProviderType)
	return models.AIProviderSummary{
		Key:             strings.TrimSpace(record.ProviderKey),
		Type:            providerType,
		Label:           ProviderLabel(record),
		ChatModel:       providerChatModel(providerType, record.ChatModel),
		BaseURL:         providerBaseURL(providerType, record.BaseURL),
		Default:         record.IsDefault,
		TokenConfigured: providerHasToken(record),
		Local:           ProviderTypeIsLocal(providerType),
	}
}

func providerHasToken(record models.AIProviderSettings) bool {
	return record.TokenConfigured || strings.TrimSpace(record.EncryptedToken) != ""
}

func providerBaseURL(providerType string, baseURL string) string {
	trimmed := strings.TrimSpace(baseURL)
	if trimmed != "" {
		return trimmed
	}
	return DefaultBaseURL(providerType)
}

func providerChatModel(providerType string, chatModel string) string {
	trimmed := strings.TrimSpace(chatModel)
	if trimmed != "" {
		return trimmed
	}
	return DefaultChatModel(providerType)
}

func providerTimeout(value int) int {
	if value > 0 {
		return value
	}
	return 30
}

func providerMaxContextTokens(value int) int {
	if value > 0 {
		return value
	}
	return 6000
}

func providerMaxOutputTokens(value int) int {
	if value > 0 {
		return value
	}
	return 1200
}

func providerTemperature(value float64) float64 {
	if value >= 0 {
		return value
	}
	return 0.2
}
