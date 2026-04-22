package orgs

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"

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
			NewOwnerID     string `json:"new_owner_id"`
			NewOwnerUserID string `json:"new_owner_user_id"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		newOwnerValue := strings.TrimSpace(body.NewOwnerID)
		if newOwnerValue == "" {
			newOwnerValue = strings.TrimSpace(body.NewOwnerUserID)
		}
		if newOwnerValue == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "new_owner_id or new_owner_user_id is required"})
			return
		}

		newOwnerID, err := uuid.Parse(newOwnerValue)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid new_owner_id"})
			return
		}

		// Verify the new owner is a member of the org
		newOwnerMembership, err := authz.LoadOrgMembership(c.Request.Context(), db, orgID, newOwnerID)
		if err != nil || newOwnerMembership == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "new owner must be an existing member of the organization"})
			return
		}
		if newOwnerMembership.Role == models.OrgRoleOwner {
			c.JSON(http.StatusBadRequest, gin.H{"error": "selected member is already the owner"})
			return
		}

		var currentOwner models.OrgMember
		hasCurrentOwner := true
		if err := db.NewSelect().Model(&currentOwner).
			Where("org_id = ? AND role = ?", orgID, models.OrgRoleOwner).
			Scan(c.Request.Context()); err != nil {
			if err == sql.ErrNoRows {
				hasCurrentOwner = false
			} else {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "organization owner could not be determined"})
				return
			}
		}

		ctx := c.Request.Context()
		err = db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
			if hasCurrentOwner {
				// Demote current owner to admin when one exists.
				if _, err := tx.NewUpdate().Model((*models.OrgMember)(nil)).
					Set("role = ?", models.OrgRoleAdmin).
					Set("updated_at = now()").
					Where("org_id = ? AND user_id = ?", orgID, currentOwner.UserID).
					Exec(ctx); err != nil {
					return err
				}
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
			func() string {
				if hasCurrentOwner {
					return fmt.Sprintf("Ownership transferred from %s to %s", currentOwner.UserID, newOwnerID)
				}
				return fmt.Sprintf("Ownership assigned to %s", newOwnerID)
			}())

		c.JSON(http.StatusOK, gin.H{"result": "ownership transferred"})
	}
}
