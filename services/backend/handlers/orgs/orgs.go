package orgs

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"justscan-backend/compliance"
	"justscan-backend/functions/authz"
	"justscan-backend/functions/vulnerabilityview"
	scanhandlers "justscan-backend/handlers/scans"
	"justscan-backend/pkg/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

// ListOrgs returns all organisations with their policy count.
func ListOrgs(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		type OrgWithSummary struct {
			models.Org
			MemberCount      int        `bun:"member_count" json:"member_count"`
			PolicyCount      int        `bun:"policy_count" json:"policy_count"`
			ScanCount        int        `bun:"scan_count" json:"scan_count"`
			UniqueImageCount int        `bun:"unique_image_count" json:"unique_image_count"`
			LastScanAt       *time.Time `bun:"last_scan_at" json:"last_scan_at,omitempty"`
		}

		var orgs []OrgWithSummary
		query := db.NewSelect().
			TableExpr("orgs AS org").
			ColumnExpr("org.*").
			ColumnExpr("(SELECT COUNT(*) FROM org_members om WHERE om.org_id = org.id) AS member_count").
			ColumnExpr("(SELECT COUNT(*) FROM org_policies op WHERE op.org_id = org.id) AS policy_count").
			ColumnExpr("(SELECT COUNT(*) FROM org_scans os WHERE os.org_id = org.id) AS scan_count").
			ColumnExpr("(SELECT COUNT(DISTINCT s.image_name) FROM scans s JOIN org_scans os ON os.scan_id = s.id WHERE os.org_id = org.id) AS unique_image_count").
			ColumnExpr("(SELECT MAX(s.created_at) FROM scans s JOIN org_scans os ON os.scan_id = s.id WHERE os.org_id = org.id) AS last_scan_at").
			OrderExpr("org.created_at DESC")
		if !isAdmin {
			accessibleOrgIDs, err := authz.ListAccessibleOrgIDs(c.Request.Context(), db, userID, false)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list organizations"})
				return
			}
			if len(accessibleOrgIDs) == 0 {
				c.JSON(http.StatusOK, gin.H{"data": []OrgWithSummary{}})
				return
			}
			query = query.Where("org.id IN (?)", bun.In(accessibleOrgIDs))
		}
		if err := query.Scan(c.Request.Context(), &orgs); err != nil {
			log.WithError(err).Warn("orgs: failed to list organization summaries")
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list organizations"})
			return
		}

		roleMap := map[uuid.UUID]string{}
		if !isAdmin {
			var err error
			roleMap, err = authz.LoadUserOrgRoles(c.Request.Context(), db, userID)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list organizations"})
				return
			}
		}

		for index := range orgs {
			o := &orgs[index].Org
			if !isAdmin {
				if o.CreatedByID == userID {
					o.CurrentUserRole = models.OrgRoleOwner
				} else {
					o.CurrentUserRole = roleMap[o.ID]
				}
			}
		}

		c.JSON(http.StatusOK, gin.H{"data": orgs})
	}
}

