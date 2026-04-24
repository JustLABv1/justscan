package middlewares

import (
	"errors"
	"strings"

	"justscan-backend/functions/auth"
	"justscan-backend/functions/gatekeeper"
	"justscan-backend/functions/httperror"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/uptrace/bun"
)

const (
	AuthContextUserIDKey     = "auth.user_id"
	AuthContextIsAdminKey    = "auth.is_admin"
	AuthContextOrgTokenIDKey = "auth.org_token_id"
	AuthContextOrgTokenOrgID = "auth.org_token_org_id"
)

func Auth(db *bun.DB) gin.HandlerFunc {
	return func(context *gin.Context) {
		raw := context.GetHeader("Authorization")
		if raw == "" {
			httperror.Unauthorized(context, "Request does not contain an access token", errors.New("request does not contain an access token"))
			return
		}
		tokenString := strings.TrimPrefix(raw, "Bearer ")
		err := auth.ValidateToken(tokenString)
		if err != nil {
			httperror.Unauthorized(context, "Token is not valid", err)
			return
		}

		valid, err := auth.ValidateTokenDBEntry(tokenString, db, context)
		if err != nil {
			httperror.InternalServerError(context, "Error receiving token from db", err)
			return
		}

		if !valid {
			httperror.Unauthorized(context, "The provided token is not valid", errors.New("the provided token is not valid"))
			return
		}

		tokenType, err := auth.GetTypeFromToken(tokenString)
		if err != nil {
			httperror.InternalServerError(context, "Error receiving token type", err)
			return
		}

		if tokenType == "user" || tokenType == "personal" {
			userId, err := auth.GetUserIDFromToken(tokenString)
			if err != nil {
				httperror.InternalServerError(context, "Error receiving userID from token", err)
				return
			}
			isAdmin, err := gatekeeper.CheckAdmin(userId, db)
			if err != nil {
				httperror.InternalServerError(context, "Error checking for user role", err)
				return
			}
			userDisabled, err := gatekeeper.CheckAccountStatus(userId.String(), db)
			if err != nil {
				httperror.InternalServerError(context, "Error checking for account status", err)
				return
			}
			if userDisabled {
				httperror.Unauthorized(context, "Your Account is currently disabled", errors.New("user is disabled"))
				return
			}

			context.Set(AuthContextUserIDKey, userId)
			context.Set(AuthContextIsAdminKey, isAdmin)

			context.Next()
		} else if tokenType == "project" || tokenType == "service" {
			tokenID, err := auth.GetIDFromToken(tokenString)
			if err != nil {
				httperror.InternalServerError(context, "Error receiving tokenID from token", err)
				return
			}

			// check for token in tokens table
			var token models.Tokens
			err = db.NewSelect().Model(&token).Where("id = ?", tokenID).Scan(context)
			if err != nil {
				httperror.Unauthorized(context, "Token is not valid", err)
				return
			}
			// check if token is disabled
			if token.Disabled {
				httperror.Unauthorized(context, "Token is currently disabled", errors.New("token is disabled"))
				return
			}

			context.Next()
		} else if tokenType == "org" {
			tokenID, err := auth.GetIDFromToken(tokenString)
			if err != nil {
				httperror.InternalServerError(context, "Error receiving tokenID from token", err)
				return
			}

			var token models.Tokens
			err = db.NewSelect().Model(&token).
				Column("id", "disabled", "disabled_reason", "org_id").
				Where("id = ?", tokenID).
				Scan(context)
			if err != nil {
				httperror.Unauthorized(context, "Token is not valid", err)
				return
			}
			if token.Disabled {
				httperror.Unauthorized(context, "Token is currently disabled", errors.New("token is disabled"))
				return
			}
			if token.OrgID == nil {
				httperror.Unauthorized(context, "Org token has no associated organization", errors.New("org token missing org_id"))
				return
			}

			context.Set(AuthContextOrgTokenIDKey, token.ID)
			context.Set(AuthContextOrgTokenOrgID, *token.OrgID)

			context.Next()
		} else {
			httperror.Unauthorized(context, "Token type is invalid", errors.New("invalid token type"))
		}
	}
}
