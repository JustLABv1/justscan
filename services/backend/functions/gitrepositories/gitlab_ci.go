package gitrepositories

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"justscan-backend/scanner"

	"sigs.k8s.io/yaml"
)

const (
	gitLabCIFileName        = ".gitlab-ci.yml"
	gitLabCIAltFileName     = ".gitlab-ci.yaml"
	gitLabCIMaxIncludeDepth = 16
)

var (
	gitLabCIVariablePattern  = regexp.MustCompile(`\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))`)
	gitLabCIDocumentBoundary = regexp.MustCompile(`(?m)^---[ \t]*(?:#.*)?\r?$`)
)

// discoverGitLabCI extracts concrete container image references from one or
// more GitLab CI configuration files. If paths is empty, the conventional
// root .gitlab-ci.yml/.gitlab-ci.yaml files are used. Explicit paths may be
// files, directories, or filepath globs; all paths are resolved below root.
func discoverGitLabCI(root string, paths []string) ([]DiscoveredImage, error) {
	files, err := gitLabCIConfigFiles(root, paths)
	if err != nil {
		return nil, err
	}
	byRef := map[string]*DiscoveredImage{}
	visited := map[string]bool{}
	for _, file := range files {
		if err := appendGitLabCIFile(root, file, byRef, visited, 0); err != nil {
			return nil, err
		}
	}
	return sortedDiscoveredImages(byRef), nil
}

func gitLabCIConfigFiles(root string, paths []string) ([]string, error) {
	if len(paths) == 0 {
		paths = []string{gitLabCIFileName, gitLabCIAltFileName}
	}
	files := make([]string, 0, len(paths))
	seen := map[string]bool{}
	for _, raw := range paths {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		matches, err := gitLabCIPathMatches(root, raw)
		if err != nil {
			return nil, err
		}
		for _, match := range matches {
			match = filepath.Clean(match)
			if !seen[match] {
				seen[match] = true
				files = append(files, match)
			}
		}
	}
	sort.Strings(files)
	return files, nil
}

func gitLabCIPathMatches(root, raw string) ([]string, error) {
	if !hasGitLabCIGlob(raw) {
		path, err := resolveRepositoryPath(root, raw)
		if err != nil {
			return nil, err
		}
		info, err := os.Stat(path)
		if os.IsNotExist(err) && (raw == gitLabCIFileName || raw == gitLabCIAltFileName) {
			// A repository may use either spelling. Missing conventional files
			// are therefore an empty discovery result, not a failed scan.
			return nil, nil
		}
		if err != nil {
			return nil, fmt.Errorf("stat GitLab CI config %q: %w", raw, err)
		}
		if info.IsDir() {
			return gitLabCIWalkFiles(root, path)
		}
		return []string{path}, nil
	}

	clean := filepath.Clean(raw)
	if filepath.IsAbs(raw) || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || clean == ".." {
		return nil, fmt.Errorf("GitLab CI config path %q is outside the repository", raw)
	}
	matches, err := filepath.Glob(filepath.Join(root, clean))
	if err != nil {
		return nil, fmt.Errorf("invalid GitLab CI config pattern %q: %w", raw, err)
	}
	result := make([]string, 0, len(matches))
	for _, match := range matches {
		if !pathWithin(root, match) {
			return nil, fmt.Errorf("GitLab CI config path %q is outside the repository", raw)
		}
		info, statErr := os.Stat(match)
		if statErr != nil {
			return nil, fmt.Errorf("stat GitLab CI config %q: %w", raw, statErr)
		}
		if info.IsDir() {
			walked, walkErr := gitLabCIWalkFiles(root, match)
			if walkErr != nil {
				return nil, walkErr
			}
			result = append(result, walked...)
		} else if isYAMLFile(match) {
			result = append(result, match)
		}
	}
	sort.Strings(result)
	return result, nil
}

