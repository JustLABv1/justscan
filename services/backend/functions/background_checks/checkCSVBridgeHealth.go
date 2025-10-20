package background_checks

import (
	"context"
	"justwms-backend/pkg/models"
	"net/http"
	"time"

	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

func checkCSVBridgeHealth(db *bun.DB) {
	context := context.Background()

	log.Info("Bot: Checking CSV bridge health...")

	// get all bridges
	var bridges []models.CSVBridge
	err := db.NewSelect().Model(&bridges).Scan(context)
	if err != nil {
		log.Error("Bot: Error getting bridges. ", err)
		return
	}

	// check each bridge's health
	for _, bridge := range bridges {
		if !isBridgeHealthy(bridge) {
			log.Warnf("Bot: Bridge %s is unhealthy", bridge.BridgeID)
		}

		// check the health endpoint
		healthy := checkCSVBridgeHealthEndpoint(bridge.HealthURL)
		if healthy {
			log.Infof("Bot: Bridge %s health endpoint is healthy", bridge.BridgeID)
		} else {
			log.Warnf("Bot: Bridge %s health endpoint is unhealthy", bridge.BridgeID)
		}
	}
}

func isBridgeHealthy(bridge models.CSVBridge) bool {
	// A bridge is considered healthy if its last heartbeat was within the last 2 minutes
	if bridge.LastHeartbeat.IsZero() {
		return false
	}
	// consider healthy if LastHeartbeat + 2 minutes is after now
	return bridge.LastHeartbeat.Add(2 * time.Minute).After(time.Now())
}

// function the check the csv health endpoint
func checkCSVBridgeHealthEndpoint(healthURL string) bool {
	// make a get request to the health endpoint with a timeout of 5 seconds
	client := http.Client{
		Timeout: 5 * time.Second,
	}
	resp, err := client.Get(healthURL)
	if err != nil {
		log.Error("Bot: Error checking bridge health endpoint. ", err)
		return false
	}
	defer resp.Body.Close()

	// if status code is 200, return true
	if resp.StatusCode == 200 {
		return true
	}
	return false
}
