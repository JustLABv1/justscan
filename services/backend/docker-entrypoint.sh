#!/bin/sh
set -eu

export TRIVY_CACHE_DIR="${TRIVY_CACHE_DIR:-/app/data/trivy-cache}"
mkdir -p "$TRIVY_CACHE_DIR/bootstrap"

if ! trivy image --cache-dir "$TRIVY_CACHE_DIR/bootstrap" --download-db-only --quiet; then
  echo "warning: failed to refresh Trivy vulnerability DB during container startup" >&2
fi

if ! trivy image --cache-dir "$TRIVY_CACHE_DIR/bootstrap" --download-java-db-only --quiet; then
  echo "warning: failed to refresh Trivy Java DB during container startup" >&2
fi

exec "$@"