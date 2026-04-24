package config

import (
	"context"
	"strconv"
	"sync"
	"time"

	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

// SettingResolver resolves runtime settings from the database, falling back to
// the loaded config.yaml values. An in-memory cache with a 60-second TTL avoids
// per-request database reads.
type SettingResolver struct {
	db    *bun.DB
	mu    sync.RWMutex
	cache map[string]cachedSetting
	ttl   time.Duration
}

type cachedSetting struct {
	value     string
	expiresAt time.Time
}

var (
	resolverInstance *SettingResolver
	resolverOnce     sync.Once
)

// InitSettingResolver initialises the singleton resolver. Must be called after
// the database is ready.
func InitSettingResolver(db *bun.DB) {
	resolverOnce.Do(func() {
		resolverInstance = &SettingResolver{
			db:    db,
			cache: make(map[string]cachedSetting),
			ttl:   60 * time.Second,
		}
	})
}

// GetResolver returns the singleton SettingResolver. Returns nil if not yet initialised.
func GetResolver() *SettingResolver {
	return resolverInstance
}

// GetString returns the string value for key, falling back to fallback if no DB
// override exists.
func (r *SettingResolver) GetString(key, fallback string) string {
	if v, ok := r.fromCache(key); ok {
		return v
	}
	val, found := r.fromDB(key)
	if !found {
		return fallback
	}
	return val
}

// GetBool returns the bool value for key, falling back to fallback.
func (r *SettingResolver) GetBool(key string, fallback bool) bool {
	s := r.GetString(key, strconv.FormatBool(fallback))
	v, err := strconv.ParseBool(s)
	if err != nil {
		return fallback
	}
	return v
}

// GetInt returns the int value for key, falling back to fallback.
func (r *SettingResolver) GetInt(key string, fallback int) int {
	s := r.GetString(key, strconv.Itoa(fallback))
	v, err := strconv.Atoi(s)
	if err != nil {
		return fallback
	}
	return v
}

// Set persists a setting to the database and invalidates the cache entry.
func (r *SettingResolver) Set(ctx context.Context, key, value string) error {
	_, err := r.db.NewRaw(`
		INSERT INTO system_settings (key, value, updated_at)
		VALUES (?, ?, now())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
	`, key, value).Exec(ctx)
	if err != nil {
		return err
	}
	r.Invalidate(key)
	return nil
}

// Delete removes a DB override for the given key (reverts to config.yaml default).
func (r *SettingResolver) Delete(ctx context.Context, key string) error {
	_, err := r.db.NewRaw(`DELETE FROM system_settings WHERE key = ?`, key).Exec(ctx)
	r.Invalidate(key)
	return err
}

// Invalidate removes a single key from the cache.
func (r *SettingResolver) Invalidate(key string) {
	r.mu.Lock()
	delete(r.cache, key)
	r.mu.Unlock()
}

// fromCache returns a cached value if it exists and has not expired.
func (r *SettingResolver) fromCache(key string) (string, bool) {
	r.mu.RLock()
	entry, ok := r.cache[key]
	r.mu.RUnlock()
	if ok && time.Now().Before(entry.expiresAt) {
		return entry.value, true
	}
	return "", false
}

// fromDB fetches a value from the database and populates the cache.
func (r *SettingResolver) fromDB(key string) (string, bool) {
	var value string
	err := r.db.NewRaw(`SELECT value FROM system_settings WHERE key = ?`, key).Scan(context.Background(), &value)
	if err != nil {
		// Key not in DB — cache a sentinel so we don't hammer the DB for missing keys.
		r.mu.Lock()
		r.cache[key] = cachedSetting{value: "", expiresAt: time.Now().Add(r.ttl)}
		r.mu.Unlock()
		return "", false
	}
	r.mu.Lock()
	r.cache[key] = cachedSetting{value: value, expiresAt: time.Now().Add(r.ttl)}
	r.mu.Unlock()
	log.Debugf("setting resolved from DB: %s = %s", key, value)
	return value, true
}
