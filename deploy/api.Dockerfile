# API SIGAP Bencana (server/). Server mengimpor aturan dan parser dari recorder/src,
# jadi konteks build = root repo (lihat deploy/compose.yaml).
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN npm ci --prefix server --omit=dev && npm cache clean --force
# package.json perekam menandai recorder/src sebagai modul ES.
COPY recorder/package.json recorder/
COPY recorder/src recorder/src
COPY server server
USER node
WORKDIR /app/server
EXPOSE 3000
# Migrasi aman dijalankan berulang (dicatat di schema_migrations), lalu API dan penjadwalnya.
CMD ["sh", "-c", "node db/migrate.js && exec node src/index.js"]
