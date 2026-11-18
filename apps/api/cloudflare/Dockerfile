# syntax=docker/dockerfile:1
FROM node:24-alpine

WORKDIR /app/apps/api
ENV NODE_ENV=production
ENV PORT=8080

# @electric-sql/pglite is externalized by build-runtime.mjs and statically imported by @docket/db
# even when production connects to Neon Postgres over TCP.
RUN npm install --no-save --omit=dev @electric-sql/pglite@0.5.1

COPY server.mjs ./dist/server.mjs
COPY server.mjs.map ./dist/server.mjs.map

EXPOSE 8080
CMD ["node", "dist/server.mjs"]
