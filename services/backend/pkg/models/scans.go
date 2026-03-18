package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type Scan struct {
	bun.BaseModel `bun:"table:scans"`

	ID              uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	ImageName       string     `bun:"image_name,type:text,notnull" json:"image_name"`
	ImageTag        string     `bun:"image_tag,type:text,notnull" json:"image_tag"`
	ImageDigest     string     `bun:"image_digest,type:text,default:''" json:"image_digest"`
	Status          string     `bun:"status,type:text,notnull,default:'pending'" json:"status"`
	ErrorMessage    string     `bun:"error_message,type:text,default:''" json:"error_message"`
	CriticalCount   int        `bun:"critical_count,type:int,default:0" json:"critical_count"`
	HighCount       int        `bun:"high_count,type:int,default:0" json:"high_count"`
	MediumCount     int        `bun:"medium_count,type:int,default:0" json:"medium_count"`
	LowCount        int        `bun:"low_count,type:int,default:0" json:"low_count"`
	UnknownCount    int        `bun:"unknown_count,type:int,default:0" json:"unknown_count"`
	SuppressedCount int        `bun:"suppressed_count,type:int,default:0" json:"suppressed_count"`
	TrivyVersion    string     `bun:"trivy_version,type:text,default:''" json:"trivy_version"`
	UserID          *uuid.UUID `bun:"user_id,type:uuid" json:"user_id,omitempty"`
	Architecture    string     `bun:"architecture,type:text,default:''" json:"architecture"`
	OSFamily        string     `bun:"os_family,type:text,default:''" json:"os_family"`
	OSName          string     `bun:"os_name,type:text,default:''" json:"os_name"`
	Platform        string     `bun:"platform,type:text,default:''" json:"platform"`
	StartedAt       *time.Time `bun:"started_at,type:timestamptz" json:"started_at"`
	CompletedAt     *time.Time `bun:"completed_at,type:timestamptz" json:"completed_at"`
	CreatedAt       time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`

	// Relations (not stored in DB, populated on join)
	Tags            []Tag           `bun:"m2m:scan_tags,join:Scan=Tag" json:"tags,omitempty"`
	Vulnerabilities []Vulnerability `bun:"rel:has-many,join:id=scan_id" json:"vulnerabilities,omitempty"`
}

// ScanStatus constants
const (
	ScanStatusPending   = "pending"
	ScanStatusRunning   = "running"
	ScanStatusCompleted = "completed"
	ScanStatusFailed    = "failed"
)
