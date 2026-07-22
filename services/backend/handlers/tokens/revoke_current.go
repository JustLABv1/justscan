package tokens

import (
	"net/http"
	"strings"

	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

// RevokeCurrentToken invalidates exactly the credential used for this request.
// It is deliberately separate from profile token management so the CLI can
// safely sign out without knowing a database token ID.
func RevokeCurrentToken(c *gin.Context, db *bun.DB) {
	if _, _, ok := authz.RequireRequestUser(c, db); !ok {
		return
	}
	raw := strings.TrimSpace(strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer "))
	if raw == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing bearer token"})
		return
	}
	result, err := db.NewUpdate().Model((*models.Tokens)(nil)).
		Set("disabled = true").
		Set("disabled_reason = ?", "signed_out").
		Where("key = ? AND disabled = false", raw).
		Where("type IN (?)", bun.In([]string{"user", "personal", "cli_session"})).
		Exec(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to revoke current token"})
		return
	}
	if changed, _ := result.RowsAffected(); changed == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "token is not active"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"result": "signed out"})
}
