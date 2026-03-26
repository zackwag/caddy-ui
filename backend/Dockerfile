FROM node:20-alpine

RUN apk add --no-cache caddy

WORKDIR /app

COPY package.json .
RUN npm install --omit=dev

COPY src/ ./src/

EXPOSE 3001

CMD ["node", "src/index.js"]
