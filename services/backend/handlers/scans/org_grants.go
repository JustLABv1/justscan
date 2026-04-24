package scans

import (
	"net/http"

	"justscan-backend/compliance"
	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type scanOrgGrant struct {
	OrgID          uuid.UUID `bun:"org_id" json:"org_id"`
	OrgName        string    `bun:"org_name" json:"org_name"`
	OrgDescription string    `bun:"org_description" json:"org_description"`
	IsOwner        bool      `bun:"-" json:"is_owner"`
}

func ListScanOrgGrants(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}
		scan, _, _, ok := LoadAuthorizedScanForWrite(c, db, scanID)
		if !ok {
			return
		}

		var grants []scanOrgGrant
		if err := db.NewSelect().
			TableExpr("org_scans AS org_scan").
			ColumnExpr("o.id AS org_id").
			ColumnExpr("o.name AS org_name").
			ColumnExpr("o.description AS org_description").
			Join("JOIN orgs AS o ON o.id = org_scan.org_id").
			Where("org_scan.scan_id = ?", scan.ID).
			OrderExpr("o.name ASC").
			Scan(c.Request.Context(), &grants); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list scan access grants"})
			return
		}

		for index := range grants {
			grants[index].IsOwner = scan.OwnerOrgID != nil && grants[index].OrgID == *scan.OwnerOrgID
		}

		c.JSON(http.StatusOK, gin.H{"data": grants})
	}
}

func GrantScanOrgAccess(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}
		scan, _, isAdmin, ok := LoadAuthorizedScanForWrite(c, db, scanID)
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
		if scan.OwnerOrgID != nil && *scan.OwnerOrgID == targetOrgID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "scan is already owned by that organization"})
			return
		}
		if !isAdmin {
			if _, _, _, _, ok := authz.RequireOrgRole(c, db, targetOrgID, models.OrgRoleEditor); !ok {
				return
			}
		}

		if err := EnsureOrgScanLink(c.Request.Context(), db, targetOrgID, scan.ID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to grant scan access"})
			return
		}

		go compliance.RunForScan(db, scan.ID)

		c.JSON(http.StatusCreated, gin.H{"result": "shared"})
	}
}

func RevokeScanOrgAccess(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}
		scan, _, _, ok := LoadAuthorizedScanForWrite(c, db, scanID)
		if !ok {
			return
		}

		targetOrgID, err := uuid.Parse(c.Param("orgId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
			return
		}
		if scan.OwnerOrgID != nil && *scan.OwnerOrgID == targetOrgID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot remove the owner organization"})
			return
		}

		if _, err := db.NewDelete().Model((*models.OrgScan)(nil)).
			Where("org_id = ?", targetOrgID).
			Where("scan_id = ?", scan.ID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to revoke scan access"})
			return
		}

		db.NewDelete().Model((*models.ComplianceResult)(nil)).
			Where("scan_id = ? AND org_id = ?", scan.ID, targetOrgID).
			Exec(c.Request.Context()) //nolint:errcheck

		c.JSON(http.StatusOK, gin.H{"result": "unshared"})
	}
}
