package watchlist

import (
	"context"
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"time"

	"justscan-backend/functions/authz"
	collectionhandlers "justscan-backend/handlers/collections"
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
		q = authz.ApplyWorkspaceScope(c, q, "", "owner_user_id", "owner_org_id", "org_watchlist_items", "watchlist_item_id", userID)
		if err := q.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list watchlist"})
			return
		}
		if err := attachWatchlistPosture(c.Request.Context(), db, items, isAdmin, accessibleOrgIDs); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load watchlist scan posture"})
			return
		}
		if err := attachWatchlistCollections(c.Request.Context(), db, items, userID, isAdmin, c.Query("scope")); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load watchlist collections"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": items})
	}
}

func attachWatchlistPosture(ctx context.Context, db *bun.DB, items []models.WatchlistItem, isAdmin bool, accessibleOrgIDs []uuid.UUID) error {
	scanIDs := make([]uuid.UUID, 0, len(items))
	seenScanIDs := make(map[uuid.UUID]struct{}, len(items))
	for _, item := range items {
		if item.LastScanID == nil {
			continue
		}
		if _, ok := seenScanIDs[*item.LastScanID]; ok {
			continue
		}
		seenScanIDs[*item.LastScanID] = struct{}{}
		scanIDs = append(scanIDs, *item.LastScanID)
	}
	if len(scanIDs) == 0 {
		return nil
	}

	var scans []models.Scan
	if err := db.NewSelect().Model(&scans).Where("id IN (?)", bun.In(scanIDs)).Scan(ctx); err != nil {
		return err
	}
	scansByID := make(map[uuid.UUID]*models.Scan, len(scans))
	for index := range scans {
		scansByID[scans[index].ID] = &scans[index]
	}
	for index := range items {
		if items[index].LastScanID != nil {
			items[index].LastScan = scansByID[*items[index].LastScanID]
		}
	}

	var complianceRows []models.ComplianceResult
	complianceQuery := db.NewSelect().Model(&complianceRows).Where("scan_id IN (?)", bun.In(scanIDs))
	if !isAdmin {
		if len(accessibleOrgIDs) == 0 {
			return nil
		}
		complianceQuery = complianceQuery.Where("org_id IN (?)", bun.In(accessibleOrgIDs))
	}
	if err := complianceQuery.Scan(ctx); err != nil {
		return err
	}
	if len(complianceRows) == 0 {
		return nil
	}

	policyIDs := make([]uuid.UUID, 0)
	orgIDs := make([]uuid.UUID, 0)
	seenPolicyIDs := map[uuid.UUID]struct{}{}
	seenOrgIDs := map[uuid.UUID]struct{}{}
	for _, row := range complianceRows {
		if _, ok := seenPolicyIDs[row.PolicyID]; !ok {
			seenPolicyIDs[row.PolicyID] = struct{}{}
			policyIDs = append(policyIDs, row.PolicyID)
		}
		if _, ok := seenOrgIDs[row.OrgID]; !ok {
			seenOrgIDs[row.OrgID] = struct{}{}
			orgIDs = append(orgIDs, row.OrgID)
		}
	}

	policyNames := make(map[uuid.UUID]string, len(policyIDs))
	if len(policyIDs) > 0 {
		var policies []models.OrgPolicy
		if err := db.NewSelect().Model(&policies).Where("id IN (?)", bun.In(policyIDs)).Scan(ctx); err != nil {
			return err
		}
		for _, policy := range policies {
			policyNames[policy.ID] = policy.Name
		}
	}

	orgNames := make(map[uuid.UUID]string, len(orgIDs))
	if len(orgIDs) > 0 {
		var orgs []models.Org
		if err := db.NewSelect().Model(&orgs).Where("id IN (?)", bun.In(orgIDs)).Scan(ctx); err != nil {
			return err
		}
		for _, org := range orgs {
			orgNames[org.ID] = org.Name
		}
	}

	summaries := make(map[uuid.UUID]*models.WatchlistComplianceSummary, len(scanIDs))
	policiesByScan := make(map[uuid.UUID]map[string]struct{}, len(scanIDs))
	failedPoliciesByScan := make(map[uuid.UUID]map[string]struct{}, len(scanIDs))
	orgsByScan := make(map[uuid.UUID]map[string]struct{}, len(scanIDs))
	for _, row := range complianceRows {
		summary := summaries[row.ScanID]
		if summary == nil {
			summary = &models.WatchlistComplianceSummary{Status: "pass"}
			summaries[row.ScanID] = summary
		}
		if row.Status == "fail" {
			summary.FailCount++
			summary.Status = "fail"
		} else {
			summary.PassCount++
		}
		if summary.EvaluatedAt == nil || row.EvaluatedAt.After(*summary.EvaluatedAt) {
			evaluatedAt := row.EvaluatedAt
			summary.EvaluatedAt = &evaluatedAt
		}

		policyName := strings.TrimSpace(policyNames[row.PolicyID])
		if policyName != "" {
			if policiesByScan[row.ScanID] == nil {
				policiesByScan[row.ScanID] = map[string]struct{}{}
			}
			policiesByScan[row.ScanID][policyName] = struct{}{}
			if row.Status == "fail" {
				if failedPoliciesByScan[row.ScanID] == nil {
					failedPoliciesByScan[row.ScanID] = map[string]struct{}{}
				}
				failedPoliciesByScan[row.ScanID][policyName] = struct{}{}
			}
		}

		orgName := strings.TrimSpace(orgNames[row.OrgID])
		if orgName != "" {
			if orgsByScan[row.ScanID] == nil {
				orgsByScan[row.ScanID] = map[string]struct{}{}
			}
			orgsByScan[row.ScanID][orgName] = struct{}{}
		}
	}

	for scanID, summary := range summaries {
		summary.PolicyNames = sortedSetValues(policiesByScan[scanID])
		summary.FailedPolicyNames = sortedSetValues(failedPoliciesByScan[scanID])
		summary.OrgNames = sortedSetValues(orgsByScan[scanID])
	}
	for index := range items {
		if items[index].LastScanID == nil {
			continue
		}
		items[index].ComplianceSummary = summaries[*items[index].LastScanID]
	}
	return nil
}

