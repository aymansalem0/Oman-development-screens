FROM node:20-alpine AS evidence-build
WORKDIR /build
COPY package*.json ./
RUN npm install --no-audit --no-fund --prefer-offline --loglevel=error --fetch-retries=3
COPY ai-proxy/build-fleet-evidence.mjs ./ai-proxy/build-fleet-evidence.mjs
COPY ai-proxy/airia-demo-99.json ./ai-proxy/airia-demo-99.json
COPY src/app/data/ ./src/app/data/
COPY src/app/services/nmc-risk-engine.service.ts src/app/services/nmc-vessel-evidence.service.ts ./src/app/services/
RUN node ./ai-proxy/build-fleet-evidence.mjs

FROM node:20-alpine
RUN apk add --no-cache poppler-utils
ENV NODE_ENV=production
WORKDIR /app
COPY ai-proxy/package.json ai-proxy/server.mjs ai-proxy/airia-demo-cohort.mjs ai-proxy/airia-demo-99.json ai-proxy/moei-poc-auth.mjs ai-proxy/moei-google-users.mjs ai-proxy/moei-google-sso.mjs ai-proxy/psc-reader.mjs ai-proxy/dashboard-workspace.mjs ai-proxy/nmc-dashboard-focus.mjs ai-proxy/alert-workspace.mjs ai-proxy/case-workspace.mjs ai-proxy/case-source-provenance.mjs ai-proxy/nmc-decision-policy.mjs ai-proxy/nmc-incident-feed.mjs ai-proxy/nmc-incident-airia.mjs ai-proxy/nmc-action-plan.mjs ai-proxy/fleet-ai.mjs ai-proxy/fleet-scheduler.mjs ai-proxy/operational-guidance.mjs ai-proxy/risk-policy.mjs ai-proxy/si-erp-workforce.mjs ai-proxy/si-electronic-scheduling.mjs ai-proxy/si-maritime-batch-scheduling.mjs ai-proxy/si-v2-schedule-approval.mjs ai-proxy/si-plan-s01-advisor.mjs ai-proxy/si-maritime-plan-source.mjs ai-proxy/si-scheduling-poc-fixtures.mjs ai-proxy/si-vessel-master-etd.mjs ai-proxy/atomic-json-store.mjs ai-proxy/si-candidate-targeting.mjs ai-proxy/si-inspection-ranking.mjs ai-proxy/si-inspection-preparation.mjs ai-proxy/si-inspection-lifecycle.mjs ai-proxy/si-management-report.mjs ai-proxy/si-agent-mock.mjs ai-proxy/si-poc-workflow-advisors.mjs ai-proxy/si-airia-workflow-advisors.mjs ai-proxy/nmc-airia-data-quality.mjs ai-proxy/si-candidate-agent.mjs ai-proxy/si-inspection-plan.mjs ai-proxy/si-rolling-plan-store.mjs ai-proxy/si-bulk-inspection-plan.mjs ai-proxy/si-checklist-library.mjs ai-proxy/si-checklist-field.mjs ai-proxy/si-checklist-airia.mjs ai-proxy/si-checklist-oracle.mjs ai-proxy/ai-credential-vault.mjs ai-proxy/drive-document-intelligence.mjs ai-proxy/airia-a03-contract.mjs ai-proxy/airia-a03-multipart.mjs ai-proxy/document-risk-evidence.mjs ai-proxy/runtime-settings.mjs ai-proxy/si-source-excel-import.mjs ai-proxy/si-ai-prioritization.mjs ai-proxy/si-psc-selection.mjs ai-proxy/oracle-store.mjs ai-proxy/oracle-preflight.mjs ai-proxy/data-quality.mjs ai-proxy/oracle-quality-backfill.mjs ./
# Include audited schema reconciliation tool and complete migration manifest;
# NOT executed automatically during container startup.
COPY ai-proxy/migrations/ ./migrations/
COPY ai-proxy/tools/reconcile-moei-schema.mjs ./tools/reconcile-moei-schema.mjs
COPY ai-proxy/tools/migrate-si-checklist-json-to-oracle.mjs ./tools/migrate-si-checklist-json-to-oracle.mjs
COPY ai-proxy/tools/check-si-rolling-oracle.mjs ./tools/check-si-rolling-oracle.mjs
COPY ai-proxy/tools/reset-si-poc-actions.mjs ./tools/reset-si-poc-actions.mjs
COPY ai-proxy/tools/reset-si-plans-only.mjs ./tools/reset-si-plans-only.mjs
COPY ai-proxy/tools/generate-msw-demo-feeds.mjs ./tools/generate-msw-demo-feeds.mjs
COPY ai-proxy/tools/reset-nmc-poc-actions.mjs ./tools/reset-nmc-poc-actions.mjs
COPY ai-proxy/tools/reset-nmc-incident-ledger.mjs ./tools/reset-nmc-incident-ledger.mjs
COPY ai-proxy/tools/seed-si-mandatory-checklists.mjs ./tools/seed-si-mandatory-checklists.mjs
RUN node --check ./si-v2-schedule-approval.mjs && node --check ./si-vessel-master-etd.mjs && node --check ./si-plan-s01-advisor.mjs && node --check ./si-maritime-batch-scheduling.mjs && node --check ./si-maritime-plan-source.mjs && node --check ./tools/reset-si-plans-only.mjs && node --check ./tools/generate-msw-demo-feeds.mjs && node --check ./airia-demo-cohort.mjs && node --check ./tools/reset-nmc-poc-actions.mjs && node --check ./tools/reset-nmc-incident-ledger.mjs && node --check ./tools/reset-si-poc-actions.mjs && node --check ./tools/seed-si-mandatory-checklists.mjs && node --check ./tools/reconcile-moei-schema.mjs && node --check ./tools/migrate-si-checklist-json-to-oracle.mjs && node --check ./si-checklist-oracle.mjs && node --check ./si-inspection-ranking.mjs && node --check ./si-rolling-plan-store.mjs && node --check ./si-poc-workflow-advisors.mjs && node --check ./atomic-json-store.mjs && node --check ./si-airia-workflow-advisors.mjs && node --check ./nmc-airia-data-quality.mjs && node --check ./tools/check-si-rolling-oracle.mjs
RUN npm install --omit=dev --no-audit --no-fund --prefer-offline --loglevel=error --fetch-retries=3
# Four non-mutating Smart Inspection POC scheduling contract tests.
# Keep them in the image so documented "docker compose exec ai-proxy node --test
# test/..." commands work even without mounting the repository.
COPY ai-proxy/test/si-scheduling-poc-fixtures.test.mjs ai-proxy/test/si-maritime-batch-scheduling.test.mjs ai-proxy/test/si-maritime-plan-source.test.mjs ai-proxy/test/si-plan-s01-advisor.test.mjs ai-proxy/test/si-v2-schedule-work-orders.test.mjs ai-proxy/test/si-v2-work-orders.test.mjs ./test/
RUN node --test test/si-scheduling-poc-fixtures.test.mjs test/si-maritime-batch-scheduling.test.mjs test/si-maritime-plan-source.test.mjs test/si-plan-s01-advisor.test.mjs test/si-v2-schedule-work-orders.test.mjs test/si-v2-work-orders.test.mjs
# Fail image build early when a case-workspace ESM import is missing.
RUN node -e "import('./si-vessel-master-etd.mjs').catch(e=>{console.error(e);process.exit(1)})" 
RUN node --check si-checklist-library.mjs && node --check si-checklist-field.mjs && node --check si-checklist-airia.mjs && node --check si-bulk-inspection-plan.mjs && node --check moei-google-users.mjs && node --check moei-google-sso.mjs && node --check nmc-incident-feed.mjs && node --check nmc-incident-airia.mjs && node --check server.mjs && node --check case-workspace.mjs && node --check case-source-provenance.mjs && node --check nmc-dashboard-focus.mjs && node --check nmc-decision-policy.mjs && node -e "import('./case-workspace.mjs').catch(e=>{console.error(e);process.exit(1)})"
COPY --from=evidence-build /build/ai-proxy/fleet-bundles.json ./fleet-bundles.json
COPY tools/psc/psc-fixtures.mjs ./psc-fixtures.mjs
COPY src/app/data/nmc-vessel-catalog.ts src/app/data/nmc-expanded-vessel-catalog.ts ./
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
