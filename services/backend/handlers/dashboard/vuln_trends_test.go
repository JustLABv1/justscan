package dashboard

import (
	"testing"
	"time"

	"justscan-backend/pkg/models"
)

func TestAggregateVulnTrendRowsBucketsByCompletedAt(t *testing.T) {
	yesterday := time.Date(2026, time.April, 8, 23, 45, 0, 0, time.UTC)
	today := time.Date(2026, time.April, 9, 8, 15, 0, 0, time.UTC)

	rows := aggregateVulnTrendRows([]vulnTrendSample{
		{
			Status:      models.ScanStatusCompleted,
			CompletedAt: &yesterday,
			Critical:    2,
			High:        4,
		},
		{
			Status:      models.ScanStatusCompleted,
			CompletedAt: &today,
			Critical:    6,
			High:        2,
		},
	})

	if len(rows) != 2 {
		t.Fatalf("expected 2 trend rows, got %d", len(rows))
	}
	if rows[1].Date != "2026-04-09" {
		t.Fatalf("expected second row to bucket into completion date, got %s", rows[1].Date)
	}
	if rows[1].Critical != 6 || rows[1].High != 2 {
		t.Fatalf("expected today's row to keep today's counts, got critical=%d high=%d", rows[1].Critical, rows[1].High)
	}
}

func TestAggregateVulnTrendRowsIgnoresIncompleteSamples(t *testing.T) {
	today := time.Date(2026, time.April, 9, 8, 15, 0, 0, time.UTC)

	rows := aggregateVulnTrendRows([]vulnTrendSample{
		{
			Status:      models.ScanStatusCompleted,
			CompletedAt: &today,
			Critical:    5,
			High:        1,
		},
		{
			Status:   models.ScanStatusRunning,
			Critical: 99,
			High:     99,
		},
	})

	if len(rows) != 1 {
		t.Fatalf("expected only completed samples to be aggregated, got %d rows", len(rows))
	}
	if rows[0].Critical != 5 || rows[0].High != 1 {
		t.Fatalf("expected incomplete samples to be ignored, got critical=%d high=%d", rows[0].Critical, rows[0].High)
	}
}
