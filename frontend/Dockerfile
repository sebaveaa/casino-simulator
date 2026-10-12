# Web portal image. Build from the repository root: docker build -f frontend/Dockerfile .
# VITE_API_URL is inlined at build time; empty selects the in-memory mock API.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci
COPY tsconfig.base.json ./
COPY shared shared
COPY frontend frontend
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build -w frontend

FROM nginxinc/nginx-unprivileged:1.28.0-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 8080
