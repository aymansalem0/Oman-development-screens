# Production-like local POC: Angular 18 -> Nginx, built from current source.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
# Persist npm tarballs across Docker builds and retry transient registry failures.
# The debug log is displayed if a registry/network request ultimately fails.
RUN --mount=type=cache,target=/root/.npm \
    npm install --no-audit --no-fund --prefer-offline --loglevel=error \
      --fetch-retries=3 --fetch-retry-mintimeout=10000 \
      --fetch-retry-maxtimeout=60000 --fetch-timeout=180000 \
    || { echo '=== npm installation failed; latest debug log ==='; \
         log=$(ls -t /root/.npm/_logs/*debug-0.log 2>/dev/null | head -n 1); \
         if [ -n "$log" ]; then tail -n 100 "$log"; fi; \
         exit 1; }
COPY . .
RUN npm run build -- --configuration production --base-href /

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/oman-development-screens/browser/ /usr/share/nginx/html/
EXPOSE 80
HEALTHCHECK --interval=20s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
