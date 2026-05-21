package users

import (
	"net/http"
	"time"

	"justscan-backend/functions/auth"
	"justscan-backend/functions/httperror"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

type workspaceTourStateResponse struct {
	Completed   bool       `json:"completed"`
	CompletedAt *time.Time `json:"completed_at"`
}

type workspaceTourStateRequest struct {
	Completed bool `json:"completed"`
}

func GetWorkspaceTourState(context *gin.Context, db *bun.DB) {
	userID, err := auth.GetUserIDFromToken(context.GetHeader("Authorization"))
	if err != nil {
		httperror.Unauthorized(context, "Error receiving userID from token", err)
		return
	}

	var user models.Users
	if err := db.NewSelect().
		Model(&user).
		Column("workspace_tour_completed_at").
		Where("id = ?", userID).
		Scan(context); err != nil {
		httperror.InternalServerError(context, "Error collecting workspace tour state from db", err)
		return
	}

	context.JSON(http.StatusOK, workspaceTourStateResponse{
		Completed:   user.WorkspaceTourCompletedAt != nil,
		CompletedAt: user.WorkspaceTourCompletedAt,
	})
}

func UpdateWorkspaceTourState(context *gin.Context, db *bun.DB) {
	userID, err := auth.GetUserIDFromToken(context.GetHeader("Authorization"))
	if err != nil {
		httperror.Unauthorized(context, "Error receiving userID from token", err)
		return
	}

	var body workspaceTourStateRequest
	if err := context.ShouldBindJSON(&body); err != nil {
		httperror.StatusBadRequest(context, "Error parsing incoming data", err)
		return
	}

	var completedAt *time.Time
	if body.Completed {
		now := time.Now().UTC()
		completedAt = &now
	}

	_, err = db.NewUpdate().
		Model((*models.Users)(nil)).
		Set("workspace_tour_completed_at = ?", completedAt).
		Set("updated_at = ?", time.Now().UTC()).
		Where("id = ?", userID).
		Exec(context)
	if err != nil {
		httperror.InternalServerError(context, "Error updating workspace tour state on db", err)
		return
	}

	context.JSON(http.StatusOK, workspaceTourStateResponse{
		Completed:   body.Completed,
		CompletedAt: completedAt,
	})
}