func sortedSetValues(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func CreateWatchlistItem(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body struct {
			ImageName     string      `json:"image_name" binding:"required"`
			ImageTag      string      `json:"image_tag" binding:"required"`
			Schedule      string      `json:"schedule" binding:"required"`
			Timezone      string      `json:"timezone"`
			Enabled       bool        `json:"enabled"`
			OrgID         string      `json:"org_id"`
			RegistryID    *uuid.UUID  `json:"registry_id"`
			CollectionIDs []uuid.UUID `json:"collection_ids"`
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
			if _, _, _, _, ok := authz.RequireOrgRole(c, db, parsedOrgID, models.OrgRoleEditor); !ok {
				return
			}
			ownerOrgID = &parsedOrgID
		}
		if body.RegistryID != nil {
			if _, _, _, ok := authz.LoadAccessibleRegistry(c, db, *body.RegistryID); !ok {
				return
			}
		}
		collectionScope := "personal"
		if ownerOrgID != nil {
			collectionScope = ownerOrgID.String()
		}
		if _, err := collectionhandlers.ValidateManageableCollectionsForScope(c.Request.Context(), db, body.CollectionIDs, userID, false, collectionScope); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid collection_ids"})
			return
		}
		item := &models.WatchlistItem{
			ImageName:     body.ImageName,
			ImageTag:      body.ImageTag,
			Schedule:      body.Schedule,
			Timezone:      timezone,
			Enabled:       body.Enabled,
			RegistryID:    body.RegistryID,
			CollectionIDs: body.CollectionIDs,
			UserID:        userID,
			OwnerType:     models.OwnerTypeUser,
			OwnerUserID:   &userID,
			CreatedAt:     time.Now(),
			UpdatedAt:     time.Now(),
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
			ImageName     *string          `json:"image_name"`
			ImageTag      *string          `json:"image_tag"`
			Schedule      *string          `json:"schedule"`
			Timezone      *string          `json:"timezone"`
			Enabled       *bool            `json:"enabled"`
			RegistryID    *json.RawMessage `json:"registry_id"`
			CollectionIDs *[]uuid.UUID     `json:"collection_ids"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if body.ImageName != nil {
			item.ImageName = *body.ImageName
		}
		if body.ImageTag != nil {
			item.ImageTag = *body.ImageTag
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
			if string(*body.RegistryID) == "null" {
				item.RegistryID = nil
			} else {
				var registryID uuid.UUID
				if err := json.Unmarshal(*body.RegistryID, &registryID); err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": "invalid registry_id"})
					return
				}
				if _, _, _, ok := authz.LoadAccessibleRegistry(c, db, registryID); !ok {
					return
				}
				item.RegistryID = &registryID
			}
		}
		if body.CollectionIDs != nil {
			scope := "personal"
			if item.OwnerOrgID != nil {
				scope = item.OwnerOrgID.String()
			}
			if _, err := collectionhandlers.ValidateManageableCollectionsForScope(c.Request.Context(), db, *body.CollectionIDs, userID, isAdmin, scope); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid collection_ids"})
				return
			}
			item.CollectionIDs = *body.CollectionIDs
		}
		if err := scheduler.ValidateSchedule(item.Schedule, item.Timezone); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		item.UpdatedAt = time.Now()
		if _, err := db.NewUpdate().Model(item).
			Column("image_name", "image_tag", "schedule", "timezone", "enabled", "registry_id", "collection_ids", "updated_at").
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
		if err := collectionhandlers.AddScanCollectionMemberships(c.Request.Context(), db, scan.ID, item.CollectionIDs); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to assign scan collections"})
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

func attachWatchlistCollections(ctx context.Context, db *bun.DB, items []models.WatchlistItem, userID uuid.UUID, isAdmin bool, scope string) error {
	collectionIDs := make([]uuid.UUID, 0)
	for _, item := range items {
		collectionIDs = append(collectionIDs, item.CollectionIDs...)
	}
	collections, err := collectionhandlers.LoadCollectionsByIDs(ctx, db, collectionIDs, userID, isAdmin, scope)
	if err != nil {
		return err
	}
	collectionsByID := make(map[uuid.UUID]models.ScanCollection, len(collections))
	for _, collection := range collections {
		collectionsByID[collection.ID] = collection
	}
	for index := range items {
		itemCollections := make([]models.ScanCollection, 0, len(items[index].CollectionIDs))
		for _, collectionID := range items[index].CollectionIDs {
			collection, ok := collectionsByID[collectionID]
			if ok {
				itemCollections = append(itemCollections, collection)
			}
		}
		items[index].Collections = itemCollections
	}
	return nil
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
	return authz.HasOrgRoleAtLeast(roles, *item.OwnerOrgID, models.OrgRoleEditor)
}

type watchlistShare struct {
	OrgID          uuid.UUID `bun:"org_id" json:"org_id"`
	OrgName        string    `bun:"org_name" json:"org_name"`
	OrgDescription string    `bun:"org_description" json:"org_description"`
	IsOwner        bool      `bun:"-" json:"is_owner"`
}

func ListWatchlistShares(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		item, _, _, ok := loadWatchlistForShareManagement(c, db)
		if !ok {
			return
		}

		var shares []watchlistShare
		if err := db.NewSelect().
			TableExpr("org_watchlist_items AS org_watchlist_item").
			ColumnExpr("o.id AS org_id").
			ColumnExpr("o.name AS org_name").
			ColumnExpr("o.description AS org_description").
			Join("JOIN orgs AS o ON o.id = org_watchlist_item.org_id").
			Where("org_watchlist_item.watchlist_item_id = ?", item.ID).
			OrderExpr("o.name ASC").
			Scan(c.Request.Context(), &shares); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list watchlist shares"})
			return
		}

		for index := range shares {
			shares[index].IsOwner = item.OwnerOrgID != nil && shares[index].OrgID == *item.OwnerOrgID
		}

		c.JSON(http.StatusOK, gin.H{"data": shares})
	}
}

func ShareWatchlistItem(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		item, _, isAdmin, ok := loadWatchlistForShareManagement(c, db)
		if !ok {
			return
		}

		var body struct {
			OrgID string `json:"org_id" binding:"required"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		targetOrgID, err := uuid.Parse(body.OrgID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
			return
		}
		if item.OwnerOrgID != nil && *item.OwnerOrgID == targetOrgID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "resource is already owned by that organization"})
			return
		}
		if !isAdmin {
			if _, _, _, _, ok := authz.RequireOrgRole(c, db, targetOrgID, models.OrgRoleEditor); !ok {
				return
			}
		}

		if _, err := db.NewInsert().Model(&models.OrgWatchlistItem{OrgID: targetOrgID, WatchlistItemID: item.ID}).On("CONFLICT DO NOTHING").Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to share watchlist item"})
			return
		}

		c.JSON(http.StatusCreated, gin.H{"result": "shared"})
	}
}

