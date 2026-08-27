package gitrepositories

import (
	"bytes"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"justscan-backend/scanner"
)

const (
	// Registry discovery intentionally has its own limits. A repository can
	// contain generated artifacts that are much larger than the deployment
	// manifests we normally inspect, and an unbounded text walk is an easy way
	// to turn a discovery request into a memory/CPU exhaustion vector.
	maxRegistryDiscoveryFileBytes  int64 = 5 * 1024 * 1024
	maxRegistryDiscoveryTotalBytes int64 = 64 * 1024 * 1024
	maxRegistryDiscoveryPrefixLen        = 512
)

var (
	// This tokeniser deliberately excludes shell/YAML punctuation while
	// retaining the punctuation used by OCI references (slashes, ports, tags,
	// and digests). Candidate validation below is stricter than this expression.
	registryDiscoveryTokenPattern  = regexp.MustCompile(`[A-Za-z0-9][A-Za-z0-9._:/@+\-]*`)
	registryDiscoveryNamePattern   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._\-]*$`)
	registryDiscoveryHostPattern   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.\-]*[A-Za-z0-9]$|^[A-Za-z0-9]$`)
	registryDiscoveryPortPattern   = regexp.MustCompile(`^[0-9]{1,5}$`)
	registryDiscoveryTagPattern    = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+\-]{0,127}$`)
	registryDiscoveryDigestPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9+._-]*:[A-Za-z0-9=_+.-]+$`)
)

var registryDiscoveryExcludedDirectories = map[string]struct{}{
	".git": {}, ".hg": {}, ".svn": {},
	"node_modules": {}, "vendor": {}, "third_party": {}, "third-party": {},
	"deps": {}, "dependency": {}, "dependencies": {},
	"dist": {}, "build": {}, "out": {}, "target": {},
	"coverage": {}, ".coverage": {},
	"generated": {}, "gen": {}, "__generated__": {}, "__pycache__": {},
	".next": {}, ".nuxt": {}, ".gradle": {}, ".terraform": {},
}

var registryDiscoveryTextExtensions = map[string]struct{}{
	".bash": {}, ".c": {}, ".cc": {}, ".cfg": {}, ".conf": {}, ".cpp": {},
	".cs": {}, ".css": {}, ".dockerfile": {}, ".env": {}, ".fish": {},
	".go": {}, ".gradle": {}, ".h": {}, ".hcl": {}, ".hpp": {},
	".html": {}, ".ini": {}, ".java": {}, ".js": {}, ".json": {},
	".jsx": {}, ".kt": {}, ".kts": {}, ".lock": {}, ".lua": {},
	".md": {}, ".mjs": {}, ".php": {}, ".pl": {}, ".properties": {},
	".proto": {}, ".py": {}, ".rb": {}, ".rs": {}, ".scala": {},
	".sh": {}, ".sql": {}, ".swift": {}, ".tf": {}, ".toml": {},
	".ts": {}, ".tsx": {}, ".txt": {}, ".xml": {}, ".yaml": {},
	".yml": {},
}

