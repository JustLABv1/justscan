package app

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNormalizeAPIURL(t *testing.T) {
	got, err := normalizeAPIURL("https://scan.example.test/justscan/", false)
	if err != nil {
		t.Fatal(err)
	}
	if got != "https://scan.example.test/justscan/api/v1" {
		t.Fatalf("URL = %q", got)
	}
	if _, err := normalizeAPIURL("http://scan.example.test", false); err == nil {
		t.Fatal("expected non-loopback HTTP to be rejected")
	}
}

func TestClientUploadsArchive(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/orgs/c7a11e8d-82a2-43fc-a978-a0319b1c7130/archive-scans" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		if err := r.ParseMultipartForm(1024 * 1024); err != nil {
			t.Fatal(err)
		}
		if got := r.FormValue("image_name"); got != "local-app" {
			t.Fatalf("image_name = %q", got)
		}
		file, _, err := r.FormFile("archive")
		if err != nil {
			t.Fatal(err)
		}
		defer file.Close()
		body, err := io.ReadAll(file)
		if err != nil {
			t.Fatal(err)
		}
		if string(body) != "archive bytes" {
			t.Fatalf("archive = %q", body)
		}
		_, _ = w.Write([]byte(`{"id":"c7a11e8d-82a2-43fc-a978-a0319b1c7130","status":"pending","current_step":"queued"}`))
	}))
	defer server.Close()
	client, err := newClient(server.URL, "token", "", false, true)
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.UploadArchive(context.Background(), "c7a11e8d-82a2-43fc-a978-a0319b1c7130", strings.NewReader("archive bytes"), "local-app.tar", 13, "local-app", "local", "")
	if err != nil {
		t.Fatal(err)
	}
	if result.ID != "c7a11e8d-82a2-43fc-a978-a0319b1c7130" {
		t.Fatalf("result = %#v", result)
	}
}

func TestClientCreatesAndReadsPipelineScan(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer token" {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		switch r.URL.Path {
		case "/api/v1/orgs/c7a11e8d-82a2-43fc-a978-a0319b1c7130/pipeline-scans":
			if r.Method != http.MethodPost {
				t.Fatalf("method = %s", r.Method)
			}
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"scan_id":"c7a11e8d-82a2-43fc-a978-a0319b1c7130","status":"accepted","scan_status":"pending"}`))
		case "/api/v1/orgs/c7a11e8d-82a2-43fc-a978-a0319b1c7130/pipeline-scans/c7a11e8d-82a2-43fc-a978-a0319b1c7130":
			_, _ = w.Write([]byte(`{"scan_id":"c7a11e8d-82a2-43fc-a978-a0319b1c7130","verdict":"pass","status":"completed","current_step":"completed"}`))
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()
	client, err := newClient(server.URL, "token", "", false, true)
	if err != nil {
		t.Fatal(err)
	}
	orgID := "c7a11e8d-82a2-43fc-a978-a0319b1c7130"
	accepted, err := client.CreateScan(orgID, ScanRequest{Image: "example/app:latest"})
	if err != nil || accepted.ScanID != orgID {
		t.Fatalf("CreateScan() = %#v, %v", accepted, err)
	}
	result, err := client.GetScan(orgID, accepted.ScanID)
	if err != nil || result.Verdict != "pass" {
		t.Fatalf("GetScan() = %#v, %v", result, err)
	}
}

func TestClientParsesAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":"org token required"}`))
	}))
	defer server.Close()
	client, err := newClient(server.URL, "token", "", false, true)
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.GetScan("c7a11e8d-82a2-43fc-a978-a0319b1c7130", "c7a11e8d-82a2-43fc-a978-a0319b1c7130")
	if err == nil || !strings.Contains(err.Error(), "org token required") {
		t.Fatalf("error = %v", err)
	}
}
