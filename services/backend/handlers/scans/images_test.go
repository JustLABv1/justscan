package scans

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestScanOwnershipWhereUsesProvidedAlias(t *testing.T) {
	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	orgID := uuid.MustParse("22222222-2222-2222-2222-222222222222")

	where, args := scanOwnershipWhere(userID, false, []uuid.UUID{orgID}, "s")

	if !strings.Contains(where, "os.scan_id = s.id") {
		t.Fatalf("expected ownership clause to use alias s.id, got %q", where)
	}
	if len(args) != 4 {
		t.Fatalf("expected 4 args, got %d", len(args))
	}
}

func TestScanScopeWhereUsesProvidedAlias(t *testing.T) {
	gin.SetMode(gin.TestMode)

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	req := httptest.NewRequest("GET", "/api/v1/scans/images?scope=33333333-3333-3333-3333-333333333333", nil)
	ctx.Request = req

	userID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	where, args := scanScopeWhere(ctx, userID, "s")

	if !strings.Contains(where, "os2.scan_id = s.id") {
		t.Fatalf("expected scope clause to use alias s.id, got %q", where)
	}
	if len(args) != 2 {
		t.Fatalf("expected 2 args, got %d", len(args))
	}
}