// NormalizeRegistryDiscoveryPrefix validates and canonicalizes the host/path
// prefix accepted by registry-reference discovery. It intentionally accepts a
// bare host (for example, an internal DNS name) but never accepts URL schemes,
// credentials, queries, fragments, traversal, or wildcard syntax.
func NormalizeRegistryDiscoveryPrefix(value string) (string, error) {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return "", fmt.Errorf("registry discovery prefix is required")
	}
	if len(raw) > maxRegistryDiscoveryPrefixLen {
		return "", fmt.Errorf("registry discovery prefix must be at most %d characters", maxRegistryDiscoveryPrefixLen)
	}
	if strings.ContainsAny(raw, "\x00\r\n\t \"") || strings.ContainsAny(raw, "?#@\\") {
		return "", fmt.Errorf("registry discovery prefix must be a host/path without credentials or URL punctuation")
	}
	if strings.Contains(raw, "://") {
		return "", fmt.Errorf("registry discovery prefix must omit the URL scheme")
	}
	if strings.HasPrefix(raw, "/") {
		return "", fmt.Errorf("registry discovery prefix must not start with /")
	}
	raw = strings.TrimRight(raw, "/")
	if raw == "" {
		return "", fmt.Errorf("registry discovery prefix is required")
	}

	parts := strings.Split(raw, "/")
	for index, part := range parts {
		if part == "" || part == "." || part == ".." {
			return "", fmt.Errorf("registry discovery prefix contains an unsafe path segment")
		}
		part = strings.ToLower(part)
		if index > 0 {
			if !registryDiscoveryNamePattern.MatchString(part) {
				return "", fmt.Errorf("registry discovery prefix contains an invalid path segment")
			}
			parts[index] = part
		}
	}
	if err := validateRegistryDiscoveryHost(parts[0]); err != nil {
		return "", err
	}
	parts[0] = strings.ToLower(parts[0])
	return strings.Join(parts, "/"), nil
}

func validateRegistryDiscoveryHost(host string) error {
	if host == "" {
		return fmt.Errorf("registry discovery prefix must include a host")
	}
	if strings.HasPrefix(host, "[") {
		closing := strings.IndexByte(host, ']')
		if closing < 0 {
			return fmt.Errorf("registry discovery prefix contains an invalid IPv6 host")
		}
		if net.ParseIP(host[1:closing]) == nil {
			return fmt.Errorf("registry discovery prefix contains an invalid IPv6 host")
		}
		if closing+1 < len(host) {
			if host[closing+1] != ':' || !validRegistryDiscoveryPort(host[closing+2:]) {
				return fmt.Errorf("registry discovery prefix contains an invalid port")
			}
		}
		return nil
	}

	hostname, port := host, ""
	if colon := strings.LastIndexByte(host, ':'); colon >= 0 {
		if strings.Contains(host[:colon], ":") {
			return fmt.Errorf("registry discovery prefix contains an invalid host")
		}
		hostname, port = host[:colon], host[colon+1:]
		if !validRegistryDiscoveryPort(port) {
			return fmt.Errorf("registry discovery prefix contains an invalid port")
		}
	}
	if hostname == "" || strings.Contains(hostname, "..") || !registryDiscoveryHostPattern.MatchString(hostname) {
		return fmt.Errorf("registry discovery prefix contains an invalid host")
	}
	if net.ParseIP(hostname) != nil {
		return nil
	}
	for _, label := range strings.Split(hostname, ".") {
		if label == "" || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return fmt.Errorf("registry discovery prefix contains an invalid host")
		}
	}
	return nil
}

func validRegistryDiscoveryPort(port string) bool {
	if !registryDiscoveryPortPattern.MatchString(port) {
		return false
	}
	value, err := strconv.Atoi(port)
	return err == nil && value > 0 && value <= 65535
}

// normalizeConfiguredRegistryPrefix accepts the URL form stored by the
// registry model and converts it to the same host/path representation used by
// manually entered prefixes.
func normalizeConfiguredRegistryPrefix(value string) (string, error) {
	raw := strings.TrimSpace(value)
	if strings.Contains(raw, "://") {
		parts := strings.SplitN(raw, "://", 2)
		if len(parts) != 2 || (strings.ToLower(parts[0]) != "http" && strings.ToLower(parts[0]) != "https") {
			return "", fmt.Errorf("configured registry URL must use http:// or https://")
		}
		raw = parts[1]
	}
	return NormalizeRegistryDiscoveryPrefix(raw)
}

// NormalizeConfiguredRegistryDiscoveryPrefix validates a configured registry
// URL and returns the host/path prefix used by repository discovery.
func NormalizeConfiguredRegistryDiscoveryPrefix(value string) (string, error) {
	return normalizeConfiguredRegistryPrefix(value)
}

