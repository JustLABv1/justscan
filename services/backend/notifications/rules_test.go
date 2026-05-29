package notifications

import (
	"testing"

	"justscan-backend/pkg/models"
)

func TestRuleMatchesAllConditions(t *testing.T) {
	rule := models.NotificationRule{
		Enabled:    true,
		EventTypes: models.StringList{models.NotificationEventScanComplete},
		Conditions: models.JSONObject{
			"op": "all",
			"conditions": []models.JSONObject{
				{"field": "highest_cvss", "operator": "gte", "value": 7},
				{"field": "scan_provider", "operator": "eq", "value": "trivy"},
			},
		},
	}

	payload := Payload{
		Event:        models.NotificationEventScanComplete,
		HighestCVSS:  9.1,
		ScanProvider: "trivy",
	}

	if !ruleMatches(rule, payload) {
		t.Fatalf("expected rule to match payload")
	}
}

func TestRuleMatchesAnyConditionListPredicates(t *testing.T) {
	rule := models.NotificationRule{
		Enabled:    true,
		EventTypes: models.StringList{models.NotificationEventComplianceFailed},
		Conditions: models.JSONObject{
			"op": "any",
			"conditions": []models.JSONObject{
				{"field": "policy_name", "operator": "contains", "value": []string{"critical-policy"}},
				{"field": "xray_watch_name", "operator": "matches_any", "value": []string{"prod-*"}},
			},
		},
	}

	payload := Payload{
		Event:          models.NotificationEventComplianceFailed,
		PolicyNames:    []string{"baseline"},
		XrayWatchNames: []string{"prod-cluster"},
	}

	if !ruleMatches(rule, payload) {
		t.Fatalf("expected any-condition rule to match list predicate")
	}
}

func TestRuleDoesNotMatchWrongEvent(t *testing.T) {
	rule := models.NotificationRule{
		Enabled:    true,
		EventTypes: models.StringList{models.NotificationEventScanFailed},
	}

	payload := Payload{Event: models.NotificationEventScanComplete}
	if ruleMatches(rule, payload) {
		t.Fatalf("expected rule not to match mismatched event type")
	}
}
