package notifications

import (
	"fmt"
	"net/http"
	"strings"

	"justscan-backend/functions/authz"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// NotificationConditionOption is deliberately separate from the persisted
// predicate type: labels and descriptions are presentation data and must not
// leak into notification rule JSON.
type NotificationConditionOption struct {
	Value       string `json:"value"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
	Group       string `json:"group,omitempty"`
}

type notificationConditionOptionContext struct {
	scope            Scope
	userID           uuid.UUID
	isAdmin          bool
	accessibleOrgIDs []uuid.UUID
	orgID            uuid.UUID
}

var dynamicNotificationConditionFields = map[string]struct{}{
	"user_id":          {},
	"org_id":           {},
	"policy_id":        {},
	"policy_name":      {},
	"tag":              {},
	"image_ref":        {},
	"xray_policy_name": {},
	"xray_watch_name":  {},
}

// ListConditionOptions returns searchable values for condition fields whose
// values come from scoped resources. Finite values are intentionally kept in
// the editor catalog so they do not require a database round trip.
func ListConditionOptions(c *gin.Context, db *bun.DB, scope Scope) {
	field := strings.ToLower(strings.TrimSpace(c.Query("field")))
	if _, ok := dynamicNotificationConditionFields[field]; !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported condition option field"})
		return
	}

	optionContext, ok := resolveNotificationConditionOptionContext(c, db, scope)
	if !ok {
		return
	}

	limit := normalizeLimit(c.DefaultQuery("limit", "50"), 50, 100)
	query := strings.TrimSpace(c.Query("q"))
	if len(query) > 200 {
		query = query[:200]
	}

	options, err := loadNotificationConditionOptions(c, db, optionContext, field, query, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load condition options"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": options})
}

func resolveNotificationConditionOptionContext(c *gin.Context, db *bun.DB, scope Scope) (notificationConditionOptionContext, bool) {
	result := notificationConditionOptionContext{scope: scope}

	switch scope.Type {
	case models.NotificationScopeSystem:
		// The admin middleware owns this authorization boundary. System values
		// are therefore allowed to include all persisted resources.
		result.isAdmin = true
		return result, true
	case models.NotificationScopeOrg:
		orgID, err := uuid.Parse(scope.Ref)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid organization scope"})
			return notificationConditionOptionContext{}, false
		}
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return notificationConditionOptionContext{}, false
		}
		result.orgID = orgID
		result.userID = userID
		result.isAdmin = isAdmin
		return result, true
	case models.NotificationScopeUser:
		requestedUserID, err := uuid.Parse(scope.Ref)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user scope"})
			return notificationConditionOptionContext{}, false
		}
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return notificationConditionOptionContext{}, false
		}
		if userID != requestedUserID && !isAdmin {
			c.JSON(http.StatusForbidden, gin.H{"error": "insufficient notification scope"})
			return notificationConditionOptionContext{}, false
		}
		accessibleOrgIDs, err := authz.ListAccessibleOrgIDs(c.Request.Context(), db, userID, isAdmin)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve organization access"})
			return notificationConditionOptionContext{}, false
		}
		result.userID = userID
		result.isAdmin = isAdmin
		result.accessibleOrgIDs = accessibleOrgIDs
		return result, true
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid notification scope"})
		return notificationConditionOptionContext{}, false
	}
}

func loadNotificationConditionOptions(
	c *gin.Context,
	db *bun.DB,
	optionContext notificationConditionOptionContext,
	field string,
	query string,
	limit int,
) ([]NotificationConditionOption, error) {
	switch field {
	case "user_id":
		return loadNotificationUserOptions(c, db, optionContext, query, limit)
	case "org_id":
		return loadNotificationOrgOptions(c, db, optionContext, query, limit)
	case "policy_id", "policy_name":
		return loadNotificationPolicyOptions(c, db, optionContext, field, query, limit)
	case "tag":
		return loadNotificationTagOptions(c, db, optionContext, query, limit)
	case "image_ref":
		return loadNotificationImageOptions(c, db, optionContext, query, limit)
	case "xray_policy_name", "xray_watch_name":
		return loadNotificationXrayOptions(c, db, optionContext, field, query, limit)
	default:
		return nil, fmt.Errorf("unsupported condition option field %q", field)
	}
}

func loadNotificationUserOptions(
	c *gin.Context,
	db *bun.DB,
	optionContext notificationConditionOptionContext,
	query string,
	limit int,
) ([]NotificationConditionOption, error) {
	where := "1 = 1"
	args := make([]interface{}, 0)
	join := ""
	switch optionContext.scope.Type {
	case models.NotificationScopeOrg:
		where = "om.org_id = ?"
		args = append(args, optionContext.orgID)
	case models.NotificationScopeUser:
		if !optionContext.isAdmin {
			clauses := []string{"u.id = ?"}
			args = append(args, optionContext.userID)
			if len(optionContext.accessibleOrgIDs) > 0 {
				join = "LEFT JOIN org_members om ON om.user_id = u.id"
				clauses = append(clauses, "om.org_id IN (?)")
				args = append(args, bun.In(optionContext.accessibleOrgIDs))
			}
			where = "(" + strings.Join(clauses, " OR ") + ")"
		}
	}

	if optionContext.scope.Type == models.NotificationScopeOrg {
		join = "JOIN org_members om ON om.user_id = u.id"
	}
	search, searchArgs := notificationOptionSearch(query, "u.username", "u.email", "u.id::text")
	where, args = appendNotificationOptionSearch(where, args, search, searchArgs)

	sql := fmt.Sprintf(`
		SELECT DISTINCT
			u.id::text AS value,
			COALESCE(NULLIF(u.username, ''), NULLIF(u.email, ''), u.id::text) AS label,
			COALESCE(u.email, '') AS description,
			'Users' AS group_name
		FROM users u
		%s
		WHERE %s
		ORDER BY label ASC
		LIMIT ?`, join, where)
	args = append(args, limit)
	return scanNotificationConditionOptions(c, db, sql, args...)
}

func loadNotificationOrgOptions(
	c *gin.Context,
	db *bun.DB,
	optionContext notificationConditionOptionContext,
	query string,
	limit int,
) ([]NotificationConditionOption, error) {
	where := "1 = 1"
	args := make([]interface{}, 0)
	switch optionContext.scope.Type {
	case models.NotificationScopeOrg:
		where = "o.id = ?"
		args = append(args, optionContext.orgID)
	case models.NotificationScopeUser:
		if !optionContext.isAdmin {
			if len(optionContext.accessibleOrgIDs) == 0 {
				where = "1 = 0"
			} else {
				where = "o.id IN (?)"
				args = append(args, bun.In(optionContext.accessibleOrgIDs))
			}
		}
	}
	search, searchArgs := notificationOptionSearch(query, "o.name", "o.description", "o.id::text")
	where, args = appendNotificationOptionSearch(where, args, search, searchArgs)

	sql := fmt.Sprintf(`
		SELECT
			o.id::text AS value,
			o.name AS label,
			COALESCE(o.description, '') AS description,
			'Organizations' AS group_name
		FROM orgs o
		WHERE %s
		ORDER BY label ASC
		LIMIT ?`, where)
	args = append(args, limit)
	return scanNotificationConditionOptions(c, db, sql, args...)
}

func loadNotificationPolicyOptions(
	c *gin.Context,
	db *bun.DB,
	optionContext notificationConditionOptionContext,
	field string,
	query string,
	limit int,
) ([]NotificationConditionOption, error) {
	where := "1 = 1"
	args := make([]interface{}, 0)
	switch optionContext.scope.Type {
	case models.NotificationScopeOrg:
		where = "p.org_id = ?"
		args = append(args, optionContext.orgID)
	case models.NotificationScopeUser:
		if !optionContext.isAdmin {
			if len(optionContext.accessibleOrgIDs) == 0 {
				where = "1 = 0"
			} else {
				where = "p.org_id IN (?)"
				args = append(args, bun.In(optionContext.accessibleOrgIDs))
			}
		}
	}
	search, searchArgs := notificationOptionSearch(query, "p.name", "p.id::text", "o.name")
	where, args = appendNotificationOptionSearch(where, args, search, searchArgs)
	value := "p.id::text"
	if field == "policy_name" {
		value = "p.name"
	}

	sql := fmt.Sprintf(`
		SELECT
			%s AS value,
			p.name AS label,
			COALESCE(o.name, '') AS description,
			'Policies' AS group_name
		FROM org_policies p
		JOIN orgs o ON o.id = p.org_id
		WHERE %s
		ORDER BY label ASC
		LIMIT ?`, value, where)
	args = append(args, limit)
	return scanNotificationConditionOptions(c, db, sql, args...)
}

func loadNotificationTagOptions(
	c *gin.Context,
	db *bun.DB,
	optionContext notificationConditionOptionContext,
	query string,
	limit int,
) ([]NotificationConditionOption, error) {
	where := "1 = 1"
	args := make([]interface{}, 0)
	if !optionContext.isAdmin && optionContext.scope.Type != models.NotificationScopeSystem {
		clauses := []string{"t.owner_type = ?"}
		args = append(args, models.OwnerTypeSystem)
		if optionContext.scope.Type == models.NotificationScopeOrg {
			clauses = append(clauses,
				"t.owner_user_id = ?",
				"t.owner_org_id = ?",
			)
			args = append(args, optionContext.userID, optionContext.orgID)
			clauses = append(clauses,
				"EXISTS (SELECT 1 FROM org_tags shared WHERE shared.tag_id = t.id AND shared.org_id = ?)",
			)
			args = append(args, optionContext.orgID)
		} else {
			clauses = append(clauses, "t.owner_user_id = ?")
			args = append(args, optionContext.userID)
			if len(optionContext.accessibleOrgIDs) > 0 {
				clauses = append(clauses,
					"t.owner_org_id IN (?)",
					"EXISTS (SELECT 1 FROM org_tags shared WHERE shared.tag_id = t.id AND shared.org_id IN (?))",
				)
				args = append(args, bun.In(optionContext.accessibleOrgIDs), bun.In(optionContext.accessibleOrgIDs))
			}
		}
		where = "(" + strings.Join(clauses, " OR ") + ")"
	}
	search, searchArgs := notificationOptionSearch(query, "t.name", "t.id::text")
	where, args = appendNotificationOptionSearch(where, args, search, searchArgs)

	sql := fmt.Sprintf(`
		SELECT DISTINCT
			t.name AS value,
			t.name AS label,
			'' AS description,
			'Tags' AS group_name
		FROM tags t
		WHERE %s
		ORDER BY label ASC
		LIMIT ?`, where)
	args = append(args, limit)
	return scanNotificationConditionOptions(c, db, sql, args...)
}

func loadNotificationImageOptions(
	c *gin.Context,
	db *bun.DB,
	optionContext notificationConditionOptionContext,
	query string,
	limit int,
) ([]NotificationConditionOption, error) {
	visibility, visibilityArgs := notificationScanVisibilityClause(optionContext, "s")
	search, searchArgs := notificationOptionSearch(query, "image_options.value")
	where := "value <> ''"
	args := append([]interface{}{}, visibilityArgs...)
	if search != "" {
		where, args = appendNotificationOptionSearch(where, args, search, searchArgs)
	}

	sql := fmt.Sprintf(`
		SELECT value, value AS label, '' AS description, 'Scanned images' AS group_name
		FROM (
			SELECT DISTINCT CONCAT_WS(':', NULLIF(s.image_name, ''), NULLIF(s.image_tag, '')) AS value
			FROM scans s
			WHERE %s
		) AS image_options
		WHERE %s
		ORDER BY label ASC
		LIMIT ?`, visibility, where)
	args = append(args, limit)
	return scanNotificationConditionOptions(c, db, sql, args...)
}

func loadNotificationXrayOptions(
	c *gin.Context,
	db *bun.DB,
	optionContext notificationConditionOptionContext,
	field string,
	query string,
	limit int,
) ([]NotificationConditionOption, error) {
	visibility, visibilityArgs := notificationScanVisibilityClause(optionContext, "s")
	var valueQueries string
	switch field {
	case "xray_watch_name":
		valueQueries = fmt.Sprintf(`
			SELECT NULLIF(v.xray_watch_name, '') AS value
			FROM vulnerabilities v
			JOIN scans s ON s.id = v.scan_id
			WHERE %s
			UNION ALL
			SELECT NULLIF(w.watch_name, '') AS value
			FROM vulnerabilities v
			JOIN scans s ON s.id = v.scan_id
			CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(v.xray_watch_names, '[]'::jsonb)) AS w(watch_name)
			WHERE %s`, visibility, visibility)
	case "xray_policy_name":
		valueQueries = fmt.Sprintf(`
			SELECT NULLIF(policy.policy->>'policy', '') AS value
			FROM vulnerabilities v
			JOIN scans s ON s.id = v.scan_id
			CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.xray_matched_policies, '[]'::jsonb)) AS policy(policy)
			WHERE %s
			UNION ALL
			SELECT NULLIF(policy.policy->>'policy', '') AS value
			FROM vulnerabilities v
			JOIN scans s ON s.id = v.scan_id
			CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.xray_watch_policy_matches, '[]'::jsonb)) AS policy(policy)
			WHERE %s`, visibility, visibility)
	default:
		return nil, fmt.Errorf("unsupported Xray condition option field %q", field)
	}

	where := "value IS NOT NULL"
	search, searchArgs := notificationOptionSearch(query, "xray_options.value")
	args := make([]interface{}, 0, len(visibilityArgs)*2+len(searchArgs)+1)
	args = append(args, visibilityArgs...)
	args = append(args, visibilityArgs...)
	if search != "" {
		where, args = appendNotificationOptionSearch(where, args, search, searchArgs)
	}

	sql := fmt.Sprintf(`
		SELECT DISTINCT value, value AS label, '' AS description, 'Xray values' AS group_name
		FROM (%s) AS xray_options
		WHERE %s
		ORDER BY label ASC
		LIMIT ?`, valueQueries, where)
	args = append(args, limit)
	return scanNotificationConditionOptions(c, db, sql, args...)
}

func notificationScanVisibilityClause(optionContext notificationConditionOptionContext, alias string) (string, []interface{}) {
	if optionContext.isAdmin || optionContext.scope.Type == models.NotificationScopeSystem {
		return "1 = 1", nil
	}
	if optionContext.scope.Type == models.NotificationScopeOrg {
		return fmt.Sprintf("(%s.owner_org_id = ? OR EXISTS (SELECT 1 FROM org_scans os WHERE os.scan_id = %s.id AND os.org_id = ?))", alias, alias), []interface{}{optionContext.orgID, optionContext.orgID}
	}

	clauses := []string{
		fmt.Sprintf("%s.user_id = ?", alias),
		fmt.Sprintf("%s.owner_user_id = ?", alias),
	}
	args := []interface{}{optionContext.userID, optionContext.userID}
	if len(optionContext.accessibleOrgIDs) > 0 {
		clauses = append(clauses,
			fmt.Sprintf("%s.owner_org_id IN (?)", alias),
			fmt.Sprintf("EXISTS (SELECT 1 FROM org_scans os WHERE os.scan_id = %s.id AND os.org_id IN (?))", alias),
		)
		args = append(args, bun.In(optionContext.accessibleOrgIDs), bun.In(optionContext.accessibleOrgIDs))
	}
	return "(" + strings.Join(clauses, " OR ") + ")", args
}

func notificationOptionSearch(query string, expressions ...string) (string, []interface{}) {
	query = strings.TrimSpace(query)
	if query == "" || len(expressions) == 0 {
		return "", nil
	}
	pattern := "%" + query + "%"
	parts := make([]string, 0, len(expressions))
	args := make([]interface{}, 0, len(expressions))
	for _, expression := range expressions {
		parts = append(parts, expression+" ILIKE ?")
		args = append(args, pattern)
	}
	return "(" + strings.Join(parts, " OR ") + ")", args
}

func appendNotificationOptionSearch(where string, args []interface{}, search string, searchArgs []interface{}) (string, []interface{}) {
	if search == "" {
		return where, args
	}
	return where + " AND " + search, append(args, searchArgs...)
}

func scanNotificationConditionOptions(c *gin.Context, db *bun.DB, query string, args ...interface{}) ([]NotificationConditionOption, error) {
	var rows []struct {
		Value       string `bun:"value"`
		Label       string `bun:"label"`
		Description string `bun:"description"`
		Group       string `bun:"group_name"`
	}
	if err := db.NewRaw(query, args...).Scan(c.Request.Context(), &rows); err != nil {
		return nil, err
	}
	options := make([]NotificationConditionOption, 0, len(rows))
	for _, row := range rows {
		value := strings.TrimSpace(row.Value)
		if value == "" {
			continue
		}
		options = append(options, NotificationConditionOption{
			Value:       value,
			Label:       strings.TrimSpace(row.Label),
			Description: strings.TrimSpace(row.Description),
			Group:       strings.TrimSpace(row.Group),
		})
	}
	return options, nil
}
