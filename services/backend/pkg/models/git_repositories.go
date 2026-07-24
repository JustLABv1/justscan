package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

const (
	GitRepositoryAuthNone  = "none"
	GitRepositoryAuthToken = "token"
	GitRepositoryAuthBasic = "basic"

	GitRepositoryRescanChanged = "changed"
	GitRepositoryRescanAll     = "all"

	// GitRepositoryDiscoveryAuto renders detected Kustomize deployment roots,
	// falling back to plain Kubernetes manifests when no roots exist.
	GitRepositoryDiscoveryAuto      = "auto"
	GitRepositoryDiscoveryKustomize = "kustomize"
	GitRepositoryDiscoveryManifests = "manifests"

	GitRepositoryRunQueued      = "queued"
	GitRepositoryRunDiscovering = "discovering"
	GitRepositoryRunScanning    = "scanning"
	GitRepositoryRunCompleted   = "completed"
	GitRepositoryRunPartial     = "partial"
	GitRepositoryRunFailed      = "failed"

	GitRepositoryCandidateUnresolved   = "unresolved"
	GitRepositoryCandidateAutoAccepted = "auto_accepted"
	GitRepositoryCandidateResolved     = "resolved"
	GitRepositoryCandidateIgnored      = "ignored"
)

// GitRepository is a workspace-owned HTTPS repository connector. Credentials
// are encrypted at rest and deliberately excluded from JSON responses.
type GitRepository struct {
	bun.BaseModel `bun:"table:git_repositories"`

	ID                   uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	Name                 string     `bun:"name,type:text,notnull" json:"name"`
	CloneURL             string     `bun:"clone_url,type:text,notnull" json:"clone_url"`
	Ref                  string     `bun:"ref,type:text,notnull,default:'HEAD'" json:"ref"`
	AuthType             string     `bun:"auth_type,type:text,notnull,default:'none'" json:"auth_type"`
	Username             string     `bun:"username,type:text,notnull,default:''" json:"username"`
	EncryptedCredential  string     `bun:"encrypted_credential,type:text,notnull,default:''" json:"-"`
	CredentialConfigured bool       `bun:"-" json:"credential_configured"`
	Schedule             string     `bun:"schedule,type:text,notnull,default:'0 2 * * *'" json:"schedule"`
	Timezone             string     `bun:"timezone,type:text,notnull,default:'UTC'" json:"timezone"`
	Enabled              bool       `bun:"enabled,type:bool,notnull,default:false" json:"enabled"`
	RescanPolicy         string     `bun:"rescan_policy,type:text,notnull,default:'changed'" json:"rescan_policy"`
	DiscoveryMode        string     `bun:"discovery_mode,type:text,notnull,default:'auto'" json:"discovery_mode"`
	Entrypoints          []string   `bun:"entrypoints,type:jsonb,notnull,default:'[]'" json:"entrypoints"`
	TagIDs               []string   `bun:"tag_ids,type:jsonb,notnull,default:'[]'" json:"tag_ids"`
	CreatedByID          uuid.UUID  `bun:"created_by_id,type:uuid,notnull" json:"created_by_id"`
	OwnerType            string     `bun:"owner_type,type:text,notnull,default:'user'" json:"owner_type"`
	OwnerUserID          *uuid.UUID `bun:"owner_user_id,type:uuid" json:"owner_user_id,omitempty"`
	OwnerOrgID           *uuid.UUID `bun:"owner_org_id,type:uuid" json:"owner_org_id,omitempty"`
	LastRunID            *uuid.UUID `bun:"last_run_id,type:uuid" json:"last_run_id,omitempty"`
	LastRunAt            *time.Time `bun:"last_run_at,type:timestamptz" json:"last_run_at,omitempty"`
	CreatedAt            time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt            time.Time  `bun:"updated_at,type:timestamptz" json:"updated_at"`
}

