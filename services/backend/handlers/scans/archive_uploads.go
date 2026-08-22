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
			if !isArchiveUploadPath(session.ID, session.ArchivePath) {
				return errors.New("invalid upload archive path")
			}
			// Filesystem writes cannot participate in the database transaction. If
			// the process crashed (or the offset update failed) after appending a
			// chunk, reconcile the file back to the durable database offset before
			// accepting a retry. This prevents the same chunk from being appended
			// twice.
			if err := reconcileArchiveUploadFile(session); err != nil {
				return err
			}
			if offset != session.UploadedSize {
				currentOffset = session.UploadedSize
				return errUploadOffsetMismatch
			}
			newOffset, err := appendArchiveUploadChunk(session, c.Request.Body)
			if err != nil {
				return err
			}
			if newOffset > maxUploadedArchiveBytes || (session.ExpectedSize > 0 && newOffset > session.ExpectedSize) {
				_ = truncateArchiveUploadFile(session.ArchivePath, session.UploadedSize)
				return errors.New("uploaded archive exceeds the 5 GB limit")
			}
			if _, err := tx.NewUpdate().Model((*models.ArchiveUploadSession)(nil)).
				Set("uploaded_size = ?", newOffset).Where("id = ?", session.ID).Exec(ctx); err != nil {
				// Best-effort rollback closes the crash window for ordinary DB
				// errors; reconcileArchiveUploadFile remains the recovery path if
				// the process dies before this truncation runs.
				_ = truncateArchiveUploadFile(session.ArchivePath, session.UploadedSize)
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
			case errors.Is(err, errUploadArchiveFileMismatch):
				c.Header("Upload-Offset", strconv.FormatInt(currentOffset, 10))
				c.JSON(http.StatusConflict, gin.H{"error": "upload archive file does not match its recorded offset", "upload_offset": currentOffset})
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
		session, err := claimArchiveUploadCompletion(c.Request.Context(), db, sessionID, orgID)
		if err != nil {
			switch {
			case errors.Is(err, sql.ErrNoRows):
				c.JSON(http.StatusNotFound, gin.H{"error": "upload session not found"})
			case errors.Is(err, errUploadSessionIncomplete):
				var currentOffset int64
				if session != nil {
					currentOffset = session.UploadedSize
				}
				c.JSON(http.StatusConflict, gin.H{"error": "archive upload is incomplete", "upload_offset": currentOffset})
			case errors.Is(err, errUploadArchiveFileMismatch):
				c.JSON(http.StatusConflict, gin.H{"error": "archive upload is incomplete or unavailable"})
			case errors.Is(err, errUploadSessionUnavailable):
				c.JSON(http.StatusConflict, gin.H{"error": "upload session is expired or unavailable"})
			default:
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to complete upload session"})
			}
			return
		}

		initiatorTokenID, initiatorDescription, err := resolvePipelineInitiator(c, db, userID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve upload initiator"})
			return
		}
		response, err := createScanFromArchive(c.Request.Context(), db, orgID, userID, session, initiatorTokenID, initiatorDescription)
		if err != nil {
			log.Errorf("CompleteArchiveUploadSession %s: %v", session.ID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create scan from uploaded archive"})
			return
		}
		go audit.Write(context.Background(), db, archiveUploadActor(userID, c), "scan.create.upload", fmt.Sprintf("Resumable archive scan created for %s:%s (id=%s,size=%d)", response.ImageName, response.ImageTag, response.ID, session.UploadedSize))
		c.JSON(http.StatusCreated, response)
	}
}

var (
	errUploadOffsetMismatch      = errors.New("upload offset mismatch")
	errUploadSessionUnavailable  = errors.New("upload session unavailable")
	errUploadSessionIncomplete   = errors.New("upload session incomplete")
	errUploadArchiveFileMismatch = errors.New("upload archive file mismatch")
)

