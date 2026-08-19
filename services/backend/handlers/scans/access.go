package scans

import (
	"context"
	"net/http"

	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// LoadAuthorizedScan ensures the caller can read the scan.
func LoadAuthorizedScan(c *gin.Context, db *bun.DB, scanID uuid.UUID) (*models.Scan, uuid.UUID, bool, bool) {
	userID, isAdmin, ok := authz.RequireRequestUser(c, db)
	if !ok {
		return nil, uuid.Nil, false, false
	}

	scan := &models.Scan{}
	if err := db.NewSelect().Model(scan).Where("id = ?", scanID).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "scan not found"})
		return nil, uuid.Nil, false, false
	}

	if canReadScan(c.Request.Context(), db, scan, userID, isAdmin) {
		return scan, userID, isAdmin, true
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "scan not found"})
	return nil, uuid.Nil, false, false
}

// LoadAuthorizedScanForWrite ensures the caller can mutate the scan.
func LoadAuthorizedScanForWrite(c *gin.Context, db *bun.DB, scanID uuid.UUID) (*models.Scan, uuid.UUID, bool, bool) {
	userID, isAdmin, ok := authz.RequireRequestUser(c, db)
	if !ok {
		return nil, uuid.Nil, false, false
	}

	scan := &models.Scan{}
	if err := db.NewSelect().Model(scan).Where("id = ?", scanID).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "scan not found"})
		return nil, uuid.Nil, false, false
	}

	if canWriteScan(c.Request.Context(), db, scan, userID, isAdmin) {
		return scan, userID, isAdmin, true
	}

	c.JSON(http.StatusNotFound, gin.H{"error": "scan not found"})
	return nil, uuid.Nil, false, false
}

// ScanAccessContext contains the already-resolved identity used when checking
// whether a caller can read a scan. Keeping this separate from gin.Context
// lets non-HTTP integrations, such as the MCP server, reuse the same boundary.
type ScanAccessContext struct {
	UserID           uuid.UUID
	IsAdmin          bool
	AccessibleOrgIDs []uuid.UUID
}

// CanReadScan checks scan visibility for an already-authenticated caller.
// Callers must resolve AccessibleOrgIDs before invoking this function for a
// non-admin user.
func CanReadScan(ctx context.Context, db *bun.DB, scan *models.Scan, access ScanAccessContext) bool {
	if scan == nil {
		return false
	}
	if access.IsAdmin {
		return true
	}
	if scan.UserID != nil && *scan.UserID == access.UserID {
		return true
	}
	if scan.OwnerUserID != nil && *scan.OwnerUserID == access.UserID {
		return true
	}
	if len(access.AccessibleOrgIDs) == 0 {
		return false
	}
	if scan.OwnerOrgID != nil {
		for _, orgID := range access.AccessibleOrgIDs {
			if orgID == *scan.OwnerOrgID {
				return true
			}
		}
	}
	shared, err := db.NewSelect().
		TableExpr("org_scans").
		Where("scan_id = ?", scan.ID).
		Where("org_id IN (?)", bun.In(access.AccessibleOrgIDs)).
		Exists(ctx)
	return err == nil && shared
}

func canReadScan(ctx context.Context, db *bun.DB, scan *models.Scan, userID uuid.UUID, isAdmin bool) bool {
	orgIDs, err := authz.ListAccessibleOrgIDs(ctx, db, userID, isAdmin)
	if err != nil {
		return false
	}
	return CanReadScan(ctx, db, scan, ScanAccessContext{
		UserID:           userID,
		IsAdmin:          isAdmin,
		AccessibleOrgIDs: orgIDs,
	})
}

func canWriteScan(ctx context.Context, db *bun.DB, scan *models.Scan, userID uuid.UUID, isAdmin bool) bool {
	return CanWriteScan(ctx, db, scan, ScanAccessContext{UserID: userID, IsAdmin: isAdmin})
}

// CanWriteScan checks scan mutation visibility for an already-authenticated
// caller. It deliberately mirrors the REST rescan permission boundary so
// integrations cannot mutate scans that the REST API would hide.
func CanWriteScan(ctx context.Context, db *bun.DB, scan *models.Scan, access ScanAccessContext) bool {
	if scan == nil {
		return false
	}
	if access.IsAdmin {
		return true
	}
	if scan.UserID != nil && *scan.UserID == access.UserID {
		return true
	}
	if scan.OwnerUserID != nil && *scan.OwnerUserID == access.UserID {
		return true
	}
	if scan.OwnerOrgID == nil {
		return false
	}
	roles, err := authz.LoadUserOrgRoles(ctx, db, access.UserID)
	if err != nil {
		return false
	}
	return authz.HasOrgRoleAtLeast(roles, *scan.OwnerOrgID, models.OrgRoleEditor)
}

func EnsureOrgScanLink(ctx context.Context, db bun.IDB, orgID, scanID uuid.UUID) error {
	_, err := db.NewInsert().Model(&models.OrgScan{OrgID: orgID, ScanID: scanID}).On("CONFLICT DO NOTHING").Exec(ctx)
	return err
}

func CopyOrgScanLinks(ctx context.Context, db bun.IDB, sourceScanID, targetScanID uuid.UUID) error {
	var orgScans []models.OrgScan
	if err := db.NewSelect().Model(&orgScans).Where("scan_id = ?", sourceScanID).Scan(ctx); err != nil {
		return err
	}
	for _, orgScan := range orgScans {
		if err := EnsureOrgScanLink(ctx, db, orgScan.OrgID, targetScanID); err != nil {
			return err
		}
	}
	return nil
}