func gitLabCIWalkFiles(root, directory string) ([]string, error) {
	files := []string{}
	err := filepath.WalkDir(directory, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if entry.Name() == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		if isYAMLFile(path) {
			files = append(files, filepath.Clean(path))
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("walk GitLab CI config directory %q: %w", relativePath(root, directory), err)
	}
	sort.Strings(files)
	return files, nil
}

func appendGitLabCIFile(root, file string, byRef map[string]*DiscoveredImage, visited map[string]bool, depth int) error {
	file = filepath.Clean(file)
	if visited[file] {
		return nil
	}
	if depth > gitLabCIMaxIncludeDepth {
		return fmt.Errorf("GitLab CI config include depth exceeds %d", gitLabCIMaxIncludeDepth)
	}
	visited[file] = true
	info, err := os.Stat(file)
	if err != nil {
		return fmt.Errorf("stat GitLab CI config %q: %w", relativePath(root, file), err)
	}
	if info.IsDir() {
		return fmt.Errorf("GitLab CI config %q is a directory", relativePath(root, file))
	}
	if info.Size() > maxManifestBytes {
		return fmt.Errorf("GitLab CI config %q exceeds %d bytes", relativePath(root, file), maxManifestBytes)
	}
	content, err := os.ReadFile(file)
	if err != nil {
		return fmt.Errorf("read GitLab CI config %q: %w", relativePath(root, file), err)
	}

	var globalVariables map[string]string
	for document, raw := range gitLabCIDocuments(content) {
		var configuration map[string]any
		if err := yaml.Unmarshal(raw, &configuration); err != nil {
			return fmt.Errorf("parse GitLab CI config %q: %w", relativePath(root, file), err)
		}
		if configuration == nil {
			continue
		}
		variables := gitLabCIStringVariables(configuration["variables"])
		if len(variables) > 0 {
			if globalVariables == nil {
				globalVariables = map[string]string{}
			}
			for key, value := range variables {
				globalVariables[key] = value
			}
		}
		appendGitLabCIImageValue(root, byRef, configuration["image"], file, document, "", "image", globalVariables)

		if defaultConfig, ok := configuration["default"].(map[string]any); ok {
			appendGitLabCIImageValue(root, byRef, defaultConfig["image"], file, document, "default", "default.image", globalVariables)
			appendGitLabCIServices(root, byRef, defaultConfig["services"], file, document, "default", "default.services", globalVariables)
		}
		appendGitLabCIServices(root, byRef, configuration["services"], file, document, "", "services", globalVariables)

		for key, value := range configuration {
			if gitLabCIReservedKey(key) {
				continue
			}
			job, ok := value.(map[string]any)
			if !ok {
				continue
			}
			jobVariables := cloneGitLabCIVariables(globalVariables)
			for variable, variableValue := range gitLabCIStringVariables(job["variables"]) {
				jobVariables[variable] = variableValue
			}
			appendGitLabCIImageValue(root, byRef, job["image"], file, document, key, key+".image", jobVariables)
			appendGitLabCIServices(root, byRef, job["services"], file, document, key, key+".services", jobVariables)
		}

		for _, include := range gitLabCILocalIncludes(configuration["include"]) {
			includePath, includeErr := resolveGitLabCILocalInclude(root, file, include)
			if includeErr != nil {
				return includeErr
			}
			if includePath == "" {
				continue
			}
			if err := appendGitLabCIFile(root, includePath, byRef, visited, depth+1); err != nil {
				return err
			}
		}
	}
	return nil
}

func gitLabCIDocuments(content []byte) [][]byte {
	// GitLab's optional `spec` header uses YAML's document separator. Parsing
	// each document keeps image declarations in the actual pipeline document
	// discoverable while remaining tolerant of ordinary single-document files.
	parts := gitLabCIDocumentBoundary.Split(string(content), -1)
	result := make([][]byte, 0, len(parts))
	for _, part := range parts {
		if strings.TrimSpace(part) != "" {
			result = append(result, []byte(part))
		}
	}
	if len(result) == 0 {
		return [][]byte{content}
	}
	return result
}

func appendGitLabCIImageValue(root string, byRef map[string]*DiscoveredImage, value any, file string, document int, job, path string, variables map[string]string) {
	image := gitLabCIImageName(value)
	if image == "" {
		return
	}
	image = expandGitLabCIValue(image, variables)
	if !isConcreteGitLabCIImage(image) {
		return
	}
	fullRef, imageName, imageTag := scanner.NormalizeHelmImageRef(image)
	if fullRef == "" || imageName == "" {
		return
	}
	item := byRef[fullRef]
	if item == nil {
		item = &DiscoveredImage{FullRef: fullRef, ImageName: imageName, ImageTag: imageTag}
		byRef[fullRef] = item
	}
	item.Locations = append(item.Locations, ImageLocation{
		File: relativePath(root, file), Document: document + 1, Kind: "GitLabCI", Name: job, Path: path,
	})
}

func appendGitLabCIServices(root string, byRef map[string]*DiscoveredImage, value any, file string, document int, job, path string, variables map[string]string) {
	items, ok := value.([]any)
	if !ok {
		return
	}
	for index, item := range items {
		servicePath := fmt.Sprintf("%s[%d]", path, index)
		appendGitLabCIImageValue(root, byRef, item, file, document, job, servicePath, variables)
	}
}

func gitLabCIImageName(value any) string {
	switch image := value.(type) {
	case string:
		return strings.TrimSpace(image)
	case map[string]any:
		name, _ := image["name"].(string)
		return strings.TrimSpace(name)
	default:
		return ""
	}
}

func gitLabCIStringVariables(value any) map[string]string {
	variables := map[string]string{}
	items, ok := value.(map[string]any)
	if !ok {
		return variables
	}
	for key, value := range items {
		switch typed := value.(type) {
		case string:
			variables[key] = typed
		case fmt.Stringer:
			variables[key] = typed.String()
		case int, int64, float64, bool:
			variables[key] = fmt.Sprint(typed)
		}
	}
	return variables
}

func cloneGitLabCIVariables(source map[string]string) map[string]string {
	result := map[string]string{}
	for key, value := range source {
		result[key] = value
	}
	return result
}

func expandGitLabCIValue(value string, variables map[string]string) string {
	result := strings.TrimSpace(value)
	for iteration := 0; iteration < 8; iteration++ {
		changed := false
		result = gitLabCIVariablePattern.ReplaceAllStringFunc(result, func(match string) string {
			parts := gitLabCIVariablePattern.FindStringSubmatch(match)
			name := parts[1]
			if name == "" {
				name = parts[2]
			}
			replacement, ok := variables[name]
			if !ok {
				return match
			}
			changed = true
			return replacement
		})
		if !changed {
			break
		}
	}
	return strings.TrimSpace(result)
}

func isConcreteGitLabCIImage(value string) bool {
	if value == "" || strings.ContainsAny(value, " \t\r\n") {
		return false
	}
	if gitLabCIVariablePattern.MatchString(value) || strings.ContainsAny(value, "*?") {
		return false
	}
	// GitLab permits image names with a digest and tags, but not arbitrary URL
	// schemes. Keeping this check narrow avoids treating include URLs or script
	// values as image declarations if the config shape changes.
	return !strings.Contains(value, "://")
}

func gitLabCIReservedKey(key string) bool {
	switch key {
	case "default", "include", "stages", "variables", "workflow", "image", "services", "before_script", "after_script", "cache", "pages", "schedules", "spec":
		return true
	default:
		// Dot-prefixed entries are hidden jobs/templates in GitLab CI. They can
		// still declare image or services and must be inspected like any other
		// job; do not treat their names as reserved YAML keys.
		return false
	}
}

func gitLabCILocalIncludes(value any) []string {
	result := []string{}
	switch include := value.(type) {
	case string:
		result = append(result, include)
	case []any:
		for _, item := range include {
			result = append(result, gitLabCILocalIncludes(item)...)
		}
	case map[string]any:
		if local, ok := include["local"].(string); ok {
			result = append(result, local)
		}
	}
	return result
}

func resolveGitLabCILocalInclude(root, includingFile, include string) (string, error) {
	include = strings.TrimSpace(include)
	if include == "" || strings.HasPrefix(include, "http://") || strings.HasPrefix(include, "https://") {
		return "", nil
	}
	include = strings.TrimPrefix(include, "/")
	path, err := resolveRepositoryPath(root, include)
	if err != nil {
		return "", fmt.Errorf("resolve GitLab CI local include %q: %w", include, err)
	}
	if _, err := os.Stat(path); err == nil {
		return path, nil
	} else if !os.IsNotExist(err) {
		return "", fmt.Errorf("stat GitLab CI local include %q: %w", include, err)
	}
	// A relative fallback is useful for hand-authored nested configs while the
	// root-relative path remains the GitLab-defined interpretation.
	nested := filepath.Join(filepath.Dir(includingFile), include)
	if pathWithin(root, nested) {
		if _, err := os.Stat(nested); err == nil {
			return filepath.Clean(nested), nil
		}
	}
	return "", fmt.Errorf("GitLab CI local include %q not found", include)
}

func hasGitLabCIGlob(value string) bool {
	return strings.ContainsAny(value, "*?[")
}

func isYAMLFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".yaml" || ext == ".yml"
}
