# Cursus self-host image. Multi-stage:
#   builder — full install + prisma generate + next build (also runs one-shot
#             `prisma migrate deploy` via the compose `migrate` service)
#   runner  — production-only deps + built output, `next start`.
FROM node:22-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
# Dummy URL: module-level client creation must not throw during `next build`
# (no connection is opened at import time). Compose overrides at runtime.
ARG DATABASE_URL=postgresql://build:build@localhost:5432/build?schema=public
ENV DATABASE_URL=$DATABASE_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/app/generated ./app/generated
COPY --from=builder /app/next.config.ts ./next.config.ts
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health > /dev/null || exit 1
CMD ["npm", "run", "start", "--", "-p", "3000"]
