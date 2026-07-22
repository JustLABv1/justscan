package app

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/zalando/go-keyring"
)

const keyringService = "justscan-cli"

func credentialKey(profileName, server string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(profileName) + "\n" + strings.TrimRight(strings.TrimSpace(server), "/")))
	return hex.EncodeToString(sum[:])
}

func loadStoredToken(profileName, server string) (string, error) {
	token, err := keyring.Get(keyringService, credentialKey(profileName, server))
	if err == keyring.ErrNotFound {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("read stored login: %w", err)
	}
	return strings.TrimSpace(token), nil
}

func storeToken(profileName, server, token string) error {
	if err := keyring.Set(keyringService, credentialKey(profileName, server), strings.TrimSpace(token)); err != nil {
		return fmt.Errorf("store login in system keychain: %w", err)
	}
	return nil
}

func deleteStoredToken(profileName, server string) error {
	err := keyring.Delete(keyringService, credentialKey(profileName, server))
	if err == keyring.ErrNotFound {
		return nil
	}
	if err != nil {
		return fmt.Errorf("remove stored login: %w", err)
	}
	return nil
}
