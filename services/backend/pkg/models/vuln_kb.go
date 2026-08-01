package models

import (
	"time"

	"github.com/uptrace/bun"
)

type VulnKBEntry struct {
	bun.BaseModel `bun:"table:vuln_kb"`

	VulnID            string        `bun:"vuln_id,type:text,pk" json:"vuln_id"`
	Description       string        `bun:"description,type:text,default:''" json:"description"`
	Severity          string        `bun:"severity,type:text,default:''" json:"severity"`
	CVSSVector        string        `bun:"cvss_vector,type:text,default:''" json:"cvss_vector"`
	CVSSScore         float64       `bun:"cvss_score,type:float,default:0" json:"cvss_score"`
	PublishedDate     *time.Time    `bun:"published_date,type:timestamptz" json:"published_date"`
	ModifiedDate      *time.Time    `bun:"modified_date,type:timestamptz" json:"modified_date"`
	References        []KBRef       `bun:"references,type:jsonb" json:"references"`
	ExploitAvailable  bool          `bun:"exploit_available,type:bool,default:false" json:"exploit_available"`
	FetchedAt         time.Time     `bun:"fetched_at,type:timestamptz,default:now()" json:"fetched_at"`
	HistoryEventCount int           `bun:"-" json:"history_event_count,omitempty"`
	LastChangeAt      *time.Time    `bun:"-" json:"last_change_at,omitempty"`
	LastChange        *KBLastChange `bun:"-" json:"last_change,omitempty"`
}

type KBRef struct {
	URL    string `json:"url"`
	Source string `json:"source"`
}

type KBLastChange struct {
	EventName        string    `json:"event_name"`
	Source           string    `json:"source"`
	SourceIdentifier string    `json:"source_identifier"`
	ObservedAt       time.Time `json:"observed_at"`
}