func UnshareWatchlistItem(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		item, _, _, ok := loadWatchlistForShareManagement(c, db)
		if !ok {
			return
		}

		targetOrgID, err := uuid.Parse(c.Param("orgId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
			return
		}
		if item.OwnerOrgID != nil && *item.OwnerOrgID == targetOrgID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot remove the owner organization"})
			return
		}

		if _, err := db.NewDelete().Model((*models.OrgWatchlistItem)(nil)).
			Where("org_id = ?", targetOrgID).
			Where("watchlist_item_id = ?", item.ID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to revoke watchlist share"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"result": "unshared"})
	}
}

func loadWatchlistForShareManagement(c *gin.Context, db *bun.DB) (*models.WatchlistItem, uuid.UUID, bool, bool) {
	itemID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid watchlist item ID"})
		return nil, uuid.Nil, false, false
	}

	userID, isAdmin, ok := authz.RequireRequestUser(c, db)
	if !ok {
		return nil, uuid.Nil, false, false
	}

	item := &models.WatchlistItem{}
	if err := db.NewSelect().Model(item).Where("id = ?", itemID).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "watchlist item not found"})
		return nil, uuid.Nil, false, false
	}

	if !canWriteWatchlistItem(c.Request.Context(), db, item, userID, isAdmin) {
		c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
		return nil, uuid.Nil, false, false
	}

	return item, userID, isAdmin, true
}
