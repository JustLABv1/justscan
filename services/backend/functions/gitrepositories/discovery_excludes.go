package gitrepositories

import (
	"fmt"
	"path"
	"path/filepath"
	"strings"
)

const (
	maxDiscoveryExcludePatterns = 256
	maxDiscoveryExcludeLength   = 512
)

// NormalizeDiscoveryExcludes validates and canonicalizes repository-relative
// discovery exclusion globs. Paths are persisted with slash separators so the
// same configuration behaves consistently on every worker platform.
func NormalizeDiscoveryExcludes(patterns []string) ([]string, error) {
	if len(patterns) > maxDiscoveryExcludePatterns {
		return nil, fmt.Errorf("discovery_excludes must contain at most %d patterns", maxDiscoveryExcludePatterns)
	}

	result := make([]string, 0, len(patterns))
	seen := make(map[string]struct{}, len(patterns))
	for _, raw := range patterns {
		pattern, err := normalizeDiscoveryExclude(raw)
		if err != nil {
			return nil, err
		}
		if _, ok := seen[pattern]; ok {
			continue
		}
		seen[pattern] = struct{}{}
		result = append(result, pattern)
	}
	return result, nil
}

// ValidateDiscoveryExcludes is the validation-only form used by callers that
// do not need the canonicalized values.
func ValidateDiscoveryExcludes(patterns []string) error {
	_, err := NormalizeDiscoveryExcludes(patterns)
	return err
}

func normalizeDiscoveryExclude(raw string) (string, error) {
	pattern := strings.TrimSpace(raw)
	if pattern == "" {
		return "", fmt.Errorf("discovery exclusion patterns must not be empty")
	}
	if len(pattern) > maxDiscoveryExcludeLength {
		return "", fmt.Errorf("discovery exclusion pattern must be at most %d characters", maxDiscoveryExcludeLength)
	}
	if strings.ContainsAny(pattern, "\x00\r\n\t\\") {
		return "", fmt.Errorf("discovery exclusion pattern %q contains unsafe control or path separator characters", raw)
	}
	if filepath.IsAbs(pattern) || strings.HasPrefix(pattern, "/") || hasWindowsVolume(pattern) {
		return "", fmt.Errorf("discovery exclusion pattern %q must be a relative repository path", raw)
	}

	// A trailing slash has no useful distinction for a repository path. Accept
	// it for ergonomic input, but do not allow it to create an empty segment.
	pattern = strings.TrimRight(pattern, "/")
	if pattern == "" {
		return "", fmt.Errorf("discovery exclusion pattern %q must name a relative path", raw)
	}
	segments := strings.Split(pattern, "/")
	for _, segment := range segments {
		if segment == "" || segment == "." || segment == ".." {
			return "", fmt.Errorf("discovery exclusion pattern %q contains an unsafe path segment", raw)
		}
		if _, err := path.Match(segment, "discovery-exclude-check"); err != nil {
			return "", fmt.Errorf("discovery exclusion pattern %q is not a valid glob: %w", raw, err)
		}
	}
	return strings.Join(segments, "/"), nil
}

func hasWindowsVolume(value string) bool {
	return len(value) >= 2 && ((value[0] >= 'a' && value[0] <= 'z') || (value[0] >= 'A' && value[0] <= 'Z')) && value[1] == ':'
}

type discoveryExcludeGlob struct {
	segments []string
}

// discoveryPathMatcher owns the repository root used to turn absolute walker
// paths into repository-relative paths. A matched directory is considered
// excluded for all of its descendants, allowing walkers to prune it before
// reading any files.
type discoveryPathMatcher struct {
	root     string
	patterns []discoveryExcludeGlob
}

func newDiscoveryPathMatcher(root string, patterns []string) (discoveryPathMatcher, error) {
	normalized, err := NormalizeDiscoveryExcludes(patterns)
	if err != nil {
		return discoveryPathMatcher{}, err
	}
	matcher := discoveryPathMatcher{root: filepath.Clean(root), patterns: make([]discoveryExcludeGlob, 0, len(normalized))}
	for _, pattern := range normalized {
		matcher.patterns = append(matcher.patterns, discoveryExcludeGlob{segments: strings.Split(pattern, "/")})
	}
	return matcher, nil
}

func emptyDiscoveryPathMatcher(root string) discoveryPathMatcher {
	return discoveryPathMatcher{root: filepath.Clean(root)}
}

func (matcher discoveryPathMatcher) relative(pathname string) (string, bool) {
	if matcher.root != "" && filepath.IsAbs(pathname) {
		relative, err := filepath.Rel(matcher.root, pathname)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return "", false
		}
		if relative == "." {
			return "", true
		}
		return filepath.ToSlash(relative), true
	}
	relative := filepath.ToSlash(filepath.Clean(pathname))
	if relative == "." {
		return "", true
	}
	if strings.HasPrefix(relative, "../") || relative == ".." || strings.HasPrefix(relative, "/") {
		return "", false
	}
	return relative, true
}

// Excluded reports whether pathname itself, or an excluded directory ancestor,
// matches one of the configured patterns. The empty relative path is the
// repository root and is intentionally never excluded so a pattern such as
// ** prunes all children without preventing the walker from starting.
func (matcher discoveryPathMatcher) Excluded(pathname string) bool {
	if len(matcher.patterns) == 0 {
		return false
	}
	relative, ok := matcher.relative(pathname)
	if !ok || relative == "" {
		return false
	}
	segments := strings.Split(relative, "/")
	for length := len(segments); length > 0; length-- {
		candidate := segments[:length]
		for _, pattern := range matcher.patterns {
			if matchDiscoveryGlob(pattern.segments, candidate) {
				return true
			}
		}
	}
	return false
}

func matchDiscoveryGlob(pattern, value []string) bool {
	state := make(map[[2]int]bool)
	known := make(map[[2]int]bool)
	var match func(int, int) bool
	match = func(patternIndex, valueIndex int) bool {
		key := [2]int{patternIndex, valueIndex}
		if known[key] {
			return state[key]
		}
		known[key] = true
		matched := false
		switch {
		case patternIndex == len(pattern):
			matched = valueIndex == len(value)
		case pattern[patternIndex] == "**":
			// ** consumes zero or more complete path segments. This makes
			// .archive/** match .archive itself and every descendant.
			for index := valueIndex; index <= len(value); index++ {
				if match(patternIndex+1, index) {
					matched = true
					break
				}
			}
		case valueIndex < len(value):
			matched, _ = path.Match(pattern[patternIndex], value[valueIndex])
			if matched {
				matched = match(patternIndex+1, valueIndex+1)
			}
		}
		state[key] = matched
		return matched
	}
	return match(0, 0)
}
