FROM node:24-alpine AS build

ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION

WORKDIR /app

COPY package.json .
RUN npm install

COPY index.html .
COPY vite.config.js .
COPY caddyui-logo.ico caddyui-logo.svg caddyui-logo.png ./
COPY src/ ./src/
COPY scripts/ ./scripts/

# English is always included; select additional catalogs before Vite bundles them.
ARG CADDY_UI_ADDITIONAL_LANGUAGES=
RUN node scripts/select-locales.mjs && npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
