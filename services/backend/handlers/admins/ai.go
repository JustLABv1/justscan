package admins

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"justscan-backend/config"
	aifuncs "justscan-backend/functions/ai"
	"justscan-backend/functions/audit"
	"justscan-backend/middlewares"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type createAIProviderRequest struct {
	ProviderKey      string   `json:"providerKey"`
	ProviderType     string   `json:"providerType"`
	Label            string   `json:"label"`
	BaseURL          string   `json:"baseUrl"`
	APIPath          string   `json:"apiPath"`
	APIVersion       string   `json:"apiVersion"`
	Region           string   `json:"region"`
	Organization     string   `json:"organization"`
	Token            string   `json:"token"`
	ChatModel        string   `json:"chatModel"`
	EmbeddingModel   string   `json:"embeddingModel"`
	Enabled          *bool    `json:"enabled"`
	IsDefault        *bool    `json:"isDefault"`
	TimeoutSeconds   int      `json:"timeoutSeconds"`
	MaxContextTokens int      `json:"maxContextTokens"`
	MaxOutputTokens  int      `json:"maxOutputTokens"`
	Temperature      *float64 `json:"temperature"`
}

type updateAIProviderRequest struct {
	Label            *string  `json:"label"`
	BaseURL          *string  `json:"baseUrl"`
	APIPath          *string  `json:"apiPath"`
	APIVersion       *string  `json:"apiVersion"`
	Region           *string  `json:"region"`
	Organization     *string  `json:"organization"`
	Token            *string  `json:"token"`
	ClearToken       bool     `json:"clearToken"`
	ChatModel        *string  `json:"chatModel"`
	EmbeddingModel   *string  `json:"embeddingModel"`
	Enabled          *bool    `json:"enabled"`
	IsDefault        *bool    `json:"isDefault"`
	TimeoutSeconds   *int     `json:"timeoutSeconds"`
	MaxContextTokens *int     `json:"maxContextTokens"`
	MaxOutputTokens  *int     `json:"maxOutputTokens"`
	Temperature      *float64 `json:"temperature"`
}

type testAIProviderRequest struct {
	ProviderKey string `json:"providerKey"`
}

type updateAISettingsRequest struct {
	Enabled        *bool `json:"enabled"`
	AllowAnonymous *bool `json:"allowAnonymous"`
}

func GetAISettings(c *gin.Context) {
	settings := aifuncs.EffectiveSettings(config.GetConfigInstance())
	c.JSON(http.StatusOK, gin.H{
		"enabled":                settings.Enabled,
		"allowAnonymous":         settings.AllowAnonymous,
		"defaultProviderKey":     settings.DefaultProviderKey,
		"defaultTimeoutSeconds":  settings.DefaultTimeoutSeconds,
		"maxContextResults":      settings.MaxContextResults,
		"supportedProviderCount": len(aifuncs.SupportedProviders()),
	})
}

func UpdateAISettings(c *gin.Context, db *bun.DB) {
	var req updateAISettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Enabled == nil && req.AllowAnonymous == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no AI settings provided"})
		return
	}

	if req.Enabled != nil {
		if err := persistAISetting(c, db, "ai.enabled", *req.Enabled); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update AI enabled setting"})
			return
		}
	}
	if req.AllowAnonymous != nil {
		if err := persistAISetting(c, db, "ai.allow_anonymous", *req.AllowAnonymous); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update anonymous AI setting"})
			return
		}
	}

	settings := aifuncs.EffectiveSettings(config.GetConfigInstance())
	writeAIAudit(c, db, "settings.ai.update", "updated AI settings")
	c.JSON(http.StatusOK, gin.H{
		"enabled":                settings.Enabled,
		"allowAnonymous":         settings.AllowAnonymous,
		"defaultProviderKey":     settings.DefaultProviderKey,
		"defaultTimeoutSeconds":  settings.DefaultTimeoutSeconds,
		"maxContextResults":      settings.MaxContextResults,
		"supportedProviderCount": len(aifuncs.SupportedProviders()),
	})
}

func ListAIProviders(c *gin.Context, db *bun.DB) {
	providers, err := aifuncs.ListAdminProviders(c.Request.Context(), db)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list AI providers"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"providers": providers,
	})
}

func ListAISupportedProviders(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"providers": aifuncs.SupportedProviders(),
	})
}

