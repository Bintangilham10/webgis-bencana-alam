# Peta web SIGAP Bencana: hasil build Vite disajikan Caddy, yang juga meneruskan
# /api ke server Express dan mengurus HTTPS (deploy/Caddyfile).
FROM node:24-alpine AS build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /web/dist /srv
