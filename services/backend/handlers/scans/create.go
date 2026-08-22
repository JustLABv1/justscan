package scans

import (
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"justscan-backend/functions/audit"
	"justscan-backend/functions/authz"
	"justscan-backend/pipelines"
	"justscan-backend/pkg/models"
	"justscan-backend/scanner"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

const (
	maxUploadedArchiveBytes int64 = 5 * 1024 * 1024 * 1024
	uploadFormMemoryBytes   int64 = 32 * 1024 * 1024
)

const maxConcurrentArchiveUploadsPerOrg = 2

var archiveUploadGuards = struct {
	sync.Mutex
	byOrg map[uuid.UUID]chan struct{}
}{byOrg: make(map[uuid.UUID]chan struct{})}

type uploadedArchiveScanResponse struct {
	ID          uuid.UUID `json:"id"`
	ImageName   string    `json:"image_name"`
	ImageTag    string    `json:"image_tag"`
	Status      string    `json:"status"`
	CurrentStep string    `json:"current_step"`
}

type CreateScanRequest struct {
	Image          string   `json:"image" binding:"required"`
	Tag            string   `json:"tag" binding:"required"`
	Platform       string   `json:"platform"`
	RegistryID     string   `json:"registry_id"`
	XrayRepository string   `json:"xray_repository"`
	OrgID          string   `json:"org_id"`
	TagIDs         []string `json:"tag_ids"`
}

type CreateScansRequest struct {
	Images         []string `json:"images" binding:"required,min=1"`
	Platform       string   `json:"platform"`
	RegistryID     string   `json:"registry_id"`
	XrayRepository string   `json:"xray_repository"`
	OrgID          string   `json:"org_id"`
	TagIDs         []string `json:"tag_ids"`
}

func CreateScan(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateScanRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		userID, _, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		var requestedRegistryID *uuid.UUID
		var requestedOrgID *uuid.UUID
		if req.RegistryID != "" {
			parsedRegistryID, err := uuid.Parse(req.RegistryID)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid registry_id"})
				return
			}
			if _, _, _, ok := authz.LoadAccessibleRegistry(c, db, parsedRegistryID); !ok {
				return
			}
			requestedRegistryID = &parsedRegistryID
		}
		if req.OrgID != "" {
			parsedOrgID, err := uuid.Parse(req.OrgID)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
				return
			}
			org, _, _, _, ok := authz.RequireOrgRole(c, db, parsedOrgID, models.OrgRoleEditor)
			if !ok {
				return
			}
			if !authz.EnsureOrgActionAllowed(c, org, "image_scan") {
				return
			}
			requestedOrgID = &parsedOrgID
		}

		registry, envVars, err := scanner.ResolveRegistryForScan(c.Request.Context(), db, req.Image, requestedRegistryID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		provider, err := scanner.ProviderForRegistry(registry)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		normalizedImageName, normalizedImageTag := scanner.NormalizeScanTargetWithXrayRepository(req.Image, req.Tag, registry, req.XrayRepository)

		scan := &models.Scan{
			ImageName:    normalizedImageName,
			ImageTag:     normalizedImageTag,
			Platform:     req.Platform,
			RegistryID:   requestedRegistryID,
			ScanProvider: provider,
			ScanSource:   models.ScanSourceRegistry,
			CurrentStep:  models.ScanStepQueued,
			Status:       models.ScanStatusPending,
			UserID:       &userID,
			OwnerType:    models.OwnerTypeUser,
			OwnerUserID:  &userID,
			CreatedAt:    time.Now(),
		}
		if requestedOrgID != nil {
			scan.OwnerType = models.OwnerTypeOrg
			scan.OwnerUserID = nil
			scan.OwnerOrgID = requestedOrgID
		}
		if registry != nil {
			scan.RegistryID = &registry.ID
		}
		if _, err := db.NewInsert().Model(scan).Exec(c.Request.Context()); err != nil {
			log.Errorf("CreateScan DB insert error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create scan"})
			return
		}
		if requestedOrgID != nil {
			if err := EnsureOrgScanLink(c.Request.Context(), db, *requestedOrgID, scan.ID); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to scope scan to organization"})
				return
			}
		}

		// Attach tags if provided
		if len(req.TagIDs) > 0 {
			var scanTags []models.ScanTag
			for _, tagIDStr := range req.TagIDs {
				tagID, err := uuid.Parse(tagIDStr)
				if err != nil {
					continue
				}
				scanTags = append(scanTags, models.ScanTag{ScanID: scan.ID, TagID: tagID})
			}
			if len(scanTags) > 0 {
				db.NewInsert().Model(&scanTags).Exec(c.Request.Context()) //nolint:errcheck
			}
		}

		if err := scanner.DispatchScan(c.Request.Context(), db, scan, envVars, req.Platform); err != nil {
			log.Warnf("CreateScan dispatch failed for %s: %v", scan.ID, err)
			if markErr := scanner.MarkScanFailed(c.Request.Context(), db, scan.ID, err.Error()); markErr != nil {
				log.Errorf("CreateScan failed to persist dispatch error for %s: %v", scan.ID, markErr)
			} else {
				completedAt := time.Now()
				scan.Status = models.ScanStatusFailed
				scan.CurrentStep = models.ScanStepFailed
				scan.ErrorMessage = err.Error()
				scan.CompletedAt = &completedAt
			}
		}

		go audit.Write(context.Background(), db, userID.String(), "scan.create",
			fmt.Sprintf("Scan created for %s:%s (id=%s)", scan.ImageName, scan.ImageTag, scan.ID))

		c.JSON(http.StatusCreated, scan)
	}
}

