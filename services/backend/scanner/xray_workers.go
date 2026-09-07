package scanner

import (
	"context"
	"sync/atomic"
)

// Xray coordinators keep only bounded polling goroutines alive. Download and
// import permits are released during provider waits; local scanners have their
// own queue and never wait behind a remote Xray operation. Pending scan rows
// remain durable and are retried by the existing recovery dispatcher.
var xrayJobQueue chan ScanJob
var xrayActiveCoordinators atomic.Int64
var xrayWorkPool chan struct{}
var xrayImportPool chan struct{}

type xrayWorkPermitKey struct{}

type xrayWorkPermit struct {
	pool chan struct{}
	held bool
}

func (p *xrayWorkPermit) acquire(ctx context.Context) error {
	if p == nil || p.held {
		return nil
	}
	select {
	case p.pool <- struct{}{}:
		p.held = true
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (p *xrayWorkPermit) release() {
	if p != nil && p.held {
		<-p.pool
		p.held = false
	}
}

// Imports have a separate pool so a burst of cold downloads cannot starve
// reports whose provider analysis has already completed.
func (p *xrayWorkPermit) acquireImport(ctx context.Context) error {
	if p == nil {
		return nil
	}
	p.release()
	p.pool = xrayImportPool
	return p.acquire(ctx)
}

func xrayPermit(ctx context.Context) *xrayWorkPermit {
	p, _ := ctx.Value(xrayWorkPermitKey{}).(*xrayWorkPermit)
	return p
}

func initXrayWorkers() {
	settings := effectiveScannerSettings()
	xrayJobQueue = make(chan ScanJob, 64)
	pool := make(chan struct{}, settings.XrayConcurrency)
	xrayWorkPool = pool
	xrayImportPool = make(chan struct{}, settings.XrayConcurrency)
	for i := 0; i < settings.XrayMaxActive; i++ {
		go func() {
			for job := range xrayJobQueue {
				permit := &xrayWorkPermit{pool: pool}
				// Claim only when preparation capacity is available, so waiting
				// jobs retain their pending status and queue estimate.
				_ = permit.acquire(context.Background())
				job.xrayWork = permit
				xrayActiveCoordinators.Add(1)
				processScan(job, "")
				xrayActiveCoordinators.Add(-1)
				permit.release()
				queuedScanIDs.Delete(job.ScanID)
				completedJobs.Add(1)
			}
		}()
	}
}
