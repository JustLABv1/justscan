package collections

import (
	"context"
	"database/sql"
	"net/http"
	"slices"
	"strings"
	"time"

	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func ListCollections(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, accessibleOrgIDs, ok := authz.RequireOwnershipContext(c, db)
		if !ok {
			return
		}

		var collections []models.ScanCollection
		query := db.NewSelect().Model(&collections).OrderExpr("name ASC")
		query = authz.ApplyOwnershipVisibility(query, "", "", "owner_user_id", "owner_org_id", "", "", userID, isAdmin, accessibleOrgIDs)
		query = authz.ApplyWorkspaceScope(c, query, "", "owner_user_id", "owner_org_id", "", "", userID)
		if search := strings.TrimSpace(c.Query("q")); search != "" {
			query = query.Where("name ILIKE ?", "%"+search+"%")
		}
		if err := query.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list collections"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"data": collections})
	}
}

func CreateCollection(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		var body struct {
			Name  string `json:"name" binding:"required"`
			OrgID string `json:"org_id"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		name := strings.TrimSpace(body.Name)
		if name == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
			return
		}

		collection := &models.ScanCollection{
			Name:        name,
			OwnerType:   models.OwnerTypeUser,
			OwnerUserID: &userID,
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
		}

		if orgID, hasOrg, ok := parseCollectionMutationOrg(c, db, body.OrgID); !ok {
			return
		} else if hasOrg {
			collection.OwnerType = models.OwnerTypeOrg
			collection.OwnerUserID = nil
			collection.OwnerOrgID = &orgID
		}

		if _, err := db.NewInsert().Model(collection).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusConflict, gin.H{"error": "collection name already exists"})
			return
		}

		c.JSON(http.StatusCreated, collection)
	}
}

func UpdateCollection(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		collection, ok := loadManageableCollection(c, db, userID, isAdmin)
		if !ok {
			return
		}

		var body struct {
			Name string `json:"name"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		if trimmed := strings.TrimSpace(body.Name); trimmed != "" {
			collection.Name = trimmed
		}
		collection.UpdatedAt = time.Now()

		if _, err := db.NewUpdate().Model(collection).Column("name", "updated_at").Where("id = ?", collection.ID).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusConflict, gin.H{"error": "collection name already exists"})
			return
		}

		c.JSON(http.StatusOK, collection)
	}
}

func DeleteCollection(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		collection, ok := loadManageableCollection(c, db, userID, isAdmin)
		if !ok {
			return
		}

		if err := db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
			var items []models.WatchlistItem
			if err := tx.NewSelect().Model(&items).Scan(ctx); err != nil {
				return err
			}
			for index := range items {
				nextIDs := make([]uuid.UUID, 0, len(items[index].CollectionIDs))
				for _, collectionID := range items[index].CollectionIDs {
					if collectionID != collection.ID {
						nextIDs = append(nextIDs, collectionID)
					}
				}
				if len(nextIDs) == len(items[index].CollectionIDs) {
					continue
				}
				items[index].CollectionIDs = nextIDs
				items[index].UpdatedAt = time.Now()
				if _, err := tx.NewUpdate().Model(&items[index]).Column("collection_ids", "updated_at").Where("id = ?", items[index].ID).Exec(ctx); err != nil {
					return err
				}
			}
			if _, err := tx.NewDelete().Model((*models.ScanCollection)(nil)).Where("id = ?", collection.ID).Exec(ctx); err != nil {
				return err
			}
			return nil
		}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete collection"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"result": "deleted"})
	}
}

