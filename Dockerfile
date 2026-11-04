# Single-container image for hosting: the NestJS API also serves the built React app,
# so the whole product is one service with one URL (no CORS, same-origin event stream).
#   docker build -t trialmatch .
#   docker run -p 3000:3000 -e DATABASE_URL=... -e JWT_SECRET=... trialmatch
# (docker-compose.yml runs the split setup instead: nginx + API + Redis worker.)

# ---- build: shared library, API and web app with Nx ----
FROM node:24-slim AS build
WORKDIR /repo
COPY package.json package-lock.json nx.json tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/web-e2e/package.json apps/web-e2e/
COPY libs/shared/package.json libs/shared/
RUN npm ci --no-audit --no-fund
COPY . .
ENV NX_DAEMON=false NX_NO_CLOUD=true
RUN npx nx run-many -t build -p api web

# ---- runtime: production dependencies only, non-root ----
FROM node:24-slim
ENV NODE_ENV=production WEB_DIST_DIR=/app/web PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY libs/shared/package.json libs/shared/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /repo/libs/shared/dist libs/shared/dist
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/web/dist web
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=10 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# Applies pending migrations (under an advisory lock), then serves the app and the API.
CMD ["node", "apps/api/dist/main.js"]
