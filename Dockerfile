FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY --from=build /app /app
RUN npx playwright install --with-deps chromium && chmod -R a+rX /ms-playwright && chown -R node:node /app
USER node
EXPOSE 3000 4000
CMD ["npm","run","start:web"]
