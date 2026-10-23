FROM node:26.12.1-alpine3.24 AS builder

USER root
WORKDIR /app
RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ARG NEXT_PUBLIC_API_URL=""
ARG APP_VERSION=dev
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build

# Keep package managers and build headers out of the runtime layers.
FROM alpine:3.24 AS runner
RUN apk add --no-cache ca-certificates libstdc++ \
    && addgroup -g 1000 node \
    && adduser -D -u 1000 -G node node
COPY --from=builder /usr/local/bin/node /usr/local/bin/node
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
