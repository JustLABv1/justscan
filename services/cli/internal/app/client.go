package app

import (
	"bytes"
	"context"
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

type LoginResponse struct {
	Token     string `json:"token"`
	ExpiresAt int64  `json:"expires_at"`
	User      struct {
		Username string `json:"username"`
		Email    string `json:"email"`
	} `json:"user"`
}

type ScanRequest struct {
	Image          string   `json:"image"`
	Platform       string   `json:"platform,omitempty"`
	RegistryID     string   `json:"registry_id,omitempty"`
	XrayRepository string   `json:"xray_repository,omitempty"`
	TagIDs         []string `json:"tag_ids,omitempty"`
	Source         string   `json:"source,omitempty"`
	ExternalRef    string   `json:"external_ref,omitempty"`
}

type AcceptedScan struct {
	ScanID     string `json:"scan_id"`
	Status     string `json:"status"`
	ScanStatus string `json:"scan_status"`
	StatusURL  string `json:"status_url"`
	ScanURL    string `json:"scan_url,omitempty"`
}

type UploadedArchiveScan struct {
	ID          string `json:"id"`
	ImageName   string `json:"image_name"`
	ImageTag    string `json:"image_tag"`
	Status      string `json:"status"`
	CurrentStep string `json:"current_step"`
}

type archiveUploadSession struct {
	ID           string `json:"id"`
	UploadOffset int64  `json:"upload_offset"`
	ChunkSize    int64  `json:"chunk_size"`
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

func (c *Client) UploadArchive(ctx context.Context, orgID string, archive io.Reader, filename string, size int64, imageName, imageTag, platform string) (UploadedArchiveScan, error) {
	if size > maxArchiveBytes {
		return UploadedArchiveScan{}, errors.New("archive exceeds the 5 GB upload limit")
	}
	expectedSize := size
	if expectedSize < 0 {
		expectedSize = 0
	}
	var session archiveUploadSession
	if err := c.doJSON(http.MethodPost, "/orgs/"+orgID+"/archive-upload-sessions", map[string]any{
		"filename": filename, "image_name": imageName, "image_tag": imageTag, "platform": platform, "expected_size": expectedSize,
	}, &session); err != nil {
		return UploadedArchiveScan{}, err
	}
	if session.ID == "" || session.ChunkSize <= 0 {
		return UploadedArchiveScan{}, errors.New("JustScan API returned an invalid archive upload session")
	}

	buffer := make([]byte, session.ChunkSize)
	offset := session.UploadOffset
	for {
		n, readErr := io.ReadFull(archive, buffer)
		if n > 0 {
			if offset+int64(n) > maxArchiveBytes {
				return UploadedArchiveScan{}, errors.New("archive exceeds the 5 GB upload limit")
			}
			if err := c.uploadArchiveChunk(ctx, orgID, session.ID, offset, buffer[:n]); err != nil {
				return UploadedArchiveScan{}, err
			}
			offset += int64(n)
		}
		if errors.Is(readErr, io.EOF) || errors.Is(readErr, io.ErrUnexpectedEOF) {
			break
		}
		if readErr != nil {
			return UploadedArchiveScan{}, fmt.Errorf("read archive: %w", readErr)
		}
	}
	if offset == 0 {
		return UploadedArchiveScan{}, errors.New("archive is empty")
	}
	var result UploadedArchiveScan
	if err := c.doJSON(http.MethodPost, "/orgs/"+orgID+"/archive-upload-sessions/"+session.ID+"/complete", nil, &result); err != nil {
		return UploadedArchiveScan{}, err
	}
	return result, nil
}

func (c *Client) uploadArchiveChunk(ctx context.Context, orgID, sessionID string, offset int64, chunk []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, c.baseURL+"/orgs/"+orgID+"/archive-upload-sessions/"+sessionID, bytes.NewReader(chunk))
	if err != nil {
		return fmt.Errorf("create archive upload chunk: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/offset+octet-stream")
	req.Header.Set("Upload-Offset", strconv.FormatInt(offset, 10))
	uploadHTTP := *c.http
	uploadHTTP.Timeout = 10 * time.Minute
	response, err := uploadHTTP.Do(req)
	if err != nil {
		return fmt.Errorf("upload archive chunk at offset %d: %w", offset, err)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return fmt.Errorf("read archive upload response: %w", err)
	}
	if response.StatusCode != http.StatusNoContent {
		return apiErrorFromResponse(response, payload)
	}
	nextOffset, err := strconv.ParseInt(response.Header.Get("Upload-Offset"), 10, 64)
	if err != nil || nextOffset != offset+int64(len(chunk)) {
		return errors.New("JustScan API returned an invalid archive upload offset")
	}
	return nil
}

func (c *Client) Login(email, password string) (LoginResponse, error) {
	var result LoginResponse
	if err := c.doPublicJSON(http.MethodPost, "/auth/login", map[string]any{"email": email, "password": password, "remember_me": true, "client": "justscan_cli"}, &result); err != nil {
		return LoginResponse{}, err
	}
	if strings.TrimSpace(result.Token) == "" {
		return LoginResponse{}, errors.New("JustScan API did not return a login token")
	}
	return result, nil
}

func (c *Client) RevokeCurrentToken() error {
	var result struct {
		Result string `json:"result"`
	}
	return c.doJSON(http.MethodDelete, "/token/current", nil, &result)
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
	return c.doJSONWithAuth(method, path, input, output, true)
}

func (c *Client) doPublicJSON(method, path string, input, output any) error {
	return c.doJSONWithAuth(method, path, input, output, false)
}

func (c *Client) doJSONWithAuth(method, path string, input, output any, includeAuth bool) error {
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
	if includeAuth {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
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
		return apiErrorFromResponse(response, payload)
	}
	if err := json.Unmarshal(payload, output); err != nil {
		return fmt.Errorf("parse JustScan API response: %w", err)
	}
	return nil
}

func apiErrorFromResponse(response *http.Response, payload []byte) error {
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
