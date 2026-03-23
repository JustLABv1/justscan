package docs

import (
	"fmt"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
)

func OpenAPISpec(routes []gin.RouteInfo) map[string]any {
	spec := map[string]any{
		"openapi": "3.0.3",
		"info": map[string]any{
			"title":       "JustScan API",
			"description": "OpenAPI document for JustScan. Route coverage is generated from the registered Gin router so new API endpoints appear in swagger without requiring manual path bookkeeping.",
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
						"delta_critical_count":    map[string]any{"type": "integer", "nullable": true},
						"high_count":              map[string]any{"type": "integer"},
						"delta_high_count":        map[string]any{"type": "integer", "nullable": true},
						"medium_count":            map[string]any{"type": "integer"},
						"delta_medium_count":      map[string]any{"type": "integer", "nullable": true},
						"low_count":               map[string]any{"type": "integer"},
						"previous_critical_count": map[string]any{"type": "integer", "nullable": true},
						"previous_high_count":     map[string]any{"type": "integer", "nullable": true},
						"freshness_hours":         map[string]any{"type": "integer"},
						"observed_at":             map[string]any{"type": "string", "format": "date-time"},
						"previous_scan_at":        map[string]any{"type": "string", "format": "date-time", "nullable": true},
						"error_message":           map[string]any{"type": "string", "nullable": true},
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

	paths := spec["paths"].(map[string]any)
	addRegisteredRoutes(paths, routes)

	return spec
}

func addRegisteredRoutes(paths map[string]any, routes []gin.RouteInfo) {
	routeList := append([]gin.RouteInfo(nil), routes...)
	sort.Slice(routeList, func(i, j int) bool {
		if routeList[i].Path == routeList[j].Path {
			return routeList[i].Method < routeList[j].Method
		}
		return routeList[i].Path < routeList[j].Path
	})

	for _, route := range routeList {
		if !strings.HasPrefix(route.Path, "/api/v1") {
			continue
		}

		normalizedPath := normalizePath(route.Path)
		if normalizedPath == "" {
			continue
		}

		pathItem, ok := paths[normalizedPath].(map[string]any)
		if !ok {
			pathItem = map[string]any{}
		}

		methodKey := strings.ToLower(route.Method)
		if _, exists := pathItem[methodKey]; exists {
			paths[normalizedPath] = pathItem
			continue
		}

		operation := map[string]any{
			"summary":     defaultSummary(route.Method, normalizedPath),
			"operationId": defaultOperationID(route.Method, normalizedPath),
			"tags":        []string{defaultTag(normalizedPath)},
			"responses": map[string]any{
				defaultSuccessStatus(route.Method): map[string]any{
					"description": defaultSuccessDescription(route.Method),
				},
				"400": map[string]any{"description": "Invalid request"},
			},
		}

		if parameters := pathParameters(route.Path); len(parameters) > 0 {
			operation["parameters"] = parameters
		}

		if methodAllowsBody(route.Method) {
			operation["requestBody"] = map[string]any{
				"required": route.Method == "POST",
				"content": map[string]any{
					"application/json": map[string]any{
						"schema": map[string]any{
							"type":                 "object",
							"additionalProperties": true,
						},
					},
				},
			}
		}

		if routeRequiresAuth(normalizedPath) {
			operation["security"] = []map[string][]string{{"bearerAuth": {}}}
			operation["responses"].(map[string]any)["401"] = map[string]any{"description": "Authentication required"}
		}

		if strings.HasPrefix(normalizedPath, "/admin/") {
			operation["x-justscan-access"] = "admin"
		} else if strings.HasPrefix(normalizedPath, "/public/") || strings.HasPrefix(normalizedPath, "/shared/") || strings.HasPrefix(normalizedPath, "/auth/") {
			operation["x-justscan-access"] = "public"
		}

		pathItem[methodKey] = operation
		paths[normalizedPath] = pathItem
	}
}

func normalizePath(path string) string {
	trimmed := strings.TrimPrefix(path, "/api/v1")
	if trimmed == "" {
		return "/"
	}
	if len(trimmed) > 1 {
		trimmed = strings.TrimSuffix(trimmed, "/")
	}

	segments := strings.Split(trimmed, "/")
	normalized := make([]string, 0, len(segments))
	for _, segment := range segments {
		if segment == "" {
			continue
		}
		if strings.HasPrefix(segment, ":") || strings.HasPrefix(segment, "*") {
			normalized = append(normalized, "{"+segment[1:]+"}")
			continue
		}
		normalized = append(normalized, segment)
	}

	if len(normalized) == 0 {
		return "/"
	}

	return "/" + strings.Join(normalized, "/")
}

func pathParameters(path string) []map[string]any {
	trimmed := strings.TrimPrefix(path, "/api/v1")
	segments := strings.Split(trimmed, "/")
	parameters := make([]map[string]any, 0)

	for _, segment := range segments {
		if segment == "" || (!strings.HasPrefix(segment, ":") && !strings.HasPrefix(segment, "*")) {
			continue
		}
		parameters = append(parameters, map[string]any{
			"name":     segment[1:],
			"in":       "path",
			"required": true,
			"schema":   map[string]any{"type": "string"},
		})
	}

	return parameters
}

func routeRequiresAuth(path string) bool {
	publicPrefixes := []string{"/auth/", "/token/", "/public/", "/shared/", "/status-pages/slug/", "/swagger/"}
	for _, prefix := range publicPrefixes {
		if strings.HasPrefix(path, prefix) {
			return false
		}
	}
	return path != "/health"
}

func methodAllowsBody(method string) bool {
	switch method {
	case "POST", "PUT", "PATCH":
		return true
	default:
		return false
	}
}

func defaultTag(path string) string {
	trimmed := strings.Trim(path, "/")
	if trimmed == "" {
		return "root"
	}
	return strings.Split(trimmed, "/")[0]
}

func defaultSummary(method string, path string) string {
	action := map[string]string{
		"GET":    "Fetch",
		"POST":   "Create or execute",
		"PUT":    "Replace or update",
		"PATCH":  "Update",
		"DELETE": "Delete",
	}[method]

	trimmed := strings.Trim(path, "/")
	if trimmed == "" {
		return action + " API root"
	}

	return fmt.Sprintf("%s %s", action, strings.ReplaceAll(trimmed, "/", " "))
}

func defaultOperationID(method string, path string) string {
	replacer := strings.NewReplacer("/", "_", "{", "", "}", "", "-", "_", ".", "_")
	trimmed := strings.Trim(replacer.Replace(strings.Trim(path, "/")), "_")
	if trimmed == "" {
		trimmed = "root"
	}
	return strings.ToLower(method) + "_" + trimmed
}

func defaultSuccessStatus(method string) string {
	switch method {
	case "POST":
		return "201"
	default:
		return "200"
	}
}

func defaultSuccessDescription(method string) string {
	switch method {
	case "GET":
		return "Request completed successfully"
	case "POST":
		return "Resource created or action queued successfully"
	case "PUT", "PATCH":
		return "Resource updated successfully"
	case "DELETE":
		return "Resource deleted successfully"
	default:
		return "Request completed successfully"
	}
}
