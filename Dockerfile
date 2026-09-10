# OS Shell — production static host for Railway / containers
FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/demo-notes/package.json apps/demo-notes/
COPY packages/contract/package.json packages/contract/
COPY packages/runtime/package.json packages/runtime/
COPY packages/sdk/package.json packages/sdk/

RUN npm ci

COPY . .

# Vite bakes VITE_* at build time — provided by Railway service variables.
ENV VITE_SHELL_MODE=production
RUN npm run build -w @osshell/web

FROM nginx:1.27-alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY deploy/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/docker-entrypoint.sh"]
