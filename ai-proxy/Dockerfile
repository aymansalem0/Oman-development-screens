FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY ai-proxy/package.json ai-proxy/server.mjs ai-proxy/psc-reader.mjs ai-proxy/fleet-ai.mjs ./
COPY tools/psc/psc-fixtures.mjs ./psc-fixtures.mjs
COPY src/app/data/nmc-vessel-catalog.ts src/app/data/nmc-expanded-vessel-catalog.ts ./
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
