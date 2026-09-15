FROM node:20-alpine AS build

ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION

WORKDIR /app

COPY package.json .
RUN npm install

COPY index.html .
COPY vite.config.js .
COPY src/ ./src/
COPY scripts/ ./scripts/

RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