// CreateOrg creates a new organisation.
func CreateOrg(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, _, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		var body struct {
			Name        string `json:"name" binding:"required"`
			Description string `json:"description"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		org := &models.Org{
			Name:        body.Name,
			Description: body.Description,
			CreatedByID: userID,
		}
		if err := db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
			if _, err := tx.NewInsert().Model(org).Exec(ctx); err != nil {
				return err
			}
			member := &models.OrgMember{
				OrgID:     org.ID,
				UserID:    userID,
				Role:      models.OrgRoleOwner,
				JoinedAt:  time.Now(),
				CreatedAt: time.Now(),
				UpdatedAt: time.Now(),
			}
			if _, err := tx.NewInsert().Model(member).On("CONFLICT (org_id, user_id) DO UPDATE").
				Set("role = ?", models.OrgRoleOwner).
				Set("updated_at = now()").
				Exec(ctx); err != nil {
				return err
			}
			return nil
		}); err != nil {
			c.JSON(http.StatusConflict, gin.H{"error": "organization name already exists"})
			return
		}
		org.CurrentUserRole = models.OrgRoleOwner
		settings := vulnerabilityview.DefaultSettings()
		org.VulnerabilityViewSettings = &settings
		c.JSON(http.StatusCreated, org)
	}
}

// GetOrg returns a single org with its policies.
func GetOrg(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}

		org, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleViewer)
		if !ok {
			return
		}

		// Load policies
		var policies []models.OrgPolicy
		db.NewSelect().Model(&policies).Where("org_id = ?", orgID).OrderExpr("created_at ASC").Scan(c.Request.Context()) //nolint:errcheck
		org.Policies = policies
		if err := attachOrgVulnerabilityViewSettings(c.Request.Context(), db, org); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load vulnerability view settings"})
			return
		}

		c.JSON(http.StatusOK, org)
	}
}

// UpdateOrg updates an org's name and description.
func UpdateOrg(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}

		var body struct {
			Name        *string `json:"name"`
			Description *string `json:"description"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		org, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleAdmin)
		if !ok {
			return
		}

		if body.Name != nil {
			name := strings.TrimSpace(*body.Name)
			if name == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "organization name is required"})
				return
			}
			org.Name = name
		}
		if body.Description != nil {
			org.Description = *body.Description
		}
		org.UpdatedAt = time.Now()

		if _, err := db.NewUpdate().Model(org).Column("name", "description", "updated_at").Where("id = ?", orgID).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update organization"})
			return
		}
		if err := attachOrgVulnerabilityViewSettings(c.Request.Context(), db, org); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load vulnerability view settings"})
			return
		}
		c.JSON(http.StatusOK, org)
	}
}

// GetComplianceTrend returns daily pass/fail counts for an org over the last 30 days.
func GetComplianceTrend(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleViewer); !ok {
			return
		}

		days := 30
		if rawDays := strings.TrimSpace(c.Query("days")); rawDays != "" {
			parsedDays, parseErr := strconv.Atoi(rawDays)
			if parseErr != nil || (parsedDays != 30 && parsedDays != 60 && parsedDays != 90) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "days must be one of 30, 60, or 90"})
				return
			}
			days = parsedDays
		}

		type DayResult struct {
			Day    string `bun:"day"`
			Status string `bun:"status"`
			Count  int    `bun:"count"`
		}

		var rows []DayResult
		err = db.NewRaw(`
            WITH latest_daily AS (
                SELECT DISTINCT ON (scan_id, policy_id, (evaluated_at AT TIME ZONE 'UTC')::date)
                       evaluated_at,
                       status
                FROM compliance_history
                WHERE org_id = ?
                  AND evaluated_at >= NOW() - (? * INTERVAL '1 day')
                ORDER BY scan_id, policy_id, (evaluated_at AT TIME ZONE 'UTC')::date, evaluated_at DESC
            )
            SELECT to_char(evaluated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') as day,
                   status,
                   count(*) as count
            FROM latest_daily
            GROUP BY day, status
            ORDER BY day ASC
        `, orgID, days).Scan(c.Request.Context(), &rows)
		if err != nil {
			log.WithError(err).Warn("org compliance trend: failed to query compliance_history; falling back to compliance_results")
			if err := db.NewRaw(`
				SELECT to_char(evaluated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') as day,
				       status,
				       count(*) as count
				FROM compliance_results
				WHERE org_id = ?
				  AND evaluated_at >= NOW() - (? * INTERVAL '1 day')
				GROUP BY day, status
				ORDER BY day ASC
			`, orgID, days).Scan(c.Request.Context(), &rows); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load compliance trend"})
				return
			}
		}

		// Build map: day → {pass, fail}
		type Point struct {
			Date string  `json:"date"`
			Pass int     `json:"pass"`
			Fail int     `json:"fail"`
			Rate float64 `json:"rate"`
		}
		dayMap := make(map[string]*Point)
		for _, r := range rows {
			if _, ok := dayMap[r.Day]; !ok {
				dayMap[r.Day] = &Point{Date: r.Day}
			}
			if r.Status == "pass" {
				dayMap[r.Day].Pass = r.Count
			} else {
				dayMap[r.Day].Fail = r.Count
			}
		}
		points := make([]Point, 0, len(dayMap))
		for _, p := range dayMap {
			total := p.Pass + p.Fail
			if total > 0 {
				p.Rate = float64(p.Pass) / float64(total)
			}
			points = append(points, *p)
		}
		// Sort by date
		for i := 0; i < len(points); i++ {
			for j := i + 1; j < len(points); j++ {
				if points[i].Date > points[j].Date {
					points[i], points[j] = points[j], points[i]
				}
			}
		}
		c.JSON(http.StatusOK, gin.H{"data": points})
	}
}

