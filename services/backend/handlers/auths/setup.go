package auths

import (
	"context"
	"net/http"
	"strings"
	"time"

	"justscan-backend/functions/auth"
	"justscan-backend/functions/httperror"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func SetupStatus(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		status, err := auth.ResolveSetupStatus(c.Request.Context(), db)
		if err != nil {
			httperror.InternalServerError(c, "Failed to resolve setup status", err)
			return
		}

		active, expiresAt := currentSetupSession(c, status)
		c.JSON(http.StatusOK, gin.H{
			"setup_enabled":            status.SetupEnabled,
			"setup_required":           status.SetupRequired,
			"setup_completed":          status.SetupCompleted,
			"setup_session_active":     active,
			"setup_session_expires_at": expiresAt,
		})
	}
}

func SetupSessionStatus(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		status, err := auth.ResolveSetupStatus(c.Request.Context(), db)
		if err != nil {
			httperror.InternalServerError(c, "Failed to resolve setup status", err)
			return
		}
		active, expiresAt := currentSetupSession(c, status)
		c.JSON(http.StatusOK, gin.H{
			"active":     active,
			"expires_at": expiresAt,
		})
	}
}

func StartSetupSession(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		status, err := auth.ResolveSetupStatus(c.Request.Context(), db)
		if err != nil {
			httperror.InternalServerError(c, "Failed to resolve setup status", err)
			return
		}
		if !status.SetupEnabled {
			c.JSON(http.StatusNotFound, gin.H{"error": "setup is not enabled for this installation"})
			return
		}
		if status.SetupCompleted {
			c.JSON(http.StatusConflict, gin.H{"error": "setup is already complete"})
			return
		}

		var request struct {
			Token string `json:"token"`
		}
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
		if !auth.ValidateSetupToken(request.Token) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid setup token"})
			return
		}

		token, expiresAt, err := auth.GenerateSetupSession()
		if err != nil {
			httperror.InternalServerError(c, "Failed to create setup session", err)
			return
		}
		setSetupCookie(c, token, expiresAt)
		c.JSON(http.StatusOK, gin.H{
			"active":     true,
			"expires_at": expiresAt,
		})
	}
}

func CreateInitialAdmin(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		status, err := auth.ResolveSetupStatus(c.Request.Context(), db)
		if err != nil {
			httperror.InternalServerError(c, "Failed to resolve setup status", err)
			return
		}
		if !status.SetupRequired {
			c.JSON(http.StatusConflict, gin.H{"error": "setup is not active for this installation"})
			return
		}
		if active, _ := currentSetupSession(c, status); !active {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "setup session is missing or expired"})
			return
		}

		var request struct {
			Username string `json:"username"`
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
			return
		}
		request.Username = strings.TrimSpace(request.Username)
		request.Email = strings.TrimSpace(strings.ToLower(request.Email))
		if request.Username == "" || request.Email == "" || len(request.Password) < 8 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "username, email, and a password of at least 8 characters are required"})
			return
		}

		userCount, err := db.NewSelect().Model((*models.Users)(nil)).Count(c.Request.Context())
		if err != nil {
			httperror.InternalServerError(c, "Failed to inspect existing users", err)
			return
		}
		if userCount > 0 {
			c.JSON(http.StatusConflict, gin.H{"error": "initial admin already exists"})
			return
		}

		var duplicateCount int
		duplicateCount, err = db.NewSelect().Model((*models.Users)(nil)).Where("email = ? OR username = ?", request.Email, request.Username).Count(c.Request.Context())
		if err != nil {
			httperror.InternalServerError(c, "Failed to validate admin identity", err)
			return
		}
		if duplicateCount > 0 {
			c.JSON(http.StatusConflict, gin.H{"error": "a user with that email or username already exists"})
			return
		}

		user := models.Users{
			ID:              uuid.New(),
			Username:        request.Username,
			Email:           request.Email,
			Role:            "admin",
			AuthType:        "local",
			LastLoginMethod: "local",
			LastLoginAt:     func() *time.Time { t := time.Now().UTC(); return &t }(),
			UpdatedAt:       time.Now().UTC(),
		}
		if err := user.HashPassword(request.Password); err != nil {
			httperror.InternalServerError(c, "Failed to secure admin password", err)
			return
		}

		var tokenString string
		var expiresAt int64
		if err := db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
			if _, err := tx.NewInsert().Model(&user).
				Column("id", "email", "username", "password", "role", "auth_type", "last_login_at", "last_login_method", "updated_at").
				Exec(ctx); err != nil {
				return err
			}
			if err := auth.UpsertSystemSetting(ctx, tx, "auth.local_enabled", "true"); err != nil {
				return err
			}
			if err := auth.MarkSetupCompleted(ctx, tx); err != nil {
				return err
			}

			var err error
			tokenString, expiresAt, err = auth.GenerateJWT(user.ID, false)
			if err != nil {
				return err
			}
			token := models.Tokens{
				UserID:      user.ID.String(),
				Key:         tokenString,
				Description: "Initial setup admin token",
				Type:        "user",
				ExpiresAt:   time.Unix(expiresAt, 0),
				CreatedAt:   time.Now().UTC(),
			}
			if _, err := tx.NewInsert().Model(&token).Exec(ctx); err != nil {
				return err
			}
			return nil
		}); err != nil {
			httperror.InternalServerError(c, "Failed to create initial admin", err)
			return
		}

		clearSetupCookie(c)
		c.JSON(http.StatusCreated, gin.H{
			"token":      tokenString,
			"expires_at": expiresAt,
			"user": gin.H{
				"id":                user.ID,
				"email":             user.Email,
				"username":          user.Username,
				"disabled":          false,
				"disabled_reason":   "",
				"role":              user.Role,
				"auth_type":         user.AuthType,
				"last_login_at":     user.LastLoginAt,
				"last_login_method": user.LastLoginMethod,
			},
		})
	}
}

func currentSetupSession(c *gin.Context, status auth.SetupStatus) (bool, int64) {
	if !status.SetupRequired {
		clearSetupCookie(c)
		return false, 0
	}
	cookieValue, err := c.Cookie(auth.SetupCookieName)
	if err != nil || cookieValue == "" {
		return false, 0
	}
	expiresAt, err := auth.ParseSetupSession(cookieValue)
	if err != nil {
		clearSetupCookie(c)
		return false, 0
	}
	return true, expiresAt
}

func setSetupCookie(c *gin.Context, token string, expiresAt int64) {
	maxAge := int(time.Until(time.Unix(expiresAt, 0)).Seconds())
	if maxAge < 1 {
		maxAge = 1
	}
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(auth.SetupCookieName, token, maxAge, "/", "", false, true)
}

func clearSetupCookie(c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(auth.SetupCookieName, "", -1, "/", "", false, true)
}

func requireCompletedSetup(c *gin.Context, db *bun.DB) bool {
	required, err := auth.SetupRequired(c.Request.Context(), db)
	if err != nil {
		httperror.InternalServerError(c, "Failed to resolve setup state", err)
		return false
	}
	if !required {
		return true
	}
	c.JSON(http.StatusForbidden, gin.H{"error": "setup must be completed before this sign-in method is available"})
	return false
}
