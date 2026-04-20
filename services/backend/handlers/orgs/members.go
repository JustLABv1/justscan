package orgs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func ListMembers(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleMember); !ok {
			return
		}

		type row struct {
			OrgID     uuid.UUID `bun:"org_id"`
			UserID    uuid.UUID `bun:"user_id"`
			Role      string    `bun:"role"`
			JoinedAt  time.Time `bun:"joined_at"`
			CreatedAt time.Time `bun:"created_at"`
			Email     string    `bun:"email"`
			Username  string    `bun:"username"`
		}

		var rows []row
		if err := db.NewRaw(`
			SELECT om.org_id, om.user_id, om.role, om.joined_at, om.created_at, u.email, u.username
			FROM org_members om
			JOIN users u ON u.id = om.user_id
			WHERE om.org_id = ?
			ORDER BY CASE om.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, lower(u.username), lower(u.email)
		`, orgID).Scan(c.Request.Context(), &rows); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load organization members"})
			return
		}

		members := make([]models.OrgMember, 0, len(rows))
		for _, row := range rows {
			members = append(members, models.OrgMember{
				OrgID:     row.OrgID,
				UserID:    row.UserID,
				Role:      row.Role,
				JoinedAt:  row.JoinedAt,
				CreatedAt: row.CreatedAt,
				Email:     row.Email,
				Username:  row.Username,
			})
		}

		c.JSON(http.StatusOK, gin.H{"data": members})
	}
}

