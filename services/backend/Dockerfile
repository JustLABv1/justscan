# syntax=docker/dockerfile:1.28
FROM golang:1.27.3-bookworm AS builder
LABEL org.opencontainers.image.source = "https://github.com/JustLabV1/JustScan"

WORKDIR /app/backend

COPY go.mod go.sum ./

RUN go mod download

COPY . .

ARG APP_VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=${APP_VERSION}" -o justscan-backend
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o justscan-mcp ./cmd/justscan-mcp

FROM builder AS helm-builder

# Alpine's packaged Helm binary currently embeds older Go dependencies. Build
# Helm under the backend module graph so Go's minimal-version selection uses the
# patched oras-go version required by JustScan. `go install pkg@version` would
# ignore this module graph and restore Helm's oras-go v2.6.1 dependency.
RUN CGO_ENABLED=0 go build -mod=mod -trimpath -ldflags="-s -w" -o /out/helm helm.sh/helm/v4/cmd/helm

FROM alpine:3.24 AS runtime-base
LABEL org.opencontainers.image.source = "https://github.com/JustLabV1/JustScan"
WORKDIR /app

# Alpine 3.24 still packages Expat 2.8.5, affected by CVE-2026-77214.
# Temporarily install only the fixed Expat package from edge; keep the base and
# all other packages on 3.24. Remove this once 3.24 ships Expat >= 2.9.0.
RUN apk add --no-cache --repository https://dl-cdn.alpinelinux.org/alpine/edge/main \
    libexpat=2.9.0-r0 \
    && apk add --upgrade --no-cache ca-certificates git tzdata libcrypto3 libssl3

COPY --from=builder /app/backend/justscan-backend /app/
COPY --from=builder /app/backend/justscan-mcp /app/
COPY --from=helm-builder /out/helm /usr/local/bin/helm
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
COPY config/config.yaml /etc/justscan/config.yaml

RUN addgroup --system --gid 1001 justscan \
    && adduser --system --uid 1001 --ingroup justscan justscan

RUN mkdir -p /etc/justscan \
    && chown -R justscan:justscan /etc/justscan

RUN mkdir -p /app/data \
    && chown -R justscan:justscan /app/data

RUN chmod +x /app/docker-entrypoint.sh

RUN chown -R justscan:justscan /app

VOLUME [ "/app/data" ]

EXPOSE 8080

USER justscan

ENTRYPOINT [ "/app/docker-entrypoint.sh" ]

CMD [ "/app/justscan-backend", "--config", "/etc/justscan/config.yaml" ]

FROM runtime-base AS runner-minimal

ENV BACKEND_SCANNER_ENABLE_TRIVY=false
ENV BACKEND_SCANNER_ENABLE_GRYPE=false

# Rebuild the pinned scanner release with patched transitive dependencies.
FROM golang:1.27.3-bookworm AS trivy-bin
ARG TRIVY_VERSION=v0.76.1
RUN go mod download github.com/aquasecurity/trivy@${TRIVY_VERSION} \
    && cp -a /go/pkg/mod/github.com/aquasecurity/trivy@${TRIVY_VERSION} /src \
    && chmod -R u+w /src
WORKDIR /src
RUN go get github.com/go-jose/go-jose/v4@v4.1.6 oras.land/oras-go/v2@v2.6.4-0.20261015110029-8883c8588eb5 \
    && CGO_ENABLED=0 go build -trimpath \
    -ldflags="-s -w -X github.com/aquasecurity/trivy/pkg/version/app.ver=${TRIVY_VERSION#v}" \
    -o /usr/local/bin/trivy ./cmd/trivy

FROM golang:1.27.3-bookworm AS grype-bin
ARG GRYPE_VERSION=v0.121.0
RUN go mod download github.com/anchore/grype@${GRYPE_VERSION} \
    && cp -a /go/pkg/mod/github.com/anchore/grype@${GRYPE_VERSION} /src \
    && chmod -R u+w /src
WORKDIR /src
RUN go get github.com/go-jose/go-jose/v4@v4.1.6 \
    && CGO_ENABLED=0 go build -trimpath \
    -tags=containers_image_openpgp,exclude_graphdriver_btrfs \
    -ldflags="-s -w -X main.version=${GRYPE_VERSION#v}" -o /grype ./cmd/grype

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
