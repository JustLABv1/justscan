package search

import (
	"net/http"
	"strings"

	authfuncs "justscan-backend/functions/auth"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

type imageResult struct {
	ImageName string `bun:"image_name" json:"image_name"`
	ScanCount int    `bun:"scan_count" json:"scan_count"`
}

type vulnResult struct {
	VulnID    string `bun:"vuln_id"    json:"vuln_id"`
	PkgName   string `bun:"pkg_name"   json:"pkg_name"`
	Severity  string `bun:"severity"   json:"severity"`
	ScanCount int    `bun:"scan_count" json:"scan_count"`
}

// Search returns matching images and vulnerabilities for a query string.
// Query param: q (required, max 200 chars)
func Search(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx := c.Request.Context()

		q := strings.TrimSpace(c.Query("q"))
		if q == "" {
			c.JSON(http.StatusOK, gin.H{"images": []imageResult{}, "vulns": []vulnResult{}})
			return
		}
		if len(q) > 200 {
			q = q[:200]
		}
		pattern := "%" + q + "%"

		userID, err := authfuncs.GetUserIDFromToken(c.GetHeader("Authorization"))
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		tokenType, _ := authfuncs.GetTypeFromToken(c.GetHeader("Authorization"))
		isAdmin := tokenType == "admin"

		// ── Images ───────────────────────────────────────────────────
		var images []imageResult
		imgQ := db.NewSelect().
			TableExpr("scans").
			ColumnExpr("image_name").
			ColumnExpr("COUNT(*) AS scan_count").
			Where("image_name ILIKE ?", pattern).
			GroupExpr("image_name").
			OrderExpr("COUNT(*) DESC").
			Limit(6)

		if !isAdmin {
			imgQ = imgQ.Where("user_id = ?", userID)
		}
		imgQ.Scan(ctx, &images) //nolint:errcheck
		if images == nil {
			images = []imageResult{}
		}

		// ── Vulnerabilities (CVE ID or package name) ──────────────────
		var vulns []vulnResult
		vulnQ := db.NewSelect().
			TableExpr("vulnerabilities v").
			Join("JOIN scans s ON s.id = v.scan_id").
			ColumnExpr("v.vuln_id").
			ColumnExpr("v.pkg_name").
			ColumnExpr("v.severity").
			ColumnExpr("COUNT(DISTINCT v.scan_id) AS scan_count").
			Where("(v.vuln_id ILIKE ? OR v.pkg_name ILIKE ?)", pattern, pattern).
			GroupExpr("v.vuln_id, v.pkg_name, v.severity").
			OrderExpr("COUNT(DISTINCT v.scan_id) DESC, v.severity ASC").
			Limit(6)

		if !isAdmin {
			vulnQ = vulnQ.Where("s.user_id = ?", userID)
		}
		vulnQ.Scan(ctx, &vulns) //nolint:errcheck
		if vulns == nil {
			vulns = []vulnResult{}
		}

		c.JSON(http.StatusOK, gin.H{"images": images, "vulns": vulns})
	}
}
