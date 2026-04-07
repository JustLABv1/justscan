package auths

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"justscan-backend/config"
	"justscan-backend/functions/auth"
	"justscan-backend/functions/httperror"
	"justscan-backend/pkg/models"

	gooidc "github.com/coreos/go-oidc/v3/oidc"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

// OIDCCallback handles the redirect from the OIDC provider after the user authenticates.
// Flow:
//  1. Verify state cookie to prevent CSRF.
//  2. Exchange authorization code for tokens.
//  3. Verify the ID token.
//  4. Look up / provision the local user account.
//  5. Re-evaluate the user's role from OIDC group/role claims.
//  6. Issue a JustScan JWT and redirect the frontend with it in the URL fragment.
func OIDCCallback(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		cfg := config.Config
		if !cfg.OIDC.Enabled {
			httperror.StatusNotFound(c, "OIDC is not enabled", errors.New("oidc not enabled"))
			return
		}

		// --- 1. Verify state ---
		stateParam := c.Query("state")
		stateCookie, err := c.Cookie("oidc_state")
		if err != nil || stateCookie == "" || stateCookie != stateParam {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid or missing state parameter"})
			return
		}
		// Clear state cookie immediately after verification.
		c.SetSameSite(http.SameSiteLaxMode)
		c.SetCookie("oidc_state", "", -1, "/", "", false, true)

		// Check for error from provider (e.g. user denied consent)
		if errParam := c.Query("error"); errParam != "" {
			desc := c.Query("error_description")
			c.JSON(http.StatusUnauthorized, gin.H{"error": errParam, "error_description": desc})
			return
		}

		code := c.Query("code")
		if code == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "missing authorization code"})
			return
		}

		// --- 2. Exchange code for tokens ---
		oauth2Cfg := auth.GetOIDCOAuth2Config()
		token, err := oauth2Cfg.Exchange(c.Request.Context(), code)
		if err != nil {
			httperror.InternalServerError(c, "Failed to exchange authorization code", err)
			return
		}

		// --- 3. Verify ID token ---
		provider := auth.GetOIDCProvider()
		if provider == nil {
			httperror.InternalServerError(c, "OIDC provider not initialised", errors.New("oidc provider is nil"))
			return
		}

		oidcVerifier := provider.Verifier(&gooidc.Config{ClientID: cfg.OIDC.ClientID})
		rawIDToken, ok := token.Extra("id_token").(string)
		if !ok {
			httperror.InternalServerError(c, "ID token missing from provider response", errors.New("no id_token in token response"))
			return
		}
		idToken, err := oidcVerifier.Verify(c.Request.Context(), rawIDToken)
		if err != nil {
			httperror.InternalServerError(c, "Failed to verify ID token", err)
			return
		}

		// --- 4. Extract claims ---
		claims, err := auth.ExtractOIDCClaims(idToken)
		if err != nil {
			httperror.InternalServerError(c, "Failed to extract OIDC claims", err)
			return
		}

		if cfg.OIDC.Debug {
			log.WithFields(log.Fields{
				"subject":            claims.Sub,
				"email":              claims.Email,
				"preferred_username": claims.PreferredUsername,
				"groups_claim":       cfg.OIDC.GroupsClaim,
				"roles_claim":        cfg.OIDC.RolesClaim,
				"extracted_groups":   claims.Groups,
				"extracted_roles":    claims.Roles,
				"raw_claims":         claims.RawClaims,
			}).Info("OIDC user details received from provider")
		}

		// --- 5. Find or provision local user ---
		user, err := findOrProvisionUser(c, db, claims)
		if err != nil {
			httperror.InternalServerError(c, "Failed to provision user account", err)
			return
		}

		// Check if the account is disabled.
		if user.Disabled {
			c.JSON(http.StatusForbidden, gin.H{"error": "account is disabled: " + user.DisabledReason})
			return
		}

		// --- 6. Re-evaluate admin role ---
		newRole := "user"
		if auth.IsAdmin(claims) {
			newRole = "admin"
		}
		if user.Role != newRole {
			user.Role = newRole
			if _, err := db.NewUpdate().Model(user).Column("role").Where("id = ?", user.ID).Exec(c.Request.Context()); err != nil {
				// Non-fatal: log but continue.
				_ = fmt.Errorf("oidc: failed to update user role: %w", err)
			}
		}

		// --- 7. Issue JWT ---
		tokenString, expiresAt, err := auth.GenerateJWT(user.ID, false)
		if err != nil {
			httperror.InternalServerError(c, "Failed to generate session token", err)
			return
		}

		dbToken := models.Tokens{
			UserID:      user.ID.String(),
			Key:         tokenString,
			Description: "OIDC login",
			Type:        "user",
			ExpiresAt:   time.Unix(expiresAt, 0),
			CreatedAt:   time.Now(),
		}
		if _, err := db.NewInsert().Model(&dbToken).Exec(c.Request.Context()); err != nil {
			httperror.InternalServerError(c, "Failed to store session token", err)
			return
		}

		// --- 8. Redirect to frontend with token in URL fragment ---
		frontendOrigin := deriveFrontendOrigin(cfg)
		c.Redirect(http.StatusFound, frontendOrigin+"/auth/oidc/callback#token="+tokenString)
	}
}

