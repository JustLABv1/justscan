package scans

import (
	"strings"
	"testing"
)

func TestArtifactCollectionWhere(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
		args int
	}{
		{name: "no filter", raw: "", want: "1=1", args: 0},
		{name: "unassigned", raw: "__none__", want: "NOT EXISTS", args: 0},
		{name: "collection", raw: " 11111111-1111-1111-1111-111111111111 ", want: "EXISTS", args: 1},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			where, args := artifactCollectionWhere(test.raw)
			if len(args) != test.args {
				t.Fatalf("expected %d args, got %d", test.args, len(args))
			}
			if test.want != "" && !strings.Contains(where, test.want) {
				t.Fatalf("expected where clause %q to contain %q", where, test.want)
			}
		})
	}
}

func TestArtifactCollectionWhereUsesLatestScan(t *testing.T) {
	where, _ := artifactCollectionWhere("__none__")
	if !strings.Contains(where, "l.latest_scan_id") {
		t.Fatalf("expected collection filter to apply to latest scan, got %q", where)
	}
}
