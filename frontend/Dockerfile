# ===== Stage 1: Dependencies =====
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ===== Stage 2: Build =====
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build Next.js
RUN npm run build

# ===== Stage 3: Production =====
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Create non-root user
RUN addgroup --system --gid 1001 app && \
    adduser --system --uid 1001 app

# Copy standalone build
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public


# Create uploads, temp, and db directories
RUN mkdir -p public/uploads .tmp && chown -R app:app .

USER app

EXPOSE 3000

CMD ["node", "server.js"]
