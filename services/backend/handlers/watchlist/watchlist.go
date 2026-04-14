package watchlist

import (
	"context"
	"net/http"
	"strings"
	"time"

	"justscan-backend/functions/authz"
	scanhandlers "justscan-backend/handlers/scans"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"
	"justscan-backend/scheduler"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func ListWatchlist(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}
		accessibleOrgIDs, err := authz.ListAccessibleOrgIDs(c.Request.Context(), db, userID, isAdmin)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve organization access"})
			return
		}
		var items []models.WatchlistItem
		q := db.NewSelect().Model(&items).OrderExpr("created_at DESC")
		q = authz.ApplyOwnershipVisibility(q, "", "user_id", "owner_user_id", "owner_org_id", "org_watchlist_items", "watchlist_item_id", userID, isAdmin, accessibleOrgIDs)
		if err := q.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list watchlist"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": items})
	}
}

func CreateWatchlistItem(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			ImageName  string     `json:"image_name" binding:"required"`
			ImageTag   string     `json:"image_tag" binding:"required"`
			Schedule   string     `json:"schedule" binding:"required"`
			Timezone   string     `json:"timezone"`
			Enabled    bool       `json:"enabled"`
			OrgID      string     `json:"org_id"`
			RegistryID *uuid.UUID `json:"registry_id"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		userID, _, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}
		timezone := strings.TrimSpace(body.Timezone)
		if timezone == "" {
			timezone = "UTC"
		}
		if err := scheduler.ValidateSchedule(body.Schedule, timezone); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		var ownerOrgID *uuid.UUID
		if body.OrgID != "" {
			parsedOrgID, err := uuid.Parse(body.OrgID)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
				return
			}
			if _, _, _, _, ok := authz.RequireOrgRole(c, db, parsedOrgID, models.OrgRoleAdmin); !ok {
				return
			}
			ownerOrgID = &parsedOrgID
		}
		item := &models.WatchlistItem{
			ImageName:   body.ImageName,
			ImageTag:    body.ImageTag,
			Schedule:    body.Schedule,
			Timezone:    timezone,
			Enabled:     body.Enabled,
			RegistryID:  body.RegistryID,
			UserID:      userID,
			OwnerType:   models.OwnerTypeUser,
			OwnerUserID: &userID,
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
		}
		if ownerOrgID != nil {
			item.OwnerType = models.OwnerTypeOrg
			item.OwnerUserID = nil
			item.OwnerOrgID = ownerOrgID
		}
		if _, err := db.NewInsert().Model(item).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create watchlist item"})
			return
		}
		if ownerOrgID != nil {
			if _, err := db.NewInsert().Model(&models.OrgWatchlistItem{OrgID: *ownerOrgID, WatchlistItemID: item.ID}).On("CONFLICT DO NOTHING").Exec(c.Request.Context()); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to share watchlist item with organization"})
				return
			}
		}
		scheduler.SyncWatchlistItem(db, *item)
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
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}
		item := &models.WatchlistItem{}
		if err := db.NewSelect().Model(item).Where("id = ?", itemID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "watchlist item not found"})
			return
		}
		if !canWriteWatchlistItem(c.Request.Context(), db, item, userID, isAdmin) {
			c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
			return
		}
		var body struct {
			Schedule   *string    `json:"schedule"`
			Timezone   *string    `json:"timezone"`
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
		if body.Timezone != nil {
			item.Timezone = strings.TrimSpace(*body.Timezone)
		}
		if item.Timezone == "" {
			item.Timezone = "UTC"
		}
		if body.Enabled != nil {
			item.Enabled = *body.Enabled
		}
		if body.RegistryID != nil {
			item.RegistryID = body.RegistryID
		}
		if err := scheduler.ValidateSchedule(item.Schedule, item.Timezone); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		item.UpdatedAt = time.Now()
		if _, err := db.NewUpdate().Model(item).
			Column("schedule", "timezone", "enabled", "registry_id", "updated_at").
			Where("id = ?", itemID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update watchlist item"})
			return
		}
		scheduler.SyncWatchlistItem(db, *item)
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
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}
		item := &models.WatchlistItem{}
		if err := db.NewSelect().Model(item).Where("id = ?", itemID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "watchlist item not found"})
			return
		}
		if !canWriteWatchlistItem(c.Request.Context(), db, item, userID, isAdmin) {
			c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
			return
		}
		if _, err := db.NewDelete().Model((*models.WatchlistItem)(nil)).
			Where("id = ?", itemID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete watchlist item"})
			return
		}
		scheduler.UnscheduleWatchlistItem(itemID.String())
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
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}
		item := &models.WatchlistItem{}
		if err := db.NewSelect().Model(item).Where("id = ?", itemID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "watchlist item not found"})
			return
		}
		if !canWriteWatchlistItem(c.Request.Context(), db, item, userID, isAdmin) {
			c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
			return
		}
		scan := &models.Scan{
			ImageName:   item.ImageName,
			ImageTag:    item.ImageTag,
			RegistryID:  item.RegistryID,
			Status:      models.ScanStatusPending,
			UserID:      &userID,
			OwnerType:   item.OwnerType,
			OwnerUserID: item.OwnerUserID,
			OwnerOrgID:  item.OwnerOrgID,
			CreatedAt:   time.Now(),
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
		if item.OwnerOrgID != nil {
			if err := scanhandlers.EnsureOrgScanLink(c.Request.Context(), db, *item.OwnerOrgID, scan.ID); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to scope scan"})
				return
			}
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

func canWriteWatchlistItem(ctx context.Context, db *bun.DB, item *models.WatchlistItem, userID uuid.UUID, isAdmin bool) bool {
	if item == nil {
		return false
	}
	if isAdmin || item.UserID == userID {
		return true
	}
	if item.OwnerUserID != nil && *item.OwnerUserID == userID {
		return true
	}
	if item.OwnerOrgID == nil {
		return false
	}
	roles, err := authz.LoadUserOrgRoles(ctx, db, userID)
	if err != nil {
		return false
	}
	return authz.HasOrgRoleAtLeast(roles, *item.OwnerOrgID, models.OrgRoleAdmin)
}
