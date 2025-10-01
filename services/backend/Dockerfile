FROM golang:1.23-alpine as builder

WORKDIR /app

COPY go.mod go.sum ./

RUN go mod download

COPY . .

# Build
RUN CGO_ENABLED=0 GOOS=linux go build -o /justwms-backend

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
