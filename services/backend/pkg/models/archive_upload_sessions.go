package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

const (
	ArchiveUploadStatusActive    = "active"
	ArchiveUploadStatusCompleted = "completed"
)

type ArchiveUploadSession struct {
	bun.BaseModel `bun:"table:archive_upload_sessions"`

	ID           uuid.UUID  `bun:",pk,type:uuid" json:"id"`
	OrgID        uuid.UUID  `bun:"org_id,type:uuid,notnull" json:"org_id"`
	UserID       *uuid.UUID `bun:"user_id,type:uuid" json:"user_id,omitempty"`
	Filename     string     `bun:"filename,type:text,notnull" json:"filename"`
	ImageName    string     `bun:"image_name,type:text,notnull" json:"image_name"`
	ImageTag     string     `bun:"image_tag,type:text,notnull" json:"image_tag"`
	Platform     string     `bun:"platform,type:text,notnull" json:"platform"`
	ExpectedSize int64      `bun:"expected_size,type:bigint,notnull" json:"expected_size"`
	UploadedSize int64      `bun:"uploaded_size,type:bigint,notnull" json:"uploaded_size"`
	ArchivePath  string     `bun:"archive_path,type:text,notnull" json:"-"`
	Status       string     `bun:"status,type:text,notnull" json:"status"`
	CreatedAt    time.Time  `bun:"created_at,type:timestamptz,notnull" json:"created_at"`
	ExpiresAt    time.Time  `bun:"expires_at,type:timestamptz,notnull" json:"expires_at"`
	CompletedAt  *time.Time `bun:"completed_at,type:timestamptz" json:"completed_at,omitempty"`
}