func UpdateMemberRole(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		_, requesterMember, _, isAdmin, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleAdmin)
		if !ok {
			return
		}
		if !isAdmin && (requesterMember == nil || requesterMember.Role != models.OrgRoleOwner) {
			c.JSON(http.StatusForbidden, gin.H{"error": "only organization owners can change member roles"})
			return
		}

		targetUserID, err := uuid.Parse(c.Param("userId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
			return
		}

		var body struct {
			Role string `json:"role" binding:"required,oneof=admin member"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		targetMembership, err := authz.LoadOrgMembership(c.Request.Context(), db, orgID, targetUserID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "organization member not found"})
			return
		}
		if targetMembership.Role == models.OrgRoleOwner {
			c.JSON(http.StatusForbidden, gin.H{"error": "owner role cannot be changed through this endpoint"})
			return
		}

		if _, err := db.NewUpdate().Model((*models.OrgMember)(nil)).
			Set("role = ?", body.Role).
			Set("updated_at = now()").
			Where("org_id = ? AND user_id = ?", orgID, targetUserID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update organization member"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"result": "updated"})
	}
}

func RemoveMember(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		_, requesterMember, _, isAdmin, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleAdmin)
		if !ok {
			return
		}

		targetUserID, err := uuid.Parse(c.Param("userId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user ID"})
			return
		}

		targetMembership, err := authz.LoadOrgMembership(c.Request.Context(), db, orgID, targetUserID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "organization member not found"})
			return
		}
		if targetMembership.Role == models.OrgRoleOwner {
			c.JSON(http.StatusForbidden, gin.H{"error": "organization owners cannot be removed through this endpoint"})
			return
		}
		if !isAdmin && requesterMember != nil && requesterMember.Role == models.OrgRoleAdmin && targetMembership.Role != models.OrgRoleMember {
			c.JSON(http.StatusForbidden, gin.H{"error": "organization admins can only remove members"})
			return
		}

		if _, err := db.NewDelete().Model((*models.OrgMember)(nil)).
			Where("org_id = ? AND user_id = ?", orgID, targetUserID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove organization member"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"result": "removed"})
	}
}

func ListInvites(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleAdmin); !ok {
			return
		}

		var invites []models.OrgInvite
		if err := db.NewSelect().Model(&invites).
			Where("org_id = ?", orgID).
			Where("accepted_at IS NULL").
			Where("revoked_at IS NULL").
			OrderExpr("created_at DESC").
			Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load organization invites"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"data": invites})
	}
}

func ListMyInvites(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		user := &models.Users{}
		if err := db.NewSelect().Model(user).
			Column("id", "email", "username").
			Where("id = ?", userID).
			Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unable to resolve current user"})
			return
		}

		normalizedEmail := strings.ToLower(strings.TrimSpace(user.Email))
		if normalizedEmail == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "current user does not have an email address"})
			return
		}

		type row struct {
			models.OrgInvite
			OrgName        string `bun:"org_name"`
			OrgDescription string `bun:"org_description"`
			InvitedByEmail string `bun:"invited_by_email"`
			InvitedByName  string `bun:"invited_by_username"`
		}

		var rows []row
		if err := db.NewRaw(`
			SELECT oi.*, o.name AS org_name, o.description AS org_description,
			       u.email AS invited_by_email, u.username AS invited_by_username
			FROM org_invites oi
			JOIN orgs o ON o.id = oi.org_id
			JOIN users u ON u.id = oi.invited_by_user_id
			WHERE lower(oi.email) = ?
			  AND oi.accepted_at IS NULL
			  AND oi.revoked_at IS NULL
			  AND oi.expires_at > now()
			ORDER BY oi.created_at DESC
		`, normalizedEmail).Scan(c.Request.Context(), &rows); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load pending organization invites"})
			return
		}

		invites := make([]models.OrgInvite, 0, len(rows))
		for _, row := range rows {
			invite := row.OrgInvite
			invite.OrgName = row.OrgName
			invite.OrgDescription = row.OrgDescription
			invite.InvitedByEmail = row.InvitedByEmail
			invite.InvitedByName = row.InvitedByName
			invites = append(invites, invite)
		}

		c.JSON(http.StatusOK, gin.H{"data": invites})
	}
}

func CreateInvite(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		_, requesterMember, userID, isAdmin, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleAdmin)
		if !ok {
			return
		}

		var body struct {
			Email string `json:"email" binding:"required,email"`
			Role  string `json:"role" binding:"required,oneof=admin member"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if !isAdmin && requesterMember != nil && requesterMember.Role == models.OrgRoleAdmin && body.Role != models.OrgRoleMember {
			c.JSON(http.StatusForbidden, gin.H{"error": "organization admins can only invite members"})
			return
		}

		normalizedEmail := strings.ToLower(strings.TrimSpace(body.Email))
		if normalizedEmail == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "email is required"})
			return
		}

		var memberExists bool
		if err := db.NewRaw(`
			SELECT EXISTS (
				SELECT 1
				FROM org_members om
				JOIN users u ON u.id = om.user_id
				WHERE om.org_id = ? AND lower(u.email) = ?
			)
		`, orgID, normalizedEmail).Scan(c.Request.Context(), &memberExists); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to validate organization invite"})
			return
		}
		if memberExists {
			c.JSON(http.StatusConflict, gin.H{"error": "user is already a member of this organization"})
			return
		}

		var inviteExists bool
		if err := db.NewRaw(`
			SELECT EXISTS (
				SELECT 1
				FROM org_invites
				WHERE org_id = ?
				  AND lower(email) = ?
				  AND accepted_at IS NULL
				  AND revoked_at IS NULL
				  AND expires_at > now()
			)
		`, orgID, normalizedEmail).Scan(c.Request.Context(), &inviteExists); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to validate organization invite"})
			return
		}
		if inviteExists {
			c.JSON(http.StatusConflict, gin.H{"error": "an active invite already exists for this email"})
			return
		}

		raw := make([]byte, 32)
		if _, err := rand.Read(raw); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate invite token"})
			return
		}

		now := time.Now()
		invite := &models.OrgInvite{
			OrgID:           orgID,
			Email:           normalizedEmail,
			Role:            body.Role,
			Token:           hex.EncodeToString(raw),
			InvitedByUserID: userID,
			ExpiresAt:       now.Add(7 * 24 * time.Hour),
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		if _, err := db.NewInsert().Model(invite).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create organization invite"})
			return
		}

		c.JSON(http.StatusCreated, invite)
	}
}

func RevokeInvite(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		_, requesterMember, _, isAdmin, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleAdmin)
		if !ok {
			return
		}

		inviteID, err := uuid.Parse(c.Param("inviteId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid invite ID"})
			return
		}

		invite := &models.OrgInvite{}
		if err := db.NewSelect().Model(invite).
			Where("id = ? AND org_id = ?", inviteID, orgID).
			Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "organization invite not found"})
			return
		}
		if invite.AcceptedAt != nil || invite.RevokedAt != nil {
			c.JSON(http.StatusConflict, gin.H{"error": "organization invite is no longer active"})
			return
		}
		if !isAdmin && requesterMember != nil && requesterMember.Role == models.OrgRoleAdmin && invite.Role != models.OrgRoleMember {
			c.JSON(http.StatusForbidden, gin.H{"error": "organization admins can only revoke member invites"})
			return
		}

		if _, err := db.NewUpdate().Model((*models.OrgInvite)(nil)).
			Set("revoked_at = now()").
			Set("updated_at = now()").
			Where("id = ?", inviteID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to revoke organization invite"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"result": "revoked"})
	}
}

