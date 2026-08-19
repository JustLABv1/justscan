# syntax=docker/dockerfile:1.26
FROM reg.mini.dev/go:v1.26.6 AS builder
LABEL org.opencontainers.image.source = "https://github.com/JustLabV1/JustScan"

WORKDIR /app/backend

COPY go.mod go.sum ./

RUN go mod download

COPY . .

ARG APP_VERSION=dev
RUN CGO_ENABLED=0 go build -ldflags="-X main.version=${APP_VERSION}" -o justscan-backend
RUN CGO_ENABLED=0 go build -o justscan-mcp ./cmd/justscan-mcp

FROM builder AS helm-builder

# Alpine's packaged Helm binary currently embeds older Go dependencies. Build
# Helm under the backend module graph so Go's minimal-version selection uses the
# patched oras-go version required by JustScan. `go install pkg@version` would
# ignore this module graph and restore Helm's oras-go v2.6.1 dependency.
RUN CGO_ENABLED=0 go build -mod=mod -o /out/helm helm.sh/helm/v4/cmd/helm

FROM alpine:3.24 AS runtime-base
LABEL org.opencontainers.image.source = "https://github.com/JustLabV1/JustScan"
WORKDIR /app

RUN apk add --upgrade --no-cache ca-certificates git tzdata libcrypto3 libssl3

COPY --from=builder /app/backend/justscan-backend /app/
COPY --from=builder /app/backend/justscan-mcp /app/
COPY --from=helm-builder /out/helm /usr/local/bin/helm
COPY docker-entrypoint.sh /app/docker-entrypoint.sh

RUN addgroup --system --gid 1001 justscan \
    && adduser --system --uid 1001 --ingroup justscan justscan

RUN mkdir -p /etc/justscan \
    && chown -R justscan:justscan /etc/justscan

RUN mkdir -p /app/data \
    && chown -R justscan:justscan /app/data

RUN chmod +x /app/docker-entrypoint.sh

RUN chown -R justscan:justscan /app

VOLUME [ "/etc/justscan", "/app/data" ]

EXPOSE 8080

USER justscan

ENTRYPOINT [ "/app/docker-entrypoint.sh" ]

CMD [ "/app/justscan-backend", "--config", "/etc/justscan/config.yaml" ]

FROM runtime-base AS runner-minimal

ENV BACKEND_SCANNER_ENABLE_TRIVY=false
ENV BACKEND_SCANNER_ENABLE_GRYPE=false

FROM ghcr.io/aquasecurity/trivy:latest AS trivy-bin
FROM anchore/grype:latest AS grype-bin

FROM runtime-base AS runner

USER root

ARG INCLUDE_TRIVY=true
ARG INCLUDE_GRYPE=true

RUN --mount=type=bind,from=trivy-bin,source=/usr/local/bin/trivy,target=/tmp/trivy,ro \
    --mount=type=bind,from=grype-bin,source=/grype,target=/tmp/grype,ro \
    if [ "$INCLUDE_TRIVY" = "true" ]; then install -m 0755 /tmp/trivy /usr/local/bin/trivy; fi \
    && if [ "$INCLUDE_TRIVY" = "true" ] && [ "$INCLUDE_GRYPE" = "true" ]; then install -m 0755 /tmp/grype /usr/local/bin/grype; fi

ENV TRIVY_CACHE_DIR=/app/data/trivy-cache

USER justscan
