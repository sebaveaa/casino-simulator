# One image, two process roles: PROCESS_ROLE=api (default) or worker picks the process at runtime.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci
COPY tsconfig.base.json ./
COPY shared shared
COPY backend backend
RUN npm run build -w backend

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# Only the backend's production dependencies; @casino/shared is already bundled into dist.
RUN npm ci --omit=dev --workspace backend && npm cache clean --force
COPY --from=build /app/backend/dist backend/dist
USER node
EXPOSE 3000
CMD ["node", "backend/dist/main.js"]