func DeclineInvite(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		inviteID, err := uuid.Parse(c.Param("inviteId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid invite ID"})
			return
		}

		userID, _, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		user := &models.Users{}
		if err := db.NewSelect().Model(user).
			Column("id", "email", "username").
			Where("id = ?", userID).
			Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unable to resolve current user"})
			return
		}

		invite := &models.OrgInvite{}
		if err := db.NewSelect().Model(invite).
			Where("id = ?", inviteID).
			Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "organization invite not found"})
			return
		}
		if invite.RevokedAt != nil || invite.AcceptedAt != nil {
			c.JSON(http.StatusConflict, gin.H{"error": "organization invite is no longer active"})
			return
		}
		if invite.ExpiresAt.Before(time.Now()) {
			c.JSON(http.StatusGone, gin.H{"error": "organization invite has expired"})
			return
		}
		if !strings.EqualFold(strings.TrimSpace(user.Email), strings.TrimSpace(invite.Email)) {
			c.JSON(http.StatusForbidden, gin.H{"error": "organization invite email does not match the current user"})
			return
		}

		if _, err := db.NewUpdate().Model((*models.OrgInvite)(nil)).
			Set("revoked_at = now()").
			Set("updated_at = now()").
			Where("id = ?", inviteID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to decline organization invite"})
			return
		}

		c.JSON(http.StatusOK, gin.H{"result": "declined"})
	}
}

func AcceptInviteByID(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		inviteID, err := uuid.Parse(c.Param("inviteId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid invite ID"})
			return
		}

		user, ok := loadCurrentInviteUser(c, db)
		if !ok {
			return
		}

		invite := &models.OrgInvite{}
		if err := db.NewSelect().Model(invite).
			Where("id = ?", inviteID).
			Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "organization invite not found"})
			return
		}

		completeInviteAcceptance(c, db, user, invite)
	}
}

func AcceptInviteByToken(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := strings.TrimSpace(c.Param("token"))
		if token == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invite token is required"})
			return
		}

		user, ok := loadCurrentInviteUser(c, db)
		if !ok {
			return
		}

		invite := &models.OrgInvite{}
		if err := db.NewSelect().Model(invite).
			Where("token = ?", token).
			Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "organization invite not found"})
			return
		}

		completeInviteAcceptance(c, db, user, invite)
	}
}

func loadCurrentInviteUser(c *gin.Context, db *bun.DB) (*models.Users, bool) {
	userID, _, ok := authz.RequireRequestUser(c, db)
	if !ok {
		return nil, false
	}

	user := &models.Users{}
	if err := db.NewSelect().Model(user).
		Column("id", "email", "username").
		Where("id = ?", userID).
		Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unable to resolve current user"})
		return nil, false
	}

	return user, true
}

func completeInviteAcceptance(c *gin.Context, db *bun.DB, user *models.Users, invite *models.OrgInvite) {
	if invite.RevokedAt != nil || invite.AcceptedAt != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "organization invite is no longer active"})
		return
	}
	if invite.ExpiresAt.Before(time.Now()) {
		c.JSON(http.StatusGone, gin.H{"error": "organization invite has expired"})
		return
	}
	if !strings.EqualFold(strings.TrimSpace(user.Email), strings.TrimSpace(invite.Email)) {
		c.JSON(http.StatusForbidden, gin.H{"error": "organization invite email does not match the current user"})
		return
	}

	now := time.Now()
	acceptedBy := user.ID
	if err := db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
		member := &models.OrgMember{
			OrgID:     invite.OrgID,
			UserID:    user.ID,
			Role:      invite.Role,
			JoinedAt:  now,
			CreatedAt: now,
			UpdatedAt: now,
		}
		if _, err := tx.NewInsert().Model(member).
			On("CONFLICT (org_id, user_id) DO NOTHING").
			Exec(ctx); err != nil {
			return err
		}

		if _, err := tx.NewUpdate().Model((*models.OrgInvite)(nil)).
			Set("accepted_by_user_id = ?", acceptedBy).
			Set("accepted_at = ?", now).
			Set("updated_at = ?", now).
			Where("id = ?", invite.ID).
			Exec(ctx); err != nil {
			return err
		}

		return nil
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to accept organization invite"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"result":   "accepted",
		"org_id":   invite.OrgID,
		"org_name": loadOrgName(c.Request.Context(), db, invite.OrgID),
		"role":     invite.Role,
	})
}

func loadOrgName(ctx context.Context, db *bun.DB, orgID uuid.UUID) string {
	org := &models.Org{}
	if err := db.NewSelect().Model(org).Column("name").Where("id = ?", orgID).Scan(ctx); err != nil {
		return ""
	}
	return org.Name
}