// DeleteOrg deletes an org.
func DeleteOrg(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleOwner); !ok {
			return
		}
		if _, err := db.NewDelete().Model((*models.Org)(nil)).Where("id = ?", orgID).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete organization"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"result": "deleted"})
	}
}

// ListPolicies returns all policies for an org.
func ListPolicies(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleOwner); !ok {
			return
		}
		var policies []models.OrgPolicy
		if err := db.NewSelect().Model(&policies).Where("org_id = ?", orgID).OrderExpr("created_at ASC").Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list policies"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": policies})
	}
}

var validRuleTypes = map[string]bool{
	"max_cvss":          true,
	"max_count":         true,
	"max_total":         true,
	"require_fix":       true,
	"blocked_cve":       true,
	"xray_policy_block": true,
}

func policyIncludeSuppressedOrDefault(includeSuppressed *bool) bool {
	return includeSuppressed == nil || *includeSuppressed
}

// CreatePolicy creates a new policy for an org.
func CreatePolicy(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleAdmin); !ok {
			return
		}

		var body struct {
			Name              string                `json:"name" binding:"required"`
			Rules             models.PolicyRuleList `json:"rules"`
			IncludeSuppressed *bool                 `json:"include_suppressed"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		for _, r := range body.Rules {
			if !validRuleTypes[r.Type] {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rule type: " + r.Type})
				return
			}
		}

		policy := &models.OrgPolicy{
			OrgID:             orgID,
			Name:              body.Name,
			Rules:             body.Rules,
			IncludeSuppressed: policyIncludeSuppressedOrDefault(body.IncludeSuppressed),
		}
		if _, err := db.NewInsert().Model(policy).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create policy"})
			return
		}
		c.JSON(http.StatusCreated, policy)
	}
}

// UpdatePolicy updates an existing policy.
func UpdatePolicy(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		policyID, err := uuid.Parse(c.Param("policyId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid policy ID"})
			return
		}

		if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleAdmin); !ok {
			return
		}

		var body struct {
			Name              string                `json:"name"`
			Rules             models.PolicyRuleList `json:"rules"`
			IncludeSuppressed *bool                 `json:"include_suppressed"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		for _, r := range body.Rules {
			if !validRuleTypes[r.Type] {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rule type: " + r.Type})
				return
			}
		}

		policy := &models.OrgPolicy{}
		if err := db.NewSelect().Model(policy).Where("id = ? AND org_id = ?", policyID, orgID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "policy not found"})
			return
		}

		if body.Name != "" {
			policy.Name = body.Name
		}
		if body.Rules != nil {
			policy.Rules = body.Rules
		}
		if body.IncludeSuppressed != nil {
			policy.IncludeSuppressed = *body.IncludeSuppressed
		}
		policy.UpdatedAt = time.Now()

		if _, err := db.NewUpdate().Model(policy).Column("name", "rules", "include_suppressed", "updated_at").Where("id = ?", policyID).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update policy"})
			return
		}
		c.JSON(http.StatusOK, policy)
	}
}

// DeletePolicy deletes a policy.
func DeletePolicy(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		policyID, err := uuid.Parse(c.Param("policyId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid policy ID"})
			return
		}
		if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleAdmin); !ok {
			return
		}

		if _, err := db.NewDelete().Model((*models.OrgPolicy)(nil)).
			Where("id = ? AND org_id = ?", policyID, orgID).
			Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete policy"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"result": "deleted"})
	}
}

// AssignScan grants an organization access to an existing scan and runs compliance checks.
func AssignScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleAdmin); !ok {
			return
		}
		scanID, err := uuid.Parse(c.Param("scanId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}
		if _, _, _, ok := scanhandlers.LoadAuthorizedScanForWrite(c, db, scanID); !ok {
			return
		}

		orgScan := &models.OrgScan{OrgID: orgID, ScanID: scanID}
		if _, err := db.NewInsert().Model(orgScan).On("CONFLICT DO NOTHING").Exec(c.Request.Context()); err != nil {
			log.Warnf("orgs: failed to assign scan %s to org %s: %v", scanID, orgID, err)
		}

		go compliance.RunForScan(db, scanID)

		c.JSON(http.StatusOK, gin.H{"result": "assigned"})
	}
}

