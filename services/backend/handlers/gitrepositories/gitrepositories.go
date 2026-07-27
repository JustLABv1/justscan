package gitrepositories

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"justscan-backend/config"
	"justscan-backend/functions/authz"
	gitservice "justscan-backend/functions/gitrepositories"
	"justscan-backend/pkg/crypto"
	"justscan-backend/pkg/models"
	"justscan-backend/scheduler"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
	"sigs.k8s.io/yaml"
)

type repositoryRequest struct {
	Name          string   `json:"name"`
	CloneURL      string   `json:"clone_url" binding:"required"`
	Ref           string   `json:"ref"`
	AuthType      string   `json:"auth_type"`
	Username      string   `json:"username"`
	Credential    string   `json:"credential"`
	Schedule      string   `json:"schedule"`
	Timezone      string   `json:"timezone"`
	Enabled       bool     `json:"enabled"`
	RescanPolicy  string   `json:"rescan_policy"`
	DiscoveryMode string   `json:"discovery_mode"`
	Entrypoints   []string `json:"entrypoints"`
	TagIDs        []string `json:"tag_ids"`
	OrgID         string   `json:"org_id"`
}

func List(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, admin, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}
		orgIDs, err := authz.ListAccessibleOrgIDs(c.Request.Context(), db, userID, admin)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve organization access"})
			return
		}
		var items []models.GitRepository
		q := db.NewSelect().Model(&items).OrderExpr("created_at DESC")
		if !admin {
			q = q.WhereGroup(" AND ", func(q *bun.SelectQuery) *bun.SelectQuery {
				q = q.Where("owner_user_id = ?", userID)
				if len(orgIDs) > 0 {
					q = q.WhereOr("owner_org_id IN (?)", bun.In(orgIDs))
				}
				return q
			})
		}
		q = authz.ApplyWorkspaceScope(c, q, "", "owner_user_id", "owner_org_id", "", "", userID)
		if err := q.Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list Git repositories"})
			return
		}
		redact(items)
		c.JSON(http.StatusOK, gin.H{"data": items})
	}
}

func Create(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body repositoryRequest
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		userID, _, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}
		repository, err := build(c, db, body, userID, nil)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if _, err := db.NewInsert().Model(repository).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create Git repository"})
			return
		}
		gitservice.SyncSchedule(*repository)
		redactOne(repository)
		c.JSON(http.StatusCreated, repository)
	}
}

func Validate(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var body repositoryRequest
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		userID, _, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}
		repository, err := build(c, db, body, userID, nil)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		images, sha, err := gitservice.Discover(c.Request.Context(), *repository)
		if err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"commit_sha": sha, "images": images})
	}
}

func Get(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		item, ok := load(c, db)
		if !ok {
			return
		}
		redactOne(item)
		c.JSON(http.StatusOK, item)
	}
}
func Update(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		item, ok := load(c, db)
		if !ok {
			return
		}
		var body repositoryRequest
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		updated, err := build(c, db, body, item.CreatedByID, item)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		updated.ID, updated.CreatedAt = item.ID, item.CreatedAt
		if _, err := db.NewUpdate().Model(updated).Where("id = ?", updated.ID).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update Git repository"})
			return
		}
		gitservice.SyncSchedule(*updated)
		redactOne(updated)
		c.JSON(http.StatusOK, updated)
	}
}
func Delete(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		item, ok := load(c, db)
		if !ok {
			return
		}
		if _, err := db.NewDelete().Model(item).Where("id = ?", item.ID).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete Git repository"})
			return
		}
		gitservice.Unschedule(item.ID)
		c.JSON(http.StatusOK, gin.H{"result": "deleted"})
	}
}
func CreateRun(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		item, ok := load(c, db)
		if !ok {
			return
		}
		if item.OwnerOrgID != nil {
			org, _, _, _, allowed := authz.RequireOrgRole(c, db, *item.OwnerOrgID, models.OrgRoleEditor)
			if !allowed || !authz.EnsureOrgActionAllowed(c, org, "image_scan") {
				return
			}
		}
		var body struct {
			Policy         string   `json:"policy"`
			SelectedImages []string `json:"selected_images"`
		}
		_ = c.ShouldBindJSON(&body)
		run, err := gitservice.CreateRun(c.Request.Context(), item.ID, "manual", body.Policy, body.SelectedImages)
		if err != nil {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusCreated, run)
	}
}

func ListImageExclusions(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		item, ok := load(c, db)
		if !ok {
			return
		}
		var exclusions []models.GitRepositoryImageExclusion
		if err := db.NewSelect().Model(&exclusions).Where("repository_id = ?", item.ID).OrderExpr("full_ref ASC").Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load image exclusions"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": exclusions})
	}
}

