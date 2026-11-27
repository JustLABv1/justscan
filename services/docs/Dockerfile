FROM node:26.13.1-alpine3.24 AS builder

USER root
WORKDIR /app
RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# Keep package managers and build headers out of the runtime layers.
FROM alpine:3.24 AS runner
# Temporarily allow the fixed OpenSSL libraries from Alpine 3.22.
# Remove the repository exception once Alpine 3.24 ships 3.5.9-r2 or newer.
RUN apk add --upgrade --no-cache \
    --repository "@openssl-fix https://dl-cdn.alpinelinux.org/alpine/v3.22/main" \
    ca-certificates libstdc++ libatomic \
    "libcrypto3@openssl-fix>=3.5.9-r2" "libssl3@openssl-fix>=3.5.9-r2" \
    && addgroup -g 1000 node \
    && adduser -D -u 1000 -G node node
COPY --from=builder /usr/local/bin/node /usr/local/bin/node
# Check shared libraries on the target architecture during the build.
RUN node --version
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder --chown=1000:1000 /app/public ./public
COPY --from=builder --chown=1000:1000 /app/.next/standalone ./
COPY --from=builder --chown=1000:1000 /app/.next/static ./.next/static

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
USER node

CMD ["node", "server.js"]