// discoverRegistry scans bounded text/code files for concrete image refs
// addressed to prefix. It never follows symlinked files and skips common
// generated/dependency trees before reading file contents.
func discoverRegistry(root, prefix string) ([]DiscoveredImage, error) {
	normalizedPrefix, err := NormalizeRegistryDiscoveryPrefix(prefix)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(root) == "" {
		return nil, fmt.Errorf("repository root is required")
	}

	byRef := map[string]*DiscoveredImage{}
	seenLocations := map[string]map[string]bool{}
	var totalBytes int64
	err = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry == nil {
			return nil
		}
		if entry.IsDir() {
			if path != root && registryDiscoveryExcludedDirectory(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if totalBytes >= maxRegistryDiscoveryTotalBytes || entry.Type()&os.ModeSymlink != 0 || !entry.Type().IsRegular() {
			return nil
		}
		if !registryDiscoveryTextFile(entry.Name()) {
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			return infoErr
		}
		if info.Size() < 0 || info.Size() > maxRegistryDiscoveryFileBytes || info.Size() > maxRegistryDiscoveryTotalBytes-totalBytes {
			return nil
		}
		content, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		totalBytes += int64(len(content))
		if len(content) == 0 || bytes.IndexByte(content, 0) >= 0 || !utf8.Valid(content) {
			return nil
		}
		appendRegistryDiscoveryImages(root, path, content, normalizedPrefix, byRef, seenLocations)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return sortedDiscoveredImages(byRef), nil
}

// discoverRegistryImages is kept as a descriptive alias for callers/tests
// that use the method name rather than the shorter internal helper.
func discoverRegistryImages(root, prefix string) ([]DiscoveredImage, error) {
	return discoverRegistry(root, prefix)
}

func registryDiscoveryExcludedDirectory(name string) bool {
	_, ok := registryDiscoveryExcludedDirectories[strings.ToLower(strings.TrimSpace(name))]
	return ok
}

func registryDiscoveryTextFile(name string) bool {
	lower := strings.ToLower(name)
	if strings.Contains(lower, ".generated.") || strings.HasSuffix(lower, ".generated") ||
		strings.Contains(lower, "_generated.") || strings.Contains(lower, ".gen.") ||
		strings.HasSuffix(lower, "_gen.go") || strings.HasSuffix(lower, ".map") {
		return false
	}
	if lower == "dockerfile" || lower == "containerfile" || lower == "makefile" || lower == ".env" {
		return true
	}
	_, ok := registryDiscoveryTextExtensions[filepath.Ext(lower)]
	if ok {
		return true
	}
	// Extensionless executable/configuration files are often where image refs
	// live (for example, a checked-in deploy script). Binary detection still
	// runs after reading, so this does not admit binary payloads.
	return filepath.Ext(lower) == ""
}

func appendRegistryDiscoveryImages(root, path string, content []byte, prefix string, byRef map[string]*DiscoveredImage, seenLocations map[string]map[string]bool) {
	text := string(content)
	relative := relativePath(root, path)
	for _, bounds := range registryDiscoveryTokenPattern.FindAllStringIndex(text, -1) {
		start, end := bounds[0], bounds[1]
		token := text[start:end]
		if strings.Contains(token, "://") || (start >= 3 && text[start-3:start] == "://") {
			continue
		}
		if strings.HasSuffix(token, "/") || strings.HasSuffix(token, ":") || strings.HasSuffix(token, "@") {
			continue
		}
		if !registryDiscoveryRefMatchesPrefix(token, prefix) {
			continue
		}
		// A repository reference without an explicit selector would be
		// normalized by NormalizeHelmImageRef as an implicit :latest. Registry
		// discovery deliberately only reports concrete refs, so reject those
		// before normalization. The colon in a host:port prefix is not a tag:
		// only a colon after the last slash qualifies as an explicit tag.
		if !hasExplicitRegistryImageSelector(token) {
			continue
		}
		fullRef, imageName, imageTag := scanner.NormalizeHelmImageRef(token)
		if !validRegistryDiscoveryImage(fullRef, imageName, imageTag) {
			continue
		}
		line := 1 + strings.Count(text[:start], "\n")
		location := ImageLocation{File: relative, Document: 1, Kind: "Registry", Path: fmt.Sprintf("line %d", line)}
		locationKey := relative + "\x00" + location.Path
		item := byRef[fullRef]
		if item == nil {
			item = &DiscoveredImage{FullRef: fullRef, ImageName: imageName, ImageTag: imageTag}
			byRef[fullRef] = item
		}
		locations := seenLocations[fullRef]
		if locations == nil {
			locations = map[string]bool{}
			seenLocations[fullRef] = locations
		}
		if locations[locationKey] {
			continue
		}
		locations[locationKey] = true
		item.Locations = append(item.Locations, location)
	}
	for _, image := range byRef {
		sort.Slice(image.Locations, func(i, j int) bool {
			if image.Locations[i].File != image.Locations[j].File {
				return image.Locations[i].File < image.Locations[j].File
			}
			return image.Locations[i].Path < image.Locations[j].Path
		})
	}
}

func hasExplicitRegistryImageSelector(ref string) bool {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return false
	}
	if at := strings.LastIndexByte(ref, '@'); at >= 0 {
		return at > 0 && at < len(ref)-1
	}
	lastSlash := strings.LastIndexByte(ref, '/')
	lastColon := strings.LastIndexByte(ref, ':')
	return lastColon > lastSlash && lastColon < len(ref)-1
}

func registryDiscoveryRefMatchesPrefix(ref, prefix string) bool {
	ref = strings.ToLower(strings.Trim(strings.TrimSpace(ref), "/"))
	prefix = strings.ToLower(strings.Trim(strings.TrimSpace(prefix), "/"))
	if ref == "" || prefix == "" || ref == prefix {
		return ref == prefix && strings.Contains(ref, "/")
	}
	if !strings.HasPrefix(ref, prefix) {
		return false
	}
	remainder := ref[len(prefix):]
	return len(remainder) > 0 && (remainder[0] == '/' || remainder[0] == ':' || remainder[0] == '@')
}

func validRegistryDiscoveryImage(fullRef, imageName, imageTag string) bool {
	if fullRef == "" || imageName == "" || strings.ContainsAny(fullRef, "\r\n\t \"") || strings.Contains(fullRef, "://") {
		return false
	}
	if !hasExplicitRegistryImageSelector(fullRef) {
		return false
	}
	parts := strings.Split(imageName, "/")
	if len(parts) < 2 {
		return false
	}
	for index, part := range parts {
		if part == "" {
			return false
		}
		if index == 0 {
			if colon := strings.LastIndexByte(part, ':'); colon >= 0 {
				if strings.Contains(part[:colon], ":") || !validRegistryDiscoveryPort(part[colon+1:]) {
					return false
				}
				part = part[:colon]
			}
			if strings.HasPrefix(part, "[") {
				if strings.TrimSpace(part) == "" || !strings.HasSuffix(part, "]") || net.ParseIP(strings.Trim(part, "[]")) == nil {
					return false
				}
			} else if !registryDiscoveryHostPattern.MatchString(part) {
				return false
			}
			continue
		}
		if !registryDiscoveryNamePattern.MatchString(part) {
			return false
		}
	}
	if strings.Contains(imageTag, "/") || strings.HasSuffix(imageTag, ":") {
		return false
	}
	if strings.HasPrefix(imageTag, "sha256:") || strings.Contains(imageTag, ":") {
		return registryDiscoveryDigestPattern.MatchString(imageTag)
	}
	return registryDiscoveryTagPattern.MatchString(imageTag)
}