// reconcileArchiveUploadFile makes the filesystem state agree with the
// database offset before a new chunk is accepted. A file can be ahead when a
// process dies after writing bytes but before committing uploaded_size.
func reconcileArchiveUploadFile(session *models.ArchiveUploadSession) error {
	if session == nil || !isArchiveUploadPath(session.ID, session.ArchivePath) {
		return errors.New("invalid upload archive path")
	}
	info, err := os.Lstat(session.ArchivePath)
	if err != nil {
		return fmt.Errorf("stat upload archive: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() < session.UploadedSize {
		return errUploadArchiveFileMismatch
	}
	if info.Size() == session.UploadedSize {
		return nil
	}
	return truncateArchiveUploadFile(session.ArchivePath, session.UploadedSize)
}

func truncateArchiveUploadFile(path string, offset int64) error {
	file, err := os.OpenFile(path, os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if err := file.Truncate(offset); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}

// appendArchiveUploadChunk writes a single chunk and returns the resulting
// offset. Any body/file error restores the original file length immediately;
// the offset reconciliation above remains the final protection for crashes
// between this write and the database update.
func appendArchiveUploadChunk(session *models.ArchiveUploadSession, body io.Reader) (int64, error) {
	if session == nil || !isArchiveUploadPath(session.ID, session.ArchivePath) {
		return 0, errors.New("invalid upload archive path")
	}
	startOffset := session.UploadedSize
	file, err := os.OpenFile(session.ArchivePath, os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return 0, err
	}
	rollback := func() {
		if err := file.Truncate(startOffset); err != nil {
			log.Warnf("failed to roll back partial archive upload %s: %v", session.ID, err)
			return
		}
		if err := file.Sync(); err != nil {
			log.Warnf("failed to sync rolled-back archive upload %s: %v", session.ID, err)
		}
	}
	written, copyErr := io.Copy(file, io.LimitReader(body, archiveUploadChunkBytes+1))
	if copyErr != nil || written == 0 || written > archiveUploadChunkBytes {
		rollback()
		_ = file.Close()
		if copyErr != nil {
			return 0, copyErr
		}
		return 0, errors.New("upload chunk must be between 1 byte and 8 MiB")
	}
	if err := file.Sync(); err != nil {
		rollback()
		_ = file.Close()
		return 0, err
	}
	if err := file.Close(); err != nil {
		return 0, err
	}
	return startOffset + written, nil
}

// claimArchiveUploadCompletion serializes completion and persists the scan ID
// before any scan dispatch work. A retry therefore resumes the same scan even
// if the process dies after this transaction commits.
func claimArchiveUploadCompletion(ctx context.Context, db *bun.DB, sessionID, orgID uuid.UUID) (*models.ArchiveUploadSession, error) {
	var result *models.ArchiveUploadSession
	err := db.RunInTx(ctx, nil, func(ctx context.Context, tx bun.Tx) error {
		session := &models.ArchiveUploadSession{}
		if err := tx.NewSelect().Model(session).
			Where("id = ? AND org_id = ?", sessionID, orgID).
			For("UPDATE").Scan(ctx); err != nil {
			return err
		}

		if session.Status == models.ArchiveUploadStatusCompleted {
			if session.ScanID == nil {
				if err := recoverCompletedArchiveScanID(ctx, tx, session); err != nil {
					return err
				}
			}
			result = session
			return nil
		}
		if session.Status != models.ArchiveUploadStatusActive || time.Now().After(session.ExpiresAt) {
			return errUploadSessionUnavailable
		}
		if session.UploadedSize == 0 || (session.ExpectedSize > 0 && session.UploadedSize != session.ExpectedSize) {
			result = session
			return errUploadSessionIncomplete
		}
		if !isArchiveUploadPath(session.ID, session.ArchivePath) {
			return errors.New("invalid upload archive path")
		}
		if err := reconcileArchiveUploadFile(session); err != nil {
			return err
		}
		info, err := os.Lstat(session.ArchivePath)
		if err != nil || !info.Mode().IsRegular() || info.Size() != session.UploadedSize {
			return errUploadArchiveFileMismatch
		}

		scanID := uuid.New()
		now := time.Now().UTC()
		updated, err := tx.NewUpdate().Model((*models.ArchiveUploadSession)(nil)).
			Set("status = ?", models.ArchiveUploadStatusCompleted).
			Set("completed_at = ?", now).
			Set("scan_id = ?", scanID).
			Where("id = ? AND status = ?", session.ID, models.ArchiveUploadStatusActive).
			Exec(ctx)
		if err != nil {
			return err
		}
		if rows, err := updated.RowsAffected(); err != nil {
			return err
		} else if rows != 1 {
			return errUploadSessionUnavailable
		}
		session.ScanID = &scanID
		session.Status = models.ArchiveUploadStatusCompleted
		session.CompletedAt = &now
		result = session
		return nil
	})
	return result, err
}

// recoverCompletedArchiveScanID handles sessions completed by an older
// server version before scan_id was persisted. It first reuses a matching
// existing scan, then reserves a new deterministic ID for the retry.
func recoverCompletedArchiveScanID(ctx context.Context, db bun.IDB, session *models.ArchiveUploadSession) error {
	var scan models.Scan
	err := db.NewSelect().Model(&scan).
		Where("scan_source = ? AND image_location = ? AND owner_org_id = ?", models.ScanSourceUploadedArchive, session.ArchivePath, session.OrgID).
		OrderExpr("created_at ASC, id ASC").
		Limit(1).
		Scan(ctx)
	if err == nil {
		session.ScanID = &scan.ID
		_, err = db.NewUpdate().Model((*models.ArchiveUploadSession)(nil)).
			Set("scan_id = ?", scan.ID).
			Where("id = ? AND scan_id IS NULL", session.ID).
			Exec(ctx)
		return err
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	scanID := uuid.New()
	if _, err := db.NewUpdate().Model((*models.ArchiveUploadSession)(nil)).
		Set("scan_id = ?", scanID).
		Where("id = ? AND scan_id IS NULL", session.ID).
		Exec(ctx); err != nil {
		return err
	}
	session.ScanID = &scanID
	return nil
}

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
	scanID := uuid.New()
	if session.ScanID != nil {
		scanID = *session.ScanID
	}
	scan := &models.Scan{ID: scanID, ImageName: imageName, ImageTag: imageTag, Platform: session.Platform, ScanProvider: models.ScanProviderTrivy, ScanSource: models.ScanSourceUploadedArchive, ImageLocation: session.ArchivePath, CurrentStep: models.ScanStepQueued, Status: models.ScanStatusPending, OwnerType: models.OwnerTypeOrg, OwnerOrgID: &orgID, CreatedAt: time.Now()}
	if userID != uuid.Nil {
		scan.UserID = &userID
	}
	inserted, err := db.NewInsert().Model(scan).On("CONFLICT (id) DO NOTHING").Exec(ctx)
	if err != nil {
		return uploadedArchiveScanResponse{}, err
	}
	insertedRows, err := inserted.RowsAffected()
	if err != nil {
		return uploadedArchiveScanResponse{}, err
	}
	if insertedRows == 0 {
		// The completion transaction already reserved this ID and another
		// request may have created the scan. Reuse the durable row instead of
		// creating a second scan or dispatching the same job twice.
		if err := db.NewSelect().Model(scan).Where("id = ?", scanID).Scan(ctx); err != nil {
			return uploadedArchiveScanResponse{}, err
		}
	}
	if err := EnsureOrgScanLink(ctx, db, orgID, scan.ID); err != nil {
		return uploadedArchiveScanResponse{}, err
	}
	var pipelineRequest models.PipelineScanRequest
	pipelineErr := db.NewSelect().Model(&pipelineRequest).Where("scan_id = ?", scan.ID).Scan(ctx)
	if errors.Is(pipelineErr, sql.ErrNoRows) {
		if err := pipelines.CreateScanRequest(ctx, db, scan.ID.String(), orgID.String(), pipelines.ScanCreateConfig{
			Source:                    models.PipelineSourceJustScanCLI,
			InitiatorTokenID:          initiatorTokenID,
			InitiatorTokenDescription: initiatorDescription,
		}); err != nil {
			// A concurrent completion may have inserted the unique request. Treat
			// that race as success when the request is now present.
			if loadErr := db.NewSelect().Model(&pipelineRequest).Where("scan_id = ?", scan.ID).Scan(ctx); loadErr != nil {
				return uploadedArchiveScanResponse{}, err
			}
		}
	} else if pipelineErr != nil {
		return uploadedArchiveScanResponse{}, pipelineErr
	}
	// If the process crashed after inserting the reserved scan but before
	// dispatching it, a retry must enqueue the existing pending row. The worker
	// claims pending rows atomically, so a concurrent retry cannot execute the
	// same scan twice.
	if insertedRows == 1 || (insertedRows == 0 && scan.Status == models.ScanStatusPending) {
		if err := scanner.DispatchScan(ctx, db, scan, nil, session.Platform); err != nil {
			log.Warnf("Create archive session scan dispatch failed for %s: %v", scan.ID, err)
			if markErr := scanner.MarkScanFailed(ctx, db, scan.ID, err.Error()); markErr != nil {
				return uploadedArchiveScanResponse{}, markErr
			}
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
	if err != nil || relative == "." || filepath.IsAbs(relative) || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || relative == ".." {
		return false
	}
	return !strings.Contains(relative, string(filepath.Separator)) && validateArchiveFilename(relative) == nil
}

// isControlledUploadedArchivePath accepts only an archive file directly under
// a UUID-named directory in the application upload root. This is used when a
// scan row is being deleted and its session ID is not available in the row.
func isControlledUploadedArchivePath(path string) bool {
	root := filepath.Join(os.TempDir(), "justscan", "uploads")
	relative, err := filepath.Rel(root, filepath.Clean(path))
	if err != nil || relative == "." || filepath.IsAbs(relative) {
		return false
	}
	parts := strings.Split(relative, string(filepath.Separator))
	if len(parts) != 2 {
		return false
	}
	if _, err := uuid.Parse(parts[0]); err != nil {
		return false
	}
	return validateArchiveFilename(parts[1]) == nil
}

// loadArchiveUploadSessionsForScans resolves resumable uploads before their
// scan rows are deleted. The scan_id foreign key is intentionally nullable for
// legacy sessions, so callers must capture the validated session path before
// deleteScanRecords removes the link.
func loadArchiveUploadSessionsForScans(ctx context.Context, db bun.IDB, scanIDs []uuid.UUID) ([]models.ArchiveUploadSession, error) {
	if len(scanIDs) == 0 {
		return nil, nil
	}
	exists, err := scanDeletionTableExists(ctx, db, "archive_upload_sessions")
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, nil
	}
	var sessions []models.ArchiveUploadSession
	if err := db.NewSelect().Model(&sessions).Where("scan_id IN (?)", bun.In(scanIDs)).Scan(ctx); err != nil {
		return nil, err
	}
	return sessions, nil
}

// cleanupArchiveUploadSessions removes only the UUID-scoped directories
// created by the resumable upload flow. Invalid or legacy paths are ignored;
// they must never become arbitrary filesystem deletion targets.
func cleanupArchiveUploadSessions(sessions []models.ArchiveUploadSession) error {
	var firstErr error
	for i := range sessions {
		session := &sessions[i]
		if !isArchiveUploadPath(session.ID, session.ArchivePath) {
			continue
		}
		if err := os.RemoveAll(archiveUploadDirectory(session.ID)); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func deleteArchiveUploadSessionsForScans(ctx context.Context, db bun.IDB, scanIDs []uuid.UUID) error {
	if len(scanIDs) == 0 {
		return nil
	}
	exists, err := scanDeletionTableExists(ctx, db, "archive_upload_sessions")
	if err != nil {
		return err
	}
	if !exists {
		return nil
	}
	_, err = db.NewDelete().TableExpr("archive_upload_sessions").Where("scan_id IN (?)", bun.In(scanIDs)).Exec(ctx)
	return err
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
