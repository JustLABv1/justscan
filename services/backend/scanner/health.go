package scanner

import (
	"context"
	"time"

	"justscan-backend/config"
)

type WorkerHealth struct {
	WorkerID           int        `json:"worker_id"`
	CacheDir           string     `json:"cache_dir"`
	Status             string     `json:"status"`
	Error              string     `json:"error,omitempty"`
	TrivyVersion       string     `json:"trivy_version"`
	VulnDBUpdatedAt    *time.Time `json:"vuln_db_updated_at,omitempty"`
	VulnDBDownloadedAt *time.Time `json:"vuln_db_downloaded_at,omitempty"`
	VulnDBAgeHours     *float64   `json:"vuln_db_age_hours,omitempty"`
	JavaDBUpdatedAt    *time.Time `json:"java_db_updated_at,omitempty"`
	JavaDBDownloadedAt *time.Time `json:"java_db_downloaded_at,omitempty"`
	JavaDBAgeHours     *float64   `json:"java_db_age_hours,omitempty"`
}

type HealthReport struct {
	GeneratedAt          time.Time      `json:"generated_at"`
	CacheRoot            string         `json:"cache_root"`
	MaxAllowedAgeHours   int            `json:"max_allowed_age_hours"`
	TotalWorkers         int            `json:"total_workers"`
	HealthyWorkers       int            `json:"healthy_workers"`
	StaleWorkers         int            `json:"stale_workers"`
	ErrorWorkers         int            `json:"error_workers"`
	OldestVulnDBAgeHours *float64       `json:"oldest_vuln_db_age_hours,omitempty"`
	OldestJavaDBAgeHours *float64       `json:"oldest_java_db_age_hours,omitempty"`
	Workers              []WorkerHealth `json:"workers"`
}

func GetHealthReport(ctx context.Context) HealthReport {
	concurrency := config.Config.Scanner.Concurrency
	if concurrency <= 0 {
		concurrency = 2
	}

	report := HealthReport{
		GeneratedAt:        time.Now().UTC(),
		CacheRoot:          trivyCacheRoot(),
		MaxAllowedAgeHours: config.Config.Scanner.DBMaxAgeHours,
		TotalWorkers:       concurrency,
		Workers:            make([]WorkerHealth, 0, concurrency),
	}
	if report.MaxAllowedAgeHours <= 0 {
		report.MaxAllowedAgeHours = 24
	}

	now := time.Now()
	for workerID := 0; workerID < concurrency; workerID++ {
		cacheDir := workerCacheDir(workerID)
		worker := WorkerHealth{
			WorkerID: workerID,
			CacheDir: cacheDir,
		}

		info, err := GetTrivyRuntimeInfo(ctx, cacheDir)
		if err != nil {
			worker.Status = "error"
			worker.Error = err.Error()
			report.ErrorWorkers++
			report.Workers = append(report.Workers, worker)
			continue
		}

		worker.TrivyVersion = info.Version
		worker.VulnDBUpdatedAt = info.VulnerabilityDB.UpdatedAt
		worker.VulnDBDownloadedAt = info.VulnerabilityDB.DownloadedAt
		worker.VulnDBAgeHours = ageHours(now, info.VulnerabilityDB.DownloadedAt)
		worker.JavaDBUpdatedAt = info.JavaDB.UpdatedAt
		worker.JavaDBDownloadedAt = info.JavaDB.DownloadedAt
		worker.JavaDBAgeHours = ageHours(now, info.JavaDB.DownloadedAt)

		if shouldRefreshDatabases(info) {
			worker.Status = "stale"
			report.StaleWorkers++
		} else {
			worker.Status = "healthy"
			report.HealthyWorkers++
		}

		report.OldestVulnDBAgeHours = maxAge(report.OldestVulnDBAgeHours, worker.VulnDBAgeHours)
		report.OldestJavaDBAgeHours = maxAge(report.OldestJavaDBAgeHours, worker.JavaDBAgeHours)
		report.Workers = append(report.Workers, worker)
	}

	return report
}

func ageHours(now time.Time, updatedAt *time.Time) *float64 {
	if updatedAt == nil {
		return nil
	}
	age := now.Sub(*updatedAt).Hours()
	return &age
}

func maxAge(current, candidate *float64) *float64 {
	if candidate == nil {
		return current
	}
	if current == nil || *candidate > *current {
		return candidate
	}
	return current
}