func CreateScans(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateScansRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request: " + err.Error()})
			return
		}

		userID, _, ok := authz.RequireRequestUser(c, db)
		if !ok {
			return
		}

		var requestedRegistryID *uuid.UUID
		var requestedOrgID *uuid.UUID
		if req.RegistryID != "" {
			parsedRegistryID, err := uuid.Parse(req.RegistryID)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid registry_id"})
				return
			}
			if _, _, _, ok := authz.LoadAccessibleRegistry(c, db, parsedRegistryID); !ok {
				return
			}
			requestedRegistryID = &parsedRegistryID
		}
		if req.OrgID != "" {
			parsedOrgID, err := uuid.Parse(req.OrgID)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
				return
			}
			org, _, _, _, ok := authz.RequireOrgRole(c, db, parsedOrgID, models.OrgRoleEditor)
			if !ok {
				return
			}
			if !authz.EnsureOrgActionAllowed(c, org, "image_scan") {
				return
			}
			requestedOrgID = &parsedOrgID
		}

		type preparedScan struct {
			Scan    models.Scan
			EnvVars []string
		}

		prepared := make([]preparedScan, 0, len(req.Images))
		for _, ref := range req.Images {
			_, imageName, imageTag := scanner.NormalizeHelmImageRef(ref)
			if imageName == "" {
				continue
			}

			registry, envVars, err := scanner.ResolveRegistryForScan(c.Request.Context(), db, imageName, requestedRegistryID)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
			provider, err := scanner.ProviderForRegistry(registry)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}

			normalizedImageName, normalizedImageTag := scanner.NormalizeScanTargetWithXrayRepository(imageName, imageTag, registry, req.XrayRepository)
			scan := models.Scan{
				ImageName:    normalizedImageName,
				ImageTag:     normalizedImageTag,
				Platform:     req.Platform,
				ScanProvider: provider,
				ScanSource:   models.ScanSourceRegistry,
				CurrentStep:  models.ScanStepQueued,
				Status:       models.ScanStatusPending,
				UserID:       &userID,
				OwnerType:    models.OwnerTypeUser,
				OwnerUserID:  &userID,
				CreatedAt:    time.Now(),
			}
			if requestedOrgID != nil {
				scan.OwnerType = models.OwnerTypeOrg
				scan.OwnerUserID = nil
				scan.OwnerOrgID = requestedOrgID
			}
			if registry != nil {
				scan.RegistryID = &registry.ID
			}

			prepared = append(prepared, preparedScan{Scan: scan, EnvVars: envVars})
		}

		if len(prepared) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no valid images found in request"})
			return
		}

		created := make([]models.Scan, 0, len(prepared))
		if err := db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
			for i := range prepared {
				scan := prepared[i].Scan
				if _, err := tx.NewInsert().Model(&scan).Exec(ctx); err != nil {
					return err
				}
				if requestedOrgID != nil {
					if err := EnsureOrgScanLink(ctx, tx, *requestedOrgID, scan.ID); err != nil {
						return err
					}
				}

				if len(req.TagIDs) > 0 {
					var scanTags []models.ScanTag
					for _, tagIDStr := range req.TagIDs {
						tagID, err := uuid.Parse(tagIDStr)
						if err != nil {
							continue
						}
						scanTags = append(scanTags, models.ScanTag{ScanID: scan.ID, TagID: tagID})
					}
					if len(scanTags) > 0 {
						if _, err := tx.NewInsert().Model(&scanTags).Exec(ctx); err != nil {
							return err
						}
					}
				}

				prepared[i].Scan = scan
				created = append(created, scan)
			}
			return nil
		}); err != nil {
			log.Errorf("CreateScans DB insert error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create scans"})
			return
		}

		for i := range created {
			scan := &created[i]
			if err := scanner.DispatchScan(c.Request.Context(), db, scan, prepared[i].EnvVars, req.Platform); err != nil {
				log.Warnf("CreateScans dispatch failed for %s: %v", scan.ID, err)
				if markErr := scanner.MarkScanFailed(c.Request.Context(), db, scan.ID, err.Error()); markErr != nil {
					log.Errorf("CreateScans failed to persist dispatch error for %s: %v", scan.ID, markErr)
				} else {
					completedAt := time.Now()
					scan.Status = models.ScanStatusFailed
					scan.CurrentStep = models.ScanStepFailed
					scan.ErrorMessage = err.Error()
					scan.CompletedAt = &completedAt
				}
			}
		}

		go audit.Write(context.Background(), db, userID.String(), "scan.create.batch",
			fmt.Sprintf("Queued %d scans", len(created)))

		c.JSON(http.StatusCreated, gin.H{"scans": created})
	}
}

