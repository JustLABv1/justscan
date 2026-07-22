package resourceownership

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"justscan-backend/functions/audit"
	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// TransferParams describes the already-validated resource table and its
// organization access table. Values are supplied only by server handlers.
type TransferParams struct {
	ResourceID         uuid.UUID
	OwnerType          string
	OwnerOrgID         *uuid.UUID
	ResourceTable      string
	LinkTable          string
	LinkResourceColumn string
	ResourceName       string
	HasUpdatedAt       bool
}

type TransferResult struct {
	SourceOrgID uuid.UUID
	TargetOrgID uuid.UUID
}

// TransferOrgOwnedResource moves an organization-owned resource to another
// organization while retaining the former owner's access grant.
func TransferOrgOwnedResource(c *gin.Context, db *bun.DB, params TransferParams) (TransferResult, bool) {
	if params.OwnerType != models.OwnerTypeOrg || params.OwnerOrgID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only organization-owned resources can be transferred"})
		return TransferResult{}, false
	}

	var body struct {
		OrgID string `json:"org_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return TransferResult{}, false
	}

	targetOrgID, err := uuid.Parse(strings.TrimSpace(body.OrgID))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
		return TransferResult{}, false
	}
	sourceOrgID := *params.OwnerOrgID
	if targetOrgID == sourceOrgID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "resource is already owned by that organization"})
		return TransferResult{}, false
	}

	_, _, userID, _, ok := authz.RequireOrgRole(c, db, sourceOrgID, models.OrgRoleAdmin)
	if !ok {
		return TransferResult{}, false
	}
	if _, _, _, _, ok := authz.RequireOrgRole(c, db, targetOrgID, models.OrgRoleAdmin); !ok {
		return TransferResult{}, false
	}

	err = db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
		linkQuery := fmt.Sprintf(
			"INSERT INTO %s (org_id, %s) VALUES (?, ?) ON CONFLICT DO NOTHING",
			params.LinkTable,
			params.LinkResourceColumn,
		)
		// A legacy resource may not have an owner link yet. Add it before the
		// owner changes so the former organization remains a shared workspace.
		for _, orgID := range []uuid.UUID{sourceOrgID, targetOrgID} {
			if _, err := tx.NewRaw(linkQuery, orgID, params.ResourceID).Exec(ctx); err != nil {
				return err
			}
		}

		setClauses := []string{"owner_type = ?", "owner_user_id = NULL", "owner_org_id = ?"}
		args := []any{models.OwnerTypeOrg, targetOrgID}
		if params.HasUpdatedAt {
			setClauses = append(setClauses, "updated_at = ?")
			args = append(args, time.Now())
		}
		args = append(args, params.ResourceID)
		updateQuery := fmt.Sprintf("UPDATE %s SET %s WHERE id = ?", params.ResourceTable, strings.Join(setClauses, ", "))
		_, err := tx.NewRaw(updateQuery, args...).Exec(ctx)
		return err
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to transfer ownership"})
		return TransferResult{}, false
	}

	details := fmt.Sprintf("%s %s ownership transferred from %s to %s", params.ResourceName, params.ResourceID, sourceOrgID, targetOrgID)
	operation := params.ResourceName + ".transfer_ownership"
	go audit.WriteOrgAction(context.Background(), db, userID.String(), sourceOrgID, operation, details)
	go audit.WriteOrgAction(context.Background(), db, userID.String(), targetOrgID, operation, details)

	return TransferResult{SourceOrgID: sourceOrgID, TargetOrgID: targetOrgID}, true
}
