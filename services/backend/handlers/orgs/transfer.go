package orgs

import (
	"context"
	"fmt"
	"net/http"

	"justscan-backend/functions/audit"
	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

func TransferOwnership(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}

		_, requesterMember, userID, isAdmin, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleOwner)
		if !ok {
			return
		}
		if !isAdmin && (requesterMember == nil || requesterMember.Role != models.OrgRoleOwner) {
			c.JSON(http.StatusForbidden, gin.H{"error": "only the organization owner can transfer ownership"})
			return
		}

		var body struct {
			NewOwnerID string `json:"new_owner_id" binding:"required"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		newOwnerID, err := uuid.Parse(body.NewOwnerID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid new_owner_id"})
			return
		}
		if newOwnerID == userID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "you are already the owner"})
			return
		}

		// Verify the new owner is a member of the org
		newOwnerMembership, err := authz.LoadOrgMembership(c.Request.Context(), db, orgID, newOwnerID)
		if err != nil || newOwnerMembership == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "new owner must be an existing member of the organization"})
			return
		}

		ctx := c.Request.Context()
		err = db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
			// Demote current owner to admin
			if _, err := tx.NewUpdate().Model((*models.OrgMember)(nil)).
				Set("role = ?", models.OrgRoleAdmin).
				Set("updated_at = now()").
				Where("org_id = ? AND user_id = ?", orgID, userID).
				Exec(ctx); err != nil {
				return err
			}
			// Promote new owner
			if _, err := tx.NewUpdate().Model((*models.OrgMember)(nil)).
				Set("role = ?", models.OrgRoleOwner).
				Set("updated_at = now()").
				Where("org_id = ? AND user_id = ?", orgID, newOwnerID).
				Exec(ctx); err != nil {
				return err
			}
			return nil
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to transfer ownership"})
			return
		}

		go audit.WriteOrgAction(context.Background(), db, userID.String(), orgID, "org.transfer_ownership",
			fmt.Sprintf("Ownership transferred from %s to %s", userID, newOwnerID))

		c.JSON(http.StatusOK, gin.H{"result": "ownership transferred"})
	}
}
