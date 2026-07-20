package scans

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"justscan-backend/compliance"
	"justscan-backend/functions/audit"
	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type bulkWorkspaceRequest struct {
	IDs   []string `json:"ids" binding:"required,min=1"`
	OrgID string   `json:"org_id"`
}

type bulkTransferOwnershipRequest struct {
	IDs         []string `json:"ids" binding:"required,min=1"`
	TargetType  string   `json:"target_type" binding:"required,oneof=user org"`
	TargetOrgID string   `json:"target_org_id"`
}

// BulkGrantScanOrgAccess shares scans with an organization without changing ownership.
func BulkGrantScanOrgAccess(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		var req bulkWorkspaceRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}
		targetOrgID, err := uuid.Parse(strings.TrimSpace(req.OrgID))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
			return
		}
		if !isAdmin {
			if _, _, _, _, ok := authz.RequireOrgRole(c, db, targetOrgID, models.OrgRoleEditor); !ok {
				return
			}
		}

		scanIDs, ok := loadWritableScanIDs(c, db, req.IDs, userID, isAdmin)
		if !ok {
			return
		}
		if err := db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
			for _, scanID := range scanIDs {
				if err := EnsureOrgScanLink(ctx, tx, targetOrgID, scanID); err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to share scans with workspace"})
			return
		}

		for _, scanID := range scanIDs {
			go compliance.RunForScan(db, scanID)
		}
		go audit.Write(context.Background(), db, userID.String(), "scan.bulk_share_workspace", fmt.Sprintf("Shared %d scans with organization %s", len(scanIDs), targetOrgID))
		c.JSON(http.StatusOK, gin.H{"result": "shared", "count": len(scanIDs)})
	}
}

// BulkTransferScanOwnership moves scans into the caller's personal workspace or an organization.
// Transfers deliberately revoke every previous organization grant so the destination is the sole workspace.
func BulkTransferScanOwnership(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		var req bulkTransferOwnershipRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		var targetOrgID *uuid.UUID
		if req.TargetType == models.OwnerTypeOrg {
			parsedOrgID, err := uuid.Parse(strings.TrimSpace(req.TargetOrgID))
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid target_org_id"})
				return
			}
			targetOrgID = &parsedOrgID
			if !isAdmin {
				if _, _, _, _, ok := authz.RequireOrgRole(c, db, parsedOrgID, models.OrgRoleEditor); !ok {
					return
				}
			}
		}

		scanIDs, ok := loadWritableScanIDs(c, db, req.IDs, userID, isAdmin)
		if !ok {
			return
		}

		if err := db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
			if _, err := tx.NewDelete().Model((*models.OrgScan)(nil)).Where("scan_id IN (?)", bun.In(scanIDs)).Exec(ctx); err != nil {
				return err
			}
			if _, err := tx.NewDelete().Model((*models.ComplianceResult)(nil)).Where("scan_id IN (?)", bun.In(scanIDs)).Exec(ctx); err != nil {
				return err
			}
			if err := pruneTransferredScanMetadata(ctx, tx, scanIDs, userID, targetOrgID); err != nil {
				return err
			}

			if targetOrgID == nil {
				if _, err := tx.NewUpdate().Model((*models.Scan)(nil)).
					Set("owner_type = ?", models.OwnerTypeUser).
					Set("owner_user_id = ?", userID).
					Set("owner_org_id = NULL").
					Set("user_id = ?", userID).
					Where("id IN (?)", bun.In(scanIDs)).Exec(ctx); err != nil {
					return err
				}
				return nil
			}

			if _, err := tx.NewUpdate().Model((*models.Scan)(nil)).
				Set("owner_type = ?", models.OwnerTypeOrg).
				Set("owner_user_id = NULL").
				Set("owner_org_id = ?", *targetOrgID).
				Set("user_id = NULL").
				Where("id IN (?)", bun.In(scanIDs)).Exec(ctx); err != nil {
				return err
			}
			for _, scanID := range scanIDs {
				if err := EnsureOrgScanLink(ctx, tx, *targetOrgID, scanID); err != nil {
					return err
				}
			}
			return nil
		}); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to transfer scan ownership"})
			return
		}

		if targetOrgID != nil {
			for _, scanID := range scanIDs {
				go compliance.RunForScan(db, scanID)
			}
		}
		destination := "personal workspace"
		if targetOrgID != nil {
			destination = "organization " + targetOrgID.String()
		}
		go audit.Write(context.Background(), db, userID.String(), "scan.bulk_transfer_ownership", fmt.Sprintf("Transferred %d scans to %s", len(scanIDs), destination))
		c.JSON(http.StatusOK, gin.H{"result": "ownership transferred", "count": len(scanIDs)})
	}
}

func loadWritableScanIDs(c *gin.Context, db *bun.DB, rawIDs []string, userID uuid.UUID, isAdmin bool) ([]uuid.UUID, bool) {
	scanIDs := make([]uuid.UUID, 0, len(rawIDs))
	seen := make(map[uuid.UUID]struct{}, len(rawIDs))
	for _, rawID := range rawIDs {
		scanID, err := uuid.Parse(rawID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID: " + rawID})
			return nil, false
		}
		if _, exists := seen[scanID]; exists {
			continue
		}
		seen[scanID] = struct{}{}
		scan := &models.Scan{}
		if err := db.NewSelect().Model(scan).Where("id = ?", scanID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "scan not found: " + rawID})
			return nil, false
		}
		if !canWriteScan(c.Request.Context(), db, scan, userID, isAdmin) {
			c.JSON(http.StatusForbidden, gin.H{"error": "insufficient permissions to change scan workspace"})
			return nil, false
		}
		scanIDs = append(scanIDs, scanID)
	}
	return scanIDs, true
}

func pruneTransferredScanMetadata(ctx context.Context, tx bun.Tx, scanIDs []uuid.UUID, userID uuid.UUID, targetOrgID *uuid.UUID) error {
	if targetOrgID == nil {
		if _, err := tx.NewRaw(`
DELETE FROM scan_tags AS st
USING tags AS t
WHERE st.tag_id = t.id
  AND st.scan_id IN (?)
  AND NOT (t.owner_type = ? OR t.owner_user_id = ?)
`, bun.In(scanIDs), models.OwnerTypeSystem, userID).Exec(ctx); err != nil {
			return err
		}
		_, err := tx.NewRaw(`
DELETE FROM scan_collection_memberships AS scm
USING scan_collections AS c
WHERE scm.collection_id = c.id
  AND scm.scan_id IN (?)
  AND c.owner_user_id IS DISTINCT FROM ?
`, bun.In(scanIDs), userID).Exec(ctx)
		return err
	}

	if _, err := tx.NewRaw(`
DELETE FROM scan_tags AS st
USING tags AS t
WHERE st.tag_id = t.id
  AND st.scan_id IN (?)
  AND NOT (
    t.owner_type = ?
    OR t.owner_org_id = ?
    OR EXISTS (SELECT 1 FROM org_tags AS ot WHERE ot.tag_id = t.id AND ot.org_id = ?)
  )
`, bun.In(scanIDs), models.OwnerTypeSystem, *targetOrgID, *targetOrgID).Exec(ctx); err != nil {
		return err
	}
	_, err := tx.NewRaw(`
DELETE FROM scan_collection_memberships AS scm
USING scan_collections AS c
WHERE scm.collection_id = c.id
  AND scm.scan_id IN (?)
  AND c.owner_org_id IS DISTINCT FROM ?
`, bun.In(scanIDs), *targetOrgID).Exec(ctx)
	return err
}
