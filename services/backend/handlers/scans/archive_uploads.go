package scans

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
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
	archiveUploadChunkBytes = int64(8 * 1024 * 1024)
	archiveUploadSessionTTL = 24 * time.Hour
)

type archiveUploadSessionRequest struct {
	Filename     string `json:"filename" binding:"required"`
	ImageName    string `json:"image_name"`
	ImageTag     string `json:"image_tag"`
	Platform     string `json:"platform"`
	ExpectedSize int64  `json:"expected_size"`
}

type archiveUploadSessionResponse struct {
	ID           uuid.UUID `json:"id"`
	UploadOffset int64     `json:"upload_offset"`
	ChunkSize    int64     `json:"chunk_size"`
	ExpectedSize int64     `json:"expected_size"`
	ExpiresAt    time.Time `json:"expires_at"`
}

// CreateArchiveUploadSession starts a short-request, resumable archive upload.
func CreateArchiveUploadSession(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, userID, ok := requireArchiveUploadOrgScope(c, db)
		if !ok {
			return
		}
		var request archiveUploadSessionRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid upload session request"})
			return
		}
		filename := sanitizeArchiveFilename(request.Filename)
		if err := validateArchiveFilename(filename); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if request.ExpectedSize < 0 || request.ExpectedSize > maxUploadedArchiveBytes {
			c.JSON(http.StatusBadRequest, gin.H{"error": "expected_size exceeds the 5 GB upload limit"})
			return
		}

		id := uuid.New()
		directory := archiveUploadDirectory(id)
		if err := os.MkdirAll(directory, 0o700); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to initialize upload directory"})
			return
		}
		archivePath := filepath.Join(directory, filename)
		file, err := os.OpenFile(archivePath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err != nil {
			_ = os.RemoveAll(directory)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to initialize upload file"})
			return
		}
		_ = file.Close()

		now := time.Now().UTC()
		session := &models.ArchiveUploadSession{
			ID: id, OrgID: orgID, Filename: filename,
			ImageName: strings.TrimSpace(request.ImageName), ImageTag: strings.TrimSpace(request.ImageTag), Platform: strings.TrimSpace(request.Platform),
			ExpectedSize: request.ExpectedSize, ArchivePath: archivePath, Status: models.ArchiveUploadStatusActive,
			CreatedAt: now, ExpiresAt: now.Add(archiveUploadSessionTTL),
		}
		if userID != uuid.Nil {
			session.UserID = &userID
		}
		if _, err := db.NewInsert().Model(session).Exec(c.Request.Context()); err != nil {
			_ = os.RemoveAll(directory)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create upload session"})
			return
		}
		go cleanupExpiredArchiveUploadSessions(context.Background(), db)
		c.JSON(http.StatusCreated, archiveUploadSessionResponse{ID: session.ID, ChunkSize: archiveUploadChunkBytes, ExpectedSize: session.ExpectedSize, ExpiresAt: session.ExpiresAt})
	}
}

// UploadArchiveUploadChunk appends one ordered chunk. The offset makes retries safe:
// a client can query the returned offset and continue without restarting the archive export.
func UploadArchiveUploadChunk(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, _, ok := requireArchiveUploadOrgScope(c, db)
		if !ok {
			return
		}
		sessionID, err := uuid.Parse(c.Param("uploadId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid upload session ID"})
			return
		}
		offset, err := strconv.ParseInt(c.GetHeader("Upload-Offset"), 10, 64)
		if err != nil || offset < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Upload-Offset must be a non-negative integer"})
			return
		}
		if !acquireArchiveUpload(orgID) {
			c.Header("Retry-After", "60")
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "too many archive uploads are already running for this organization"})
			return
		}
		defer releaseArchiveUpload(orgID)

		var currentOffset int64
		err = db.RunInTx(c.Request.Context(), nil, func(ctx context.Context, tx bun.Tx) error {
			session := &models.ArchiveUploadSession{}
			if err := tx.NewSelect().Model(session).Where("id = ? AND org_id = ?", sessionID, orgID).For("UPDATE").Scan(ctx); err != nil {
				return err
			}
			if session.Status != models.ArchiveUploadStatusActive || time.Now().After(session.ExpiresAt) {
				return errUploadSessionUnavailable
			}
			if offset != session.UploadedSize {
				currentOffset = session.UploadedSize
				return errUploadOffsetMismatch
			}
			if !isArchiveUploadPath(session.ID, session.ArchivePath) {
				return errors.New("invalid upload archive path")
			}
			file, err := os.OpenFile(session.ArchivePath, os.O_WRONLY|os.O_APPEND, 0o600)
			if err != nil {
				return err
			}
			written, copyErr := io.Copy(file, io.LimitReader(c.Request.Body, archiveUploadChunkBytes+1))
			closeErr := file.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
			if written == 0 || written > archiveUploadChunkBytes {
				return errors.New("upload chunk must be between 1 byte and 8 MiB")
			}
			newOffset := session.UploadedSize + written
			if newOffset > maxUploadedArchiveBytes || (session.ExpectedSize > 0 && newOffset > session.ExpectedSize) {
				return errors.New("uploaded archive exceeds the 5 GB limit")
			}
			if _, err := tx.NewUpdate().Model((*models.ArchiveUploadSession)(nil)).
				Set("uploaded_size = ?", newOffset).Where("id = ?", session.ID).Exec(ctx); err != nil {
				return err
			}
			currentOffset = newOffset
			return nil
		})
		if err != nil {
			switch {
			case errors.Is(err, errUploadOffsetMismatch):
				c.Header("Upload-Offset", strconv.FormatInt(currentOffset, 10))
				c.JSON(http.StatusConflict, gin.H{"error": "upload offset does not match", "upload_offset": currentOffset})
			case errors.Is(err, errUploadSessionUnavailable):
				c.JSON(http.StatusConflict, gin.H{"error": "upload session is expired or already completed"})
			case errors.Is(err, sql.ErrNoRows):
				c.JSON(http.StatusNotFound, gin.H{"error": "upload session not found"})
			default:
				c.JSON(http.StatusBadRequest, gin.H{"error": "failed to store upload chunk"})
			}
			return
		}
		c.Header("Upload-Offset", strconv.FormatInt(currentOffset, 10))
		c.JSON(http.StatusNoContent, nil)
	}
}

