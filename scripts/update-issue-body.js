const https = require('https');
const { execSync } = require('child_process');

function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const out = execSync("powershell -Command \"[System.Environment]::GetEnvironmentVariable('GITHUB_TOKEN', 'User')\"", { encoding: 'utf8' }).trim();
    if (out) return out;
  } catch (e) {}
  return null;
}

const token = getGitHubToken();

function requestGraphQL(query, variables) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ query, variables });
    const req = https.request({
      hostname: 'api.github.com',
      path: '/graphql',
      method: 'POST',
      headers: {
        'User-Agent': 'ConformIA-Bot',
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const itemId = "PVTI_lADOFOE58c4BqQlUzhG_BQQ";

async function main() {
  const updatedBody = `## 📋 Estágio 1: Product Owner Regulatória (@compliance-specialist)
**Como:** Auditor Deontológico e Gestor de Conformidade em Saúde  
**Quero:** Configurar a periodicidade de auditoria contínua através de um campo de Cron no bloco '1. Identificação do Agente & Alvo Oficial' da página de Agentes e dispor de um motor de agendamento automático em background  
**Para:** Garantir vigilância regulatória 24/7 sobre os canais digitais das clínicas médicas cadastradas, prevenindo infrações éticas à Resolução CFM nº 2.336/2023 e violações à LGPD sem necessidade de intervenção humana constante.

### Critérios de Aceite
- [x] Campo de configuração de Cron no bloco "1. Identificação do Agente & Alvo Oficial" na interface do Cockpit de Agentes.
- [x] Seletor rápido de periodicidades com presets (a cada 6h [recomendado], 1h, 12h, diário às 03:00, 15 min [homologação] e personalizado).
- [x] Motor de agendamento contínuo em background integrado ao BullMQ e com fallback por timer ativo.
- [x] Disparo automático das auditorias deontológicas com registro de logs operacionais e geração de laudos formais no MongoDB.
- [x] Persistência correta do campo \`cronSchedule\` no MongoDB Atlas.

---

## 🏗️ Estágio 2: Arquitetura & Engenharia Full-Stack (@software-architect & @backend-engineer)
- **Serviço de Agendamento:** \`AuditSchedulerService\` implementado com validação estrita de 5 campos cron UNIX (\`cron-parser\`), sincronização em memória e integração ao BullMQ (\`auditQueue\`).
- **Controlador de Agentes:** \`agentController.ts\` atualizado com validação de cron no Zod e persistência via Prisma.
- **Frontend Cockpit:** \`AgentsPage.tsx\` atualizado com controles reativos de periodicidade no Bloco 1 e no modal de cadastro manual, além de indicador visual nos cards de agentes.
- **Workers e Bootstrap:** \`index.ts\` e \`worker.ts\` inicializam o agendador e processam os jobs periódicos.

---

## 🛡️ Estágio 3 & 4: Segurança, Testes & Observabilidade (@security-engineer & @test-specialist)
- [x] Validação sintática rigorosa com bloqueio de expressões malformadas ou campos inválidos.
- [x] Desduplicação de disparos para evitar concorrência e sobrecarga da URL alvo.
- [x] Testes unitários do agendador: 7 testes em \`dashboard/src/__tests__/auditScheduler.test.ts\` (100% aprovados).
- [x] Suite completa de testes automatizados: 12 arquivos, 58 testes aprovados.
- [x] Builds de produção compilados com sucesso (\`dashboard\` e \`dashboard-web\`).

---

## 🚀 Estágio 5: Git & Rastreabilidade (@devops-engineer)
- **Branch:** \`feature/cockpit-telemetria-revogado-normas\`
- **Commit:** \`783ecf8\` (\`feat(scheduler): agendamento continuo de auditorias deontologicas e campo cron (refs #PVTI_lADOFOE58c4BqQlUzhG_BQQ)\`)
- **Status no Board:** [In review]`;

  const mutation = `
    mutation UpdateDraftIssue($itemId: ID!, $body: String!) {
      updateProjectV2DraftIssue(input: {
        draftIssueId: $itemId
        body: $body
      }) {
        draftIssue {
          id
        }
      }
    }
  `;

  await requestGraphQL(mutation, { itemId, body: updatedBody });
  console.log('✅ Corpo do item atualizado no GitHub Projects Board!');
}

main().catch(console.error);
