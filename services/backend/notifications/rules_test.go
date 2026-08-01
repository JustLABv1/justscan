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

func TestNotificationScopeMatchesTargetedUsersAndOrganizations(t *testing.T) {
	userRule := models.NotificationRule{ScopeType: models.NotificationScopeUser, ScopeRef: "user-1"}
	if !notificationScopeMatches(userRule, Payload{UserIDs: []string{"user-1"}}) {
		t.Fatal("expected targeted user rule to match")
	}
	if notificationScopeMatches(userRule, Payload{UserIDs: []string{"user-2"}}) {
		t.Fatal("expected unrelated user rule not to match")
	}

	orgRule := models.NotificationRule{ScopeType: models.NotificationScopeOrg, ScopeRef: "org-1"}
	if !notificationScopeMatches(orgRule, Payload{OrgIDs: []string{"org-1"}}) {
		t.Fatal("expected affected organization rule to match")
	}
	if notificationScopeMatches(orgRule, Payload{OrgIDs: []string{"org-2"}}) {
		t.Fatal("expected unrelated organization rule not to match")
	}
}

func TestRuleMatchesIntelligenceImpactConditions(t *testing.T) {
	rule := models.NotificationRule{
		Enabled:    true,
		EventTypes: models.StringList{models.NotificationEventIntelligencePolicyImpact},
		Conditions: models.JSONObject{
			"op": "all",
			"conditions": []models.JSONObject{
				{"field": "user_id", "operator": "contains", "value": "user-1"},
				{"field": "intelligence_impact", "operator": "eq", "value": "resolved"},
				{"field": "historical_compliance_status", "operator": "eq", "value": "fail"},
				{"field": "current_compliance_status", "operator": "eq", "value": "pass"},
			},
		},
	}

	payload := Payload{
		Event:                      models.NotificationEventIntelligencePolicyImpact,
		UserIDs:                    []string{"user-1"},
		IntelligenceImpact:         "resolved",
		HistoricalComplianceStatus: "fail",
		CurrentComplianceStatus:    "pass",
	}
	if !ruleMatches(rule, payload) {
		t.Fatal("expected intelligence impact rule to match")
	}

	payload.IntelligenceImpact = "still_failed"
	if ruleMatches(rule, payload) {
		t.Fatal("expected different intelligence impact not to match")
	}
}

func TestRuleMatchesGuidedEnumBooleanAndNumericConditions(t *testing.T) {
	rule := models.NotificationRule{
		Enabled: true,
		Conditions: models.JSONObject{
			"op": "all",
			"conditions": []models.JSONObject{
				{"field": "scan_status", "operator": "eq", "value": "completed"},
				{"field": "xray_blocked", "operator": "eq", "value": true},
				{"field": "critical_count", "operator": "gte", "value": 2},
			},
		},
	}

	payload := Payload{Status: "completed", XrayBlocked: true, CriticalCount: 3}
	if !ruleMatches(rule, payload) {
		t.Fatal("expected enum, boolean, and numeric conditions to match")
	}

	payload.XrayBlocked = false
	if ruleMatches(rule, payload) {
		t.Fatal("expected boolean condition to reject a non-matching payload")
	}
}

func TestRuleMatchesMultiValueConditions(t *testing.T) {
	rule := models.NotificationRule{
		Enabled: true,
		Conditions: models.JSONObject{
			"op": "all",
			"conditions": []models.JSONObject{
				{"field": "event_type", "operator": "in", "value": []string{"scan_complete", "scan_failed"}},
				{"field": "tag", "operator": "in", "value": []string{"production", "release"}},
			},
		},
	}

	payload := Payload{
		Event: models.NotificationEventScanFailed,
		Tags:  []string{"production"},
	}
	if !ruleMatches(rule, payload) {
		t.Fatal("expected multi-value conditions to match")
	}

	payload.Tags = []string{"development"}
	if ruleMatches(rule, payload) {
		t.Fatal("expected multi-value condition to reject a missing value")
	}
}
