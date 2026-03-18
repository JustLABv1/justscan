FROM golang:1.24-alpine AS builder
LABEL org.opencontainers.image.source = "https://github.com/JustLabV1/JustScan"

WORKDIR /app/backend

COPY go.mod go.sum ./

RUN go mod download

COPY . .

RUN go build -o justscan-backend

FROM alpine:3.22 AS runner
LABEL org.opencontainers.image.source = "https://github.com/JustLabV1/JustScan"
WORKDIR /app

ARG TRIVY_VERSION=0.55.0

RUN apk add --no-cache ca-certificates wget \
    && ARCH=$(uname -m) \
    && if [ "$ARCH" = "x86_64" ]; then TRIVY_ARCH="64bit"; \
       elif [ "$ARCH" = "aarch64" ]; then TRIVY_ARCH="ARM64"; \
       else TRIVY_ARCH="ARM"; fi \
    && wget -qO /tmp/trivy.tar.gz \
         "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-${TRIVY_ARCH}.tar.gz" \
    && tar -xzf /tmp/trivy.tar.gz -C /usr/local/bin trivy \
    && rm /tmp/trivy.tar.gz \
    && apk del wget

COPY --from=builder /app/backend/justscan-backend /app/

RUN addgroup --system --gid 1001 justscan \
    && adduser --system --uid 1001 --ingroup justscan justscan

RUN mkdir -p /etc/justscan \
    && chown -R justscan:justscan /etc/justscan

RUN mkdir -p /app/data \
    && chown -R justscan:justscan /app/data

RUN chown -R justscan:justscan /app

VOLUME [ "/etc/justscan", "/app/data" ]

EXPOSE 8080

USER justscan

CMD [ "/app/justscan-backend", "--config", "/etc/justscan/config.yaml" ]
