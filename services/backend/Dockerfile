FROM golang:1.24-alpine as builder

WORKDIR /app

# Ensure Go module mode is enabled
ENV GO111MODULE=on

COPY go.mod go.sum ./
RUN go mod download

COPY . ./

# Debug: Check the structure and Go environment
RUN pwd && ls -la && cat go.mod && echo "GO111MODULE=$GO111MODULE" && go env GOMOD

# Build
RUN CGO_ENABLED=0 GOOS=linux go build -o justwms-backend

FROM alpine:3.22 as runner
LABEL org.opencontainers.image.source="https://github.com/justnz/justwms"
WORKDIR /app

COPY --from=builder /app/justwms-backend /app/

RUN addgroup --system --gid 1001 justwms
RUN adduser --system --uid 1001 justwms

RUN mkdir -p /etc/justwms \
    && chown -R justwms:justwms /etc/justwms

RUN chown -R justwms:justwms /app

VOLUME [ "/etc/justwms" ]

EXPOSE 8080

CMD [ "/justwms-backend", "--config", "/etc/justwms/config.yaml" ]
