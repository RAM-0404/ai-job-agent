# syntax=docker/dockerfile:1

# -------------------------------------------------------
# Stage 1: Base image with Node.js and pnpm
# -------------------------------------------------------
FROM node:22-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g pnpm@12.9.1

WORKDIR /app

# -------------------------------------------------------
# Stage 2: Dependencies and Build
# -------------------------------------------------------
FROM base AS builder

# Copy monorepo root configurations
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.json ./

# Copy package manifests for dependency resolution
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared/tsconfig.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
COPY apps/web/tsconfig.json ./apps/web/

# Install dependencies for shared package and web app
RUN pnpm install --frozen-lockfile --filter @ai-job-agent/shared... --filter @ai-job-agent/web...

# Build shared package so TypeScript and Vite can resolve its output
COPY packages/shared/src ./packages/shared/src
RUN pnpm --filter @ai-job-agent/shared build

# Copy web source and assets
COPY apps/web ./apps/web

# -------------------------------------------------------
# Stage 3: Runtime runner for Vite
# -------------------------------------------------------
FROM base AS runner

WORKDIR /app

ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
ENV API_INTERNAL_URL=http://api:3000

# Copy workspace dependencies, built shared package, and web application
COPY --from=builder /app ./

EXPOSE 5173

CMD ["pnpm", "--filter", "@ai-job-agent/web", "dev", "--host", "0.0.0.0", "--port", "5173"]
