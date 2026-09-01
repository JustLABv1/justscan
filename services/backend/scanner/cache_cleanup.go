package scanner

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"justscan-backend/config"

	log "github.com/sirupsen/logrus"
)

// Trivy's filesystem scan cache uses BoltDB. Scans take a shared lock for
// their worker cache while maintenance takes an exclusive lock before running
// `trivy clean`, preventing a cleanup from racing an active scan.
var trivyCacheMaintenanceLocks sync.Map // map[string]*sync.RWMutex

func trivyCacheMaintenanceLock(cacheDir string) *sync.RWMutex {
	value, _ := trivyCacheMaintenanceLocks.LoadOrStore(filepath.Clean(cacheDir), &sync.RWMutex{})
	return value.(*sync.RWMutex)
}

func withTrivyCacheUse(cacheDir string, fn func()) {
	lock := trivyCacheMaintenanceLock(cacheDir)
	lock.RLock()
	defer lock.RUnlock()
	fn()
}

// startTrivyScanCacheCleanup runs once at startup and then on the configured
// interval. It removes only Trivy's image-analysis cache, retaining the
// vulnerability and Java databases needed for fast, reliable scanning.
func startTrivyScanCacheCleanup(activeWorkerCount int) {
	go func() {
		for {
			hours := effectiveScannerSettings().ScanCacheCleanupHours
			if hours <= 0 {
				return
			}
			if err := cleanupTrivyScanCaches(context.Background(), activeWorkerCount); err != nil {
				log.Warnf("Trivy scan-cache cleanup failed: %v", err)
			}
			time.Sleep(time.Duration(hours) * time.Hour)
		}
	}()
}

func cleanupTrivyScanCaches(ctx context.Context, activeWorkerCount int) error {
	root := trivyCacheRoot()
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read cache root: %w", err)
	}
	for _, entry := range entries {
		if !entry.IsDir() || (entry.Name() != "bootstrap" && !strings.HasPrefix(entry.Name(), "worker-")) {
			continue
		}
		cacheDir := filepath.Join(root, entry.Name())
		lock := trivyCacheMaintenanceLock(cacheDir)
		lock.Lock()
		var cleanupErr error
		if workerID, isWorker := trivyWorkerCacheID(entry.Name()); isWorker && workerID >= activeWorkerCount {
			cleanupErr = os.RemoveAll(cacheDir)
			if cleanupErr == nil {
				log.Infof("Removed stale Trivy worker cache: %s", cacheDir)
			}
		} else {
			cleanupErr = cleanTrivyScanCache(ctx, cacheDir)
		}
		lock.Unlock()
		if cleanupErr != nil {
			return cleanupErr
		}
	}
	return nil
}

func trivyWorkerCacheID(name string) (int, bool) {
	if !strings.HasPrefix(name, "worker-") {
		return 0, false
	}
	id, err := strconv.Atoi(strings.TrimPrefix(name, "worker-"))
	return id, err == nil && id >= 0
}

func cleanTrivyScanCache(ctx context.Context, cacheDir string) error {
	trivyPath := "trivy"
	if config.Config != nil && config.Config.Scanner.TrivyPath != "" {
		trivyPath = config.Config.Scanner.TrivyPath
	}
	cleanCtx, cancel := context.WithTimeout(ctx, scanCommandTimeout())
	defer cancel()
	cmd := exec.CommandContext(cleanCtx, trivyPath, "--cache-dir", cacheDir, "clean", "--scan-cache")
	cmd.Env = os.Environ()
	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("clean scan cache %s: %w — output: %s", cacheDir, err, strings.TrimSpace(output.String()))
	}
	log.Infof("Trivy scan cache cleaned: %s", cacheDir)
	return nil
}
