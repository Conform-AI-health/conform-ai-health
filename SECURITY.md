# 🛡️ Política de Segurança e Divulgação Responsável — Conform.AI Health

> **Compromisso com a Privacidade, Sigilo e Integridade de Dados em Saúde Digital**

A equipe da **Conform.AI Health** leva a segurança da informação, a privacidade de dados de saúde (LGPD) e o sigilo deontológico médico com a máxima prioridade e seriedade.

Agradecemos o apoio da comunidade de segurança e pesquisadores independentes que nos ajudam a manter a plataforma resiliente, segura e confiável.

---

## 🔒 1. Versões Suportadas com Atualizações de Segurança

Atualmente, apenas as seguintes versões do projeto recebem correções ativas de segurança:

| Componente | Versão | Status de Suporte |
| :--- | :--- | :--- |
| **Backend REST API (`dashboard-api`)** | `1.0.x` / `main` | :white_check_mark: Suportado |
| **Audit Worker (`audit-worker`)** | `1.0.x` / `main` | :white_check_mark: Suportado |
| **Frontend Web SPA (`dashboard-web`)** | `1.0.x` / `main` | :white_check_mark: Suportado |

---

## 🚨 2. Como Reportar uma Vulnerabilidade (Canal Privado)

**NUNCA abra uma Issue pública no GitHub para reportar vulnerabilidades de segurança.**

Para reportar uma vulnerabilidade ou incidente de segurança:

1. **GitHub Private Vulnerability Reporting (Recomendado):**
   - Acesse a aba **Security** do repositório no GitHub.
   - Clique em **Report a vulnerability** para abrir um canal de comunicação criptografado e privado com os mantenedores.
2. **E-mail de Segurança:**
   - Envie um e-mail com detalhes técnicos para: **`security@conformia.med.br`** (ou `frederico.d.silva@outlook.com`).
   - Se possível, inclua passos reproduzíveis, Proof-of-Concept (PoC) não destrutivo, versões afetadas e impacto potencial estimado.

---

## ⏱️ 3. Prazos e Níveis de Resposta (SLA)

Nossa equipe técnica segue os seguintes compromissos de triagem e mitigação:

- **Confirmação e Triagem Inicial:** Até **48 horas corridas** a partir do recebimento do relatório.
- **Avaliação de Impacto e Reprodução:** Até **4 dias úteis**.
- **Correção e Liberação de Patch:**
  - **Severidade Crítica (P0) / Alta (P1):** Até **7 dias corridas** (ex: RCE, SQLi/NoSQLi, Bypass de Autenticação, SSRF, Vazamento de Dados Multi-Tenant).
  - **Severidade Média (P2) / Baixa (P3):** Até **15 a 30 dias corridos**.
- **Divulgação Pública Coordenada:** Após a validação e publicação do patch de segurança em produção.

---

## ⚖️ 4. Regras de Conduta para Pesquisadores (Safe Harbor)

Para que a investigação de vulnerabilidades seja considerada responsável e sob o programa de proteção aos pesquisadores:

- **Não execute ataques de negação de serviço (DoS/DDoS)** ou testes de estresse contra a infraestrutura em produção.
- **Não acesse, extraia, modifique ou exponha dados de terceiros ou de pacientes reais** (utilize estritamente os ambientes locais de desenvolvimento e casos sintéticos).
- **Não utilize técnicas de engenharia social, phishing ou invasão física** contra colaboradores ou instalações.
- Dê aos mantenedores um tempo razoável para corrigir a vulnerabilidade antes de qualquer divulgação pública.

---

## 🏛️ 5. Conformidade Regulatória e Proteção de Dados de Saúde

Todas as medidas de segurança adotadas pela plataforma estão alinhadas aos seguintes marcos normativos:
- **Lei Geral de Proteção de Dados (LGPD - Lei nº 13.709/2018):** Proteção especial e rigorosa aos dados pessoais sensíveis de saúde (Art. 11 e Art. 46).
- **Código de Ética Médica (Resolução CFM nº 2.217/2018):** Sigilo profissional médico absoluto e dever de guarda documental.
- **Resolução CFM nº 2.454/2026 e CFM nº 2.336/2023:** Supervisão humana contínua obrigatória em decisões assistidas por Inteligência Artificial.