func CreateAIProvider(c *gin.Context, db *bun.DB) {
	var req createAIProviderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	providerKey := strings.TrimSpace(req.ProviderKey)
	if providerKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "providerKey is required"})
		return
	}
	providerType := aifuncs.NormalizeProviderType(req.ProviderType)
	if !aifuncs.IsProviderTypeSupported(providerType) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported providerType"})
		return
	}
	if aifuncs.ProviderTypeRequiresToken(providerType) && strings.TrimSpace(req.Token) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token is required for this provider type"})
		return
	}

	if _, found, err := aifuncs.LoadProviderSettings(c.Request.Context(), db, providerKey); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load AI provider"})
		return
	} else if found {
		c.JSON(http.StatusConflict, gin.H{"error": "provider already exists"})
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	isDefault := false
	if req.IsDefault != nil {
		isDefault = *req.IsDefault
	}
	temperature := 0.2
	if req.Temperature != nil {
		temperature = *req.Temperature
	}
	if temperature < 0 || temperature > 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "temperature must be between 0 and 2"})
		return
	}

	encryptedToken, tokenNonce, tokenKeyVersion, err := encryptRequestedProviderToken(strings.TrimSpace(req.Token))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encrypt AI provider token"})
		return
	}

	now := time.Now().UTC()
	provider := &models.AIProviderSettings{
		ProviderKey:      providerKey,
		ProviderType:     providerType,
		Label:            strings.TrimSpace(req.Label),
		BaseURL:          normalizeProviderBaseURL(providerType, req.BaseURL),
		APIPath:          strings.TrimSpace(req.APIPath),
		APIVersion:       strings.TrimSpace(req.APIVersion),
		Region:           strings.TrimSpace(req.Region),
		Organization:     strings.TrimSpace(req.Organization),
		ChatModel:        normalizeProviderChatModel(providerType, req.ChatModel),
		EmbeddingModel:   strings.TrimSpace(req.EmbeddingModel),
		EncryptedToken:   encryptedToken,
		TokenNonce:       tokenNonce,
		TokenKeyVersion:  tokenKeyVersion,
		TokenConfigured:  encryptedToken != "",
		Enabled:          enabled,
		IsDefault:        isDefault,
		TimeoutSeconds:   normalizePositiveInt(req.TimeoutSeconds, 30),
		MaxContextTokens: normalizePositiveInt(req.MaxContextTokens, 6000),
		MaxOutputTokens:  normalizePositiveInt(req.MaxOutputTokens, 1200),
		Temperature:      temperature,
		CreatedAt:        now,
		UpdatedAt:        now,
	}

	if err := db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
		if provider.IsDefault {
			if _, err := tx.NewUpdate().Model((*models.AIProviderSettings)(nil)).Set("is_default = false").Where("is_default = true").Exec(ctx); err != nil {
				return err
			}
		}
		_, err := tx.NewInsert().Model(provider).Exec(ctx)
		return err
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create AI provider"})
		return
	}

	writeAIAudit(c, db, "settings.ai_provider.create", "created AI provider "+providerKey)
	c.JSON(http.StatusCreated, aifuncs.ToAdminResponse(*provider))
}

func UpdateAIProvider(c *gin.Context, db *bun.DB) {
	providerKey := strings.TrimSpace(c.Param("key"))
	if providerKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider key is required"})
		return
	}

	provider, found, err := aifuncs.LoadProviderSettings(c.Request.Context(), db, providerKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load AI provider"})
		return
	}
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "provider not found"})
		return
	}

	var req updateAIProviderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.ClearToken && req.Token != nil && strings.TrimSpace(*req.Token) != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token cannot be set and cleared in the same request"})
		return
	}

	providerType := aifuncs.NormalizeProviderType(provider.ProviderType)
	if req.Label != nil {
		provider.Label = strings.TrimSpace(*req.Label)
	}
	if req.BaseURL != nil {
		provider.BaseURL = normalizeProviderBaseURL(providerType, *req.BaseURL)
	}
	if req.APIPath != nil {
		provider.APIPath = strings.TrimSpace(*req.APIPath)
	}
	if req.APIVersion != nil {
		provider.APIVersion = strings.TrimSpace(*req.APIVersion)
	}
	if req.Region != nil {
		provider.Region = strings.TrimSpace(*req.Region)
	}
	if req.Organization != nil {
		provider.Organization = strings.TrimSpace(*req.Organization)
	}
	if req.ChatModel != nil {
		provider.ChatModel = normalizeProviderChatModel(providerType, *req.ChatModel)
	}
	if req.EmbeddingModel != nil {
		provider.EmbeddingModel = strings.TrimSpace(*req.EmbeddingModel)
	}
	if req.Enabled != nil {
		provider.Enabled = *req.Enabled
	}
	if req.IsDefault != nil {
		provider.IsDefault = *req.IsDefault
	}
	if req.TimeoutSeconds != nil {
		provider.TimeoutSeconds = normalizePositiveInt(*req.TimeoutSeconds, 30)
	}
	if req.MaxContextTokens != nil {
		provider.MaxContextTokens = normalizePositiveInt(*req.MaxContextTokens, 6000)
	}
	if req.MaxOutputTokens != nil {
		provider.MaxOutputTokens = normalizePositiveInt(*req.MaxOutputTokens, 1200)
	}
	if req.Temperature != nil {
		if *req.Temperature < 0 || *req.Temperature > 2 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "temperature must be between 0 and 2"})
			return
		}
		provider.Temperature = *req.Temperature
	}

	if req.ClearToken {
		if aifuncs.ProviderTypeRequiresToken(providerType) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "token is required for this provider type"})
			return
		}
		provider.EncryptedToken = ""
		provider.TokenNonce = ""
		provider.TokenKeyVersion = ""
		provider.TokenConfigured = false
	}
	if req.Token != nil && strings.TrimSpace(*req.Token) != "" {
		encryptedToken, tokenNonce, tokenKeyVersion, err := encryptRequestedProviderToken(*req.Token)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encrypt AI provider token"})
			return
		}
		provider.EncryptedToken = encryptedToken
		provider.TokenNonce = tokenNonce
		provider.TokenKeyVersion = tokenKeyVersion
		provider.TokenConfigured = true
	}
	if aifuncs.ProviderTypeRequiresToken(providerType) && strings.TrimSpace(provider.EncryptedToken) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token is required for this provider type"})
		return
	}

	provider.UpdatedAt = time.Now().UTC()
	if err := db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
		if provider.IsDefault {
			if _, err := tx.NewUpdate().Model((*models.AIProviderSettings)(nil)).Set("is_default = false").Where("provider_key <> ?", provider.ProviderKey).Exec(ctx); err != nil {
				return err
			}
		}
		_, err := tx.NewUpdate().Model(&provider).
			Where("provider_key = ?", provider.ProviderKey).
			Column(
				"label", "base_url", "api_path", "api_version", "region", "organization", "chat_model", "embedding_model",
				"encrypted_token", "token_nonce", "token_key_version", "token_configured", "enabled", "is_default",
				"timeout_seconds", "max_context_tokens", "max_output_tokens", "temperature", "updated_at",
			).
			Exec(ctx)
		return err
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update AI provider"})
		return
	}

	writeAIAudit(c, db, "settings.ai_provider.update", "updated AI provider "+providerKey)
	c.JSON(http.StatusOK, aifuncs.ToAdminResponse(provider))
}

