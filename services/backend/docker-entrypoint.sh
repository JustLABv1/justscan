#!/bin/sh
set -eu

export TRIVY_CACHE_DIR="${TRIVY_CACHE_DIR:-/app/data/trivy-cache}"
CUSTOM_CA_BUNDLE_PATH="${JUSTSCAN_CUSTOM_CA_BUNDLE_PATH:-/app/data/ca-certificates/custom-ca-bundle.crt}"
SYSTEM_CA_BUNDLE="/etc/ssl/certs/ca-certificates.crt"

config_file_path() {
  if [ -n "${JUSTSCAN_CONFIG_PATH:-}" ]; then
    printf '%s\n' "$JUSTSCAN_CONFIG_PATH"
    return
  fi

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --config|-c)
        shift
        if [ "$#" -gt 0 ]; then
          printf '%s\n' "$1"
          return
        fi
        ;;
    esac
    shift
  done

  printf '%s\n' "/etc/justscan/config.yaml"
}

scanner_trivy_enabled() {
  if [ -n "${BACKEND_SCANNER_ENABLE_TRIVY:-}" ]; then
    case "$(printf '%s' "$BACKEND_SCANNER_ENABLE_TRIVY" | tr '[:upper:]' '[:lower:]')" in
      false|0|no|off)
        return 1
        ;;
      *)
        return 0
        ;;
    esac
  fi

  config_file="$(config_file_path "$@")"
  if [ -f "$config_file" ]; then
    value="$(grep -E '^[[:space:]]*enable_trivy:' "$config_file" | tail -n 1 | sed -E 's/^[[:space:]]*enable_trivy:[[:space:]]*//; s/[[:space:]#].*$//')"
    if [ -n "$value" ]; then
      case "$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')" in
        false|0|no|off)
          return 1
          ;;
      esac
    fi
  fi

  return 0
}

setup_custom_ca_bundle() {
  found=0

  for dir in "${JUSTSCAN_CUSTOM_CA_CONFIGMAP_DIR:-}" "${JUSTSCAN_CUSTOM_CA_SECRET_DIR:-}"; do
    if [ -n "$dir" ] && [ -d "$dir" ]; then
      set -- "$dir"/*
      if [ "$1" != "$dir/*" ]; then
        if [ "$found" -eq 0 ]; then
          mkdir -p "$(dirname "$CUSTOM_CA_BUNDLE_PATH")"
          if [ -f "$SYSTEM_CA_BUNDLE" ]; then
            cp "$SYSTEM_CA_BUNDLE" "$CUSTOM_CA_BUNDLE_PATH"
          else
            : > "$CUSTOM_CA_BUNDLE_PATH"
          fi
        fi

        for file in "$dir"/*; do
          if [ -f "$file" ]; then
            printf '\n' >> "$CUSTOM_CA_BUNDLE_PATH"
            cat "$file" >> "$CUSTOM_CA_BUNDLE_PATH"
            printf '\n' >> "$CUSTOM_CA_BUNDLE_PATH"
            found=1
          fi
        done
      fi
    fi
  done

  if [ "$found" -eq 1 ]; then
    export SSL_CERT_FILE="$CUSTOM_CA_BUNDLE_PATH"
    echo "info: loaded custom CA certificates into $CUSTOM_CA_BUNDLE_PATH" >&2
  fi
}

setup_custom_ca_bundle

if ! scanner_trivy_enabled "$@"; then
  echo "info: skipping Trivy DB bootstrap because local scanning is disabled" >&2
elif ! command -v trivy >/dev/null 2>&1; then
  echo "info: skipping Trivy DB bootstrap because the trivy binary is not present in this image" >&2
else
  mkdir -p "$TRIVY_CACHE_DIR/bootstrap"

  if ! trivy image --cache-dir "$TRIVY_CACHE_DIR/bootstrap" --download-db-only --quiet; then
    echo "warning: failed to refresh Trivy vulnerability DB during container startup" >&2
  fi

  if ! trivy image --cache-dir "$TRIVY_CACHE_DIR/bootstrap" --download-java-db-only --quiet; then
    echo "warning: failed to refresh Trivy Java DB during container startup" >&2
  fi
fi

exec "$@"