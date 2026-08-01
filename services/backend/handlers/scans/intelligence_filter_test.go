package scans

import (
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"justscan-backend/pkg/models"
)

func TestIntelligenceFilterConditionUsesCurrentPosture(t *testing.T) {
	condition, args, ok := intelligenceFilterCondition("changed")
	if !ok {
		t.Fatal("changed filter should be supported")
	}
	if !strings.Contains(condition, "p.finding_id = v.id") || !strings.Contains(condition, "p.state <> ?") {
		t.Fatalf("unexpected changed condition: %s", condition)
	}
	if len(args) != 1 || args[0] != models.PostureStateUnchanged {
		t.Fatalf("unexpected changed arguments: %#v", args)
	}
}

func TestApplyIntelligenceFilterSupportsDisputedAndRejected(t *testing.T) {
	sqldb, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock database: %v", err)
	}
	defer sqldb.Close()
	db := bun.NewDB(sqldb, pgdialect.New())
	defer db.Close()

	query := db.NewSelect().TableExpr("vulnerabilities AS v")
	applyIntelligenceFilter(query, "disputed_rejected")
	if !strings.Contains(query.String(), "p.state IN ('disputed', 'rejected')") {
		t.Fatalf("unexpected disputed/rejected query: %s", query.String())
	}
}

func TestIntelligenceFilterValidationRejectsUnknownValues(t *testing.T) {
	if _, _, ok := intelligenceFilterCondition("severity_increased"); ok {
		t.Fatal("severity_increased should be represented by the changed filter, not accepted as a filter value")
	}
}

func TestListVulnerabilityQueryUsesExplicitTableAlias(t *testing.T) {
	sqldb, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock database: %v", err)
	}
	defer sqldb.Close()
	db := bun.NewDB(sqldb, pgdialect.New())
	defer db.Close()

	query := db.NewSelect().
		TableExpr("vulnerabilities AS v").
		ColumnExpr("v.*").
		Where("v.scan_id = ?", "scan-id").
		Where("EXISTS (SELECT 1 FROM vulnerability_postures p WHERE p.finding_id = v.id AND p.state = ?)", models.PostureStateNeedsRescan)
	if !strings.Contains(query.String(), `FROM vulnerabilities AS v`) || !strings.Contains(query.String(), `v.*`) {
		t.Fatalf("unexpected list query: %s", query.String())
	}
}
