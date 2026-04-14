package orgs

import (
	"context"
	"net/http"
	"time"

	"justscan-backend/compliance"
	"justscan-backend/functions/authz"
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

		type OrgWithCount struct {
			models.Org
			PolicyCount int `json:"policy_count"`
		}

		var orgs []models.Org
		query := db.NewSelect().Model(&orgs).OrderExpr("created_at DESC")
		if !isAdmin {
			query = query.Where("created_by_id = ?", userID)
		}
		if err := query.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list organizations"})
			return
		}

		result := make([]OrgWithCount, 0, len(orgs))
		for _, o := range orgs {
			count, _ := db.NewSelect().Model((*models.OrgPolicy)(nil)).Where("org_id = ?", o.ID).Count(c.Request.Context())
			result = append(result, OrgWithCount{Org: o, PolicyCount: count})
		}

		c.JSON(http.StatusOK, gin.H{"data": result})
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
		if _, err := db.NewInsert().Model(org).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusConflict, gin.H{"error": "organization name already exists"})
			return
		}
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

		org, _, _, ok := authz.LoadAuthorizedOrg(c, db, orgID)
		if !ok {
			return
		}

		// Load policies
		var policies []models.OrgPolicy
		db.NewSelect().Model(&policies).Where("org_id = ?", orgID).OrderExpr("created_at ASC").Scan(c.Request.Context()) //nolint:errcheck
		org.Policies = policies

		c.JSON(http.StatusOK, org)
	}
}

// UpdateOrg updates an org's name, description, and/or image_patterns.
func UpdateOrg(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}

		var body struct {
			Name          string            `json:"name"`
			Description   string            `json:"description"`
			ImagePatterns models.StringList `json:"image_patterns"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		org, _, _, ok := authz.LoadAuthorizedOrg(c, db, orgID)
		if !ok {
			return
		}

		if body.Name != "" {
			org.Name = body.Name
		}
		if body.Description != "" {
			org.Description = body.Description
		}
		if body.ImagePatterns != nil {
			org.ImagePatterns = body.ImagePatterns
		}
		org.UpdatedAt = time.Now()

		if _, err := db.NewUpdate().Model(org).Column("name", "description", "image_patterns", "updated_at").Where("id = ?", orgID).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update organization"})
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
		if _, _, _, ok := authz.LoadAuthorizedOrg(c, db, orgID); !ok {
			return
		}

		type DayResult struct {
			Day    string `bun:"day"`
			Status string `bun:"status"`
			Count  int    `bun:"count"`
		}

		var rows []DayResult
		db.NewRaw(`
            SELECT to_char(evaluated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') as day,
                   status,
                   count(*) as count
            FROM compliance_history
            WHERE org_id = ?
              AND evaluated_at >= NOW() - INTERVAL '30 days'
            GROUP BY day, status
            ORDER BY day ASC
        `, orgID).Scan(c.Request.Context(), &rows) //nolint:errcheck

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
		if _, _, _, ok := authz.LoadAuthorizedOrg(c, db, orgID); !ok {
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
		if _, _, _, ok := authz.LoadAuthorizedOrg(c, db, orgID); !ok {
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
	"max_cvss":    true,
	"max_count":   true,
	"max_total":   true,
	"require_fix": true,
	"blocked_cve": true,
}

// CreatePolicy creates a new policy for an org.
func CreatePolicy(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		if _, _, _, ok := authz.LoadAuthorizedOrg(c, db, orgID); !ok {
			return
		}

		var body struct {
			Name  string                `json:"name" binding:"required"`
			Rules models.PolicyRuleList `json:"rules"`
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
			OrgID: orgID,
			Name:  body.Name,
			Rules: body.Rules,
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

		if _, _, _, ok := authz.LoadAuthorizedOrg(c, db, orgID); !ok {
			return
		}

		var body struct {
			Name  string                `json:"name"`
			Rules models.PolicyRuleList `json:"rules"`
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
		policy.UpdatedAt = time.Now()

		if _, err := db.NewUpdate().Model(policy).Column("name", "rules", "updated_at").Where("id = ?", policyID).Exec(c.Request.Context()); err != nil {
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
		if _, _, _, ok := authz.LoadAuthorizedOrg(c, db, orgID); !ok {
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

// AssignScan assigns a scan to an org and immediately runs compliance checks.
func AssignScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		if _, _, _, ok := authz.LoadAuthorizedOrg(c, db, orgID); !ok {
			return
		}
		scanID, err := uuid.Parse(c.Param("scanId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}
		if _, _, _, ok := scanhandlers.LoadAuthorizedScan(c, db, scanID); !ok {
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

// RemoveScan removes a scan from an org and deletes its compliance results.
func RemoveScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, err := uuid.Parse(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
			return
		}
		if _, _, _, ok := authz.LoadAuthorizedOrg(c, db, orgID); !ok {
			return
		}
		scanID, err := uuid.Parse(c.Param("scanId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid scan ID"})
			return
		}
		if _, _, _, ok := scanhandlers.LoadAuthorizedScan(c, db, scanID); !ok {
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

		if _, _, _, ok := authz.LoadAuthorizedOrg(c, db, orgID); !ok {
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
					"policy_id":   cr.PolicyID,
					"policy_name": pName,
					"status":      cr.Status,
					"violations":  cr.Violations,
				})
			}
			result = append(result, gin.H{
				"id":             s.ID,
				"image_name":     s.ImageName,
				"image_tag":      s.ImageTag,
				"image_digest":   s.ImageDigest,
				"status":         s.Status,
				"critical_count": s.CriticalCount,
				"high_count":     s.HighCount,
				"medium_count":   s.MediumCount,
				"low_count":      s.LowCount,
				"unknown_count":  s.UnknownCount,
				"created_at":     s.CreatedAt,
				"compliance":     compItems,
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

	var visibleOrgs []models.Org
	if err := db.NewSelect().Model(&visibleOrgs).
		Column("id").
		Where("id IN (?)", bun.In(orgIDs)).
		Where("created_by_id = ?", userID).
		Scan(ctx); err != nil {
		return nil, err
	}

	visible := make(map[uuid.UUID]struct{}, len(visibleOrgs))
	for _, org := range visibleOrgs {
		visible[org.ID] = struct{}{}
	}

	filtered := make([]models.ComplianceResult, 0, len(results))
	for _, result := range results {
		if _, ok := visible[result.OrgID]; ok {
			filtered = append(filtered, result)
		}
	}

	return filtered, nil
}
