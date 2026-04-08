package scanner

import (
	"context"
	"strings"

	"justscan-backend/pkg/models"

	"github.com/uptrace/bun"
)

func upsertKBEntries(ctx context.Context, db *bun.DB, entries []models.VulnKBEntry) error {
	if len(entries) == 0 {
		return nil
	}

	_, err := db.NewInsert().Model(&entries).
		On("CONFLICT (vuln_id) DO UPDATE").
		Set("description = CASE WHEN EXCLUDED.description != '' THEN EXCLUDED.description ELSE vuln_kb.description END").
		Set("severity = CASE WHEN EXCLUDED.severity != '' THEN EXCLUDED.severity ELSE vuln_kb.severity END").
		Set("cvss_score = CASE WHEN EXCLUDED.cvss_score > vuln_kb.cvss_score THEN EXCLUDED.cvss_score ELSE vuln_kb.cvss_score END").
		Set("cvss_vector = CASE WHEN EXCLUDED.cvss_score > vuln_kb.cvss_score THEN EXCLUDED.cvss_vector ELSE vuln_kb.cvss_vector END").
		Set(`"references" = COALESCE(NULLIF(EXCLUDED."references", '[]'::jsonb), vuln_kb."references")`).
		Set("exploit_available = EXCLUDED.exploit_available OR vuln_kb.exploit_available").
		Set("fetched_at = now()").
		Exec(ctx)
	return err
}

func mergeKBRefs(existing, incoming []models.KBRef) []models.KBRef {
	if len(existing) == 0 {
		return append([]models.KBRef(nil), incoming...)
	}
	if len(incoming) == 0 {
		return append([]models.KBRef(nil), existing...)
	}

	merged := make([]models.KBRef, 0, len(existing)+len(incoming))
	seen := make(map[string]bool, len(existing)+len(incoming))
	appendRef := func(ref models.KBRef) {
		ref.URL = strings.TrimSpace(ref.URL)
		ref.Source = strings.TrimSpace(ref.Source)
		if ref.URL == "" {
			return
		}
		key := ref.URL + "|" + ref.Source
		if seen[key] {
			return
		}
		seen[key] = true
		merged = append(merged, ref)
	}

	for _, ref := range existing {
		appendRef(ref)
	}
	for _, ref := range incoming {
		appendRef(ref)
	}

	return merged
}

func kbRefsContainExploit(refs []models.KBRef) bool {
	for _, ref := range refs {
		url := strings.ToLower(strings.TrimSpace(ref.URL))
		if strings.Contains(url, "exploit-db.com") ||
			strings.Contains(url, "packetstormsecurity") ||
			strings.Contains(url, "github.com/exploit") ||
			strings.Contains(url, "exploit") {
			return true
		}
	}
	return false
}