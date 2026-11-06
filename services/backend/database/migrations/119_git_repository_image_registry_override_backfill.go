package migrations

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/uptrace/bun"
)

// Migration 119 gives every existing per-image registry override its
// image-wide pattern, as saving an override now does. Overrides created before
// patterns existed only matched one exact tag, so bumping the tag in the
// repository silently dropped the manual registry choice.
func init() {
	Migrations.MustRegister(func(ctx context.Context, db *bun.DB) error {
		var overrides []struct {
			RepositoryID string `bun:"repository_id"`
			FullRef      string `bun:"full_ref"`
			RegistryID   string `bun:"registry_id"`
			CreatedByID  string `bun:"created_by_id"`
		}
		if err := db.NewRaw(`
			SELECT repository_id::text AS repository_id, full_ref,
			       registry_id::text AS registry_id, created_by_id::text AS created_by_id
			FROM git_repository_image_registry_overrides
			ORDER BY updated_at ASC
		`).Scan(ctx, &overrides); err != nil {
			return fmt.Errorf("migration 119 load image registry overrides: %w", err)
		}
		for _, override := range overrides {
			ref := strings.TrimSpace(override.FullRef)
			if index := strings.Index(ref, "@"); index >= 0 {
				ref = ref[:index]
			}
			if colon := strings.LastIndex(ref, ":"); colon > strings.LastIndex(ref, "/") {
				ref = ref[:colon]
			}
			if ref == "" {
				continue
			}
			pattern := "^" + regexp.QuoteMeta(ref) + "(?::[^/]+|@.+)?$"
			// Never replace a rule someone already saved for the same pattern.
			if _, err := db.NewRaw(`
				INSERT INTO git_repository_image_registry_override_rules
					(repository_id, pattern, registry_id, created_by_id)
				VALUES (?::uuid, ?, ?::uuid, ?::uuid)
				ON CONFLICT (repository_id, pattern) DO NOTHING
			`, override.RepositoryID, pattern, override.RegistryID, override.CreatedByID).Exec(ctx); err != nil {
				return fmt.Errorf("migration 119 backfill image registry rule: %w", err)
			}
		}
		return nil
	}, func(ctx context.Context, db *bun.DB) error {
		// The rules are indistinguishable from ones people saved, so a rollback
		// leaves them in place.
		return nil
	})
}
