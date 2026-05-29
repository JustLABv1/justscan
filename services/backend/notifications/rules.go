package notifications

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"

	"justscan-backend/pkg/models"

	log "github.com/sirupsen/logrus"
)

type conditionNode struct {
	Op         string          `json:"op,omitempty"`
	Field      string          `json:"field,omitempty"`
	Operator   string          `json:"operator,omitempty"`
	Value      json.RawMessage `json:"value,omitempty"`
	Conditions []conditionNode `json:"conditions,omitempty"`
}

func ruleMatches(rule models.NotificationRule, payload Payload) bool {
	if !rule.Enabled {
		return false
	}
	if len(rule.EventTypes) > 0 {
		match := false
		for _, eventType := range rule.EventTypes {
			if strings.EqualFold(strings.TrimSpace(eventType), payload.Event) {
				match = true
				break
			}
		}
		if !match {
			return false
		}
	}
	if len(rule.Conditions) == 0 {
		return true
	}

	var root conditionNode
	if err := decodeConditions(rule.Conditions, &root); err != nil {
		logRuleDecodeError(rule, err)
		return false
	}
	if root.Op == "" && root.Field == "" && len(root.Conditions) == 0 {
		return true
	}
	return evaluateNode(root, payload)
}

func decodeConditions(raw models.JSONObject, out *conditionNode) error {
	bytes, err := json.Marshal(raw)
	if err != nil {
		return err
	}
	return json.Unmarshal(bytes, out)
}

func logRuleDecodeError(rule models.NotificationRule, err error) {
	log.Warnf("notifications: failed to decode rule %s conditions: %v", rule.ID, err)
}

func evaluateNode(node conditionNode, payload Payload) bool {
	switch strings.ToLower(strings.TrimSpace(node.Op)) {
	case "all":
		for _, child := range node.Conditions {
			if !evaluateNode(child, payload) {
				return false
			}
		}
		return true
	case "any":
		if len(node.Conditions) == 0 {
			return true
		}
		for _, child := range node.Conditions {
			if evaluateNode(child, payload) {
				return true
			}
		}
		return false
	case "not":
		if len(node.Conditions) == 0 {
			return true
		}
		return !evaluateNode(node.Conditions[0], payload)
	default:
		return evaluatePredicate(node, payload)
	}
}

func evaluatePredicate(node conditionNode, payload Payload) bool {
	field := strings.TrimSpace(strings.ToLower(node.Field))
	operator := strings.TrimSpace(strings.ToLower(node.Operator))

	switch field {
	case "event_type":
		return compareString(payload.Event, operator, node.Value)
	case "org_id":
		return compareStringList(payload.OrgIDs, operator, node.Value)
	case "image_name":
		return compareString(payload.ImageName, operator, node.Value)
	case "image_ref":
		return compareImageRef(strings.TrimSuffix(payload.ImageName+":"+payload.ImageTag, ":"), operator, node.Value)
	case "scan_provider":
		return compareString(payload.ScanProvider, operator, node.Value)
	case "scan_status":
		return compareString(payload.Status, operator, node.Value)
	case "highest_severity":
		return compareSeverity(payload.HighestSeverity, operator, node.Value)
	case "highest_cvss":
		return compareFloat(payload.HighestCVSS, operator, node.Value)
	case "critical_count":
		return compareInt(payload.CriticalCount, operator, node.Value)
	case "high_count":
		return compareInt(payload.HighCount, operator, node.Value)
	case "medium_count":
		return compareInt(payload.MediumCount, operator, node.Value)
	case "low_count":
		return compareInt(payload.LowCount, operator, node.Value)
	case "unknown_count":
		return compareInt(payload.UnknownCount, operator, node.Value)
	case "suppressed_count":
		return compareInt(payload.SuppressedCount, operator, node.Value)
	case "compliance_failed":
		return compareBool(payload.ComplianceFailed, operator, node.Value)
	case "compliance_status":
		return compareString(payload.ComplianceStatus, operator, node.Value)
	case "policy_id":
		return compareStringList(payload.PolicyIDs, operator, node.Value)
	case "policy_name":
		return compareStringList(payload.PolicyNames, operator, node.Value)
	case "xray_blocked":
		return compareBool(payload.XrayBlocked, operator, node.Value)
	case "xray_policy_name":
		return compareStringList(payload.XrayPolicyNames, operator, node.Value)
	case "xray_watch_name":
		return compareStringList(payload.XrayWatchNames, operator, node.Value)
	case "tag":
		return compareStringList(payload.Tags, operator, node.Value)
	default:
		return false
	}
}

