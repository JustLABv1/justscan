#!/bin/sh
set -eu

export TRIVY_CACHE_DIR="${TRIVY_CACHE_DIR:-/app/data/trivy-cache}"
CUSTOM_CA_BUNDLE_PATH="${JUSTSCAN_CUSTOM_CA_BUNDLE_PATH:-/app/data/ca-certificates/custom-ca-bundle.crt}"
SYSTEM_CA_BUNDLE="/etc/ssl/certs/ca-certificates.crt"

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

mkdir -p "$TRIVY_CACHE_DIR/bootstrap"

if ! trivy image --cache-dir "$TRIVY_CACHE_DIR/bootstrap" --download-db-only --quiet; then
  echo "warning: failed to refresh Trivy vulnerability DB during container startup" >&2
fi

if ! trivy image --cache-dir "$TRIVY_CACHE_DIR/bootstrap" --download-java-db-only --quiet; then
  echo "warning: failed to refresh Trivy Java DB during container startup" >&2
fi

exec "$@"