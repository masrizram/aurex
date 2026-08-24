# AEE API + Worker — Fly.io Dockerfile
# Multi-stage: build dashboard → bundle API + worker

FROM node:20-slim AS base
WORKDIR /app
RUN npm install -g tsx
COPY package.json package-lock.json ./
RUN npm ci --production=false
COPY tsconfig.json ./
COPY packages/ ./packages/
COPY apps/ ./apps/
COPY scripts/ ./scripts/
COPY migrations/ ./migrations/
RUN npm run typecheck 2>/dev/null || true
RUN npx vite build apps/dashboard --config apps/dashboard/vite.config.ts
RUN cp packages/api/assets/index.html packages/api/assets/dashboard.html

FROM node:20-slim AS production
WORKDIR /app
RUN npm install -g tsx
COPY package.json package-lock.json ./
RUN npm ci --production
COPY tsconfig.json ./
COPY packages/ ./packages/
COPY apps/worker/ ./apps/worker/
COPY scripts/ ./scripts/
COPY migrations/ ./migrations/
COPY --from=base /app/packages/api/assets/dashboard.html ./packages/api/assets/dashboard.html
COPY --from=base /app/packages/api/assets/index.html ./packages/api/assets/index.html

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npx", "tsx", "scripts/serve.ts"]
