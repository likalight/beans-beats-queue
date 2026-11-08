FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "server.js"]
