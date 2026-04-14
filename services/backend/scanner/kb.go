package scanner

import (
	"context"
	"strings"
	"time"

	"justscan-backend/pkg/models"

	"github.com/uptrace/bun"
)

func upsertKBEntries(ctx context.Context, db *bun.DB, entries []models.VulnKBEntry) error {
	if len(entries) == 0 {
		return nil
	}

	mergedEntries, err := prepareKBEntriesForUpsert(ctx, db, entries, time.Now())
	if err != nil {
		return err
	}

	_, err = db.NewInsert().Model(&mergedEntries).
		On("CONFLICT (vuln_id) DO UPDATE").
		Set("description = EXCLUDED.description").
		Set("severity = EXCLUDED.severity").
		Set("cvss_score = EXCLUDED.cvss_score").
		Set("cvss_vector = EXCLUDED.cvss_vector").
		Set("published_date = EXCLUDED.published_date").
		Set("modified_date = EXCLUDED.modified_date").
		Set(`"references" = EXCLUDED."references"`).
		Set("exploit_available = EXCLUDED.exploit_available").
		Set("fetched_at = EXCLUDED.fetched_at").
		Exec(ctx)
	return err
}

func prepareKBEntriesForUpsert(ctx context.Context, db *bun.DB, entries []models.VulnKBEntry, fetchedAt time.Time) ([]models.VulnKBEntry, error) {
	mergedIncoming := mergeKBEntriesForUpsert(entries)
	if len(mergedIncoming) == 0 {
		return nil, nil
	}

	vulnIDs := make([]string, 0, len(mergedIncoming))
	for _, entry := range mergedIncoming {
		if strings.TrimSpace(entry.VulnID) == "" {
			continue
		}
		vulnIDs = append(vulnIDs, entry.VulnID)
	}
	if len(vulnIDs) == 0 {
		return nil, nil
	}

	var existing []models.VulnKBEntry
	if err := db.NewSelect().Model(&existing).Where("vuln_id IN (?)", bun.In(vulnIDs)).Scan(ctx); err != nil {
		return nil, err
	}

	existingByID := make(map[string]models.VulnKBEntry, len(existing))
	for _, entry := range existing {
		existingByID[entry.VulnID] = entry
	}

	prepared := make([]models.VulnKBEntry, 0, len(mergedIncoming))
	for _, entry := range mergedIncoming {
		if existingEntry, ok := existingByID[entry.VulnID]; ok {
			entry = mergeKBEntry(existingEntry, entry)
		}
		entry.FetchedAt = fetchedAt
		prepared = append(prepared, entry)
	}

	return prepared, nil
}

func mergeKBEntriesForUpsert(entries []models.VulnKBEntry) []models.VulnKBEntry {
	merged := make([]models.VulnKBEntry, 0, len(entries))
	byID := make(map[string]int, len(entries))

	for _, entry := range entries {
		vulnID := strings.TrimSpace(entry.VulnID)
		if vulnID == "" {
			continue
		}
		entry.VulnID = vulnID
		if idx, ok := byID[vulnID]; ok {
			merged[idx] = mergeKBEntry(merged[idx], entry)
			continue
		}
		byID[vulnID] = len(merged)
		merged = append(merged, entry)
	}

	return merged
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