func CompleteArchiveUploadSession(db *bun.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID, userID, ok := requireArchiveUploadOrgScope(c, db)
		if !ok {
			return
		}
		sessionID, err := uuid.Parse(c.Param("uploadId"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid upload session ID"})
			return
		}
		session := &models.ArchiveUploadSession{}
		if err := db.NewSelect().Model(session).Where("id = ? AND org_id = ?", sessionID, orgID).Scan(c.Request.Context()); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "upload session not found"})
			return
		}
		if session.Status != models.ArchiveUploadStatusActive || time.Now().After(session.ExpiresAt) {
			c.JSON(http.StatusConflict, gin.H{"error": "upload session is expired or already completed"})
			return
		}
		if session.UploadedSize == 0 || (session.ExpectedSize > 0 && session.UploadedSize != session.ExpectedSize) {
			c.JSON(http.StatusConflict, gin.H{"error": "archive upload is incomplete", "upload_offset": session.UploadedSize})
			return
		}
		if !isArchiveUploadPath(session.ID, session.ArchivePath) {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid upload archive path"})
			return
		}
		if info, err := os.Stat(session.ArchivePath); err != nil || info.Size() != session.UploadedSize {
			c.JSON(http.StatusConflict, gin.H{"error": "archive upload is incomplete or unavailable"})
			return
		}

		now := time.Now().UTC()
		completed, err := db.NewUpdate().Model((*models.ArchiveUploadSession)(nil)).
			Set("status = ?", models.ArchiveUploadStatusCompleted).
			Set("completed_at = ?", now).
			Where("id = ? AND status = ?", session.ID, models.ArchiveUploadStatusActive).
			Exec(c.Request.Context())
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to complete upload session"})
			return
		}
		rows, err := completed.RowsAffected()
		if err != nil || rows != 1 {
			c.JSON(http.StatusConflict, gin.H{"error": "upload session is already being completed or has completed"})
			return
		}

		initiatorTokenID, initiatorDescription, err := resolvePipelineInitiator(c, db, userID)
		if err != nil {
			_, _ = db.NewUpdate().Model((*models.ArchiveUploadSession)(nil)).
				Set("status = ?", models.ArchiveUploadStatusActive).
				Set("completed_at = NULL").
				Where("id = ? AND status = ?", session.ID, models.ArchiveUploadStatusCompleted).
				Exec(c.Request.Context())
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve upload initiator"})
			return
		}
		response, err := createScanFromArchive(c.Request.Context(), db, orgID, userID, session, initiatorTokenID, initiatorDescription)
		if err != nil {
			_, _ = db.NewUpdate().Model((*models.ArchiveUploadSession)(nil)).
				Set("status = ?", models.ArchiveUploadStatusActive).
				Set("completed_at = NULL").
				Where("id = ? AND status = ?", session.ID, models.ArchiveUploadStatusCompleted).
				Exec(c.Request.Context())
			log.Errorf("CompleteArchiveUploadSession %s: %v", session.ID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create scan from uploaded archive"})
			return
		}
		go audit.Write(context.Background(), db, archiveUploadActor(userID, c), "scan.create.upload", fmt.Sprintf("Resumable archive scan created for %s:%s (id=%s,size=%d)", response.ImageName, response.ImageTag, response.ID, session.UploadedSize))
		c.JSON(http.StatusCreated, response)
	}
}

