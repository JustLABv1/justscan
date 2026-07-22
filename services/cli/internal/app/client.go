package app

import (
	"bytes"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const maxResponseBytes = 2 << 20

type APIError struct {
	StatusCode int
	Message    string
	RetryAfter time.Duration
}

func (e *APIError) Error() string {
	if e.StatusCode == 0 {
		return e.Message
	}
	return fmt.Sprintf("JustScan API returned %d: %s", e.StatusCode, e.Message)
}

type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

type ScanRequest struct {
	Image          string   `json:"image"`
	Platform       string   `json:"platform,omitempty"`
	RegistryID     string   `json:"registry_id,omitempty"`
	XrayRepository string   `json:"xray_repository,omitempty"`
	TagIDs         []string `json:"tag_ids,omitempty"`
	Source         string   `json:"source,omitempty"`
	ExternalRef    string   `json:"external_ref,omitempty"`
	Verdict        Verdict  `json:"verdict"`
}

type Verdict struct {
	FailOnSeverity  string `json:"fail_on_severity"`
	FailOnScanError bool   `json:"fail_on_scan_error"`
	FailOnXrayBlock bool   `json:"fail_on_xray_block"`
}

type AcceptedScan struct {
	ScanID     string `json:"scan_id"`
	Status     string `json:"status"`
	ScanStatus string `json:"scan_status"`
	StatusURL  string `json:"status_url"`
	ScanURL    string `json:"scan_url,omitempty"`
}

type ScanResult struct {
	Event          string `json:"event"`
	ScanID         string `json:"scan_id"`
	OrgID          string `json:"org_id"`
	Source         string `json:"source"`
	ExternalRef    string `json:"external_ref,omitempty"`
	Status         string `json:"status"`
	ExternalStatus string `json:"external_status,omitempty"`
	CurrentStep    string `json:"current_step"`
	Verdict        string `json:"verdict"`
	ErrorMessage   string `json:"error_message,omitempty"`
	CriticalCount  int    `json:"critical_count"`
	HighCount      int    `json:"high_count"`
	MediumCount    int    `json:"medium_count"`
	LowCount       int    `json:"low_count"`
	UnknownCount   int    `json:"unknown_count"`
	ImageName      string `json:"image_name"`
	ImageTag       string `json:"image_tag"`
	ScanProvider   string `json:"scan_provider"`
	ScanURL        string `json:"scan_url,omitempty"`
	StatusURL      string `json:"status_url,omitempty"`
}

func newClient(server, token, caCert string, insecure bool, allowHTTP bool) (*Client, error) {
	apiURL, err := normalizeAPIURL(server, allowHTTP)
	if err != nil {
		return nil, err
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: insecure} // #nosec G402 -- explicit CLI option.
	if caCert != "" {
		pem, err := os.ReadFile(caCert)
		if err != nil {
			return nil, fmt.Errorf("read CA certificate: %w", err)
		}
		pool, err := x509.SystemCertPool()
		if err != nil || pool == nil {
			pool = x509.NewCertPool()
		}
		if !pool.AppendCertsFromPEM(pem) {
			return nil, errors.New("CA certificate contains no valid certificates")
		}
		transport.TLSClientConfig.RootCAs = pool
	}
	return &Client{
		baseURL: apiURL,
		token:   token,
		http: &http.Client{Timeout: 45 * time.Second, Transport: transport, CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return errors.New("refusing HTTP redirect while sending a bearer token")
		}},
	}, nil
}

func normalizeAPIURL(raw string, allowHTTP bool) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme == "" || u.Host == "" || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("server must be an absolute URL without query or fragment")
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return "", errors.New("server URL must use https or http")
	}
	if u.Scheme == "http" && !allowHTTP && !isLoopbackHost(u.Hostname()) {
		return "", errors.New("refusing to send a bearer token over HTTP; use --allow-insecure-http only for trusted networks")
	}
	u.Path = strings.TrimRight(u.Path, "/")
	if !strings.HasSuffix(u.Path, "/api/v1") {
		u.Path += "/api/v1"
	}
	return strings.TrimRight(u.String(), "/"), nil
}

func isLoopbackHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func (c *Client) CreateScan(orgID string, request ScanRequest) (AcceptedScan, error) {
	var accepted AcceptedScan
	err := c.doJSON(http.MethodPost, "/orgs/"+orgID+"/pipeline-scans", request, &accepted)
	if err != nil {
		return AcceptedScan{}, err
	}
	if accepted.ScanID == "" {
		return AcceptedScan{}, errors.New("JustScan API response did not include scan_id")
	}
	return accepted, nil
}

func (c *Client) GetScan(orgID, scanID string) (ScanResult, error) {
	var result ScanResult
	err := c.doJSON(http.MethodGet, "/orgs/"+orgID+"/pipeline-scans/"+scanID, nil, &result)
	if err != nil {
		return ScanResult{}, err
	}
	if result.ScanID == "" || result.Verdict == "" {
		return ScanResult{}, errors.New("JustScan API returned an incomplete scan result")
	}
	return result, nil
}

func (c *Client) doJSON(method, path string, input, output any) error {
	var body io.Reader
	if input != nil {
		encoded, err := json.Marshal(input)
		if err != nil {
			return fmt.Errorf("encode request: %w", err)
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequest(method, c.baseURL+path, body)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")
	if input != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	response, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("call JustScan API: %w", err)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return fmt.Errorf("read JustScan API response: %w", err)
	}
	if len(payload) > maxResponseBytes {
		return errors.New("JustScan API response exceeds 2 MiB limit")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message := strings.TrimSpace(string(payload))
		var apiBody struct {
			Error string `json:"error"`
		}
		if json.Unmarshal(payload, &apiBody) == nil && apiBody.Error != "" {
			message = apiBody.Error
		}
		if message == "" {
			message = response.Status
		}
		return &APIError{StatusCode: response.StatusCode, Message: message, RetryAfter: retryAfter(response.Header.Get("Retry-After"))}
	}
	if err := json.Unmarshal(payload, output); err != nil {
		return fmt.Errorf("parse JustScan API response: %w", err)
	}
	return nil
}

func retryAfter(value string) time.Duration {
	if seconds, err := strconv.Atoi(strings.TrimSpace(value)); err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}
	if retryAt, err := http.ParseTime(value); err == nil {
		if delay := time.Until(retryAt); delay > 0 {
			return delay
		}
	}
	return 0
}
