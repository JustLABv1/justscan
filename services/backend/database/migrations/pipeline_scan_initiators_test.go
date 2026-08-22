package migrations

import "testing"

func TestPipelineScanInitiatorMigrationIsRegistered(t *testing.T) {
	for _, migration := range Migrations.Sorted() {
		if migration.Name == "78" {
			return
		}
	}
	t.Fatal("migration 78 is not registered")
}

func TestMigrationNamesAreUnique(t *testing.T) {
	seen := make(map[string]string)
	for _, migration := range Migrations.Sorted() {
		if previous, ok := seen[migration.Name]; ok {
			t.Fatalf("migration name %q is registered by both %s and %s", migration.Name, previous, migration)
		}
		seen[migration.Name] = migration.String()
	}
}
