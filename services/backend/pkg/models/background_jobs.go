package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

const (
	BackgroundJobStatusQueued    = "queued"
	BackgroundJobStatusRunning   = "running"
	BackgroundJobStatusSucceeded = "succeeded"
	BackgroundJobStatusFailed    = "failed"

	BackgroundJobScopeUser = "user"
	BackgroundJobScopeOrg  = "org"

	BackgroundJobTypeScanGroupDeletion = "scan_group_deletion"
)

// BackgroundJob is the durable, user-visible record for work performed by a
// background worker. Payload and worker lease fields are intentionally not
// serialized: payload may contain implementation details while lease fields
// are operational state rather than API data.
type BackgroundJob struct {
	bun.BaseModel `bun:"table:background_jobs"`

	ID          uuid.UUID `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	UserID      uuid.UUID `bun:"user_id,type:uuid,notnull" json:"user_id"`
	ScopeType   string    `bun:"scope_type,type:text,notnull,default:'user'" json:"scope_type"`
	ScopeRef    string    `bun:"scope_ref,type:text,notnull,default:''" json:"scope_ref"`
	Type        string    `bun:"type,type:text,notnull" json:"type"`
	Status      string    `bun:"status,type:text,notnull,default:'queued'" json:"status"`
	Title       string    `bun:"title,type:text,notnull,default:''" json:"title"`
	Description string    `bun:"description,type:text,notnull,default:''" json:"description"`

	ProgressCurrent int        `bun:"progress_current,type:int,notnull,default:0" json:"progress_current"`
	ProgressTotal   int        `bun:"progress_total,type:int,notnull,default:0" json:"progress_total"`
	Phase           string     `bun:"phase,type:text,notnull,default:''" json:"phase"`
	Error           string     `bun:"error_message,type:text,notnull,default:''" json:"error,omitempty"`
	Metadata        JSONObject `bun:"metadata,type:jsonb,notnull,default:'{}'" json:"metadata"`

	CreatedAt  time.Time  `bun:"created_at,type:timestamptz,notnull,default:now()" json:"created_at"`
	QueuedAt   time.Time  `bun:"queued_at,type:timestamptz,notnull,default:now()" json:"queued_at"`
	StartedAt  *time.Time `bun:"started_at,type:timestamptz" json:"started_at,omitempty"`
	FinishedAt *time.Time `bun:"finished_at,type:timestamptz" json:"finished_at,omitempty"`
	UpdatedAt  time.Time  `bun:"updated_at,type:timestamptz,notnull,default:now()" json:"updated_at"`

	// Payload is durable execution state. It is updated as resumable work
	// completes (for example, by removing scan IDs from the remaining set).
	Payload JSONObject `bun:"payload,type:jsonb,notnull,default:'{}'" json:"-"`

	LeaseOwner string     `bun:"lease_owner,type:text,notnull,default:''" json:"-"`
	LeaseUntil *time.Time `bun:"lease_until,type:timestamptz" json:"-"`
	ErrorLog   string     `bun:"error_log,type:text,notnull,default:''" json:"-"`
	DedupeKey  string     `bun:"dedupe_key,type:text,notnull,default:''" json:"-"`
}
