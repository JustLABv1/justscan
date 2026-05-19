package admins

import (
	"net/http"
	"strings"
	"time"

	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type adminOrgSummary struct {
	ID                 uuid.UUID `json:"id"`
	Name               string    `json:"name"`
	Description        string    `json:"description"`
	CreatedByID        uuid.UUID `json:"created_by_id"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
	IsActive           bool      `json:"is_active"`
	AllowImageScans    bool      `json:"allow_image_scans"`
	AllowHelmScans     bool      `json:"allow_helm_scans"`
	AllowRescans       bool      `json:"allow_rescans"`
	AllowMemberInvites bool      `json:"allow_member_invites"`
	AllowOrgTokens     bool      `json:"allow_org_tokens"`
	MemberCount        int       `json:"member_count"`
	PendingInviteCount int       `json:"pending_invite_count"`
	ActiveTokenCount   int       `json:"active_token_count"`
}

func ListOrgs(c *gin.Context, db *bun.DB) {
	query := strings.TrimSpace(c.Query("q"))
	var orgs []models.Org
	q := db.NewSelect().Model(&orgs).OrderExpr("created_at DESC")
	if query != "" {
		q = q.Where("name ILIKE ? OR description ILIKE ?", "%"+query+"%", "%"+query+"%")
	}
	if err := q.Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list organizations"})
		return
	}

	result := make([]adminOrgSummary, 0, len(orgs))
	for _, org := range orgs {
		memberCount, _ := db.NewSelect().Model((*models.OrgMember)(nil)).Where("org_id = ?", org.ID).Count(c.Request.Context())
		pendingInviteCount, _ := db.NewSelect().Model((*models.OrgInvite)(nil)).
			Where("org_id = ?", org.ID).
			Where("accepted_at IS NULL").
			Where("revoked_at IS NULL").
			Where("expires_at > now()").
			Count(c.Request.Context())
		activeTokenCount, _ := db.NewSelect().Model((*models.Tokens)(nil)).
			Where("org_id = ?", org.ID).
			Where("disabled = false").
			Count(c.Request.Context())
		result = append(result, adminOrgSummary{
			ID:                 org.ID,
			Name:               org.Name,
			Description:        org.Description,
			CreatedByID:        org.CreatedByID,
			CreatedAt:          org.CreatedAt,
			UpdatedAt:          org.UpdatedAt,
			IsActive:           org.IsActive,
			AllowImageScans:    org.AllowImageScans,
			AllowHelmScans:     org.AllowHelmScans,
			AllowRescans:       org.AllowRescans,
			AllowMemberInvites: org.AllowMemberInvites,
			AllowOrgTokens:     org.AllowOrgTokens,
			MemberCount:        memberCount,
			PendingInviteCount: pendingInviteCount,
			ActiveTokenCount:   activeTokenCount,
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}

func GetOrgGovernance(c *gin.Context, db *bun.DB) {
	orgID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
		return
	}

	org := &models.Org{}
	if err := db.NewSelect().Model(org).Where("id = ?", orgID).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "organization not found"})
		return
	}

	c.JSON(http.StatusOK, org)
}

func UpdateOrgGovernance(c *gin.Context, db *bun.DB) {
	orgID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
		return
	}

	org := &models.Org{}
	if err := db.NewSelect().Model(org).Where("id = ?", orgID).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "organization not found"})
		return
	}

	var body struct {
		IsActive           *bool `json:"is_active"`
		AllowImageScans    *bool `json:"allow_image_scans"`
		AllowHelmScans     *bool `json:"allow_helm_scans"`
		AllowRescans       *bool `json:"allow_rescans"`
		AllowMemberInvites *bool `json:"allow_member_invites"`
		AllowOrgTokens     *bool `json:"allow_org_tokens"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if body.IsActive != nil {
		org.IsActive = *body.IsActive
	}
	if body.AllowImageScans != nil {
		org.AllowImageScans = *body.AllowImageScans
	}
	if body.AllowHelmScans != nil {
		org.AllowHelmScans = *body.AllowHelmScans
	}
	if body.AllowRescans != nil {
		org.AllowRescans = *body.AllowRescans
	}
	if body.AllowMemberInvites != nil {
		org.AllowMemberInvites = *body.AllowMemberInvites
	}
	if body.AllowOrgTokens != nil {
		org.AllowOrgTokens = *body.AllowOrgTokens
	}
	org.UpdatedAt = time.Now()

	if _, err := db.NewUpdate().Model(org).
		Column("is_active", "allow_image_scans", "allow_helm_scans", "allow_rescans", "allow_member_invites", "allow_org_tokens", "updated_at").
		Where("id = ?", orgID).
		Exec(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update organization governance"})
		return
	}

	c.JSON(http.StatusOK, org)
}
