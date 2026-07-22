package pipelines

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"justscan-backend/config"
)

const callbackResponseHeaderTimeout = 10 * time.Second

// ValidateCallbackURL permits public HTTPS endpoints by default. Operators can
// opt in to private callback destinations using the explicit allowlists.
func ValidateCallbackURL(ctx context.Context, raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" {
		return nil, errors.New("callback.url must be an absolute HTTPS URL without credentials or fragment")
	}
	host := strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
	if host == "" {
		return nil, errors.New("callback.url must include a hostname")
	}
	if hostAllowed(host) {
		return parsed, nil
	}
	addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if err != nil || len(addresses) == 0 {
		return nil, errors.New("callback.url hostname could not be resolved")
	}
	for _, address := range addresses {
		if !isPublicCallbackAddress(address) && !cidrAllowed(address) {
			return nil, errors.New("callback.url must not resolve to a private or local network address")
		}
	}
	return parsed, nil
}

func newCallbackHTTPClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = callbackResponseHeaderTimeout
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		parsed, err := ValidateCallbackURL(ctx, (&url.URL{Scheme: "https", Host: host}).String())
		if err != nil {
			return nil, err
		}
		addresses, err := net.DefaultResolver.LookupNetIP(ctx, "ip", parsed.Hostname())
		if err != nil {
			return nil, err
		}
		for _, candidate := range addresses {
			if hostAllowed(parsed.Hostname()) || isPublicCallbackAddress(candidate) || cidrAllowed(candidate) {
				return (&net.Dialer{}).DialContext(ctx, network, net.JoinHostPort(candidate.String(), port))
			}
		}
		return nil, fmt.Errorf("callback target has no permitted address")
	}
	return &http.Client{
		Timeout:   callbackHTTPTimeout,
		Transport: transport,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return errors.New("pipeline callbacks must not redirect")
		},
	}
}

func hostAllowed(host string) bool {
	if config.Config == nil {
		return false
	}
	for _, allowed := range config.Config.Security.CallbackAllowedHosts {
		if strings.EqualFold(strings.TrimSuffix(strings.TrimSpace(allowed), "."), host) {
			return true
		}
	}
	return false
}

func cidrAllowed(address netip.Addr) bool {
	if config.Config == nil {
		return false
	}
	for _, raw := range config.Config.Security.CallbackAllowedCIDRs {
		if prefix, err := netip.ParsePrefix(strings.TrimSpace(raw)); err == nil && prefix.Contains(address) {
			return true
		}
	}
	return false
}

func isPublicCallbackAddress(address netip.Addr) bool {
	return address.IsValid() && !address.IsLoopback() && !address.IsPrivate() && !address.IsLinkLocalUnicast() &&
		!address.IsLinkLocalMulticast() && !address.IsMulticast() && !address.IsUnspecified()
}
