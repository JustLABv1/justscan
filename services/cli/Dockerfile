# The runtime includes the Docker client so `justscan scan --local` can use a
# mounted Docker socket in CI. JustScan itself still performs the scan remotely.
FROM golang:1.26-alpine AS builder

WORKDIR /src

COPY services/cli/go.mod services/cli/go.sum ./
RUN go mod download

COPY services/cli/ ./

ARG VERSION=dev
ARG COMMIT=none
ARG DATE=unknown

RUN CGO_ENABLED=0 go build -trimpath \
    -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT} -X main.date=${DATE}" \
    -o /out/justscan ./cmd/justscan

# docker-cli is the smallest practical base for local-image scans: the CLI calls
# Docker through its Unix socket, but it never runs a vulnerability scanner here.
FROM docker:27-cli

COPY --from=builder /out/justscan /usr/local/bin/justscan

ENTRYPOINT ["justscan"]
CMD ["--help"]