func AttachCollectionsToScans(ctx context.Context, db *bun.DB, scans []models.Scan, userID uuid.UUID, isAdmin bool, scope string) error {
	scanIDs := make([]uuid.UUID, 0, len(scans))
	for _, scan := range scans {
		scanIDs = append(scanIDs, scan.ID)
	}
	if len(scanIDs) == 0 {
		return nil
	}

	var memberships []models.ScanCollectionMembership
	if err := db.NewSelect().Model(&memberships).Where("scan_id IN (?)", bun.In(scanIDs)).Scan(ctx); err != nil {
		return err
	}
	if len(memberships) == 0 {
		return nil
	}

	collectionByID, err := visibleCollectionMap(ctx, db, membershipCollectionIDs(memberships), userID, isAdmin, scope)
	if err != nil {
		return err
	}
	if len(collectionByID) == 0 {
		return nil
	}

	scanIndexByID := make(map[uuid.UUID]int, len(scans))
	for index := range scans {
		scanIndexByID[scans[index].ID] = index
	}

	for _, membership := range memberships {
		collection, ok := collectionByID[membership.CollectionID]
		if !ok {
			continue
		}
		index, ok := scanIndexByID[membership.ScanID]
		if !ok {
			continue
		}
		scans[index].Collections = append(scans[index].Collections, collection)
	}

	for index := range scans {
		sortCollections(scans[index].Collections)
	}

	return nil
}

func LoadCollectionsByIDs(ctx context.Context, db *bun.DB, ids []uuid.UUID, userID uuid.UUID, isAdmin bool, scope string) ([]models.ScanCollection, error) {
	collectionByID, err := visibleCollectionMap(ctx, db, ids, userID, isAdmin, scope)
	if err != nil {
		return nil, err
	}
	if len(collectionByID) == 0 {
		return []models.ScanCollection{}, nil
	}

	collections := make([]models.ScanCollection, 0, len(collectionByID))
	for _, id := range uniqueUUIDs(ids) {
		collection, ok := collectionByID[id]
		if ok {
			collections = append(collections, collection)
		}
	}
	sortCollections(collections)
	return collections, nil
}

func ValidateManageableCollectionsForScope(ctx context.Context, db *bun.DB, ids []uuid.UUID, userID uuid.UUID, isAdmin bool, scope string) ([]models.ScanCollection, error) {
	ids = uniqueUUIDs(ids)
	if len(ids) == 0 {
		return []models.ScanCollection{}, nil
	}

	var collections []models.ScanCollection
	query := db.NewSelect().Model(&collections).Where("id IN (?)", bun.In(ids))
	query = authz.ApplyWorkspaceScopeValue(query, "", "owner_user_id", "owner_org_id", "", "", userID, scope)
	if err := query.Scan(ctx); err != nil {
		return nil, err
	}
	if len(collections) != len(ids) {
		return nil, sql.ErrNoRows
	}
	for _, collection := range collections {
		if !authz.CanManageCollection(ctx, db, &collection, userID, isAdmin) {
			return nil, sql.ErrNoRows
		}
	}
	sortCollections(collections)
	return collections, nil
}

func ReplaceScanCollectionMemberships(ctx context.Context, db bun.IDB, scanID uuid.UUID, collectionIDs []uuid.UUID) error {
	if _, err := db.NewDelete().Model((*models.ScanCollectionMembership)(nil)).Where("scan_id = ?", scanID).Exec(ctx); err != nil {
		return err
	}
	return AddScanCollectionMemberships(ctx, db, scanID, collectionIDs)
}

func AddScanCollectionMemberships(ctx context.Context, db bun.IDB, scanID uuid.UUID, collectionIDs []uuid.UUID) error {
	collectionIDs = uniqueUUIDs(collectionIDs)
	if len(collectionIDs) == 0 {
		return nil
	}

	memberships := make([]models.ScanCollectionMembership, 0, len(collectionIDs))
	for _, collectionID := range collectionIDs {
		memberships = append(memberships, models.ScanCollectionMembership{ScanID: scanID, CollectionID: collectionID})
	}
	_, err := db.NewInsert().Model(&memberships).On("CONFLICT DO NOTHING").Exec(ctx)
	return err
}

