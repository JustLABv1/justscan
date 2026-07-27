package gitrepositories

import (
	"strings"
	"testing"

	"justscan-backend/config"

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