type GitRepositoryRun struct {
	bun.BaseModel `bun:"table:git_repository_runs"`

	ID              uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	RepositoryID    uuid.UUID  `bun:"repository_id,type:uuid,notnull" json:"repository_id"`
	Trigger         string     `bun:"trigger,type:text,notnull,default:'manual'" json:"trigger"`
	RequestedPolicy string     `bun:"requested_policy,type:text,notnull,default:'changed'" json:"requested_policy"`
	Ref             string     `bun:"ref,type:text,notnull,default:''" json:"ref"`
	CommitSHA       string     `bun:"commit_sha,type:text,notnull,default:''" json:"commit_sha"`
	Status          string     `bun:"status,type:text,notnull,default:'queued'" json:"status"`
	ErrorMessage    string     `bun:"error_message,type:text,notnull,default:''" json:"error_message,omitempty"`
	TargetCount     int        `bun:"target_count,type:int,notnull,default:0" json:"target_count"`
	ImageCount      int        `bun:"image_count,type:int,notnull,default:0" json:"image_count"`
	ScanCount       int        `bun:"scan_count,type:int,notnull,default:0" json:"scan_count"`
	UnresolvedCount int        `bun:"unresolved_count,type:int,notnull,default:0" json:"unresolved_count"`
	StartedAt       *time.Time `bun:"started_at,type:timestamptz" json:"started_at,omitempty"`
	CompletedAt     *time.Time `bun:"completed_at,type:timestamptz" json:"completed_at,omitempty"`
	CreatedAt       time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
}

type GitRepositoryDiscoveryRule struct {
	bun.BaseModel `bun:"table:git_repository_discovery_rules"`

	ID           uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	RepositoryID uuid.UUID  `bun:"repository_id,type:uuid,notnull" json:"repository_id"`
	PathPattern  string     `bun:"path_pattern,type:text,notnull" json:"path_pattern"`
	Resolution   string     `bun:"resolution,type:text,notnull" json:"resolution"`
	Config       JSONObject `bun:"config,type:jsonb,notnull,default:'{}'" json:"config"`
	Active       bool       `bun:"active,type:bool,notnull,default:true" json:"active"`
	CreatedByID  uuid.UUID  `bun:"created_by_id,type:uuid,notnull" json:"created_by_id"`
	CreatedAt    time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
	UpdatedAt    time.Time  `bun:"updated_at,type:timestamptz" json:"updated_at"`
}

type GitRepositoryRunCandidate struct {
	bun.BaseModel `bun:"table:git_repository_run_candidates"`

	ID           uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	RunID        uuid.UUID  `bun:"run_id,type:uuid,notnull" json:"run_id"`
	Path         string     `bun:"path,type:text,notnull" json:"path"`
	DetectedType string     `bun:"detected_type,type:text,notnull" json:"detected_type"`
	Confidence   string     `bun:"confidence,type:text,notnull" json:"confidence"`
	Evidence     JSONObject `bun:"evidence,type:jsonb,notnull,default:'{}'" json:"evidence"`
	Status       string     `bun:"status,type:text,notnull,default:'unresolved'" json:"status"`
	RuleID       *uuid.UUID `bun:"rule_id,type:uuid" json:"rule_id,omitempty"`
	CreatedAt    time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
}

type GitRepositoryRunImage struct {
	bun.BaseModel `bun:"table:git_repository_run_images"`

	ID        uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	RunID     uuid.UUID  `bun:"run_id,type:uuid,notnull" json:"run_id"`
	FullRef   string     `bun:"full_ref,type:text,notnull" json:"full_ref"`
	ImageName string     `bun:"image_name,type:text,notnull" json:"image_name"`
	ImageTag  string     `bun:"image_tag,type:text,notnull" json:"image_tag"`
	Locations JSONObject `bun:"locations,type:jsonb,notnull,default:'{}'" json:"locations"`
	State     string     `bun:"state,type:text,notnull,default:'discovered'" json:"state"`
	ScanID    *uuid.UUID `bun:"scan_id,type:uuid" json:"scan_id,omitempty"`
	CreatedAt time.Time  `bun:"created_at,type:timestamptz,default:now()" json:"created_at"`
}