func CreateUploadedArchiveScan(db *bun.DB) gin.HandlerFunc {
	return createUploadedArchiveScan(db, false)
}

// CreateOrgUploadedArchiveScan receives the organization in the URL so the
// authorization check happens before the multipart body is accepted.
func CreateOrgUploadedArchiveScan(db *bun.DB) gin.HandlerFunc {
	return createUploadedArchiveScan(db, true)
}

func createUploadedArchiveScan(db *bun.DB, orgInPath bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !scanner.TrivyEnabled() {
			c.JSON(http.StatusForbidden, gin.H{"error": "archive upload scanning is unavailable because local Trivy scanning is disabled"})
			return
		}

		var requestedOrgID *uuid.UUID
		var userID uuid.UUID
		if orgInPath {
			parsedOrgID, parseErr := uuid.Parse(c.Param("id"))
			if parseErr != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
				return
			}
			org, _, resolvedUserID, _, ok := authz.RequireOrgRole(c, db, parsedOrgID, models.OrgRoleEditor)
			if !ok || !authz.EnsureOrgActionAllowed(c, org, "image_scan") {
				return
			}
			if tokenOrgID, isOrgToken := authz.GetOrgTokenOrgID(c); isOrgToken && tokenOrgID != parsedOrgID {
				c.JSON(http.StatusForbidden, gin.H{"error": "organization token can only upload archives to its own organization"})
				return
			}
			requestedOrgID = &parsedOrgID
			userID = resolvedUserID
		} else if _, isOrgToken := authz.GetOrgTokenOrgID(c); !isOrgToken {
			var ok bool
			userID, _, ok = authz.RequireRequestUser(c, db)
			if !ok {
				return
			}
		}

		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxUploadedArchiveBytes+1024)
		if err := c.Request.ParseMultipartForm(uploadFormMemoryBytes); err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "request body too large") {
				c.JSON(http.StatusBadRequest, gin.H{"error": "uploaded archive exceeds the 5 GB limit"})
				return
			}
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid multipart form: " + err.Error()})
			return
		}

		fileHeader, err := uploadedArchiveFile(c)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := validateUploadedArchiveFile(fileHeader); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		reqOrgID := strings.TrimSpace(c.PostForm("org_id"))
		if requestedOrgID != nil && reqOrgID != "" && reqOrgID != requestedOrgID.String() {
			c.JSON(http.StatusBadRequest, gin.H{"error": "org_id must match the organization in the URL"})
			return
		}
		if requestedOrgID == nil && reqOrgID != "" {
			parsedOrgID, parseErr := uuid.Parse(reqOrgID)
			if parseErr != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org_id"})
				return
			}
			org, _, _, _, ok := authz.RequireOrgRole(c, db, parsedOrgID, models.OrgRoleEditor)
			if !ok {
				return
			}
			if !authz.EnsureOrgActionAllowed(c, org, "image_scan") {
				return
			}
			requestedOrgID = &parsedOrgID
		}
		if tokenOrgID, isOrgToken := authz.GetOrgTokenOrgID(c); isOrgToken {
			if requestedOrgID == nil || *requestedOrgID != tokenOrgID {
				c.JSON(http.StatusForbidden, gin.H{"error": "organization token can only upload archives to its own organization"})
				return
			}
		} else if requestedOrgID == nil {
			var ok bool
			userID, _, ok = authz.RequireRequestUser(c, db)
			if !ok {
				return
			}
		}
		if requestedOrgID != nil {
			if !acquireArchiveUpload(*requestedOrgID) {
				c.Header("Retry-After", "60")
				c.JSON(http.StatusTooManyRequests, gin.H{"error": "too many archive uploads are already running for this organization"})
				return
			}
			defer releaseArchiveUpload(*requestedOrgID)
		}

		imageName := strings.TrimSpace(c.PostForm("image_name"))
		if imageName == "" {
			imageName = "uploaded-image"
		}
		imageTag := strings.TrimSpace(c.PostForm("image_tag"))
		if imageTag == "" {
			imageTag = "local"
		}
		platform := strings.TrimSpace(c.PostForm("platform"))

		tagIDs := parseTagIDList(c.PostForm("tag_ids"))
		if requestedOrgID != nil {
			if err := validateArchiveTags(c.Request.Context(), db, *requestedOrgID, tagIDs); err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
				return
			}
		} else if err := validatePersonalArchiveTags(c.Request.Context(), db, userID, tagIDs); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}

		scanID := uuid.New()
		archivePath := filepath.Join(os.TempDir(), "justscan", "uploads", scanID.String(), sanitizeArchiveFilename(fileHeader.Filename))
		if err := os.MkdirAll(filepath.Dir(archivePath), 0o700); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to initialize upload directory"})
			return
		}

		if err := saveUploadedArchive(fileHeader, archivePath); err != nil {
			_ = os.RemoveAll(filepath.Dir(archivePath))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to store uploaded archive"})
			return
		}

		scan := &models.Scan{
			ID:            scanID,
			ImageName:     imageName,
			ImageTag:      imageTag,
			Platform:      platform,
			ScanProvider:  models.ScanProviderTrivy,
			ScanSource:    models.ScanSourceUploadedArchive,
			ImageLocation: archivePath,
			CurrentStep:   models.ScanStepQueued,
			Status:        models.ScanStatusPending,
			OwnerType:     models.OwnerTypeUser,
			CreatedAt:     time.Now(),
		}
		if userID != uuid.Nil {
			scan.UserID = &userID
			scan.OwnerUserID = &userID
		}
		if requestedOrgID != nil {
			scan.OwnerType = models.OwnerTypeOrg
			scan.OwnerUserID = nil
			scan.OwnerOrgID = requestedOrgID
		}

		if _, err := db.NewInsert().Model(scan).Exec(c.Request.Context()); err != nil {
			_ = os.Remove(archivePath)
			log.Errorf("CreateUploadedArchiveScan DB insert error: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create scan"})
			return
		}
		if requestedOrgID != nil {
			if err := EnsureOrgScanLink(c.Request.Context(), db, *requestedOrgID, scan.ID); err != nil {
				_ = os.Remove(archivePath)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to scope scan to organization"})
				return
			}
			if err := recordUploadedArchivePipeline(c.Request.Context(), db, c, scan.ID, *requestedOrgID, userID); err != nil {
				_ = os.Remove(archivePath)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to track uploaded archive scan"})
				return
			}
		}

		if len(tagIDs) > 0 {
			scanTags := make([]models.ScanTag, 0, len(tagIDs))
			for _, tagID := range tagIDs {
				scanTags = append(scanTags, models.ScanTag{ScanID: scan.ID, TagID: tagID})
			}
			if len(scanTags) > 0 {
				db.NewInsert().Model(&scanTags).Exec(c.Request.Context()) //nolint:errcheck
			}
		}

		if err := scanner.DispatchScan(c.Request.Context(), db, scan, nil, platform); err != nil {
			log.Warnf("CreateUploadedArchiveScan dispatch failed for %s: %v", scan.ID, err)
			if !scanner.IsScanQueueCapacityError(err) {
				_ = os.RemoveAll(filepath.Dir(archivePath))
			}
			if markErr := scanner.MarkScanFailed(c.Request.Context(), db, scan.ID, err.Error()); markErr != nil {
				log.Errorf("CreateUploadedArchiveScan failed to persist dispatch error for %s: %v", scan.ID, markErr)
			}
		}

		actorID := userID.String()
		if userID == uuid.Nil {
			if tokenID, ok := authz.GetOrgTokenID(c); ok {
				actorID = "org-token:" + tokenID.String()
			}
		}
		go audit.Write(context.Background(), db, actorID, "scan.create.upload",
			fmt.Sprintf("Uploaded archive scan created for %s:%s (id=%s,size=%d)", scan.ImageName, scan.ImageTag, scan.ID, fileHeader.Size))

		c.JSON(http.StatusCreated, uploadedArchiveScanResponse{
			ID: scan.ID, ImageName: scan.ImageName, ImageTag: scan.ImageTag, Status: scan.Status, CurrentStep: scan.CurrentStep,
		})
	}
}

