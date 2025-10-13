package vps

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"csv-bridge/config"

	log "github.com/sirupsen/logrus"
)

type RegistrationRequest struct {
	ServiceID     string    `json:"service_id"`
	ServiceName   string    `json:"service_name"`
	Version       string    `json:"version"`
	UploadURL     string    `json:"upload_url"`
	HealthURL     string    `json:"health_url"`
	APIKey        string    `json:"api_key"`
	MaxFileSize   int64     `json:"max_file_size"`
	LastHeartbeat time.Time `json:"last_heartbeat"`
}

type RegistrationResponse struct {
	Status   string `json:"status"`
	Message  string `json:"message"`
	BridgeID string `json:"bridge_id,omitempty"`
	Error    string `json:"error,omitempty"`
}

// RegisterWithVPS registers this bridge service with the VPS application
func RegisterWithVPS(cfg *config.Config) error {
	// Determine the external URL for this service
	uploadURL := fmt.Sprintf("http://%s:%d/upload", getExternalIP(), cfg.Server.Port)
	if cfg.Server.Host != "0.0.0.0" {
		uploadURL = fmt.Sprintf("http://%s:%d/upload", cfg.Server.Host, cfg.Server.Port)
	}

	healthURL := fmt.Sprintf("http://%s:%d/health", getExternalIP(), cfg.Server.Port)
	if cfg.Server.Host != "0.0.0.0" {
		healthURL = fmt.Sprintf("http://%s:%d/health", cfg.Server.Host, cfg.Server.Port)
	}

	registrationData := RegistrationRequest{
		ServiceID:     cfg.Bridge.ServiceID,
		ServiceName:   cfg.Bridge.ServiceName,
		Version:       cfg.Bridge.Version,
		UploadURL:     uploadURL,
		HealthURL:     healthURL,
		APIKey:        cfg.Security.APIKey,
		MaxFileSize:   cfg.Server.MaxFileSize,
		LastHeartbeat: time.Now(),
	}

	jsonData, err := json.Marshal(registrationData)
	if err != nil {
		return fmt.Errorf("failed to marshal registration data: %w", err)
	}

	// Send registration request to VPS
	registrationURL := fmt.Sprintf("%s/api/v1/bridge/register", cfg.VPS.BaseURL)
	req, err := http.NewRequest("POST", registrationURL, bytes.NewBuffer(jsonData))
	if err != nil {
		return fmt.Errorf("failed to create registration request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", cfg.VPS.APIToken))

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send registration request: %w", err)
	}
	defer resp.Body.Close()

	var response RegistrationResponse
	if err := json.NewDecoder(resp.Body).Decode(&response); err != nil {
		return fmt.Errorf("failed to decode registration response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		if response.Error != "" {
			return fmt.Errorf("registration failed: %s - %s - %s", response.Status, response.Message, response.Error)
		}
		return fmt.Errorf("registration failed: %s - %s", response.Status, response.Message)
	}

	log.Infof("Successfully registered with VPS: %s", response.Message)
	if response.BridgeID != "" {
		log.Infof("Assigned bridge ID: %s", response.BridgeID)
	}

	return nil
}

// StartHeartbeat starts a periodic heartbeat to the VPS application
func StartHeartbeat(cfg *config.Config) {
	// Use 5 seconds interval for frequent heartbeats
	interval := 30 * time.Second
	log.Infof("Starting heartbeat service with interval: %v", interval)

	ticker := time.NewTicker(interval)

	go func() {
		defer ticker.Stop()

		// Send initial heartbeat after a short delay to ensure server is ready
		time.Sleep(2 * time.Second)
		log.Info("Sending initial heartbeat...")

		if err := RegisterWithVPS(cfg); err != nil {
			log.Errorf("Initial heartbeat registration failed: %v", err)
		} else {
			log.Info("Initial heartbeat sent successfully")
		}

		// Start periodic heartbeat loop
		heartbeatCount := 1
		for range ticker.C {
			heartbeatCount++
			log.Infof("Sending periodic heartbeat #%d...", heartbeatCount)
			if err := RegisterWithVPS(cfg); err != nil {
				log.Errorf("Heartbeat registration failed: %v", err)
			} else {
				log.Infof("Heartbeat #%d sent successfully", heartbeatCount)
			}
		}
	}()

	log.Info("Heartbeat service started successfully")
}

