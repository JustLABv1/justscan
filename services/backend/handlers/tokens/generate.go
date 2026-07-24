package tokens

import (
	"net/http"
	"time"

	"justscan-backend/config"
	"justscan-backend/functions/audit"
	"justscan-backend/functions/auth"
	"justscan-backend/functions/httperror"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type TokenRequest struct {
	Email      string `json:"email"`
	Password   string `json:"password"`
	RememberMe bool   `json:"remember_me"`
	Client     string `json:"client"`
}

func GenerateTokenUser(db *bun.DB, context *gin.Context) {
	if !config.LocalAuthEnabled() {
		context.JSON(http.StatusForbidden, gin.H{"error": "local authentication is disabled"})
		context.Abort()
		return
	}

	var request TokenRequest
	if err := context.ShouldBindJSON(&request); err != nil {
		context.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		context.Abort()
		return
	}

	// get user
	var user models.Users
	err := db.NewSelect().Model(&user).Where("email = ? OR username = ?", request.Email, request.Email).Scan(context)
	if err != nil {
		httperror.Unauthorized(context, "user not found", err)
		return
	}

	// check if user account is disabled
	if user.Disabled {
		httperror.Unauthorized(context, "user account is disabled", err)
		return
	}
	// check if password is correct
	credentialError := user.CheckPassword(request.Password)
	if credentialError != nil {
		httperror.Unauthorized(context, "password is incorrect", credentialError)
		return
	}

	if err := auth.RecordSuccessfulLogin(context.Request.Context(), db, &user, "local"); err != nil {
		httperror.InternalServerError(context, "Error updating login metadata", err)
		return
	}

	// generate token
	tokenString, ExpiresAt, err := auth.GenerateJWT(user.ID, request.RememberMe)
	if err != nil {
		httperror.InternalServerError(context, "Error generating user token", err)
		return
	}

	// write token in tokens table
	tokenType := "user"
	description := "User token"
	if request.Client == "justscan_cli" {
		tokenType = "cli_session"
		description = "JustScan CLI session"
	}
	token := models.Tokens{
		UserID:      user.ID.String(),
		Key:         tokenString,
		Description: description,
		Type:        tokenType,
		ExpiresAt:   time.Unix(ExpiresAt, 0),
		CreatedAt:   time.Now(),
	}
	_, err = db.NewInsert().Model(&token).Exec(context)
	if err != nil {
		httperror.InternalServerError(context, "Error writing token to db", err)
		return
	}

	type UserResponse struct {
		ID                       uuid.UUID  `json:"id"`
		Email                    string     `json:"email"`
		Username                 string     `json:"username"`
		Disabled                 bool       `json:"disabled"`
		DisabledReason           string     `json:"disabled_reason"`
		Role                     string     `json:"role"`
		AuthType                 string     `json:"auth_type"`
		LastLoginAt              *time.Time `json:"last_login_at,omitempty"`
		LastLoginMethod          string     `json:"last_login_method"`
		WorkspaceTourCompletedAt *time.Time `json:"workspace_tour_completed_at,omitempty"`
	}
	userResponse := UserResponse{
		ID:                       user.ID,
		Email:                    user.Email,
		Username:                 user.Username,
		Disabled:                 user.Disabled,
		DisabledReason:           user.DisabledReason,
		Role:                     user.Role,
		AuthType:                 user.AuthType,
		LastLoginAt:              user.LastLoginAt,
		LastLoginMethod:          user.LastLoginMethod,
		WorkspaceTourCompletedAt: user.WorkspaceTourCompletedAt,
	}

	context.JSON(http.StatusOK, gin.H{"token": tokenString, "user": userResponse, "expires_at": ExpiresAt})

	go audit.Write(context.Request.Context(), db, user.ID.String(), "user.login", "Login from IP: "+context.ClientIP())
}