func recordUploadedArchivePipeline(ctx context.Context, db *bun.DB, c *gin.Context, scanID, orgID, userID uuid.UUID) error {
	initiatorTokenID, initiatorDescription, err := resolvePipelineInitiator(c, db, userID)
	if err != nil {
		return err
	}
	return pipelines.CreateScanRequest(ctx, db, scanID.String(), orgID.String(), pipelines.ScanCreateConfig{
		Source:                    models.PipelineSourceJustScanCLI,
		InitiatorTokenID:          initiatorTokenID,
		InitiatorTokenDescription: initiatorDescription,
	})
}

func uploadedArchiveFile(c *gin.Context) (*multipart.FileHeader, error) {
	fileHeader, err := c.FormFile("archive")
	if err == nil {
		return fileHeader, nil
	}
	if c.Request.MultipartForm == nil || c.Request.MultipartForm.File == nil {
		return nil, fmt.Errorf("archive file is required")
	}
	for _, headers := range c.Request.MultipartForm.File {
		if len(headers) > 0 {
			return headers[0], nil
		}
	}
	return nil, fmt.Errorf("archive file is required")
}

func validateUploadedArchiveFile(fileHeader *multipart.FileHeader) error {
	if fileHeader == nil {
		return fmt.Errorf("archive file is required")
	}
	filename := strings.ToLower(strings.TrimSpace(fileHeader.Filename))
	if !(strings.HasSuffix(filename, ".tar") || strings.HasSuffix(filename, ".tar.gz") || strings.HasSuffix(filename, ".tgz")) {
		return fmt.Errorf("archive must be a .tar, .tar.gz, or .tgz file")
	}
	if fileHeader.Size <= 0 {
		return fmt.Errorf("archive file is empty")
	}
	if fileHeader.Size > maxUploadedArchiveBytes {
		return fmt.Errorf("uploaded archive exceeds the 5 GB limit")
	}
	return nil
}