func RemoveScanCollectionMemberships(ctx context.Context, db bun.IDB, scanID uuid.UUID, collectionIDs []uuid.UUID) error {
	collectionIDs = uniqueUUIDs(collectionIDs)
	if len(collectionIDs) == 0 {
		return nil
	}

	_, err := db.NewDelete().
		Model((*models.ScanCollectionMembership)(nil)).
		Where("scan_id = ?", scanID).
		Where("collection_id IN (?)", bun.In(collectionIDs)).
		Exec(ctx)
	return err
}

func CopyScanCollectionMemberships(ctx context.Context, db bun.IDB, sourceScanID, targetScanID uuid.UUID) error {
	var memberships []models.ScanCollectionMembership
	if err := db.NewSelect().Model(&memberships).Where("scan_id = ?", sourceScanID).Scan(ctx); err != nil {
		return err
	}
	collectionIDs := make([]uuid.UUID, 0, len(memberships))
	for _, membership := range memberships {
		collectionIDs = append(collectionIDs, membership.CollectionID)
	}
	return AddScanCollectionMemberships(ctx, db, targetScanID, collectionIDs)
}

func membershipCollectionIDs(memberships []models.ScanCollectionMembership) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(memberships))
	for _, membership := range memberships {
		ids = append(ids, membership.CollectionID)
	}
	return uniqueUUIDs(ids)
}

func visibleCollectionMap(ctx context.Context, db *bun.DB, ids []uuid.UUID, userID uuid.UUID, isAdmin bool, scope string) (map[uuid.UUID]models.ScanCollection, error) {
	ids = uniqueUUIDs(ids)
	if len(ids) == 0 {
		return map[uuid.UUID]models.ScanCollection{}, nil
	}

	accessibleOrgIDs, err := authz.ListAccessibleOrgIDs(ctx, db, userID, isAdmin)
	if err != nil {
		return nil, err
	}

	var collections []models.ScanCollection
	query := db.NewSelect().Model(&collections).Where("id IN (?)", bun.In(ids))
	query = authz.ApplyOwnershipVisibility(query, "", "", "owner_user_id", "owner_org_id", "", "", userID, isAdmin, accessibleOrgIDs)
	query = authz.ApplyWorkspaceScopeValue(query, "", "owner_user_id", "owner_org_id", "", "", userID, scope)
	if err := query.Scan(ctx); err != nil {
		return nil, err
	}

	result := make(map[uuid.UUID]models.ScanCollection, len(collections))
	for _, collection := range collections {
		result[collection.ID] = collection
	}
	return result, nil
}

func sortCollections(collections []models.ScanCollection) {
	slices.SortFunc(collections, func(a, b models.ScanCollection) int {
		return strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
	})
}

func uniqueUUIDs(ids []uuid.UUID) []uuid.UUID {
	seen := make(map[uuid.UUID]struct{}, len(ids))
	result := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if id == uuid.Nil {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result
}

func parseCollectionMutationOrg(c *gin.Context, db *bun.DB, rawOrgID string) (uuid.UUID, bool, bool) {
	rawOrgID = strings.TrimSpace(rawOrgID)
	if rawOrgID == "" {
		return uuid.Nil, false, true
	}

	orgID, err := uuid.Parse(rawOrgID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
		return uuid.Nil, false, false
	}
	if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleEditor); !ok {
		return uuid.Nil, false, false
	}

	return orgID, true, true
}

func loadManageableCollection(c *gin.Context, db *bun.DB, userID uuid.UUID, isAdmin bool) (*models.ScanCollection, bool) {
	collectionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid collection ID"})
		return nil, false
	}

	collection := &models.ScanCollection{}
	if err := db.NewSelect().Model(collection).Where("id = ?", collectionID).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "collection not found"})
		return nil, false
	}
	if !authz.CanManageCollection(c.Request.Context(), db, collection, userID, isAdmin) {
		c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
		return nil, false
	}

	return collection, true
}
