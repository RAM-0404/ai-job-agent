# syntax=docker/dockerfile:1

# -------------------------------------------------------
# Stage 1: Base image with Node.js and pnpm
# -------------------------------------------------------
FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true
RUN npm install -g pnpm@12.9.1

# Install openssl and ca-certificates for Prisma and wget for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates wget && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# -------------------------------------------------------
# Stage 2: Build stage
# -------------------------------------------------------
FROM base AS builder

# Copy monorepo manifest and configurations
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json ./

# Copy package manifests for workspace resolution
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared/tsconfig.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/api/tsconfig.json ./apps/api/

# Install dependencies needed for compilation
RUN pnpm install --frozen-lockfile --filter @ai-job-agent/shared... --filter @ai-job-agent/api...

# Copy source code and Prisma schema/migrations
COPY packages/shared/src ./packages/shared/src
COPY apps/api/src ./apps/api/src
COPY apps/api/prisma ./apps/api/prisma

# Generate Prisma client and compile TypeScript
RUN pnpm --filter @ai-job-agent/api db:generate && \
    pnpm --filter @ai-job-agent/shared build && \
    pnpm --filter @ai-job-agent/api build

# -------------------------------------------------------
# Stage 3: Runtime runner
# -------------------------------------------------------
FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Copy root configuration, workspace files, dependencies, and built artifacts from builder
COPY --from=builder /app ./

# Install Chromium browser and required system libraries for Playwright
RUN pnpm --filter @ai-job-agent/api exec playwright install --with-deps chromium

EXPOSE 3000

# Deploy pending migrations on startup before booting Fastify server
CMD ["sh", "-c", "pnpm --filter @ai-job-agent/api exec prisma migrate deploy && node apps/api/dist/index.js"]
