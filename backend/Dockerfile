FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

ENV PORT=3000
EXPOSE 3000

CMD ["sh", "-lc", "npx prisma migrate deploy && node dist/server.js"]
