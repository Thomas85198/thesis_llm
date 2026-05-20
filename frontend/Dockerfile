# syntax=docker/dockerfile:1
# Multi-stage build for Next.js 16 (standalone output).

# ---------- Builder ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Install deps from lockfile only first, so source changes don't bust this layer.
COPY package.json package-lock.json ./
RUN npm ci

# NEXT_PUBLIC_* env vars are baked into the build, so they need to be present
# at build time. Default to localhost so a vanilla `docker build` still works;
# override with --build-arg or docker-compose build args for production.
ARG NEXT_PUBLIC_API_BASE=http://localhost:8000
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE

COPY . .
RUN npm run build

# ---------- Runtime ----------
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Standalone output includes only the minimal node_modules subset Next needs.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