func CreateImageExclusion(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		item, ok := load(c, db)
		if !ok || !requireEdit(c, db, item) {
			return
		}
		var body struct {
			FullRef string `json:"full_ref"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		body.FullRef = strings.TrimSpace(body.FullRef)
		if body.FullRef == "" || len(body.FullRef) > 2048 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "full_ref is required"})
			return
		}
		userID, _, _ := authz.RequireRequestUser(c, db)
		exclusion := &models.GitRepositoryImageExclusion{RepositoryID: item.ID, FullRef: body.FullRef, CreatedByID: userID, CreatedAt: time.Now()}
		if _, err := db.NewInsert().Model(exclusion).On("CONFLICT (repository_id, full_ref) DO NOTHING").Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to exclude image"})
			return
		}
		c.JSON(http.StatusCreated, exclusion)
	}
}

func DeleteImageExclusion(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		item, ok := load(c, db)
		if !ok || !requireEdit(c, db, item) {
			return
		}
		id, err := uuid.Parse(c.Param("exclusionId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid exclusion ID"})
			return
		}
		if _, err := db.NewDelete().Model((*models.GitRepositoryImageExclusion)(nil)).Where("id = ? AND repository_id = ?", id, item.ID).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to re-enable image"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"result": "deleted"})
	}
}
func Discover(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		item, ok := load(c, db)
		if !ok {
			return
		}
		if item.OwnerOrgID != nil {
			org, _, _, _, allowed := authz.RequireOrgRole(c, db, *item.OwnerOrgID, models.OrgRoleEditor)
			if !allowed || !authz.EnsureOrgActionAllowed(c, org, "image_scan") {
				return
			}
		}
		run, images, err := gitservice.CreateDiscovery(c.Request.Context(), item.ID)
		if err != nil {
			log.WithFields(log.Fields{
				"repository_id":         item.ID,
				"auth_type":             item.AuthType,
				"username":              item.Username,
				"credential_configured": item.EncryptedCredential != "",
			}).WithError(err).Warn("Git repository discovery failed")
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error(), "run": run})
			return
		}
		c.JSON(http.StatusCreated, gin.H{"run": run, "images": images})
	}
}
func ListRuns(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		item, ok := load(c, db)
		if !ok {
			return
		}
		var runs []models.GitRepositoryRun
		if err := db.NewSelect().Model(&runs).Where("repository_id = ?", item.ID).OrderExpr("created_at DESC").Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list runs"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": runs})
	}
}

func ListLatestImageScans(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		item, ok := load(c, db)
		if !ok {
			return
		}
		var scans []struct {
			FullRef   string    `bun:"full_ref" json:"full_ref"`
			ScanID    uuid.UUID `bun:"scan_id" json:"scan_id"`
			Status    string    `bun:"status" json:"status"`
			CreatedAt time.Time `bun:"created_at" json:"created_at"`
		}
		if err := db.NewSelect().
			TableExpr("git_repository_run_images AS ri").
			ColumnExpr("DISTINCT ON (ri.full_ref) ri.full_ref, s.id AS scan_id, s.status, s.created_at").
			Join("JOIN git_repository_runs AS r ON r.id = ri.run_id").
			Join("JOIN scans AS s ON s.id = ri.scan_id").
			Where("r.repository_id = ?", item.ID).
			OrderExpr("ri.full_ref, s.created_at DESC, s.id DESC").
			Scan(c.Request.Context(), &scans); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load latest image scans"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": scans})
	}
}
func GetRun(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		item, ok := load(c, db)
		if !ok {
			return
		}
		id, err := uuid.Parse(c.Param("runId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid run ID"})
			return
		}
		var run models.GitRepositoryRun
		if err := db.NewSelect().Model(&run).Where("id = ? AND repository_id = ?", id, item.ID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "run not found"})
			return
		}
		var images []models.GitRepositoryRunImage
		_ = db.NewSelect().Model(&images).Where("run_id = ?", run.ID).OrderExpr("full_ref ASC").Scan(c.Request.Context())
		c.JSON(http.StatusOK, gin.H{"run": run, "images": images})
	}
}

func ListCandidates(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		item, ok := load(c, db)
		if !ok {
			return
		}
		runID, err := uuid.Parse(c.Param("runId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid run ID"})
			return
		}
		var run models.GitRepositoryRun
		if err := db.NewSelect().Model(&run).Where("id = ? AND repository_id = ?", runID, item.ID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "run not found"})
			return
		}
		var candidates []models.GitRepositoryRunCandidate
		if err := db.NewSelect().Model(&candidates).Where("run_id = ?", runID).OrderExpr("path ASC").Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load discovery candidates"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": candidates})
	}
}

func ListRules(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		item, ok := load(c, db)
		if !ok {
			return
		}
		var rules []models.GitRepositoryDiscoveryRule
		if err := db.NewSelect().Model(&rules).Where("repository_id = ?", item.ID).OrderExpr("created_at ASC").Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load discovery rules"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": rules})
	}
}

func CreateRule(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		item, ok := load(c, db)
		if !ok || !requireEdit(c, db, item) {
			return
		}
		var body struct {
			PathPattern string            `json:"path_pattern"`
			Resolution  string            `json:"resolution"`
			Config      models.JSONObject `json:"config"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		body.PathPattern = strings.TrimSpace(body.PathPattern)
		if body.PathPattern == "" || filepath.IsAbs(body.PathPattern) || strings.HasPrefix(filepath.Clean(body.PathPattern), "..") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "path_pattern must be a relative repository path"})
			return
		}
		if body.Resolution != "kustomize" && body.Resolution != "helm" && body.Resolution != "manifests" && body.Resolution != "ignore" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid resolution"})
			return
		}
		userID, _, _ := authz.RequireRequestUser(c, db)
		rule := &models.GitRepositoryDiscoveryRule{RepositoryID: item.ID, PathPattern: filepath.ToSlash(body.PathPattern), Resolution: body.Resolution, Config: body.Config, Active: true, CreatedByID: userID, CreatedAt: time.Now(), UpdatedAt: time.Now()}
		if _, err := db.NewInsert().Model(rule).On("CONFLICT (repository_id, path_pattern) DO UPDATE").Set("resolution = EXCLUDED.resolution").Set("config = EXCLUDED.config").Set("active = TRUE").Set("updated_at = EXCLUDED.updated_at").Returning("*").Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save discovery rule"})
			return
		}
		c.JSON(http.StatusCreated, rule)
	}
}

