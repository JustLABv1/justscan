package models

// VulnerabilityContextAnalysis is a UI-oriented wrapper around provider-specific
// contextual-analysis data.
type VulnerabilityContextAnalysis struct {
	Provider          string     `json:"provider"`
	Supported         bool       `json:"supported"`
	Available         bool       `json:"available"`
	Message           string     `json:"message,omitempty"`
	VulnerabilityID   string     `json:"vulnerability_id"`
	ComponentID       string     `json:"component_id,omitempty"`
	SourceComponentID string     `json:"source_component_id,omitempty"`
	ArtifactPath      string     `json:"artifact_path,omitempty"`
	Applicable        *bool      `json:"applicable,omitempty"`
	Summary           string     `json:"summary,omitempty"`
	Evidence          []string   `json:"evidence,omitempty"`
	DependencyPaths   []string   `json:"dependency_paths,omitempty"`
	Raw               JSONObject `json:"raw,omitempty"`
}
