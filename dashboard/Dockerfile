# ==========================================
# Estágio 1: Build da Aplicação Backend
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Instala dependências de compilação
RUN apk add --no-cache openssl python3 make g++

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

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
RUN apk add --no-cache openssl

# Cria usuário não-root para segurança
USER node

COPY --chown=node:node package*.json ./
COPY --chown=node:node prisma ./prisma/

# Instala apenas dependências de produção
RUN npm ci --omit=dev && npx prisma generate

# Copia build compilado
COPY --chown=node:node --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/index.js"]

