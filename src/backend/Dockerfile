FROM node:24-alpine

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

RUN apk add --no-cache docker-cli

# Caddy binary for caddy fmt, validation and version detection in local mode
# (instances without a container name). Docker mode uses the container's own.
COPY --from=caddy:latest /usr/bin/caddy /usr/bin/caddy

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ ./src/

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO /dev/null http://localhost:${PORT:-3001}/api/version || exit 1

CMD ["node", "src/index.js"]
