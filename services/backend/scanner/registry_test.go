package scanner

import (
	"testing"

	"justscan-backend/pkg/models"
)

func TestNormalizeScanTargetWithXrayRepository_DefaultRepoApplied(t *testing.T) {
	registry := &models.Registry{
		URL:            "https://registry.example.com",
		ScanProvider:   models.ScanProviderArtifactoryXray,
		XrayRepository: "docker-remote",
	}

	imageName, imageTag := NormalizeScanTargetWithXrayRepository("n8nio/n8n", "latest", registry, "")
	if imageName != "registry.example.com/docker-remote/n8nio/n8n" {
		t.Fatalf("expected default repo prefix, got %q", imageName)
	}
	if imageTag != "latest" {
		t.Fatalf("expected tag latest, got %q", imageTag)
	}
}

func TestNormalizeScanTargetWithXrayRepository_OverrideWins(t *testing.T) {
	registry := &models.Registry{
		URL:            "https://registry.example.com",
		ScanProvider:   models.ScanProviderArtifactoryXray,
		XrayRepository: "docker-remote",
	}

	imageName, _ := NormalizeScanTargetWithXrayRepository("n8nio/n8n", "latest", registry, "docker-prod")
	if imageName != "registry.example.com/docker-prod/n8nio/n8n" {
		t.Fatalf("expected override repo prefix, got %q", imageName)
	}
}

func TestNormalizeScanTargetWithXrayRepository_DoesNotDoublePrefix(t *testing.T) {
	registry := &models.Registry{
		URL:            "https://registry.example.com",
		ScanProvider:   models.ScanProviderArtifactoryXray,
		XrayRepository: "docker-remote",
	}

	imageName, _ := NormalizeScanTargetWithXrayRepository("docker-remote/n8nio/n8n", "latest", registry, "")
	if imageName != "registry.example.com/docker-remote/n8nio/n8n" {
		t.Fatalf("expected existing repo prefix to be preserved, got %q", imageName)
	}
}

func TestNormalizeScanTargetWithXrayRepository_PreservesExplicitRepoAfterMatchingHost(t *testing.T) {
	registry := &models.Registry{
		URL:            "https://registry.example.com",
		ScanProvider:   models.ScanProviderArtifactoryXray,
		XrayRepository: "docker-remote",
	}

	imageName, _ := NormalizeScanTargetWithXrayRepository("registry.example.com/n8nio/n8n", "latest", registry, "")
	if imageName != "registry.example.com/n8nio/n8n" {
		t.Fatalf("expected explicit repository path to be preserved, got %q", imageName)
	}
}

func TestNormalizeScanTargetWithXrayRepository_PreservesNestedExplicitRemotePath(t *testing.T) {
	registry := &models.Registry{
		URL:            "https://artifactory.example.com",
		ScanProvider:   models.ScanProviderArtifactoryXray,
		XrayRepository: "default-remote",
	}

	imageName, _ := NormalizeScanTargetWithXrayRepository(
		"artifactory.example.com/docker-remote/ghcr-remote/justlabv1/justapps",
		"latest",
		registry,
		"",
	)
	if imageName != "artifactory.example.com/docker-remote/ghcr-remote/justlabv1/justapps" {
		t.Fatalf("expected nested explicit remote path to be preserved, got %q", imageName)
	}
}

func TestNormalizeScanTargetWithXrayRepository_LeavesOtherHostsAlone(t *testing.T) {
	registry := &models.Registry{
		URL:            "https://registry.example.com",
		ScanProvider:   models.ScanProviderArtifactoryXray,
		XrayRepository: "docker-remote",
	}

	imageName, _ := NormalizeScanTargetWithXrayRepository("other.example.com/n8nio/n8n", "latest", registry, "")
	if imageName != "other.example.com/n8nio/n8n" {
		t.Fatalf("expected non-matching host to be preserved, got %q", imageName)
	}
}

func TestNormalizeScanTargetWithXrayRepository_TrivyBehaviorUnchanged(t *testing.T) {
	registry := &models.Registry{
		URL:          "https://registry.example.com",
		ScanProvider: models.ScanProviderTrivy,
	}

	imageName, _ := NormalizeScanTargetWithXrayRepository("nginx", "latest", registry, "docker-remote")
	if imageName != "registry.example.com/nginx" {
		t.Fatalf("expected trivy normalization to stay unchanged, got %q", imageName)
	}
}
