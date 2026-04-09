package watchlist

import (
	"net/http"
	"time"

	"justscan-backend/functions/auth"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func ListWatchlist(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, err := auth.ResolveUserAccess(c.GetHeader("Authorization"), db)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		var items []models.WatchlistItem
		q := db.NewSelect().Model(&items).OrderExpr("created_at DESC")
		if !isAdmin {
			q = q.Where("user_id = ?", userID)
		}
		if err := q.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list watchlist"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": items})
	}
}

func CreateWatchlistItem(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _, err := auth.ResolveUserAccess(c.GetHeader("Authorization"), db)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		var body struct {
			ImageName  string     `json:"image_name" binding:"required"`
			ImageTag   string     `json:"image_tag" binding:"required"`
			Schedule   string     `json:"schedule" binding:"required"`
			Enabled    bool       `json:"enabled"`
			RegistryID *uuid.UUID `json:"registry_id"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		item := &models.WatchlistItem{
			ImageName:  body.ImageName,
			ImageTag:   body.ImageTag,
			Schedule:   body.Schedule,
			Enabled:    body.Enabled,
			RegistryID: body.RegistryID,
			UserID:     userID,
			CreatedAt:  time.Now(),
			UpdatedAt:  time.Now(),
		}
		if _, err := db.NewInsert().Model(item).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create watchlist item"})
			return
		}
		c.JSON(http.StatusCreated, item)
	}
}

func UpdateWatchlistItem(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		itemID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid watchlist item ID"})
			return
		}
		userID, isAdmin, err := auth.ResolveUserAccess(c.GetHeader("Authorization"), db)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		item := &models.WatchlistItem{}
		if err := db.NewSelect().Model(item).Where("id = ?", itemID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "watchlist item not found"})
			return
		}
		if item.UserID != userID && !isAdmin {
			c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
			return
		}
		var body struct {
			Schedule   *string    `json:"schedule"`
			Enabled    *bool      `json:"enabled"`
			RegistryID *uuid.UUID `json:"registry_id"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if body.Schedule != nil {
			item.Schedule = *body.Schedule
		}
		if body.Enabled != nil {
			item.Enabled = *body.Enabled
		}
		if body.RegistryID != nil {
			item.RegistryID = body.RegistryID
		}
		item.UpdatedAt = time.Now()
		if _, err := db.NewUpdate().Model(item).
			Column("schedule", "enabled", "registry_id", "updated_at").
			Where("id = ?", itemID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update watchlist item"})
			return
		}
		c.JSON(http.StatusOK, item)
	}
}

func DeleteWatchlistItem(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		itemID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid watchlist item ID"})
			return
		}
		userID, isAdmin, err := auth.ResolveUserAccess(c.GetHeader("Authorization"), db)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		item := &models.WatchlistItem{}
		if err := db.NewSelect().Model(item).Where("id = ?", itemID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "watchlist item not found"})
			return
		}
		if item.UserID != userID && !isAdmin {
			c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
			return
		}
		if _, err := db.NewDelete().Model((*models.WatchlistItem)(nil)).
			Where("id = ?", itemID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete watchlist item"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"result": "deleted"})
	}
}

// TriggerScan manually triggers a scan for a watchlist item.
func TriggerScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		itemID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid watchlist item ID"})
			return
		}
		userID, isAdmin, err := auth.ResolveUserAccess(c.GetHeader("Authorization"), db)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		item := &models.WatchlistItem{}
		if err := db.NewSelect().Model(item).Where("id = ?", itemID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "watchlist item not found"})
			return
		}
		if item.UserID != userID && !isAdmin {
			c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
			return
		}
		scan := &models.Scan{
			ImageName:  item.ImageName,
			ImageTag:   item.ImageTag,
			RegistryID: item.RegistryID,
			Status:     models.ScanStatusPending,
			UserID:     &userID,
			CreatedAt:  time.Now(),
		}
		registry, envVars, err := scanner.ResolveRegistryForScan(c.Request.Context(), db, item.ImageName, item.RegistryID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		provider, err := scanner.ProviderForRegistry(registry)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		normalizedImageName, normalizedImageTag := scanner.NormalizeScanTarget(item.ImageName, item.ImageTag, registry)
		scan.ImageName = normalizedImageName
		scan.ImageTag = normalizedImageTag
		scan.ScanProvider = provider
		if registry != nil {
			scan.RegistryID = &registry.ID
		}
		if _, err := db.NewInsert().Model(scan).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create scan"})
			return
		}
		if err := scanner.DispatchScan(c.Request.Context(), db, scan, envVars, ""); err != nil {
			if markErr := scanner.MarkScanFailed(c.Request.Context(), db, scan.ID, err.Error()); markErr == nil {
				completedAt := time.Now()
				scan.Status = models.ScanStatusFailed
				scan.ErrorMessage = err.Error()
				scan.CompletedAt = &completedAt
			}
		}
		// Update last scanned
		now := time.Now()
		item.LastScannedAt = &now
		item.LastScanID = &scan.ID
		db.NewUpdate().Model(item).Column("last_scanned_at", "last_scan_id").Where("id = ?", itemID).Exec(c.Request.Context()) //nolint:errcheck
		c.JSON(http.StatusCreated, scan)
	}
}