// RemoveScan revokes an organization access grant and deletes its compliance results.
func RemoveScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleAdmin); !ok {
			return
		}
		scanID, err := uuid.Parse(c.Param("scanId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}
		scan, _, _, ok := scanhandlers.LoadAuthorizedScanForWrite(c, db, scanID)
		if !ok {
			return
		}
		if scan.OwnerOrgID != nil && *scan.OwnerOrgID == orgID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot remove an organization-owned scan from its owner scope"})
			return
		}

		db.NewDelete().Model((*models.OrgScan)(nil)).
			Where("org_id = ? AND scan_id = ?", orgID, scanID).
			Exec(c.Request.Context()) //nolint:errcheck

		db.NewDelete().Model((*models.ComplianceResult)(nil)).
			Where("scan_id = ? AND org_id = ?", scanID, orgID).
			Exec(c.Request.Context()) //nolint:errcheck

		c.JSON(http.StatusOK, gin.H{"result": "removed"})
	}
}

// ListOrgScans returns scans assigned to an org with compliance results.
func ListOrgScans(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}

		if _, _, _, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleViewer); !ok {
			return
		}

		// Load scans via org_scans join
		var scans []models.Scan
		if err := db.NewSelect().Model(&scans).
			Join("JOIN org_scans os ON os.scan_id = scan.id").
			Where("os.org_id = ?", orgID).
			OrderExpr("scan.created_at DESC").
			Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list scans"})
			return
		}

		scanIDs := make([]uuid.UUID, 0, len(scans))
		for _, scan := range scans {
			scanIDs = append(scanIDs, scan.ID)
		}
		pipelineRequestsByScanID := make(map[uuid.UUID]models.PipelineScanRequest, len(scanIDs))
		if len(scanIDs) > 0 {
			var pipelineRequests []models.PipelineScanRequest
			if err := db.NewSelect().Model(&pipelineRequests).Where("scan_id IN (?)", bun.In(scanIDs)).Scan(c.Request.Context()); err == nil {
				for _, request := range pipelineRequests {
					pipelineRequestsByScanID[request.ScanID] = request
				}
			}
		}

		// Load policies for this org to resolve names
		var policies []models.OrgPolicy
		db.NewSelect().Model(&policies).Where("org_id = ?", orgID).Scan(c.Request.Context()) //nolint:errcheck
		policyNames := make(map[uuid.UUID]string, len(policies))
		for _, p := range policies {
			policyNames[p.ID] = p.Name
		}

		result := make([]gin.H, 0, len(scans))
		for _, s := range scans {
			var crs []models.ComplianceResult
			db.NewSelect().Model(&crs).Where("scan_id = ? AND org_id = ?", s.ID, orgID).Scan(c.Request.Context()) //nolint:errcheck

			compItems := make([]gin.H, 0, len(crs))
			for _, cr := range crs {
				pName := policyNames[cr.PolicyID]
				compItems = append(compItems, gin.H{
					"policy_id":    cr.PolicyID,
					"policy_name":  pName,
					"status":       cr.Status,
					"violations":   cr.Violations,
					"evaluated_at": cr.EvaluatedAt,
				})
			}
			accessType := "shared"
			if s.OwnerOrgID != nil && *s.OwnerOrgID == orgID {
				accessType = "owned"
			}
			triggerSource := s.ScanSource
			externalRef := ""
			if pipelineRequest, ok := pipelineRequestsByScanID[s.ID]; ok {
				triggerSource = pipelineRequest.Source
				externalRef = pipelineRequest.ExternalRef
			}
			result = append(result, gin.H{
				"id":              s.ID,
				"image_name":      s.ImageName,
				"image_tag":       s.ImageTag,
				"image_digest":    s.ImageDigest,
				"scan_provider":   s.ScanProvider,
				"scan_source":     s.ScanSource,
				"trigger_source":  triggerSource,
				"external_ref":    externalRef,
				"status":          s.Status,
				"current_step":    s.CurrentStep,
				"external_status": s.ExternalStatus,
				"critical_count":  s.CriticalCount,
				"high_count":      s.HighCount,
				"medium_count":    s.MediumCount,
				"low_count":       s.LowCount,
				"unknown_count":   s.UnknownCount,
				"owner_type":      s.OwnerType,
				"owner_org_id":    s.OwnerOrgID,
				"access_type":     accessType,
				"created_at":      s.CreatedAt,
				"completed_at":    s.CompletedAt,
				"compliance":      compItems,
			})
		}

		c.JSON(http.StatusOK, gin.H{"data": result})
	}
}

