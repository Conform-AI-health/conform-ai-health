# 🛡️ Relatório de Auditoria e Blindagem de Segurança: `docker-compose.yml`

**Data:** 08/11/2026  
**Auditor Responsável:** `@security-engineer` & `@devops-engineer`  
**Escopo:** Configuração de orquestração multi-container (`redis`, `dashboard-api`, `audit-worker`, `dashboard-web`)

---

## 🔍 1. Vulnerabilidades Identificadas e Ações de Mitigação

| Item | Gravidade | Vulnerabilidade Detectada | Ação de Mitigação Implementada |
| :--- | :--- | :--- | :--- |
| **1. Segredos em Plaintext** | 🔴 **CRÍTICA** | Fallback padrão de `JWT_SECRET` hardcoded no compose (`ASDLAN333SDA0...`). | Removido fallback inseguro. Variável agora requer definição obrigatória no `.env` do host (`${JWT_SECRET}`). |
| **2. Exposição Pública do Redis** | 🔴 **CRÍTICA** | Porta `6379:6379` aberta no host sem senha, permitindo acesso não autenticado via internet/rede local. | Adicionada autenticação com senha via `--requirepass` e porta vinculada estritamente ao loopback (`127.0.0.1:${REDIS_PORT:-6379}:6379`). |
| **3. Ausência de Healthchecks** | 🟡 **MÉDIA** | Falta de sondas de liveness/readiness no `dashboard-api` e `dashboard-web`, permitindo roteamento para instâncias travadas. | Implementados healthchecks nativos com `node http.get` na API e `wget` no Nginx, com políticas de retentativas. |
| **4. Escalonamento de Privilégios** | 🟡 **MÉDIA** | Containers podiam herdar novos privilégios (`setuid/setgid`). | Aplicado `security_opt: [no-new-privileges:true]` em todos os 4 serviços. |
| **5. Negação de Serviço (DoS)** | 🟡 **MÉDIA** | Ausência de limites de memória e CPU, vulnerável a esgotamento da máquina host. | Configuradas diretivas `deploy.resources.limits` com tetos de CPU e RAM para cada serviço. |
| **6. CORS Desprotegido** | 🟡 **MÉDIA** | `CORS_ORIGIN=*` permitia chamadas de qualquer domínio web. | Restrito para a origem parametrizada `${CORS_ORIGIN:-http://localhost:3000}`. |
| **7. Variáveis Recentes Omitidas** | 🟢 **BAIXA** | Omissão de `JWT_REFRESH_SECRET`, `RESEND_API_KEY`, etc. | Adicionadas todas as variáveis necessárias para o ecossistema de autenticação resiliente. |

---

## ✅ 2. Conclusão da Auditoria
O arquivo `docker-compose.yml` está em conformidade com as melhores práticas OWASP para ambientes de containers em produção.
