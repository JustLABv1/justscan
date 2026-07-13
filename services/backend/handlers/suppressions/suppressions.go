package suppressions

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"justscan-backend/functions/authz"
	"justscan-backend/functions/resourceownership"
	effectivesuppressions "justscan-backend/functions/suppressions"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func ListAllSuppressions(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, accessibleOrgIDs, ok := authz.RequireOwnershipContext(c, db)
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

		scope := c.Query("scope")
		suppressions, total, err := effectivesuppressions.LoadEffectiveSuppressionsPage(c.Request.Context(), db, userID, isAdmin, accessibleOrgIDs, scope, page, limit, statusFilter, search)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load suppressions"})
			return
		}

		appliesCounts, err := loadSuppressionAppliesImageCounts(c.Request.Context(), c, db, suppressions, userID, isAdmin, accessibleOrgIDs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load suppression image counts"})
			return
		}

		for i := range suppressions {
			suppressions[i].AppliesImageCount = appliesCounts[suppressions[i].ImageDigest]
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

		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		var body struct {
			VulnID        string     `json:"vuln_id" binding:"required"`
			Status        string     `json:"status" binding:"required,oneof=accepted wont_fix false_positive"`
			Justification string     `json:"justification"`
			ExpiresAt     *time.Time `json:"expires_at"`
			OrgID         string     `json:"org_id"`
			IsGlobal      bool       `json:"is_global"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		ownerType := models.OwnerTypeUser
		ownerUserID := &userID
		var ownerOrgID *uuid.UUID
		if body.IsGlobal {
			if !isAdmin {
				c.JSON(http.StatusForbidden, gin.H{"error": "admin access required for global suppressions"})
				return
			}
			if strings.TrimSpace(body.OrgID) != "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "global suppressions cannot have org ownership"})
				return
			}
			ownerType = models.OwnerTypeSystem
			ownerUserID = nil
			ownerOrgID = nil
		} else if body.OrgID != "" {
			parsedOrgID, err := uuid.Parse(body.OrgID)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
				return
			}
			if _, _, _, _, ok := authz.RequireOrgRole(c, db, parsedOrgID, models.OrgRoleEditor); !ok {
				return
			}
			ownerType = models.OwnerTypeOrg
			ownerUserID = nil
			ownerOrgID = &parsedOrgID
		}

		existing := &models.Suppression{}
		query := db.NewSelect().Model(existing).
			Where("image_digest = ? AND vuln_id = ?", digest, body.VulnID)
		if ownerType == models.OwnerTypeSystem {
			query = query.Where("owner_type = ?", models.OwnerTypeSystem)
			query = query.Where("owner_user_id IS NULL")
			query = query.Where("owner_org_id IS NULL")
		} else if ownerOrgID != nil {
			query = query.Where("owner_type = ?", models.OwnerTypeOrg)
			query = query.Where("owner_org_id = ?", *ownerOrgID)
		} else {
			query = query.Where("owner_type = ?", models.OwnerTypeUser)
			query = query.Where("owner_org_id IS NULL")
			query = query.Where("owner_user_id = ? OR (user_id = ? AND owner_user_id IS NULL)", userID, userID)
		}
		err := query.Scan(c.Request.Context())

		if err == nil {
			// Update existing
			existing.Status = body.Status
			existing.Justification = body.Justification
			existing.UserID = userID
			existing.OwnerType = ownerType
			existing.OwnerUserID = ownerUserID
			existing.OwnerOrgID = ownerOrgID
			existing.ExpiresAt = body.ExpiresAt
			existing.UpdatedAt = time.Now()
			if err := db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
				if _, err := tx.NewUpdate().Model(existing).
					Column("status", "justification", "user_id", "owner_type", "owner_user_id", "owner_org_id", "expires_at", "updated_at").
					Where("id = ?", existing.ID).
					Exec(ctx); err != nil {
					return err
				}
				if ownerOrgID != nil {
					if err := ensureOrgSuppressionLink(ctx, tx, *ownerOrgID, existing.ID); err != nil {
						return err
					}
				}
				return nil
			}); err != nil {
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
			OwnerType:     ownerType,
			OwnerUserID:   ownerUserID,
			OwnerOrgID:    ownerOrgID,
			ExpiresAt:     body.ExpiresAt,
			CreatedAt:     time.Now(),
			UpdatedAt:     time.Now(),
		}
		if err := db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
			if _, err := tx.NewInsert().Model(supp).Exec(ctx); err != nil {
				return err
			}
			if ownerOrgID != nil {
				if err := ensureOrgSuppressionLink(ctx, tx, *ownerOrgID, supp.ID); err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save suppression"})
			return
		}
		c.JSON(http.StatusCreated, supp)
	}
}

func ListSuppressions(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, accessibleOrgIDs, ok := authz.RequireOwnershipContext(c, db)
		if !ok {
			return
		}

		digest := c.Param("digest")
		var suppressions []models.Suppression
		query := db.NewSelect().Model(&suppressions).
			Where("image_digest = ?", digest).
			OrderExpr("created_at DESC")
		if !isAdmin {
			query = effectivesuppressions.ApplySuppressionVisibility(query, "", &userID, accessibleOrgIDs)
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

		targetOrgID, ok := parseSuppressionMutationOrg(c, db, isAdmin)
		if !ok {
			return
		}

		suppression, found := loadSuppressionByDigestAndVuln(c, db, digest, vulnID, userID, isAdmin, targetOrgID)
		if !found {
			return
		}

		if _, err := db.NewDelete().Model((*models.Suppression)(nil)).
			Where("id = ?", suppression.ID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete suppression"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"result": "deleted"})
	}
}

type suppressionShare struct {
	OrgID          uuid.UUID `bun:"org_id" json:"org_id"`
	OrgName        string    `bun:"org_name" json:"org_name"`
	OrgDescription string    `bun:"org_description" json:"org_description"`
	IsOwner        bool      `bun:"-" json:"is_owner"`
}

type suppressionAppliesDigestCount struct {
	ImageDigest string `bun:"image_digest"`
	Count       int    `bun:"count"`
}

type suppressionAppliedImage struct {
	ImageName    string    `bun:"image_name" json:"image_name"`
	ImageTag     string    `bun:"image_tag" json:"image_tag"`
	ImageDigest  string    `bun:"image_digest" json:"image_digest"`
	LatestScanID string    `bun:"latest_scan_id" json:"latest_scan_id"`
	LatestSeenAt time.Time `bun:"latest_seen_at" json:"latest_seen_at"`
}

func DeleteSuppressionByID(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		suppression, _, _, ok := loadSuppressionForShareManagement(c, db)
		if !ok {
			return
		}

		if _, err := db.NewDelete().Model((*models.Suppression)(nil)).
			Where("id = ?", suppression.ID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete suppression"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"result": "deleted"})
	}
}

func ListSuppressionShares(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		suppression, _, _, ok := loadSuppressionForShareManagement(c, db)
		if !ok {
			return
		}

		var shares []suppressionShare
		if err := db.NewSelect().
			TableExpr("org_suppressions AS org_suppression").
			ColumnExpr("o.id AS org_id").
			ColumnExpr("o.name AS org_name").
			ColumnExpr("o.description AS org_description").
			Join("JOIN orgs AS o ON o.id = org_suppression.org_id").
			Where("org_suppression.suppression_id = ?", suppression.ID).
			OrderExpr("o.name ASC").
			Scan(c.Request.Context(), &shares); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list suppression shares"})
			return
		}

		ownerPresent := false
		for index := range shares {
			shares[index].IsOwner = suppression.OwnerOrgID != nil && shares[index].OrgID == *suppression.OwnerOrgID
			ownerPresent = ownerPresent || shares[index].IsOwner
		}
		if suppression.OwnerOrgID != nil && !ownerPresent {
			org := &models.Org{}
			if err := db.NewSelect().Model(org).
				Column("id", "name", "description").
				Where("id = ?", *suppression.OwnerOrgID).
				Scan(c.Request.Context()); err == nil {
				shares = append([]suppressionShare{{
					OrgID:          org.ID,
					OrgName:        org.Name,
					OrgDescription: org.Description,
					IsOwner:        true,
				}}, shares...)
			}
		}

		c.JSON(http.StatusOK, gin.H{"data": shares})
	}
}

func ListSuppressionImages(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		suppressionID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid suppression ID"})
			return
		}

		userID, isAdmin, accessibleOrgIDs, ok := authz.RequireOwnershipContext(c, db)
		if !ok {
			return
		}

		suppression := &models.Suppression{}
		q := db.NewSelect().Model(suppression).Where("id = ?", suppressionID)
		if !isAdmin {
			q = effectivesuppressions.ApplySuppressionVisibility(q, "", &userID, accessibleOrgIDs)
		}
		q = effectivesuppressions.ApplySuppressionWorkspaceScope(q, "", c.Query("scope"), userID)
		if err := q.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "suppression not found"})
			return
		}

		imageDigest := strings.TrimSpace(suppression.ImageDigest)
		if imageDigest == "" {
			c.JSON(http.StatusOK, gin.H{"data": []suppressionAppliedImage{}, "total": 0})
			return
		}

		rows := make([]suppressionAppliedImage, 0)
		query := db.NewSelect().
			TableExpr("scans AS scan").
			ColumnExpr("DISTINCT ON (scan.image_name, scan.image_tag, scan.image_digest) scan.image_name").
			ColumnExpr("scan.image_tag").
			ColumnExpr("scan.image_digest").
			ColumnExpr("scan.id::text AS latest_scan_id").
			ColumnExpr("scan.created_at AS latest_seen_at").
			Where("scan.image_digest = ?", imageDigest).
			OrderExpr("scan.image_name, scan.image_tag, scan.image_digest, scan.created_at DESC")
		query = authz.ApplyOwnershipVisibility(query, "scan", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
		query = authz.ApplyWorkspaceScopeValue(query, "scan", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, c.Query("scope"))
		if err := query.Scan(c.Request.Context(), &rows); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load suppression images"})
			return
		}

		sort.Slice(rows, func(i, j int) bool {
			return rows[i].LatestSeenAt.After(rows[j].LatestSeenAt)
		})

		c.JSON(http.StatusOK, gin.H{"data": rows, "total": len(rows)})
	}
}

func ShareSuppression(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		suppression, _, isAdmin, ok := loadSuppressionForShareManagement(c, db)
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
		if suppression.OwnerOrgID != nil && *suppression.OwnerOrgID == targetOrgID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "resource is already owned by that organization"})
			return
		}
		if !isAdmin {
			if _, _, _, _, ok := authz.RequireOrgRole(c, db, targetOrgID, models.OrgRoleEditor); !ok {
				return
			}
		}

		if _, err := db.NewInsert().Model(&models.OrgSuppression{OrgID: targetOrgID, SuppressionID: suppression.ID}).On("CONFLICT DO NOTHING").Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to share suppression"})
			return
		}

		c.JSON(http.StatusCreated, gin.H{"result": "shared"})
	}
}

func UnshareSuppression(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		suppression, _, _, ok := loadSuppressionForShareManagement(c, db)
		if !ok {
			return
		}

		targetOrgID, err := uuid.Parse(c.Param("orgId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
			return
		}
		if suppression.OwnerOrgID != nil && *suppression.OwnerOrgID == targetOrgID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot remove the owner organization"})
			return
		}

		if _, err := db.NewDelete().Model((*models.OrgSuppression)(nil)).
			Where("org_id = ?", targetOrgID).
			Where("suppression_id = ?", suppression.ID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to revoke suppression share"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"result": "unshared"})
	}
}

func TransferSuppressionOwnership(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		suppressionID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid suppression ID"})
			return
		}
		suppression := &models.Suppression{}
		if err := db.NewSelect().Model(suppression).Where("id = ?", suppressionID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "suppression not found"})
			return
		}
		if _, ok := resourceownership.TransferOrgOwnedResource(c, db, resourceownership.TransferParams{
			ResourceID: suppression.ID, OwnerType: suppression.OwnerType, OwnerOrgID: suppression.OwnerOrgID,
			ResourceTable: "suppressions", LinkTable: "org_suppressions", LinkResourceColumn: "suppression_id",
			ResourceName: "suppression", HasUpdatedAt: true,
		}); !ok {
			return
		}
		c.JSON(http.StatusOK, gin.H{"result": "ownership transferred"})
	}
}

func loadSuppressionForShareManagement(c *gin.Context, db *bun.DB) (*models.Suppression, uuid.UUID, bool, bool) {
	suppressionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid suppression ID"})
		return nil, uuid.Nil, false, false
	}

	userID, isAdmin, ok := authz.RequireRequestUser(c, db)
	if !ok {
		return nil, uuid.Nil, false, false
	}

	suppression := &models.Suppression{}
	if err := db.NewSelect().Model(suppression).Where("id = ?", suppressionID).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "suppression not found"})
		return nil, uuid.Nil, false, false
	}

	if !canManageSuppression(c.Request.Context(), db, suppression, userID, isAdmin) {
		c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
		return nil, uuid.Nil, false, false
	}

	return suppression, userID, isAdmin, true
}

func canManageSuppression(ctx context.Context, db *bun.DB, suppression *models.Suppression, userID uuid.UUID, isAdmin bool) bool {
	if suppression == nil {
		return false
	}
	if suppression.OwnerType == models.OwnerTypeSystem {
		return isAdmin
	}
	if isAdmin || suppression.UserID == userID {
		return true
	}
	if suppression.OwnerUserID != nil && *suppression.OwnerUserID == userID {
		return true
	}
	if suppression.OwnerOrgID == nil {
		return false
	}
	roles, err := authz.LoadUserOrgRoles(ctx, db, userID)
	if err != nil {
		return false
	}
	return authz.HasOrgRoleAtLeast(roles, *suppression.OwnerOrgID, models.OrgRoleEditor)
}

func parseSuppressionMutationOrg(c *gin.Context, db *bun.DB, isAdmin bool) (*uuid.UUID, bool) {
	orgIDValue := c.Query("org_id")
	if orgIDValue == "" {
		return nil, true
	}

	orgID, err := uuid.Parse(orgIDValue)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
		return nil, false
	}
	if !isAdmin {
		if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleViewer); !ok {
			return nil, false
		}
	}

	return &orgID, true
}

func loadSuppressionByDigestAndVuln(c *gin.Context, db *bun.DB, digest, vulnID string, userID uuid.UUID, isAdmin bool, targetOrgID *uuid.UUID) (*models.Suppression, bool) {
	suppression := &models.Suppression{}
	query := db.NewSelect().Model(suppression).
		Where("image_digest = ? AND vuln_id = ?", digest, vulnID)
	if targetOrgID != nil {
		query = query.Where("owner_org_id = ?", *targetOrgID)
	} else {
		query = query.Where("owner_org_id IS NULL")
		query = query.Where("owner_user_id = ? OR (user_id = ? AND owner_user_id IS NULL)", userID, userID)
	}
	if err := query.Scan(c.Request.Context()); err != nil {
		if !isAdmin {
			c.JSON(http.StatusNotFound, gin.H{"error": "suppression not found"})
		} else {
			c.JSON(http.StatusNotFound, gin.H{"error": "suppression not found"})
		}
		return nil, false
	}
	if !canManageSuppression(c.Request.Context(), db, suppression, userID, isAdmin) {
		c.JSON(http.StatusForbidden, gin.H{"error": "access denied"})
		return nil, false
	}
	return suppression, true
}

func loadSuppressionAppliesImageCounts(ctx context.Context, c *gin.Context, db *bun.DB, suppressions []models.Suppression, userID uuid.UUID, isAdmin bool, accessibleOrgIDs []uuid.UUID) (map[string]int, error) {
	digestSet := make(map[string]struct{})
	digests := make([]string, 0, len(suppressions))
	for _, suppression := range suppressions {
		digest := strings.TrimSpace(suppression.ImageDigest)
		if digest == "" {
			continue
		}
		if _, exists := digestSet[digest]; exists {
			continue
		}
		digestSet[digest] = struct{}{}
		digests = append(digests, digest)
	}
	if len(digests) == 0 {
		return map[string]int{}, nil
	}

	rows := make([]suppressionAppliesDigestCount, 0, len(digests))
	q := db.NewSelect().
		TableExpr("scans AS scan").
		ColumnExpr("scan.image_digest").
		ColumnExpr("COUNT(DISTINCT CONCAT_WS('|', scan.image_name, scan.image_tag, scan.image_digest)) AS count").
		Where("scan.image_digest IN (?)", bun.In(digests)).
		GroupExpr("scan.image_digest")
	q = authz.ApplyOwnershipVisibility(q, "scan", "user_id", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, isAdmin, accessibleOrgIDs)
	q = authz.ApplyWorkspaceScopeValue(q, "scan", "owner_user_id", "owner_org_id", "org_scans", "scan_id", userID, c.Query("scope"))
	if err := q.Scan(ctx, &rows); err != nil {
		return nil, err
	}

	counts := make(map[string]int, len(rows))
	for _, row := range rows {
		counts[row.ImageDigest] = row.Count
	}

	return counts, nil
}

func ensureOrgSuppressionLink(ctx context.Context, db bun.IDB, orgID, suppressionID uuid.UUID) error {
	_, err := db.NewInsert().Model(&models.OrgSuppression{OrgID: orgID, SuppressionID: suppressionID}).On("CONFLICT DO NOTHING").Exec(ctx)
	return err
}
