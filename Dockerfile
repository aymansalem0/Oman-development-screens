# Production-like local POC: Angular 18 -> Nginx, built from current source.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build -- --configuration production --base-href /

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/oman-development-screens/browser/ /usr/share/nginx/html/
EXPOSE 80
HEALTHCHECK --interval=20s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
