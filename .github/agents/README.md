# 👥 Squad de Agentes Especialistas - ConformIA

Bem-vindo ao diretório de agentes especialistas do ecossistema **ConformIA** (`.github/agents/`).

Este diretório contém a definição de **8 agentes virtuais de alta senioridade**, configurados com personas especializadas, comandos, ferramentas e protocolos de transição (*handoffs*) para cobrir todo o ciclo de vida do software: desde o design arquitetural e conformidade médica deontológica até a implementação full-stack, segurança, qualidade de testes e operação em nuvem.

---

## 🗂️ Catálogo de Agentes

| Agente | Arquivo de Configuração | Perfil / Senioridade | Principais Competências |
| :--- | :--- | :--- | :--- |
| **Software Architect** | [`software-architect.agent.md`](./software-architect.agent.md) | Arquiteto de Software Sênior | Arquitetura limpa Node.js + MongoDB, estratégias de scraping distribuído (Puppeteer/Cheerio/MCP), resiliência e concorrência BullMQ. |
| **Backend Engineer** | [`backend-engineer.agent.md`](./backend-engineer.agent.md) | Engenheiro Backend Sênior | Node.js 20+, Express REST APIs (`/api/v1`), Prisma ORM (MongoDB), Mongoose, validação estrita com Zod, isolamento multi-tenant e RBAC. |
| **Frontend Engineer** | [`frontend-engineer.agent.md`](./frontend-engineer.agent.md) | Engenheiro Frontend Sênior | React 18, Vite 6, Tailwind CSS 3, Lucide Icons, React Router v7, cockpit do auditor e Portal do Cliente exclusivo. |
| **AI Software Engineer** | [`ai-software-engineer.agent.md`](./ai-software-engineer.agent.md) | Engenheiro de IA & Cloud Sênior | Integração LLMs (Google Gemini 2.0 / Ollama), Arquitetura RAG vetorial no Atlas, Protocolo MCP, Structured Outputs e LLMOps. |
| **Compliance Specialist** | [`compliance-specialist.agent.md`](./compliance-specialist.agent.md) | Especialista Regulatório & Deontológico | Resoluções CFM nº 2.336/2023 (RQE, sensacionalismo, antes/depois), ANS, ANVISA, LGPD em saúde e formulação de prompts deontológicos. |
| **Security Engineer** | [`security-engineer.agent.md`](./security-engineer.agent.md) | Engenheiro de Cyber Security / AppSec | OWASP Top 10, sanitização NoSQL/XSS/SSRF, hardening de endpoints, JWT seguro, blindagem contra scraping malicioso e RBAC estrito. |
| **Test Specialist** | [`test-specialist.agent.md`](./test-specialist.agent.md) | Especialista em Testes & QA | Testes unitários e de integração (Vitest, Jest, Supertest), mocks de Prisma/MongoDB e Redis, testes de componentes React e regressão. |
| **DevOps Engineer** | [`devops-engineer.agent.md`](./devops-engineer.agent.md) | Engenheiro DevOps & SRE Sênior | Docker multi-stage, Docker Compose, AWS EC2, GitHub Actions CI/CD (`ci-deploy.yml`), GHCR, Nginx Reverse Proxy, SSL/TLS Let's Encrypt. |

> **Nota sobre formatos:** Cada agente possui versão `.agent.md` e `.md` idênticas para compatibilidade universal entre ferramentas de IA (GitHub Copilot CLI/Chat, Cursor, Antigravity e extensões VS Code).

---

## 🔄 Fluxo de Desenvolvimento Colaborativo (Feature Lifecycle)

Para implementar novos módulos ou aprimorar os existentes, os agentes colaboram em cadeia estruturada:

```
[ Requisito de Negócio / Regulação ]
                 │
                 ▼
      ⚖️ compliance-specialist (Mapeia leis, severidades e regras)
                 │
                 ▼
      🏛️ software-architect (Desenha fluxos, contratos e particionamento)
                 │
        ┌────────┴────────┐
        ▼                 ▼
⚙️ backend-engineer    🎨 frontend-engineer
(API, Prisma, Fila)    (UI, React, Cockpit)
        │                 │
        └────────┬────────┘
                 ▼
      🤖 ai-software-engineer (Refina RAG, prompts e extrações)
                 │
                 ▼
      🛡️ security-engineer (Audita vulnerabilidades, inputs e RBAC)
                 │
                 ▼
      🧪 test-specialist (Cria testes unitários, integração e mocks)
                 │
                 ▼
      🚀 devops-engineer (Gera containers, CI/CD, deploy na AWS EC2)
```

---

## 🤝 Protocolo de Handoffs (Matriz de Passagem de Bastão)

Cada agente sabe exatamente a quem recorrer dependendo do obstáculo encontrado:

1. **`compliance-specialist` ➔ `ai-software-engineer`:** Envia as diretrizes de artigos de leis (ex: Art. 14 da Resolução CFM 2.336/23) para incorporação ao System Prompt e à base vetorial RAG.
2. **`software-architect` ➔ `backend-engineer` & `frontend-engineer`:** Fornece o blueprint arquitetural, modelos Prisma e endpoints `/api/v1` detalhados.
3. **`backend-engineer` ➔ `security-engineer`:** Submete endpoints e queries do MongoDB para auditoria contra injeção e falhas de autorização (*Broken Object Level Authorization*).
4. **`frontend-engineer` ➔ `test-specialist`:** Envia componentes e páginas criadas para cobertura com testes de renderização e fluxos de navegação.
5. **`test-specialist` ➔ `devops-engineer`:** Valida que os testes rodam em modo headless limpo para inclusão na pipeline do GitHub Actions.
6. **`devops-engineer` ➔ `security-engineer`:** Valida portas de Security Groups da AWS, certificados SSL e cabeçalhos HTTP de proteção no Nginx.

---

## 💡 Como Invocar os Agentes

Você pode acionar qualquer agente nas suas conversas ou comentários usando o prefixo `@` seguido pelo nome do agente ou arquivo:

- `@software-architect analise a escalabilidade da fila BullMQ ao processar 10.000 sites por dia`
- `@compliance-specialist revise se este anúncio médico respeita as regras de RQE e imagens de antes/depois da CFM 2.336/23`
- `@backend-engineer crie um novo endpoint para download de relatórios PDF com validação Zod`
- `@frontend-engineer adicione um gráfico de rosca mostrando a distribuição de severidades no portal do cliente`
- `@ai-software-engineer calibre o modelo Gemini para evitar falsos positivos em matérias informativas de saúde`
- `@security-engineer audite as rotas de autenticação contra ataques de força bruta e bypass de JWT`
- `@test-specialist crie testes de integração cobrindo os endpoints de regras de clientes`
- `@devops-engineer configure a renovação automática de certificados SSL no container Nginx`