// getExternalIP attempts to determine the external IP address
func getExternalIP() string {
	// Try to get from environment variables first (highest priority)
	if ip := getEnvOrDefault("EXTERNAL_IP", ""); ip != "" {
		log.Infof("Using configured external IP: %s", ip)
		return ip
	}

	if ip := getEnvOrDefault("POD_IP", ""); ip != "" {
		log.Infof("Using pod IP: %s", ip)
		return ip
	}

	// Try to get external IP from online services
	if ip := getExternalIPFromService(); ip != "" {
		log.Infof("Detected external IP: %s", ip)
		return ip
	}

	// Fallback to local network IP (for internal networks)
	if ip := getLocalNetworkIP(); ip != "" {
		log.Warnf("Using local network IP: %s (this may not be reachable from VPS)", ip)
		return ip
	}

	// Last resort fallback
	log.Warn("Could not determine external IP, using localhost. Set EXTERNAL_IP environment variable for proper registration.")
	return "localhost"
}

// getExternalIPFromService queries external services to determine public IP
func getExternalIPFromService() string {
	// List of reliable IP detection services
	services := []string{
		"https://api.ipify.org",
		"https://checkip.amazonaws.com",
		"https://ipinfo.io/ip",
		"https://icanhazip.com",
	}

	client := &http.Client{
		Timeout: 5 * time.Second,
	}

	for _, service := range services {
		if ip := queryIPService(client, service); ip != "" {
			return strings.TrimSpace(ip)
		}
	}

	log.Warn("All external IP services failed")
	return ""
}

// queryIPService queries a single IP detection service
func queryIPService(client *http.Client, url string) string {
	resp, err := client.Get(url)
	if err != nil {
		log.Debugf("Failed to query %s: %v", url, err)
		return ""
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		log.Debugf("Service %s returned status %d", url, resp.StatusCode)
		return ""
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Debugf("Failed to read response from %s: %v", url, err)
		return ""
	}

	ip := strings.TrimSpace(string(body))

	// Validate IP format
	if net.ParseIP(ip) == nil {
		log.Debugf("Invalid IP format from %s: %s", url, ip)
		return ""
	}

	log.Debugf("Successfully got IP from %s: %s", url, ip)
	return ip
}

// getLocalNetworkIP tries to determine the local network IP address
func getLocalNetworkIP() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		log.Errorf("Failed to get network interfaces: %v", err)
		return ""
	}

	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
			if ipnet.IP.To4() != nil {
				ip := ipnet.IP.String()
				// Skip common virtual/docker interfaces
				if !isVirtualInterface(ip) {
					log.Infof("Detected local network IP: %s", ip)
					return ip
				}
			}
		}
	}

	log.Warn("No suitable network interface found")
	return ""
}

// isVirtualInterface checks if an IP is from a virtual/docker interface
func isVirtualInterface(ip string) bool {
	// Common virtual interface IP ranges to skip
	virtualRanges := []string{
		"172.17.",  // Docker default bridge
		"172.18.",  // Docker bridge networks
		"172.19.",  // Docker bridge networks
		"172.20.",  // Docker bridge networks
		"169.254.", // Link-local addresses
	}

	for _, vRange := range virtualRanges {
		if strings.HasPrefix(ip, vRange) {
			return true
		}
	}
	return false
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// TestHeartbeat sends a test heartbeat to verify configuration
func TestHeartbeat(cfg *config.Config) error {
	log.Info("Testing heartbeat configuration...")

	if cfg.VPS.BaseURL == "" {
		return fmt.Errorf("VPS base URL is not configured")
	}

	if cfg.VPS.APIToken == "" {
		return fmt.Errorf("VPS API token is not configured")
	}

	log.Infof("Heartbeat configuration valid - VPS: %s, Heartbeat: every 5 seconds", cfg.VPS.BaseURL)

	return RegisterWithVPS(cfg)
}

// StartSimpleHeartbeat starts a basic heartbeat for testing (sends every 5 seconds)
func StartSimpleHeartbeat(cfg *config.Config) {
	go func() {
		count := 0
		for {
			time.Sleep(5 * time.Second)
			count++
			log.Infof("⏰ Heartbeat %d - Sending registration to VPS...", count)

			if err := RegisterWithVPS(cfg); err != nil {
				log.Errorf("❌ Heartbeat %d failed: %v", count, err)
			} else {
				log.Infof("✅ Heartbeat %d successful", count)
			}
		}
	}()

	log.Info("🚀 Simple heartbeat service started (5-second interval)")
}