func compareString(actual string, operator string, raw json.RawMessage) bool {
	value := decodeString(raw)
	switch operator {
	case "eq", "=":
		return strings.EqualFold(strings.TrimSpace(actual), value)
	case "neq", "!=":
		return !strings.EqualFold(strings.TrimSpace(actual), value)
	case "contains":
		return strings.Contains(strings.ToLower(actual), strings.ToLower(value))
	case "matches":
		return wildcardPatternMatch(value, actual)
	case "in":
		return compareStringList([]string{actual}, operator, raw)
	default:
		return false
	}
}

func compareStringList(actual []string, operator string, raw json.RawMessage) bool {
	values := decodeStringList(raw)
	switch operator {
	case "contains", "eq":
		for _, value := range values {
			for _, actualValue := range actual {
				if strings.EqualFold(strings.TrimSpace(actualValue), strings.TrimSpace(value)) {
					return true
				}
			}
		}
		return false
	case "not_contains", "neq":
		return !compareStringList(actual, "contains", raw)
	case "in":
		return compareStringList(actual, "contains", raw)
	case "matches_any":
		for _, pattern := range values {
			for _, actualValue := range actual {
				if wildcardPatternMatch(pattern, actualValue) {
					return true
				}
			}
		}
		return false
	default:
		return false
	}
}

func compareImageRef(actual string, operator string, raw json.RawMessage) bool {
	switch operator {
	case "matches", "contains", "eq":
		return compareString(actual, operator, raw)
	case "matches_any":
		return compareStringList([]string{actual}, operator, raw)
	default:
		return false
	}
}

func compareSeverity(actual string, operator string, raw json.RawMessage) bool {
	value := strings.ToUpper(decodeString(raw))
	switch operator {
	case "eq":
		return strings.EqualFold(actual, value)
	case "gte", "gte_severity":
		return severityRank(actual) >= severityRank(value)
	case "lte", "lte_severity":
		return severityRank(actual) <= severityRank(value)
	default:
		return false
	}
}

func compareFloat(actual float64, operator string, raw json.RawMessage) bool {
	value := decodeFloat(raw)
	switch operator {
	case "eq":
		return actual == value
	case "gt":
		return actual > value
	case "gte":
		return actual >= value
	case "lt":
		return actual < value
	case "lte":
		return actual <= value
	default:
		return false
	}
}

func compareInt(actual int, operator string, raw json.RawMessage) bool {
	value := int(decodeFloat(raw))
	switch operator {
	case "eq":
		return actual == value
	case "gt":
		return actual > value
	case "gte":
		return actual >= value
	case "lt":
		return actual < value
	case "lte":
		return actual <= value
	default:
		return false
	}
}

func compareBool(actual bool, operator string, raw json.RawMessage) bool {
	var expected bool
	if err := json.Unmarshal(raw, &expected); err != nil {
		expected = strings.EqualFold(decodeString(raw), "true")
	}
	switch operator {
	case "eq", "=":
		return actual == expected
	case "neq", "!=":
		return actual != expected
	default:
		return false
	}
}

func decodeString(raw json.RawMessage) string {
	var value string
	if err := json.Unmarshal(raw, &value); err == nil {
		return strings.TrimSpace(value)
	}
	var anyValue any
	if err := json.Unmarshal(raw, &anyValue); err == nil && anyValue != nil {
		return strings.TrimSpace(fmt.Sprint(anyValue))
	}
	return ""
}

func decodeStringList(raw json.RawMessage) []string {
	var values []string
	if err := json.Unmarshal(raw, &values); err == nil {
		return values
	}
	single := decodeString(raw)
	if single == "" {
		return nil
	}
	return []string{single}
}

func decodeFloat(raw json.RawMessage) float64 {
	var value float64
	if err := json.Unmarshal(raw, &value); err == nil {
		return value
	}
	parsed, _ := strconv.ParseFloat(decodeString(raw), 64)
	return parsed
}

func wildcardPatternMatch(pattern string, target string) bool {
	pattern = strings.TrimSpace(strings.ToLower(pattern))
	target = strings.TrimSpace(strings.ToLower(target))
	if pattern == "" {
		return false
	}
	matched, err := filepath.Match(pattern, target)
	if err == nil {
		return matched
	}
	return strings.EqualFold(pattern, target)
}
