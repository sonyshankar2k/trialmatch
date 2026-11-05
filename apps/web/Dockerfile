# Build from the repository root:  docker build -f apps/web/Dockerfile .
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
RUN npx nx build web

# Static files + /api proxy, served by nginx as a non-root user on port 8080.
FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