func DeleteRule(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		item, ok := load(c, db)
		if !ok || !requireEdit(c, db, item) {
			return
		}
		id, err := uuid.Parse(c.Param("ruleId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid rule ID"})
			return
		}
		if _, err := db.NewDelete().Model((*models.GitRepositoryDiscoveryRule)(nil)).Where("id = ? AND repository_id = ?", id, item.ID).Exec(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete discovery rule"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"result": "deleted"})
	}
}

func ExportRules(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		item, ok := load(c, db)
		if !ok {
			return
		}
		var rules []models.GitRepositoryDiscoveryRule
		if err := db.NewSelect().Model(&rules).Where("repository_id = ? AND active = true", item.ID).OrderExpr("created_at ASC").Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to export discovery rules"})
			return
		}
		entries := make([]map[string]any, 0, len(rules))
		for _, rule := range rules {
			entry := map[string]any{"match": rule.PathPattern, "type": rule.Resolution}
			for key, value := range rule.Config {
				entry[key] = value
			}
			entries = append(entries, entry)
		}
		output, err := yaml.Marshal(map[string]any{"version": 1, "discovery": map[string]any{"auto": true, "rules": entries}})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to export discovery rules"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"yaml": string(output)})
	}
}

func requireEdit(c *gin.Context, db *bun.DB, item *models.GitRepository) bool {
	if item.OwnerOrgID == nil {
		return true
	}
	org, _, _, _, allowed := authz.RequireOrgRole(c, db, *item.OwnerOrgID, models.OrgRoleEditor)
	return allowed && authz.EnsureOrgActionAllowed(c, org, "image_scan")
}

func load(c *gin.Context, db *bun.DB) (*models.GitRepository, bool) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid repository ID"})
		return nil, false
	}
	userID, admin, ok := authz.RequireRequestUser(c, db)
	if !ok {
		return nil, false
	}
	var item models.GitRepository
	if err := db.NewSelect().Model(&item).Where("id = ?", id).Scan(c.Request.Context()); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Git repository not found"})
		return nil, false
	}
	if !admin && (item.OwnerUserID == nil || *item.OwnerUserID != userID) {
		if item.OwnerOrgID == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "Git repository not found"})
			return nil, false
		}
		if _, _, _, _, allowed := authz.RequireOrgRole(c, db, *item.OwnerOrgID, models.OrgRoleViewer); !allowed {
			return nil, false
		}
	}
	return &item, true
}

