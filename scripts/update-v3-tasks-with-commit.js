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

const COMMIT_URL = "https://github.com/Conform-AI-health/conform-ai-health/commit/f1cc1ec";
const PR_URL = "https://github.com/Conform-AI-health/conform-ai-health/pull/new/feature/cockpit-telemetria-revogado-normas";
const BRANCH = "feature/cockpit-telemetria-revogado-normas";

const taskUpdates = {
  'PVTI_lADOFOE58c4BqQlUzhG4xX8': {
    title: '[TASK 1] Simplificação do Cockpit do Auditor: Remoção de Abas Duplicadas e Limpeza de Header',
    body: `## 📋 Estágio 1: Product Owner Regulatória (@compliance-specialist)
**Como:** Auditor Deontológico e Gestor de Conformidade  
**Quero:** Que as abas 'Nova Auditoria Imediata' e 'Últimos Laudos Concluídos' sejam removidas da tela do Cockpit do Auditor (\`DashboardPage.tsx\`), juntamente com a frase de subtítulo 'Monitoramento analítico em tempo real de conformidade com a Resolução CFM nº 2.336/2023 e LGPD.'  
**Para:** Eliminar redundâncias na experiência do usuário, centralizando o disparo no Cockpit de Agentes e a consulta de laudos na página dedicada de Laudos, mantendo a tela Cockpit focada em Panorama e Indicadores Analíticos.

---

## 🏛️ Contexto Regulatório & Deontológico
- **Resolução CFM nº 2.336/2023:** O disparo imediato e a parametrização de agentes pertencem ao módulo de Governança de Agentes (\`/agents\`), onde as diretrizes comportamentais e canais oficiais residem em corpo único.
- **Minimização Cognitiva (UX em Saúde):** Auditores necessitam de visões limpas de métricas e KPIs sem formulários concorrentes ou duplicados.

---

## 🎯 Critérios de Aceite (BDD / Gherkin)
\`\`\`gherkin
Cenário: Acesso à tela Cockpit do Auditor Deontológico
  Dado que o auditor acessa a rota /cockpit
  Então a interface deve exibir diretamente o painel de Panorama & Indicadores
  E as abas "Nova Auditoria Imediata" e "Últimos Laudos Concluídos" não devem ser exibidas
  E a frase "Monitoramento analítico em tempo real de conformidade com a Resolução CFM nº 2.336/2023 e LGPD." não deve constar no cabeçalho
\`\`\`

---

## 🚀 Rastreabilidade & Entrega Git
- **Branch:** [\`${BRANCH}\`](${PR_URL})
- **Commit:** [${COMMIT_URL}](${COMMIT_URL})
- **Status:** Implementado, validado e movido para Code Review.`
  },
  'PVTI_lADOFOE58c4BqQlUzhG4xYw': {
    title: '[TASK 2] Observabilidade de IA: Modal / Dialog Interativo para Fontes e Normas Utilizadas',
    body: `## 📋 Estágio 1: Product Owner Regulatória (@compliance-specialist)
**Como:** Auditor de IA e Engenheiro de Conformidade  
**Quero:** Que na aba 'Detalhamento de Tokens e Fontes por Auditoria' (\`LogsTelemetryPage.tsx\`) a listagem de 'Fontes / Normas Utilizadas' seja encapsulada em um ícone interativo com contador que abre um Dialog/Modal estruturado  
**Para:** Permitir visualização limpa e escalável mesmo quando a auditoria empregar dezenas de arquivos e normas regulatórias (evitando quebras e overflow na tabela).

---

## 🏛️ Contexto Regulatório & Deontológico
- **Rastreabilidade e Explicabilidade Regulatória (AI Governance):** O auditor tem direito de inspecionar individualmente cada resolução (CFM, LGPD, ANS, ANVISA) que nutriu o contexto do modelo de IA.
- **Escalabilidade da Telemetria:** Suporte a auditorias multi-documentos com centenas de arquivos sem degradar o layout visual.

---

## 🎯 Critérios de Aceite (BDD / Gherkin)
\`\`\`gherkin
Cenário: Visualização de normas utilizadas em uma auditoria
  Dado que o auditor está na tabela "Detalhamento de Tokens e Fontes por Auditoria"
  Quando ele visualiza a coluna "Fontes / Normas Utilizadas"
  Então deve ser exibido um botão/ícone com contador de fontes
  E ao clicar no botão, um dialog modal acessível deve abrir listando todas as normas/arquivos utilizados com detalhes e badges
\`\`\`

---

## 🚀 Rastreabilidade & Entrega Git
- **Branch:** [\`${BRANCH}\`](${PR_URL})
- **Commit:** [${COMMIT_URL}](${COMMIT_URL})
- **Status:** Implementado, validado e movido para Code Review.`
  },
  'PVTI_lADOFOE58c4BqQlUzhG4xZs': {
    title: '[TASK 3] Tagging Deontológico: Detecção Automática e Aplicação da Tag REVOGADO',
    body: `## 📋 Estágio 1: Product Owner Regulatória (@compliance-specialist)
**Como:** Motor de Ingestão Regulatória e Auditor de Conformidade  
**Quero:** Que ao realizar o scraping ou upload de qualquer norma ou ato regulatório, caso a palavra "revogado" (ou termos derivados de revogação normativa) seja identificada no conteúdo ou título, a tag 'REVOGADO' seja aplicada automaticamente ao documento  
**Para:** Alertar auditores e impedir que resoluções sem vigência normativa induzam o modelo de IA a decisões ou autuações equivocadas contra instituições de saúde.

---

## 🏛️ Contexto Regulatório & Deontológico
- **Princípio da Segurança Jurídica & Eficácia Normativa (CFM / ANVISA / ANS):** O uso de normas revogadas em pareceres de auditoria deontológica gera nulidade e insegurança jurídica para as instituições fiscalizadas.
- **Auto-Classificação Deontológica:** O motor deve identificar menções expressas a revogações (ex: "revogado", "revogada", "revoga-se", "revogação").

---

## 🎯 Critérios de Aceite (BDD / Gherkin)
\`\`\`gherkin
Cenário: Ingestão de norma com termo de revogação
  Dado uma página, documento PDF ou ato regulatório contendo "revogado" ou "revogada"
  Quando o sistema executar a varredura ou upload
  Então o classificador heurístico deve adicionar a tag "REVOGADO" à lista de tags da norma
  E o documento deve ser indexado no MongoDB com a tag REVOGADO visível nos filtros e tabelas
\`\`\`

---

## 🚀 Rastreabilidade & Entrega Git
- **Branch:** [\`${BRANCH}\`](${PR_URL})
- **Commit:** [${COMMIT_URL}](${COMMIT_URL})
- **Status:** Implementado, validado e movido para Code Review.`
  }
};

async function main() {
  console.log("Atualizando descrição das Draft Issues com link do commit e branch...");
  for (const [draftId, t] of Object.entries(taskUpdates)) {
    const mutation = `
      mutation($input: UpdateProjectV2DraftIssueInput!) {
        updateProjectV2DraftIssue(input: $input) {
          draftIssue {
            id
            title
          }
        }
      }
    `;
    const res = await requestGraphQL(mutation, {
      input: {
        draftIssueId: draftId,
        title: t.title,
        body: t.body
      }
    });
    console.log(`✅ Draft ${draftId} atualizada:`, res?.data?.updateProjectV2DraftIssue?.draftIssue?.title);
  }
}

main().catch(console.error);
