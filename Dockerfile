# AEE API — Fly.io Dockerfile (pre-built dashboard, no build in container)
FROM node:20-slim
WORKDIR /app

# Install tsx for running TypeScript
RUN npm install -g tsx

# Copy dependency manifests and install
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY packages/ ./packages/
COPY apps/worker/ ./apps/worker/
COPY scripts/ ./scripts/
COPY migrations/ ./migrations/

# Pre-built dashboard already in packages/api/assets/
# (built locally before deploy, not in container — avoids rolldown native binding issues)

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npx", "tsx", "scripts/serve-prod.ts"]