// GetScanCompliance returns all compliance results for a scan.
func GetScanCompliance(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}
		if _, _, _, ok := scanhandlers.LoadAuthorizedScan(c, db, scanID); !ok {
			return
		}
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		var results []models.ComplianceResult
		if err := db.NewSelect().Model(&results).Where("scan_id = ?", scanID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load compliance results"})
			return
		}
		results, err = filterVisibleComplianceResults(c.Request.Context(), db, results, userID, isAdmin)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load compliance results"})
			return
		}

		// Enrich with org and policy names
		for i := range results {
			org := &models.Org{}
			if err := db.NewSelect().Model(org).Where("id = ?", results[i].OrgID).Scan(c.Request.Context()); err == nil {
				results[i].OrgName = org.Name
			}
			policy := &models.OrgPolicy{}
			if err := db.NewSelect().Model(policy).Where("id = ?", results[i].PolicyID).Scan(c.Request.Context()); err == nil {
				results[i].PolicyName = policy.Name
				results[i].PolicyRules = policy.Rules
			}
		}

		c.JSON(http.StatusOK, gin.H{"data": results})
	}
}

// ReEvaluate re-runs compliance checks for a scan and returns updated results.
func ReEvaluate(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		scanID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}
		if _, _, _, ok := scanhandlers.LoadAuthorizedScan(c, db, scanID); !ok {
			return
		}
		userID, isAdmin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		compliance.RunForScan(db, scanID)

		// Return updated results (reuse GetScanCompliance logic)
		var results []models.ComplianceResult
		if err := db.NewSelect().Model(&results).Where("scan_id = ?", scanID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load compliance results"})
			return
		}
		results, err = filterVisibleComplianceResults(c.Request.Context(), db, results, userID, isAdmin)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load compliance results"})
			return
		}
		for i := range results {
			org := &models.Org{}
			if err := db.NewSelect().Model(org).Where("id = ?", results[i].OrgID).Scan(c.Request.Context()); err == nil {
				results[i].OrgName = org.Name
			}
			policy := &models.OrgPolicy{}
			if err := db.NewSelect().Model(policy).Where("id = ?", results[i].PolicyID).Scan(c.Request.Context()); err == nil {
				results[i].PolicyName = policy.Name
				results[i].PolicyRules = policy.Rules
			}
		}

		c.JSON(http.StatusOK, gin.H{"data": results})
	}
}

func filterVisibleComplianceResults(ctx context.Context, db *bun.DB, results []models.ComplianceResult, userID uuid.UUID, isAdmin bool) ([]models.ComplianceResult, error) {
	if isAdmin || len(results) == 0 {
		return results, nil
	}

	orgIDs := make([]uuid.UUID, 0, len(results))
	seen := make(map[uuid.UUID]struct{}, len(results))
	for _, result := range results {
		if _, ok := seen[result.OrgID]; ok {
			continue
		}
		seen[result.OrgID] = struct{}{}
		orgIDs = append(orgIDs, result.OrgID)
	}

	accessibleOrgIDs, err := authz.ListAccessibleOrgIDs(ctx, db, userID, isAdmin)
	if err != nil {
		return nil, err
	}
	if len(accessibleOrgIDs) == 0 {
		return []models.ComplianceResult{}, nil
	}

	visible := make(map[uuid.UUID]struct{}, len(accessibleOrgIDs))
	for _, orgID := range accessibleOrgIDs {
		visible[orgID] = struct{}{}
	}

	filtered := make([]models.ComplianceResult, 0, len(results))
	for _, result := range results {
		if _, ok := visible[result.OrgID]; ok {
			filtered = append(filtered, result)
		}
	}

	return filtered, nil
}
