package database

import (
	"context"
	"fmt"
	"sort"
	"strconv"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/migrate"

	log "github.com/sirupsen/logrus"
)

func migrateInNumericOrder(ctx context.Context, migrator *migrate.Migrator) (*migrate.MigrationGroup, error) {
	group := new(migrate.MigrationGroup)

	if err := resetBrokenFreshInstallMigrations(ctx, migrator); err != nil {
		return group, err
	}

	migrationsWithStatus, err := migrator.MigrationsWithStatus(ctx)
	if err != nil {
		return group, err
	}

	pending := migrationsWithStatus.Unapplied()
	if len(pending) == 0 {
		return group, nil
	}

	sort.Slice(pending, func(i, j int) bool {
		return compareMigrationNames(pending[i].Name, pending[j].Name) < 0
	})

	group.ID = migrationsWithStatus.LastGroupID() + 1

	for i := range pending {
		migration := &pending[i]
		migration.GroupID = group.ID

		if migration.Up == nil {
			return group, fmt.Errorf("migrate: migration %s does not have up migration", migration.Name)
		}

		if err := migration.Up(ctx, migrator, migration); err != nil {
			return group, fmt.Errorf("%s: up: %w", migration.Name, err)
		}

		if err := migrator.MarkApplied(ctx, migration); err != nil {
			return group, err
		}

		group.Migrations = pending[:i+1]
	}

	return group, nil
}

func compareMigrationNames(left, right string) int {
	leftNum, leftErr := strconv.ParseInt(left, 10, 64)
	rightNum, rightErr := strconv.ParseInt(right, 10, 64)

	switch {
	case leftErr == nil && rightErr == nil:
		switch {
		case leftNum < rightNum:
			return -1
		case leftNum > rightNum:
			return 1
		default:
			return 0
		}
	case leftErr == nil:
		return -1
	case rightErr == nil:
		return 1
	default:
		switch {
		case left < right:
			return -1
		case left > right:
			return 1
		default:
			return 0
		}
	}
}

func resetBrokenFreshInstallMigrations(ctx context.Context, migrator *migrate.Migrator) error {
	applied, err := migrator.AppliedMigrations(ctx)
	if err != nil {
		return err
	}
	if len(applied) == 0 {
		return nil
	}

	hasOutOfOrderRegistryMigration := false
	for _, migration := range applied {
		migrationNum, parseErr := strconv.ParseInt(migration.Name, 10, 64)
		if parseErr == nil && migrationNum >= 29 {
			hasOutOfOrderRegistryMigration = true
			break
		}
	}
	if !hasOutOfOrderRegistryMigration {
		return nil
	}

	registriesExists, err := tableExists(ctx, migrator.DB(), "registries")
	if err != nil {
		return err
	}
	if registriesExists {
		return nil
	}

	log.Warn("Detected an inconsistent fresh-install migration state: later migrations were recorded before the registries table existed. Clearing bun_migrations and replaying migrations in numeric order.")
	return migrator.TruncateTable(ctx)
}

func tableExists(ctx context.Context, db *bun.DB, table string) (bool, error) {
	return db.NewSelect().
		Table("information_schema.tables").
		Where("table_name = ?", table).
		Exists(ctx)
}
