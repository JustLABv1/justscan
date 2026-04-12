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
When existingSecret is set for the backend we read from there.
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
{{- include "justscan.backend.secretName" . }}
{{- end }}
{{- end }}

{{- define "justscan.dbPassword.secretKey" -}}
{{- if .Values.postgresql.enabled }}
{{- "password" }}
{{- else if .Values.backend.secrets.existingSecret }}
{{- .Values.backend.secrets.existingSecretKeys.dbPassword }}
{{- else }}
{{- "db-password" }}
{{- end }}
{{- end }}

{{/*
OIDC redirect URI.
When backend.config.oidc.redirectUri is set, use it directly.
Otherwise derive it from the first ingress host.
*/}}
{{- define "justscan.oidc.redirectUri" -}}
{{- if .Values.backend.config.oidc.redirectUri }}
{{- .Values.backend.config.oidc.redirectUri }}
{{- else if and .Values.ingress.enabled (gt (len .Values.ingress.hosts) 0) }}
{{- $host := (index .Values.ingress.hosts 0).host }}
{{- $scheme := "https" }}
{{- if .Values.ingress.tls }}
{{- $scheme = "https" }}
{{- else }}
{{- $scheme = "http" }}
{{- end }}
{{- printf "%s://%s/api/v1/auth/oidc/callback" $scheme $host }}
{{- else }}
{{- "" }}
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
