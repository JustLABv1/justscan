package gitrepositories

import (
	"strings"
	"testing"

	"justscan-backend/config"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
)

func TestBuildRequiresCompleteGitAuthentication(t *testing.T) {
	tests := []struct {
		name string
		body repositoryRequest
		want string
	}{
		{
			name: "missing username",
			body: repositoryRequest{
				CloneURL:   "https://git.example.com/group/repository.git",
				AuthType:   "token",
				Credential: "token",
			},
			want: "Git username is required",
		},
		{
			name: "missing credential",
			body: repositoryRequest{
				CloneURL: "https://git.example.com/group/repository.git",
				AuthType: "token",
				Username: "git-user",
			},
			want: "Git token or password is required",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := build(nil, nil, test.body, uuid.New(), nil)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("build() error = %v, want message containing %q", err, test.want)
			}
		})
	}
}

func TestBuildStoresCompleteGitAuthentication(t *testing.T) {
	previousConfig := config.Config
	config.Config = &config.RestfulConf{
		Encryption: config.EncryptionConf{Key: "git-repository-test-encryption-key"},
	}
	defer func() { config.Config = previousConfig }()

	item, err := build(nil, nil, repositoryRequest{
		CloneURL:   "https://git.example.com/group/repository.git",
		AuthType:   "token",
		Username:   " git-user ",
		Credential: "token",
	}, uuid.New(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if item.Username != "git-user" {
		t.Fatalf("username = %q, want trimmed username", item.Username)
	}
	if item.EncryptedCredential == "" {
		t.Fatal("credential was not encrypted and stored")
	}
}

func TestBuildRegistryDiscoveryAcceptsCustomPrefixWithoutEntrypoints(t *testing.T) {
	item, err := build(nil, nil, repositoryRequest{
		CloneURL:          "https://git.example.com/group/repository.git",
		DiscoveryMode:     models.GitRepositoryDiscoveryRegistry,
		DiscoveryRegistry: " Registry.Example.com/Team/ ",
		Entrypoints:       nil,
	}, uuid.New(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if item.DiscoveryRegistry != "registry.example.com/team" || item.DiscoveryRegistryID != nil {
		t.Fatalf("unexpected registry discovery settings: %#v", item)
	}
}

func TestBuildRegistryDiscoveryRejectsUnsafeCustomPrefix(t *testing.T) {
	_, err := build(nil, nil, repositoryRequest{
		CloneURL:          "https://git.example.com/group/repository.git",
		DiscoveryMode:     models.GitRepositoryDiscoveryRegistry,
		DiscoveryRegistry: "https://registry.example.com/team",
	}, uuid.New(), nil)
	if err == nil || !strings.Contains(err.Error(), "omit the URL scheme") {
		t.Fatalf("unsafe registry prefix error = %v", err)
	}
}

func TestBuildHelmSourceStoresDirectCredentialsAndRestrictsPaths(t *testing.T) {
	previousConfig := config.Config
	config.Config = &config.RestfulConf{Encryption: config.EncryptionConf{Key: "helm-source-test-encryption-key"}}
	defer func() { config.Config = previousConfig }()

	ownerID := uuid.New()
	repository := &models.GitRepository{ID: uuid.New(), OwnerType: models.OwnerTypeUser, OwnerUserID: &ownerID}
	source, err := buildHelmSource(nil, nil, repository, helmSourceRequest{
		SourceType: "url", CloneURL: "https://git.example.com/team/chart.git", Ref: "main",
		AuthType: "token", Username: "git-user", Credential: "secret", ChartPath: "apps/chart",
		Values: []string{"envs/dev/chart/values.yaml"},
	}, ownerID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if source.EncryptedCredential == "" || source.ChartPath != "apps/chart" || source.Ref != "main" {
		t.Fatalf("unexpected Helm source: %#v", source)
	}
	_, err = buildHelmSource(nil, nil, repository, helmSourceRequest{SourceType: "local", ChartPath: "../chart"}, ownerID, nil)
	if err == nil || !strings.Contains(err.Error(), "relative repository path") {
		t.Fatalf("unsafe chart path error = %v", err)
	}
}

func TestSameRepositoryOwnerRejectsCrossWorkspaceLinks(t *testing.T) {
	first, second := uuid.New(), uuid.New()
	left := &models.GitRepository{OwnerType: models.OwnerTypeUser, OwnerUserID: &first}
	right := &models.GitRepository{OwnerType: models.OwnerTypeUser, OwnerUserID: &second}
	if sameRepositoryOwner(left, right) {
		t.Fatal("repositories with different users must not be linked")
	}
	right.OwnerUserID = &first
	if !sameRepositoryOwner(left, right) {
		t.Fatal("repositories in the same user workspace should be linkable")
	}
}

func TestRegistryAvailableToRepositoryRequiresCompatibleUserOwner(t *testing.T) {
	first, second := uuid.New(), uuid.New()
	repository := &models.GitRepository{OwnerType: models.OwnerTypeUser, OwnerUserID: &first}
	registry := &models.Registry{OwnerType: models.OwnerTypeUser, OwnerUserID: &second}

	allowed, err := registryAvailableToRepository(nil, nil, repository, registry)
	if err != nil {
		t.Fatal(err)
	}
	if allowed {
		t.Fatal("registry from another user workspace should not be selectable")
	}

	registry.OwnerUserID = &first
	allowed, err = registryAvailableToRepository(nil, nil, repository, registry)
	if err != nil {
		t.Fatal(err)
	}
	if !allowed {
		t.Fatal("registry from the repository user workspace should be selectable")
	}
}
