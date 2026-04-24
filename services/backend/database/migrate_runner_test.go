package database

import "testing"

func TestCompareMigrationNames(t *testing.T) {
	names := []string{"0", "1", "10", "11", "19", "2", "20", "29", "3", "4", "54", "9"}

	sorted := append([]string(nil), names...)
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if compareMigrationNames(sorted[i], sorted[j]) > 0 {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}

	want := []string{"0", "1", "2", "3", "4", "9", "10", "11", "19", "20", "29", "54"}
	if len(sorted) != len(want) {
		t.Fatalf("sorted length = %d, want %d", len(sorted), len(want))
	}

	for i := range want {
		if sorted[i] != want[i] {
			t.Fatalf("sorted[%d] = %q, want %q", i, sorted[i], want[i])
		}
	}
}
