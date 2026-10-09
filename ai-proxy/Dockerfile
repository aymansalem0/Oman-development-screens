FROM node:20-alpine AS evidence-build
WORKDIR /build
COPY package*.json ./
RUN npm install --no-audit --no-fund --prefer-offline --loglevel=error --fetch-retries=3
COPY ai-proxy/build-fleet-evidence.mjs ./ai-proxy/build-fleet-evidence.mjs
COPY src/app/data/ ./src/app/data/
COPY src/app/services/nmc-risk-engine.service.ts src/app/services/nmc-vessel-evidence.service.ts ./src/app/services/
RUN node ./ai-proxy/build-fleet-evidence.mjs

FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY ai-proxy/package.json ai-proxy/server.mjs ai-proxy/psc-reader.mjs ai-proxy/dashboard-workspace.mjs ai-proxy/alert-workspace.mjs ai-proxy/case-workspace.mjs ai-proxy/nmc-action-plan.mjs ai-proxy/fleet-ai.mjs ai-proxy/fleet-scheduler.mjs ai-proxy/operational-guidance.mjs ai-proxy/oracle-store.mjs ai-proxy/oracle-preflight.mjs ai-proxy/data-quality.mjs ai-proxy/oracle-quality-backfill.mjs ./
RUN npm install --omit=dev --no-audit --no-fund --prefer-offline --loglevel=error --fetch-retries=3
COPY --from=evidence-build /build/ai-proxy/fleet-bundles.json ./fleet-bundles.json
COPY tools/psc/psc-fixtures.mjs ./psc-fixtures.mjs
COPY src/app/data/nmc-vessel-catalog.ts src/app/data/nmc-expanded-vessel-catalog.ts ./
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