func saveUploadedArchive(fileHeader *multipart.FileHeader, destination string) error {
	src, err := fileHeader.Open()
	if err != nil {
		return err
	}
	defer src.Close()

	dst, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer dst.Close()

	_, err = io.Copy(dst, src)
	return err
}

func acquireArchiveUpload(orgID uuid.UUID) bool {
	archiveUploadGuards.Lock()
	guard := archiveUploadGuards.byOrg[orgID]
	if guard == nil {
		guard = make(chan struct{}, maxConcurrentArchiveUploadsPerOrg)
		archiveUploadGuards.byOrg[orgID] = guard
	}
	archiveUploadGuards.Unlock()
	select {
	case guard <- struct{}{}:
		return true
	default:
		return false
	}
}

func releaseArchiveUpload(orgID uuid.UUID) {
	archiveUploadGuards.Lock()
	guard := archiveUploadGuards.byOrg[orgID]
	archiveUploadGuards.Unlock()
	if guard != nil {
		<-guard
	}
}

func validateArchiveTags(ctx context.Context, db *bun.DB, orgID uuid.UUID, tagIDs []uuid.UUID) error {
	if len(tagIDs) == 0 {
		return nil
	}
	count, err := db.NewSelect().TableExpr("tags AS tag").
		Where("tag.id IN (?)", bun.In(tagIDs)).
		WhereGroup(" AND ", func(q *bun.SelectQuery) *bun.SelectQuery {
			return q.Where("tag.owner_type = ?", models.OwnerTypeSystem).
				WhereOr("tag.owner_org_id = ?", orgID).
				WhereOr("EXISTS (SELECT 1 FROM org_tags AS org_tag WHERE org_tag.tag_id = tag.id AND org_tag.org_id = ?)", orgID)
		}).
		Count(ctx)
	if err != nil {
		return fmt.Errorf("validate archive tags: %w", err)
	}
	if count != len(tagIDs) {
		return fmt.Errorf("one or more tags are not available to this organization")
	}
	return nil
}

