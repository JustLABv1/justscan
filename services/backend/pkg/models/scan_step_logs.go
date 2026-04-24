package models

import (
	"time"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

type ScanStepLog struct {
	bun.BaseModel `bun:"table:scan_step_logs"`

	ID          uuid.UUID  `bun:",pk,type:uuid,default:gen_random_uuid()" json:"id"`
	ScanID      uuid.UUID  `bun:"scan_id,type:uuid,notnull" json:"scan_id"`
	Step        string     `bun:"step,type:text,notnull" json:"step"`
	Position    int        `bun:"position,type:int,notnull,default:0" json:"position"`
	StartedAt   time.Time  `bun:"started_at,type:timestamptz,notnull,default:now()" json:"started_at"`
	CompletedAt *time.Time `bun:"completed_at,type:timestamptz" json:"completed_at,omitempty"`
	Output      []string   `bun:"output,type:jsonb" json:"output"`
	OutputCount int        `bun:"output_count,scanonly" json:"output_count,omitempty"`
}