var (
	errUploadOffsetMismatch     = errors.New("upload offset mismatch")
	errUploadSessionUnavailable = errors.New("upload session unavailable")
)

func requireArchiveUploadOrgScope(c *gin.Context, db *bun.DB) (uuid.UUID, uuid.UUID, bool) {
	if !scanner.TrivyEnabled() {
		c.JSON(http.StatusForbidden, gin.H{"error": "archive upload scanning is unavailable because local Trivy scanning is disabled"})
		return uuid.Nil, uuid.Nil, false
	}
	orgID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid org ID"})
		return uuid.Nil, uuid.Nil, false
	}
	org, _, userID, _, ok := authz.RequireOrgRole(c, db, orgID, models.OrgRoleEditor)
	if !ok || !authz.EnsureOrgActionAllowed(c, org, "image_scan") {
		return uuid.Nil, uuid.Nil, false
	}
	return orgID, userID, true
}

func createScanFromArchive(ctx context.Context, db *bun.DB, orgID, userID uuid.UUID, session *models.ArchiveUploadSession, initiatorTokenID *uuid.UUID, initiatorDescription string) (uploadedArchiveScanResponse, error) {
	imageName := session.ImageName
	if imageName == "" {
		imageName = "uploaded-image"
	}
	imageTag := session.ImageTag
	if imageTag == "" {
		imageTag = "local"
	}
	scan := &models.Scan{ID: uuid.New(), ImageName: imageName, ImageTag: imageTag, Platform: session.Platform, ScanProvider: models.ScanProviderTrivy, ScanSource: models.ScanSourceUploadedArchive, ImageLocation: session.ArchivePath, CurrentStep: models.ScanStepQueued, Status: models.ScanStatusPending, OwnerType: models.OwnerTypeOrg, OwnerOrgID: &orgID, CreatedAt: time.Now()}
	if userID != uuid.Nil {
		scan.UserID = &userID
	}
	if _, err := db.NewInsert().Model(scan).Exec(ctx); err != nil {
		return uploadedArchiveScanResponse{}, err
	}
	if err := EnsureOrgScanLink(ctx, db, orgID, scan.ID); err != nil {
		return uploadedArchiveScanResponse{}, err
	}
	if err := pipelines.CreateScanRequest(ctx, db, scan.ID.String(), orgID.String(), pipelines.ScanCreateConfig{
		Source:                    models.PipelineSourceJustScanCLI,
		InitiatorTokenID:          initiatorTokenID,
		InitiatorTokenDescription: initiatorDescription,
	}); err != nil {
		return uploadedArchiveScanResponse{}, err
	}
	if err := scanner.DispatchScan(ctx, db, scan, nil, session.Platform); err != nil {
		log.Warnf("Create archive session scan dispatch failed for %s: %v", scan.ID, err)
		if markErr := scanner.MarkScanFailed(ctx, db, scan.ID, err.Error()); markErr != nil {
			return uploadedArchiveScanResponse{}, markErr
		}
	}
	return uploadedArchiveScanResponse{ID: scan.ID, ImageName: scan.ImageName, ImageTag: scan.ImageTag, Status: scan.Status, CurrentStep: scan.CurrentStep}, nil
}

func archiveUploadDirectory(id uuid.UUID) string {
	return filepath.Join(os.TempDir(), "justscan", "uploads", id.String())
}

func isArchiveUploadPath(id uuid.UUID, path string) bool {
	directory := archiveUploadDirectory(id)
	relative, err := filepath.Rel(directory, path)
	return err == nil && relative != "." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative)
}

func validateArchiveFilename(filename string) error {
	lower := strings.ToLower(filename)
	if !strings.HasSuffix(lower, ".tar") && !strings.HasSuffix(lower, ".tar.gz") && !strings.HasSuffix(lower, ".tgz") {
		return errors.New("archive must be a .tar, .tar.gz, or .tgz file")
	}
	return nil
}

func archiveUploadActor(userID uuid.UUID, c *gin.Context) string {
	if userID != uuid.Nil {
		return userID.String()
	}
	if tokenID, ok := authz.GetOrgTokenID(c); ok {
		return "org-token:" + tokenID.String()
	}
	return "unknown"
}

func cleanupExpiredArchiveUploadSessions(ctx context.Context, db *bun.DB) {
	var sessions []models.ArchiveUploadSession
	if err := db.NewSelect().Model(&sessions).Where("status = ? AND expires_at < ?", models.ArchiveUploadStatusActive, time.Now().UTC()).Limit(50).Scan(ctx); err != nil {
		return
	}
	for _, session := range sessions {
		if isArchiveUploadPath(session.ID, session.ArchivePath) {
			_ = os.RemoveAll(archiveUploadDirectory(session.ID))
		}
		_, _ = db.NewDelete().Model((*models.ArchiveUploadSession)(nil)).Where("id = ?", session.ID).Exec(ctx)
	}
}
