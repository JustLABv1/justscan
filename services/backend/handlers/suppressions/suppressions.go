package suppressions

import (
	"net/http"
	"strconv"
	"time"

	"justscan-backend/functions/authz"
	effectivesuppressions "justscan-backend/functions/suppressions"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

func ListAllSuppressions(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		if page < 1 {
			page = 1
		}
		if limit < 1 || limit > 200 {
			limit = 50
		}
		statusFilter := c.Query("status")
		search := c.Query("q")

		suppressions, total, err := effectivesuppressions.LoadEffectiveSuppressionsPage(c.Request.Context(), db, userID, isAdmin, page, limit, statusFilter, search)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load suppressions"})
			return
		}

		for i := range suppressions {
			if suppressions[i].Source == "xray" {
				continue
			}
			user := &models.Users{}
			if err := db.NewSelect().Model(user).Column("username").
				Where("id = ?", suppressions[i].UserID).
				Scan(c.Request.Context()); err == nil {
				suppressions[i].Username = user.Username
			}
		}

		c.JSON(http.StatusOK, gin.H{"data": suppressions, "total": total})
	}
}

func UpsertSuppression(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		digest := c.Param("digest")
		if digest == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "image digest is required"})
			return
		}

		userID, _, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		var body struct {
			VulnID        string     `json:"vuln_id" binding:"required"`
			Status        string     `json:"status" binding:"required,oneof=accepted wont_fix false_positive"`
			Justification string     `json:"justification"`
			ExpiresAt     *time.Time `json:"expires_at"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		existing := &models.Suppression{}
		err := db.NewSelect().Model(existing).
			Where("image_digest = ? AND vuln_id = ?", digest, body.VulnID).
			Where("user_id = ? OR owner_user_id = ?", userID, userID).
			Scan(c.Request.Context())

		if err == nil {
			// Update existing
			existing.Status = body.Status
			existing.Justification = body.Justification
			existing.UserID = userID
			existing.OwnerType = models.OwnerTypeUser
			existing.OwnerUserID = &userID
			existing.OwnerOrgID = nil
			existing.ExpiresAt = body.ExpiresAt
			existing.UpdatedAt = time.Now()
			if _, err := db.NewUpdate().Model(existing).
				Column("status", "justification", "user_id", "owner_type", "owner_user_id", "owner_org_id", "expires_at", "updated_at").
				Where("id = ?", existing.ID).
				Exec(c.Request.Context()); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update suppression"})
				return
			}
			c.JSON(http.StatusOK, existing)
			return
		}

		// Insert new
		supp := &models.Suppression{
			ImageDigest:   digest,
			VulnID:        body.VulnID,
			Status:        body.Status,
			Justification: body.Justification,
			UserID:        userID,
			OwnerType:     models.OwnerTypeUser,
			OwnerUserID:   &userID,
			ExpiresAt:     body.ExpiresAt,
			CreatedAt:     time.Now(),
			UpdatedAt:     time.Now(),
		}
		if _, err := db.NewInsert().Model(supp).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save suppression"})
			return
		}
		c.JSON(http.StatusCreated, supp)
	}
}

func ListSuppressions(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		digest := c.Param("digest")
		var suppressions []models.Suppression
		query := db.NewSelect().Model(&suppressions).
			Where("image_digest = ?", digest).
			OrderExpr("created_at DESC")
		if !isAdmin {
			query = query.Where("user_id = ? OR owner_user_id = ?", userID, userID)
		}
		if err := query.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load suppressions"})
			return
		}

		for i := range suppressions {
			user := &models.Users{}
			if err := db.NewSelect().Model(user).Column("username").
				Where("id = ?", suppressions[i].UserID).
				Scan(c.Request.Context()); err == nil {
				suppressions[i].Username = user.Username
			}
		}

		c.JSON(http.StatusOK, gin.H{"data": suppressions})
	}
}

func DeleteSuppression(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		digest := c.Param("digest")
		vulnID := c.Param("vulnId")

		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		deleteQuery := db.NewDelete().Model((*models.Suppression)(nil)).
			Where("image_digest = ? AND vuln_id = ?", digest, vulnID)
		if !isAdmin {
			deleteQuery = deleteQuery.Where("user_id = ? OR owner_user_id = ?", userID, userID)
		}
		if _, err := deleteQuery.Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete suppression"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"result": "deleted"})
	}
}
