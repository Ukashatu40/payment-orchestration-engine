# Dockerfile

# ── Stage 1: Build ─────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files first — Docker layer cache means
# npm install only re-runs when package.json changes
COPY package*.json ./

RUN npm ci --ignore-scripts

COPY . .

RUN npm run build

# ── Stage 2: Production ────────────────────────────────────────
FROM node:22-alpine AS production

WORKDIR /app

# Create non-root user for security
RUN addgroup -S payflow && adduser -S payflow -G payflow

COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev --ignore-scripts

# Copy compiled output from builder stage
COPY --from=builder /app/dist ./dist

# Set ownership
RUN chown -R payflow:payflow /app

USER payflow

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Health check — used by Docker and test harness (Section B4.1)
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/api/v1/health || exit 1

CMD ["node", "dist/src/main.js"]