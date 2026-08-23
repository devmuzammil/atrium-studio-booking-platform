FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build \
  && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3000
ENV RUN_WORKER=true
EXPOSE 3000

CMD ["sh", "-lc", "npx prisma migrate deploy && node dist/server.js"]
