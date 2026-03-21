package docs

func OpenAPISpec() map[string]any {
	return map[string]any{
		"openapi": "3.0.3",
		"info": map[string]any{
			"title":       "JustScan API",
			"description": "Initial OpenAPI document for JustScan. This foundation currently covers health checks and the new status page APIs and will be expanded to the rest of /api/v1.",
			"version":     "0.8.0",
		},
		"servers": []map[string]any{{
			"url": "/api/v1",
		}},
		"components": map[string]any{
			"securitySchemes": map[string]any{
				"bearerAuth": map[string]any{
					"type":         "http",
					"scheme":       "bearer",
					"bearerFormat": "JWT",
				},
			},
			"schemas": map[string]any{
				"HealthResponse": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"status": map[string]any{"type": "string", "example": "ok"},
					},
				},
				"ErrorResponse": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"error": map[string]any{"type": "string"},
					},
				},
				"StatusPage": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"id":                map[string]any{"type": "string", "format": "uuid"},
						"name":              map[string]any{"type": "string"},
						"slug":              map[string]any{"type": "string"},
						"description":       map[string]any{"type": "string"},
						"visibility":        map[string]any{"type": "string", "enum": []string{"private", "public", "authenticated"}},
						"include_all_tags":  map[string]any{"type": "boolean"},
						"stale_after_hours": map[string]any{"type": "integer", "example": 72},
						"owner_user_id":     map[string]any{"type": "string", "format": "uuid"},
						"created_at":        map[string]any{"type": "string", "format": "date-time"},
						"updated_at":        map[string]any{"type": "string", "format": "date-time"},
					},
				},
				"StatusPageTarget": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"id":            map[string]any{"type": "string", "format": "uuid"},
						"image_name":    map[string]any{"type": "string"},
						"image_tag":     map[string]any{"type": "string"},
						"display_order": map[string]any{"type": "integer"},
					},
				},
				"StatusPageUpdate": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"id":           map[string]any{"type": "string", "format": "uuid"},
						"title":        map[string]any{"type": "string"},
						"body":         map[string]any{"type": "string"},
						"level":        map[string]any{"type": "string", "enum": []string{"info", "maintenance", "incident"}},
						"active_from":  map[string]any{"type": "string", "format": "date-time", "nullable": true},
						"active_until": map[string]any{"type": "string", "format": "date-time", "nullable": true},
					},
				},
				"StatusPageItem": map[string]any{
					"type": "object",
					"properties": map[string]any{
						"image_name":              map[string]any{"type": "string"},
						"image_tag":               map[string]any{"type": "string"},
						"latest_scan_id":          map[string]any{"type": "string", "format": "uuid"},
						"scan_status":             map[string]any{"type": "string"},
						"status":                  map[string]any{"type": "string"},
						"critical_count":          map[string]any{"type": "integer"},
						"high_count":              map[string]any{"type": "integer"},
						"medium_count":            map[string]any{"type": "integer"},
						"low_count":               map[string]any{"type": "integer"},
						"previous_critical_count": map[string]any{"type": "integer", "nullable": true},
						"previous_high_count":     map[string]any{"type": "integer", "nullable": true},
						"freshness_hours":         map[string]any{"type": "integer"},
						"observed_at":             map[string]any{"type": "string", "format": "date-time"},
						"previous_scan_at":        map[string]any{"type": "string", "format": "date-time", "nullable": true},
					},
				},
			},
		},
		"paths": map[string]any{
			"/health": map[string]any{
				"get": map[string]any{
					"summary":     "Health check",
					"operationId": "healthCheck",
					"responses": map[string]any{
						"200": map[string]any{
							"description": "Service is healthy",
							"content": map[string]any{
								"application/json": map[string]any{
									"schema": map[string]any{"$ref": "#/components/schemas/HealthResponse"},
								},
							},
						},
					},
				},
			},
			"/status-pages": map[string]any{
				"get": map[string]any{
					"summary":     "List status pages",
					"operationId": "listStatusPages",
					"security":    []map[string][]string{{"bearerAuth": {}}},
					"responses": map[string]any{
						"200": map[string]any{
							"description": "Owned or admin-visible status pages",
						},
					},
				},
				"post": map[string]any{
					"summary":     "Create status page",
					"operationId": "createStatusPage",
					"security":    []map[string][]string{{"bearerAuth": {}}},
					"responses": map[string]any{
						"201": map[string]any{"description": "Status page created"},
						"400": map[string]any{"description": "Invalid request"},
					},
				},
			},
			"/status-pages/{id}": map[string]any{
				"get": map[string]any{
					"summary":     "Get managed status page",
					"operationId": "getStatusPage",
					"security":    []map[string][]string{{"bearerAuth": {}}},
					"parameters": []map[string]any{{
						"name":     "id",
						"in":       "path",
						"required": true,
						"schema":   map[string]any{"type": "string", "format": "uuid"},
					}},
					"responses": map[string]any{
						"200": map[string]any{"description": "Managed status page with items"},
						"404": map[string]any{"description": "Status page not found"},
					},
				},
				"put": map[string]any{
					"summary":     "Update managed status page",
					"operationId": "updateStatusPage",
					"security":    []map[string][]string{{"bearerAuth": {}}},
					"parameters": []map[string]any{{
						"name":     "id",
						"in":       "path",
						"required": true,
						"schema":   map[string]any{"type": "string", "format": "uuid"},
					}},
					"responses": map[string]any{
						"200": map[string]any{"description": "Status page updated"},
					},
				},
				"delete": map[string]any{
					"summary":     "Delete managed status page",
					"operationId": "deleteStatusPage",
					"security":    []map[string][]string{{"bearerAuth": {}}},
					"parameters": []map[string]any{{
						"name":     "id",
						"in":       "path",
						"required": true,
						"schema":   map[string]any{"type": "string", "format": "uuid"},
					}},
					"responses": map[string]any{
						"200": map[string]any{"description": "Status page deleted"},
					},
				},
			},
			"/status-pages/slug/{slug}": map[string]any{
				"get": map[string]any{
					"summary":     "View status page by slug",
					"operationId": "viewStatusPageBySlug",
					"parameters": []map[string]any{{
						"name":     "slug",
						"in":       "path",
						"required": true,
						"schema":   map[string]any{"type": "string"},
					}},
					"responses": map[string]any{
						"200": map[string]any{"description": "Viewer payload with computed items"},
						"401": map[string]any{"description": "Authentication required for authenticated/private pages"},
						"404": map[string]any{"description": "Status page not found"},
					},
				},
			},
		},
	}
}
