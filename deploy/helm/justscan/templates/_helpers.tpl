{{/*
Expand the name of the chart.
*/}}
{{- define "justscan.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "justscan.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart label.
*/}}
{{- define "justscan.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "justscan.labels" -}}
helm.sh/chart: {{ include "justscan.chart" . }}
{{ include "justscan.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "justscan.selectorLabels" -}}
app.kubernetes.io/name: {{ include "justscan.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Service account name.
*/}}
{{- define "justscan.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "justscan.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Resolved backend image tag.
Defaults to backend-<Chart.appVersion> when not overridden.
*/}}
{{- define "justscan.backend.imageTag" -}}
{{- if .Values.backend.image.tag }}
{{- .Values.backend.image.tag }}
{{- else }}
{{- printf "backend-%s" .Chart.AppVersion }}
{{- end }}
{{- end }}

{{/*
Resolved frontend image tag.
Defaults to frontend-<Chart.appVersion> when not overridden.
*/}}
{{- define "justscan.frontend.imageTag" -}}
{{- if .Values.frontend.image.tag }}
{{- .Values.frontend.image.tag }}
{{- else }}
{{- printf "frontend-%s" .Chart.AppVersion }}
{{- end }}
{{- end }}

{{/*
Name of the Secret that holds JustScan backend secrets.
Returns the existingSecret name when set, otherwise the generated name.
*/}}
{{- define "justscan.backend.secretName" -}}
{{- if .Values.backend.secrets.existingSecret }}
{{- .Values.backend.secrets.existingSecret }}
{{- else }}
{{- printf "%s-secrets" (include "justscan.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Name of the Secret for a single backend secret field.
Usage: include "justscan.backend.secretRefName" (list . "jwtSecret")
An empty per-field name falls back to existingSecret, then to the generated Secret.
*/}}
{{- define "justscan.backend.secretRefName" -}}
{{- $root := index . 0 -}}
{{- $field := index . 1 -}}
{{- $refs := default dict $root.Values.backend.secrets.existingSecretRefs -}}
{{- $ref := default dict (index $refs $field) -}}
{{- if $ref.name -}}
{{- $ref.name -}}
{{- else -}}
{{- include "justscan.backend.secretName" $root -}}
{{- end -}}
{{- end }}

{{/*
Key in the Secret for a single backend secret field.
Usage: include "justscan.backend.secretRefKey" (list . "jwtSecret" "jwt-secret")
existingSecretRefs is the primary key mapping. existingSecretKeys remains a
backwards-compatible fallback for older values files.
*/}}
{{- define "justscan.backend.secretRefKey" -}}
{{- $root := index . 0 -}}
{{- $field := index . 1 -}}
{{- $defaultKey := index . 2 -}}
{{- $refs := default dict $root.Values.backend.secrets.existingSecretRefs -}}
{{- $ref := default dict (index $refs $field) -}}
{{- if $ref.key -}}
{{- $ref.key -}}
{{- else if and $root.Values.backend.secrets.existingSecret (hasKey $root.Values.backend.secrets "existingSecretKeys") -}}
{{- index $root.Values.backend.secrets.existingSecretKeys $field -}}
{{- else -}}
{{- $defaultKey -}}
{{- end -}}
{{- end }}

{{/*
PersistentVolumeClaim name for backend cache/data.
*/}}
{{- define "justscan.backend.persistence.claimName" -}}
{{- if .Values.backend.persistence.existingClaim }}
{{- .Values.backend.persistence.existingClaim }}
{{- else }}
{{- printf "%s-backend-data" (include "justscan.fullname" .) }}
{{- end }}
{{- end }}

{{/*
PostgreSQL host.
When the bundled postgresql subchart is enabled, return its service name.
Otherwise return the value configured in backend.config.database.server.
*/}}
{{- define "justscan.postgresql.host" -}}
{{- if .Values.postgresql.enabled }}
{{- printf "%s-postgresql" .Release.Name }}
{{- else }}
{{- .Values.backend.config.database.server }}
{{- end }}
{{- end }}

{{/*
PostgreSQL database name.
When the bundled postgresql subchart is enabled, return postgresql.auth.database.
Otherwise return the value configured in backend.config.database.name.
*/}}
{{- define "justscan.postgresql.database" -}}
{{- if .Values.postgresql.enabled }}
{{- .Values.postgresql.auth.database }}
{{- else }}
{{- .Values.backend.config.database.name }}
{{- end }}
{{- end }}

{{/*
PostgreSQL username.
When the bundled postgresql subchart is enabled, return postgresql.auth.username.
Otherwise return the value configured in backend.config.database.user.
*/}}
{{- define "justscan.postgresql.user" -}}
{{- if .Values.postgresql.enabled }}
{{- .Values.postgresql.auth.username }}
{{- else }}
{{- .Values.backend.config.database.user }}
{{- end }}
{{- end }}

{{/*
PostgreSQL password secret name.
When postgresql.enabled=true we read from the Bitnami subchart secret.
When an external DB secret ref or existingSecret is set for the backend we read from there.
Otherwise we read from the generated JustScan secret.
*/}}
{{- define "justscan.dbPassword.secretName" -}}
{{- if .Values.postgresql.enabled }}
{{- if .Values.postgresql.auth.existingSecret }}
{{- .Values.postgresql.auth.existingSecret }}
{{- else }}
{{- printf "%s-postgresql" .Release.Name }}
{{- end }}
{{- else }}
{{- include "justscan.backend.secretRefName" (list . "dbPassword") }}
{{- end }}
{{- end }}

{{- define "justscan.dbPassword.secretKey" -}}
{{- if .Values.postgresql.enabled }}
{{- "password" }}
{{- else }}
{{- include "justscan.backend.secretRefKey" (list . "dbPassword" "db-password") }}
{{- end }}
{{- end }}

{{/*
Frontend API URL.
When frontend.config.apiUrl is set, use it. Otherwise point to the backend Service.
*/}}
{{- define "justscan.frontend.apiUrl" -}}
{{- if .Values.frontend.config.apiUrl }}
{{- .Values.frontend.config.apiUrl }}
{{- else }}
{{- printf "http://%s-backend:%d" (include "justscan.fullname" .) (.Values.backend.service.port | int) }}
{{- end }}
{{- end }}