func DeleteAIProvider(c *gin.Context, db *bun.DB) {
	providerKey := strings.TrimSpace(c.Param("key"))
	if providerKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider key is required"})
		return
	}

	if _, found, err := aifuncs.LoadProviderSettings(c.Request.Context(), db, providerKey); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load AI provider"})
		return
	} else if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "provider not found"})
		return
	}

	if _, err := db.NewDelete().Model((*models.AIProviderSettings)(nil)).Where("provider_key = ?", providerKey).Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete AI provider"})
		return
	}

	writeAIAudit(c, db, "settings.ai_provider.delete", "deleted AI provider "+providerKey)
	c.JSON(http.StatusOK, gin.H{"result": "deleted"})
}

func TestAIProvider(c *gin.Context, db *bun.DB) {
	providerKey := strings.TrimSpace(c.Param("key"))
	if providerKey == "" {
		var req testAIProviderRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		providerKey = strings.TrimSpace(req.ProviderKey)
	}
	if providerKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provider key is required"})
		return
	}

	record, found, err := aifuncs.LoadProviderSettings(c.Request.Context(), db, providerKey)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load AI provider"})
		return
	}
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "provider not found"})
		return
	}

	runtime, err := aifuncs.RuntimeFromRecord(config.GetConfigInstance(), record)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	provider := aifuncs.NewChatProvider(runtime)
	if err := provider.Validate(c.Request.Context()); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	writeAIAudit(c, db, "settings.ai_provider.test", "validated AI provider "+providerKey)
	c.JSON(http.StatusOK, gin.H{
		"result":       "ok",
		"providerKey":  runtime.Key,
		"providerType": runtime.Type,
		"capabilities": provider.Capabilities(),
	})
}

func encryptRequestedProviderToken(token string) (string, string, string, error) {
	trimmedToken := strings.TrimSpace(token)
	if trimmedToken == "" {
		return "", "", "v1", nil
	}
	return aifuncs.EncryptProviderToken(config.GetConfigInstance(), trimmedToken)
}

func normalizeProviderBaseURL(providerType string, value string) string {
	trimmed := strings.TrimRight(strings.TrimSpace(value), "/")
	if trimmed != "" {
		return trimmed
	}
	return aifuncs.DefaultBaseURL(providerType)
}

func normalizeProviderChatModel(providerType string, value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed != "" {
		return trimmed
	}
	return aifuncs.DefaultChatModel(providerType)
}

func normalizePositiveInt(value int, fallback int) int {
	if value > 0 {
		return value
	}
	return fallback
}

func persistAISetting(c *gin.Context, db *bun.DB, key string, value bool) error {
	resolver := config.GetResolver()
	if resolver != nil {
		return resolver.Set(c.Request.Context(), key, strconv.FormatBool(value))
	}
	return upsertSystemSetting(c, db, key, strconv.FormatBool(value))
}

func writeAIAudit(c *gin.Context, db *bun.DB, operation string, details string) {
	userID, err := getAIAuditUserID(c)
	if err != nil {
		return
	}
	go audit.Write(c.Request.Context(), db, userID.String(), operation, details)
}

func getAIAuditUserID(c *gin.Context) (uuid.UUID, error) {
	for _, key := range []string{middlewares.AuthContextUserIDKey, "userID", "user_id"} {
		if raw, exists := c.Get(key); exists {
			switch value := raw.(type) {
			case uuid.UUID:
				return value, nil
			case string:
				return uuid.Parse(value)
			}
		}
	}
	return uuid.Nil, errors.New("missing user id")
}
