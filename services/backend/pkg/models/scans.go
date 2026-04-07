package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type Scan struct {
	bun.BaseModel `bun:"table:scans"`

	ID                      uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	ImageName               string     `bun:"image_name,type:text,notnull" json:"image_name"`
	ImageTag                string     `bun:"image_tag,type:text,notnull" json:"image_tag"`
	ImageDigest             string     `bun:"image_digest,type:text,default:''" json:"image_digest"`
	ScanProvider            string     `bun:"scan_provider,type:text,notnull,default:'trivy'" json:"scan_provider"`
	ExternalScanID          string     `bun:"external_scan_id,type:text,default:''" json:"external_scan_id,omitempty"`
	ExternalStatus          string     `bun:"external_status,type:text,default:''" json:"external_status,omitempty"`
	Status                  string     `bun:"status,type:text,notnull,default:'pending'" json:"status"`
	ErrorMessage            string     `bun:"error_message,type:text,default:''" json:"error_message"`
	CriticalCount           int        `bun:"critical_count,type:int,default:0" json:"critical_count"`
	HighCount               int        `bun:"high_count,type:int,default:0" json:"high_count"`
	MediumCount             int        `bun:"medium_count,type:int,default:0" json:"medium_count"`
	LowCount                int        `bun:"low_count,type:int,default:0" json:"low_count"`
	UnknownCount            int        `bun:"unknown_count,type:int,default:0" json:"unknown_count"`
	SuppressedCount         int        `bun:"suppressed_count,type:int,default:0" json:"suppressed_count"`
	TrivyVersion            string     `bun:"trivy_version,type:text,default:''" json:"trivy_version"`
	TrivyVulnDBUpdatedAt    *time.Time `bun:"trivy_vuln_db_updated_at,type:timestamptz" json:"trivy_vuln_db_updated_at,omitempty"`
	TrivyVulnDBDownloadedAt *time.Time `bun:"trivy_vuln_db_downloaded_at,type:timestamptz" json:"trivy_vuln_db_downloaded_at,omitempty"`
	TrivyJavaDBUpdatedAt    *time.Time `bun:"trivy_java_db_updated_at,type:timestamptz" json:"trivy_java_db_updated_at,omitempty"`
	TrivyJavaDBDownloadedAt *time.Time `bun:"trivy_java_db_downloaded_at,type:timestamptz" json:"trivy_java_db_downloaded_at,omitempty"`
	UserID                  *uuid.UUID `bun:"user_id,type:uuid" json:"user_id,omitempty"`
	RegistryID              *uuid.UUID `bun:"registry_id,type:uuid" json:"registry_id,omitempty"`
	Architecture            string     `bun:"architecture,type:text,default:''" json:"architecture"`
	OSFamily                string     `bun:"os_family,type:text,default:''" json:"os_family"`
	OSName                  string     `bun:"os_name,type:text,default:''" json:"os_name"`
	Platform                string     `bun:"platform,type:text,default:''" json:"platform"`
	ImageLocation           string     `bun:"image_location,type:text,default:''" json:"image_location"`
	StartedAt               *time.Time `bun:"started_at,type:timestamptz" json:"started_at"`
	CompletedAt             *time.Time `bun:"completed_at,type:timestamptz" json:"completed_at"`
	CreatedAt               time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	ShareToken              *string    `bun:"share_token,type:varchar(64)" json:"share_token,omitempty"`
	ShareVisibility         *string    `bun:"share_visibility,type:varchar(20)" json:"share_visibility,omitempty"`
	HelmScanRunID           *uuid.UUID `bun:"helm_scan_run_id,type:uuid" json:"helm_scan_run_id,omitempty"`
	HelmChart               string     `bun:"helm_chart,type:text,default:''" json:"helm_chart,omitempty"`
	HelmChartName           string     `bun:"helm_chart_name,type:text,default:''" json:"helm_chart_name,omitempty"`
	HelmChartVersion        string     `bun:"helm_chart_version,type:text,default:''" json:"helm_chart_version,omitempty"`
	HelmSourcePath          string     `bun:"helm_source_path,type:text,default:''" json:"helm_source_path,omitempty"`

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
	ScanStatusCancelled = "cancelled"
)

const (
	ScanProviderTrivy           = "trivy"
	ScanProviderArtifactoryXray = "artifactory_xray"
)
