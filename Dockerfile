FROM aquasec/trivy:latest AS trivy-bin

FROM node:24.7-alpine AS base

# Stage 1: Build the frontend
FROM node:24.7-alpine AS frontend-builder
RUN apk add --no-cache libc6-compat
WORKDIR /app/frontend
COPY services/frontend/package.json services/frontend/pnpm-lock.yaml ./
RUN corepack enable pnpm && pnpm --version
RUN pnpm install
COPY services/frontend/ ./

ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm run build

# Stage 2: Build the backend
FROM golang:1.25-alpine AS backend-builder
WORKDIR /app/backend
COPY services/backend/go.mod services/backend/go.sum ./
RUN go mod download
COPY services/backend/ ./
RUN go build -o justscan-backend

# Stage 3: Create the final image
FROM base AS runner
WORKDIR /app

# Install necessary packages
RUN apk update && apk add --no-cache \
    ca-certificates \
    tini \
    postgresql-client

COPY --from=trivy-bin /usr/local/bin/trivy /usr/local/bin/trivy

# Create user and group
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Copy the backend binary
COPY --from=backend-builder /app/backend/justscan-backend /app/

# Copy the frontend build
COPY --from=frontend-builder /app/frontend/public /app/public

# Set the correct permission for prerender cache
RUN mkdir .next \
    && chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
COPY --from=frontend-builder --chown=nextjs:nodejs /app/frontend/.next/standalone ./
COPY --from=frontend-builder --chown=nextjs:nodejs /app/frontend/.next/static ./.next/static

RUN chown -R nextjs:nodejs /app

RUN mkdir -p /etc/justscan \
    && chown -R nextjs:nodejs /etc/justscan

RUN mkdir -p /app/data \
    && chown -R nextjs:nodejs /app/data

# Set environment variables
ENV NODE_ENV=production

VOLUME [ "/etc/justscan", "/app/data" ]

# Expose ports
EXPOSE 8080 3000

USER nextjs

# Use tini as the entrypoint
ENTRYPOINT ["/sbin/tini", "--"]

# Start the backend and frontend
CMD ["sh", "-c", "./justscan-backend --config /etc/justscan/config.yaml & node /app/server.js"]