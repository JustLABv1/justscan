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
