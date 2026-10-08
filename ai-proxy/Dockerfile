FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json server.mjs ./
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