func validatePersonalArchiveTags(ctx context.Context, db *bun.DB, userID uuid.UUID, tagIDs []uuid.UUID) error {
	if len(tagIDs) == 0 {
		return nil
	}
	count, err := db.NewSelect().TableExpr("tags AS tag").
		Where("tag.id IN (?)", bun.In(tagIDs)).
		WhereGroup(" AND ", func(q *bun.SelectQuery) *bun.SelectQuery {
			return q.Where("tag.owner_type = ?", models.OwnerTypeSystem).
				WhereOr("tag.owner_user_id = ?", userID)
		}).
		Count(ctx)
	if err != nil {
		return fmt.Errorf("validate personal archive tags: %w", err)
	}
	if count != len(tagIDs) {
		return fmt.Errorf("one or more tags are not available to this user")
	}
	return nil
}

func sanitizeArchiveFilename(filename string) string {
	name := strings.TrimSpace(filepath.Base(filename))
	if name == "" || name == "." || name == string(filepath.Separator) {
		return "image.tar"
	}
	return strings.ReplaceAll(name, "..", "_")
}

func parseTagIDList(raw string) []uuid.UUID {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}
	parts := strings.Split(trimmed, ",")
	out := make([]uuid.UUID, 0, len(parts))
	for _, part := range parts {
		value := strings.TrimSpace(part)
		if value == "" {
			continue
		}
		if parsed, err := uuid.Parse(value); err == nil {
			out = append(out, parsed)
		}
	}
	return out
}
