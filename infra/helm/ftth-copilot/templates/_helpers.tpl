{{/*
Expand the name of the chart.
*/}}
{{- define "ftth-copilot.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "ftth-copilot.fullname" -}}
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
Create chart name and version as used by the chart label.
*/}}
{{- define "ftth-copilot.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "ftth-copilot.labels" -}}
helm.sh/chart: {{ include "ftth-copilot.chart" . }}
{{ include "ftth-copilot.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "ftth-copilot.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ftth-copilot.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
ServiceAccount name
*/}}
{{- define "ftth-copilot.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "ftth-copilot.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Secret name for runtime secrets
*/}}
{{- define "ftth-copilot.secretName" -}}
{{- if .Values.secrets.existingSecret }}
{{- .Values.secrets.existingSecret }}
{{- else }}
{{- printf "%s-secrets" (include "ftth-copilot.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Resolve image reference with optional global.imageRegistry
*/}}
{{- define "ftth-copilot.image" -}}
{{- $repo := .image.repository -}}
{{- if .global.imageRegistry -}}
{{- $repo = printf "%s/%s" .global.imageRegistry .image.repository -}}
{{- end -}}
{{- $tag := default .appVersion .image.tag -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end }}
