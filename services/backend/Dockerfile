FROM aquasec/trivy:latest AS trivy-bin

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

RUN apk add --no-cache ca-certificates

COPY --from=trivy-bin /usr/local/bin/trivy /usr/local/bin/trivy
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
