package background_checks

import (
	"time"

	"github.com/uptrace/bun"
)

func Init(db *bun.DB) {
	ticker := time.NewTicker(30 * time.Second)
	quit := make(chan struct{})

	go func() {
		for {
			select {
			case <-ticker.C:
				checkCSVBridgeHealth(db)
			case <-quit:
				ticker.Stop()
				return
			}
		}
	}()
}