func build(c *gin.Context, db *bun.DB, body repositoryRequest, userID uuid.UUID, previous *models.GitRepository) (*models.GitRepository, error) {
	url := strings.TrimSpace(body.CloneURL)
	if !strings.HasPrefix(url, "https://") && !strings.HasPrefix(url, "http://") {
		return nil, fmt.Errorf("repository URL must use http:// or https://")
	}
	authType := body.AuthType
	if authType == "" {
		authType = models.GitRepositoryAuthNone
	}
	if authType != models.GitRepositoryAuthNone && authType != models.GitRepositoryAuthToken && authType != models.GitRepositoryAuthBasic {
		return nil, fmt.Errorf("invalid authentication type")
	}
	username := strings.TrimSpace(body.Username)
	if authType != models.GitRepositoryAuthNone && username == "" {
		return nil, fmt.Errorf("Git username is required when authentication is enabled")
	}
	credential := body.Credential
	if authType == models.GitRepositoryAuthToken {
		credential = strings.TrimSpace(credential)
	}
	credentialConfigured := credential != ""
	if previous != nil && previous.EncryptedCredential != "" {
		credentialConfigured = true
	}
	if authType != models.GitRepositoryAuthNone && !credentialConfigured {
		return nil, fmt.Errorf("Git token or password is required when authentication is enabled")
	}
	schedule := body.Schedule
	if schedule == "" {
		schedule = "0 2 * * *"
	}
	timezone := body.Timezone
	if timezone == "" {
		timezone = "UTC"
	}
	if err := scheduler.ValidateSchedule(schedule, timezone); err != nil {
		return nil, err
	}
	policy := body.RescanPolicy
	if policy == "" {
		policy = models.GitRepositoryRescanChanged
	}
	if policy != models.GitRepositoryRescanChanged && policy != models.GitRepositoryRescanAll {
		return nil, fmt.Errorf("invalid rescan policy")
	}
	discoveryMode := body.DiscoveryMode
	if discoveryMode == "" {
		discoveryMode = models.GitRepositoryDiscoveryAuto
	}
	if discoveryMode != models.GitRepositoryDiscoveryAuto && discoveryMode != models.GitRepositoryDiscoveryKustomize && discoveryMode != models.GitRepositoryDiscoveryManifests {
		return nil, fmt.Errorf("invalid discovery mode")
	}
	entrypoints := make([]string, 0, len(body.Entrypoints))
	for _, entrypoint := range body.Entrypoints {
		entrypoint = strings.TrimSpace(entrypoint)
		if entrypoint == "" {
			continue
		}
		if filepath.IsAbs(entrypoint) || strings.HasPrefix(filepath.Clean(entrypoint), "..") {
			return nil, fmt.Errorf("discovery entrypoints must be relative repository paths")
		}
		entrypoints = append(entrypoints, filepath.ToSlash(entrypoint))
	}
	if discoveryMode == models.GitRepositoryDiscoveryKustomize && len(entrypoints) == 0 {
		return nil, fmt.Errorf("Kustomize discovery requires at least one entrypoint")
	}
	item := &models.GitRepository{Name: strings.TrimSpace(body.Name), CloneURL: url, Ref: strings.TrimSpace(body.Ref), AuthType: authType, Username: username, Schedule: schedule, Timezone: timezone, Enabled: body.Enabled, RescanPolicy: policy, DiscoveryMode: discoveryMode, Entrypoints: entrypoints, TagIDs: body.TagIDs, CreatedByID: userID, OwnerType: models.OwnerTypeUser, OwnerUserID: &userID, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if item.Name == "" {
		item.Name = url
	}
	if item.Ref == "" {
		item.Ref = "HEAD"
	}
	if previous != nil {
		item.CreatedByID, item.OwnerType, item.OwnerUserID, item.OwnerOrgID, item.EncryptedCredential = previous.CreatedByID, previous.OwnerType, previous.OwnerUserID, previous.OwnerOrgID, previous.EncryptedCredential
	}
	if body.OrgID != "" {
		orgID, err := uuid.Parse(body.OrgID)
		if err != nil {
			return nil, err
		}
		org, _, _, _, allowed := authz.RequireOrgRole(c, db, orgID, models.OrgRoleEditor)
		if !allowed || !authz.EnsureOrgActionAllowed(c, org, "image_scan") {
			return nil, fmt.Errorf("not allowed to use this organization")
		}
		item.OwnerType, item.OwnerUserID, item.OwnerOrgID = models.OwnerTypeOrg, nil, &orgID
	}
	if credential != "" {
		encrypted, err := crypto.Encrypt(crypto.KeyFromString(config.Config.Encryption.Key), credential)
		if err != nil {
			return nil, err
		}
		item.EncryptedCredential = encrypted
	}
	if authType == models.GitRepositoryAuthNone {
		item.EncryptedCredential = ""
	}
	return item, nil
}
func redact(items []models.GitRepository) {
	for i := range items {
		items[i].CredentialConfigured = items[i].EncryptedCredential != ""
		items[i].EncryptedCredential = ""
	}
}
func redactOne(item *models.GitRepository) {
	item.CredentialConfigured = item.EncryptedCredential != ""
	item.EncryptedCredential = ""
}
