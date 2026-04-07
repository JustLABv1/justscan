package admins

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

// AdminScanRow extends the scans table with joined owner info.
type AdminScanRow struct {
	ID              string  `bun:"id" json:"id"`
	ImageName       string  `bun:"image_name" json:"image_name"`
	ImageTag        string  `bun:"image_tag" json:"image_tag"`
	ImageDigest     string  `bun:"image_digest" json:"image_digest"`
	Status          string  `bun:"status" json:"status"`
	CriticalCount   int     `bun:"critical_count" json:"critical_count"`
	HighCount       int     `bun:"high_count" json:"high_count"`
	MediumCount     int     `bun:"medium_count" json:"medium_count"`
	LowCount        int     `bun:"low_count" json:"low_count"`
	UnknownCount    int     `bun:"unknown_count" json:"unknown_count"`
	SuppressedCount int     `bun:"suppressed_count" json:"suppressed_count"`
	Platform        string  `bun:"platform" json:"platform"`
	Architecture    string  `bun:"architecture" json:"architecture"`
	CreatedAt       string  `bun:"created_at" json:"created_at"`
	StartedAt       *string `bun:"started_at" json:"started_at"`
	CompletedAt     *string `bun:"completed_at" json:"completed_at"`
	HelmChart       string  `bun:"helm_chart" json:"helm_chart,omitempty"`
	HelmSourcePath  string  `bun:"helm_source_path" json:"helm_source_path,omitempty"`
	ShareToken      string  `bun:"share_token" json:"share_token,omitempty"`
	ShareVisibility string  `bun:"share_visibility" json:"share_visibility,omitempty"`
	OwnerEmail      string  `bun:"owner_email" json:"owner_email,omitempty"`
	OwnerUsername   string  `bun:"owner_username" json:"owner_username,omitempty"`
}

// ListAdminScans returns all scans across all users including anonymous public scans.
func ListAdminScans(c *gin.Context, db *bun.DB) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 200 {
		limit = 50
	}
	offset := (page - 1) * limit

	scans := make([]AdminScanRow, 0)

	q := db.NewSelect().
		TableExpr("scans AS s").
		ColumnExpr("s.id, s.image_name, s.image_tag, s.image_digest, s.status").
		ColumnExpr("s.critical_count, s.high_count, s.medium_count, s.low_count, s.unknown_count, s.suppressed_count").
		ColumnExpr("s.platform, s.architecture, s.created_at, s.started_at, s.completed_at").ColumnExpr("s.helm_chart, s.helm_source_path, COALESCE(s.share_token, '') AS share_token, COALESCE(s.share_visibility, '') AS share_visibility").ColumnExpr("COALESCE(u.email, '') AS owner_email, COALESCE(u.username, '') AS owner_username").
		Join("LEFT JOIN users u ON u.id = s.user_id").
		OrderExpr("s.created_at DESC").
		Limit(limit).
		Offset(offset)

	if status := c.Query("status"); status != "" {
		q = q.Where("s.status = ?", status)
	}
	if image := c.Query("image"); image != "" {
		q = q.Where("s.image_name ILIKE ?", "%"+image+"%")
	}
	if owner := c.Query("owner"); owner != "" {
		pattern := "%" + owner + "%"
		q = q.WhereGroup(" AND ", func(selectQuery *bun.SelectQuery) *bun.SelectQuery {
			return selectQuery.
				Where("u.email ILIKE ?", pattern).
				WhereOr("u.username ILIKE ?", pattern)
		})
	}
	if from := c.Query("from"); from != "" {
		if t, err := time.Parse(time.RFC3339, from); err == nil {
			q = q.Where("s.created_at >= ?", t)
		}
	}
	if to := c.Query("to"); to != "" {
		if t, err := time.Parse(time.RFC3339, to); err == nil {
			q = q.Where("s.created_at <= ?", t)
		}
	}
	if c.Query("helm_only") == "true" {
		q = q.Where("s.helm_chart != ''")
	}

	total, err := q.ScanAndCount(c.Request.Context(), &scans)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list scans"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data":  scans,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}
