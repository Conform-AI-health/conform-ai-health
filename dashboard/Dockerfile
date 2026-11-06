# ==========================================
# Estágio 1: Build da Aplicação Backend
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl python3 make g++

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY tsconfig*.json ./
COPY src ./src

# Gera o client do Prisma e compila TypeScript
RUN npx prisma generate
RUN npm run build

# ==========================================
# Estágio 2: Runtime Mínimo e Seguro
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN apk add --no-cache openssl

COPY --chown=node:node package*.json ./
COPY --chown=node:node prisma ./prisma/
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist

USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