// findOrProvisionUser looks up the user by OIDC subject, then by email (to link
// existing local accounts), and JIT-creates a new account if neither is found.
func findOrProvisionUser(c *gin.Context, db *bun.DB, claims *auth.OIDCClaims) (*models.Users, error) {
	ctx := c.Request.Context()

	// 1. Look up by OIDC subject.
	var user models.Users
	err := db.NewSelect().Model(&user).Where("oidc_subject = ?", claims.Sub).Scan(ctx)
	if err == nil {
		return &user, nil
	}

	// 2. Look up by email (auto-link existing local account).
	if claims.Email != "" {
		var existing models.Users
		err = db.NewSelect().Model(&existing).Where("email = ?", claims.Email).Scan(ctx)
		if err == nil {
			// Link this local account to the OIDC subject.
			existing.OIDCSubject = &claims.Sub
			if _, err := db.NewUpdate().Model(&existing).Column("oidc_subject").Where("id = ?", existing.ID).Exec(ctx); err != nil {
				return nil, fmt.Errorf("oidc: failed to link existing user account: %w", err)
			}
			return &existing, nil
		}
	}

	// 3. JIT-create a new user.
	username := sanitiseUsername(claims.PreferredUsername)
	if username == "" {
		username = "oidc-user"
	}
	// Ensure username is unique.
	username, err = uniqueUsername(ctx, db, username)
	if err != nil {
		return nil, err
	}

	email := claims.Email
	if email == "" {
		// Synthesise a placeholder email so the not-null constraint is satisfied.
		email = claims.Sub + "@oidc.local"
	}

	// Check how many users exist to decide the first-user admin rule.
	count, err := db.NewSelect().Model((*models.Users)(nil)).Count(ctx)
	if err != nil {
		return nil, fmt.Errorf("oidc: failed to count users: %w", err)
	}

	role := "user"
	if count == 0 {
		role = "admin"
	}

	newUser := &models.Users{
		ID:          uuid.New(),
		Username:    username,
		Email:       email,
		Password:    "", // No password for OIDC users.
		Role:        role,
		OIDCSubject: &claims.Sub,
		AuthType:    "oidc",
	}

	if _, err := db.NewInsert().Model(newUser).
		Column("id", "username", "email", "password", "role", "oidc_subject", "auth_type").
		Exec(ctx); err != nil {
		return nil, fmt.Errorf("oidc: failed to create user: %w", err)
	}

	return newUser, nil
}

// deriveFrontendOrigin returns the first allow_origins entry, stripping trailing slashes.
// Falls back to an empty string (relative redirect) if none is configured.
func deriveFrontendOrigin(cfg *config.RestfulConf) string {
	if len(cfg.AllowOrigins) > 0 {
		return strings.TrimRight(cfg.AllowOrigins[0], "/")
	}
	return ""
}

// sanitiseUsername removes characters not suitable for a username while preserving
// email-style usernames such as user@example.com.
func sanitiseUsername(s string) string {
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' || r == '@' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// uniqueUsername appends a numeric suffix if the desired username is already taken.
func uniqueUsername(ctx context.Context, db *bun.DB, desired string) (string, error) {
	candidate := desired
	for i := 2; i <= 9999; i++ {
		exists, err := db.NewSelect().Model((*models.Users)(nil)).Where("username = ?", candidate).Exists(ctx)
		if err != nil {
			return "", fmt.Errorf("oidc: failed to check username uniqueness: %w", err)
		}
		if !exists {
			return candidate, nil
		}
		candidate = fmt.Sprintf("%s%d", desired, i)
	}
	return "", errors.New("oidc: could not find a unique username")
}
