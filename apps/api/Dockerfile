# Build from the repository root:  docker build -f apps/api/Dockerfile .
# ---- build: compile the shared library and the API with Nx ----
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
RUN npx nx build api

# ---- runtime: production dependencies only, non-root ----
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY libs/shared/package.json libs/shared/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /repo/libs/shared/dist libs/shared/dist
COPY --from=build /repo/apps/api/dist apps/api/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=10 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# Applies pending migrations (under an advisory lock), then serves.
CMD ["node", "apps/api/dist/main.js"]
