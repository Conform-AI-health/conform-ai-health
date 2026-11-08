const https = require('https');
const { execSync } = require('child_process');

function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const out = execSync('powershell -Command "[System.Environment]::GetEnvironmentVariable(\'GITHUB_TOKEN\', \'User\')"', { encoding: 'utf8' }).trim();
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

const projectId = "PVT_kwDOFOE58c4BqQlU";
const statusFieldId = "PVTSSF_lADOFOE58c4BqQlUzhoof5Q";
const backlogOptionId = "f75ad846";

const task = {
  title: "[TASK] Agendamento Contínuo de Auditorias Deontológicas (Campo Cron & Motor de Execução Periódica)",
  body: `## 📋 Estágio 1: Product Owner Regulatória (@compliance-specialist)
**Como:** Auditor Deontológico e Gestor de Conformidade em Saúde  
**Quero:** Configurar a periodicidade de auditoria contínua através de um campo de Cron no bloco '1. Identificação do Agente & Alvo Oficial' da página de Agentes e dispor de um motor de agendamento automático em background  
**Para:** Garantir vigilância regulatória 24/7 sobre os canais digitais das clínicas médicas cadastradas, prevenindo infrações éticas à Resolução CFM nº 2.336/2023 e violações à LGPD sem necessidade de intervenção humana constante.

---

## 🏛️ Contexto Regulatório & Deontológico
- **Resolução CFM nº 2.336/2023 (Art. 1º, 3º e 14):** A publicidade médica em mídias digitais requer acompanhamento contínuo e tempestivo para identificar ofertas promocionais indevidas, sensacionalismo e ausência de RQE.
- **LGPD em Saúde (Art. 46):** Medidas preventivas contínuas para assegurar a conformidade dos canais digitais de coleta de dados biomédicos de pacientes.

---

## 🎯 Critérios de Aceite (BDD / Gherkin)
\`\`\`gherkin
Cenário: Configuração do intervalo de agendamento contínuo
  Dado que o operador está editando um módulo de agente no Cockpit
  Quando acessar o bloco "1. Identificação do Agente & Alvo Oficial"
  Então deve visualizar o campo "Periodicidade de Auditoria Contínua (Cron)" com opções predefinidas (1h, 6h, 12h, 24h) e expressão personalizada
  E ao salvar a configuração, o valor de cronSchedule deve ser persistido no MongoDB Atlas

Cenário: Execução periódica automática de auditoria
  Dado que existem agentes ativos com cronSchedule configurado e URL alvo válida
  Quando o motor de agendamento AuditSchedulerService identificar que o intervalo de cron foi atingido
  Então uma nova auditoria deve ser automaticamente enfileirada e processada pelo motor de IA
  E um registro de laudo com status e telemetria deve ser gerado no banco de dados
\`\`\`

---

## 🛠️ Entregas Técnicas
1. **Frontend (\`AgentsPage.tsx\`):** Inclusão do campo Cron com presets intuitivos e input formatado no bloco "1. Identificação do Agente & Alvo Oficial", sincronização com estado e salvamento via API.
2. **Backend Controller (\`agentController.ts\`):** Persistência do campo \`cronSchedule\` no método \`update\` e validação sintática do cron via Zod/regex.
3. **Scheduler Engine (\`auditSchedulerService.ts\`):** Motor de agendamento resiliente integrado a BullMQ e verificação periódica que gerencia e dispara auditorias contínuas.
4. **Bootstrapping (\`index.ts\` e \`worker.ts\`):** Inicialização automática do serviço de agendamento na subida da aplicação.
`
};

async function main() {
  console.log("🚀 [Estágio 1] Criando Draft Issue no GitHub Project 3...");
  const mutation = `
    mutation AddTask($projectId: ID!, $title: String!, $body: String!) {
      addProjectV2DraftIssue(input: {
        projectId: $projectId
        title: $title
        body: $body
      }) {
        projectItem {
          id
        }
      }
    }
  `;
  const res = await requestGraphQL(mutation, {
    projectId,
    title: task.title,
    body: task.body
  });

  const itemId = res?.data?.addProjectV2DraftIssue?.projectItem?.id;
  console.log(`✅ Draft Issue criada: ${itemId} - ${task.title}`);

  if (itemId) {
    const setStatusMutation = `
      mutation SetStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { singleSelectOptionId: $optionId }
        }) {
          projectV2Item {
            id
          }
        }
      }
    `;
    await requestGraphQL(setStatusMutation, {
      projectId,
      itemId,
      fieldId: statusFieldId,
      optionId: backlogOptionId
    });
    console.log(`📌 Item ${itemId} posicionado no [Backlog] (Estágio 1 OK)`);

    const fs = require('fs');
    fs.writeFileSync('scripts/current-cron-item.json', JSON.stringify({ itemId, title: task.title }, null, 2));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
