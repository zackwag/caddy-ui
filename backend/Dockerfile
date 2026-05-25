FROM node:20-alpine

# Copy the Caddy binary from the official image for caddy fmt and version detection
COPY --from=caddy:latest /usr/bin/caddy /usr/bin/caddy

WORKDIR /app

COPY package.json .
RUN npm install --omit=dev

COPY src/ ./src/

EXPOSE 3001

CMD ["node", "src/index.js"]
