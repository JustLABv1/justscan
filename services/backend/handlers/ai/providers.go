package ai

import (
	"net/http"

	"justscan-backend/config"
	aifuncs "justscan-backend/functions/ai"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func GetSettings() gin.HandlerFunc {
	return func(c *gin.Context) {
		settings := aifuncs.EffectiveSettings(config.GetConfigInstance())
		c.JSON(http.StatusOK, gin.H{
			"enabled":               settings.Enabled,
			"allowAnonymous":        settings.AllowAnonymous,
			"defaultProviderKey":    settings.DefaultProviderKey,
			"defaultTimeoutSeconds": settings.DefaultTimeoutSeconds,
			"maxContextResults":     settings.MaxContextResults,
		})
	}
}

func ListProviders(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		settings := aifuncs.EffectiveSettings(config.GetConfigInstance())
		if !settings.Enabled {
			c.JSON(http.StatusOK, gin.H{"providers": []models.AIProviderSummary{}})
			return
		}

		providers, err := aifuncs.ListEnabledProviderSummaries(c.Request.Context(), db)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list AI providers"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"providers": providers})
	}
}
