FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

EXPOSE 3100

HEALTHCHECK --interval=5s --timeout=3s --retries=10 --start-period=5s \
  CMD wget -qO- http://localhost:3100/health || exit 1

CMD ["node", "server.js"]
