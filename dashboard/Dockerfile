# ==========================================
# Estágio 1: Build da Aplicação Backend (Hardening INF-01)
# ==========================================
FROM node:20.18.0-alpine3.20 AS builder

WORKDIR /app

RUN apk add --no-cache openssl python3 make g++

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

COPY package*.json ./
COPY prisma ./prisma/

# Builds determinísticos e reprodutíveis com npm ci
RUN npm ci

COPY tsconfig*.json ./
COPY src ./src

# Gera o client do Prisma e compila TypeScript
RUN npx prisma generate
RUN npm run build
RUN npm prune --production

# ==========================================
# Estágio 2: Runtime Mínimo e Seguro (Hardening INF-01)
# ==========================================
FROM node:20.18.0-alpine3.20 AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Instala dumb-init para gerenciamento confiável de sinais de processo (PID 1)
RUN apk add --no-cache openssl dumb-init

COPY --chown=node:node package*.json ./
COPY --chown=node:node prisma ./prisma/
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist

# Execução com usuário sem privilégios root
USER node

EXPOSE 3000 3001

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/index.js"]
