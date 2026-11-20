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
if (!token) {
  console.error("❌ Token do GitHub não encontrado nas variáveis de ambiente!");
  process.exit(1);
}

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

async function run() {
  console.log("🔍 1. Verificando dados do Project Board #3...");
  const projectId = "PVT_kwDOFOE58c4BqQlU";

  const fieldsRes = await requestGraphQL(`
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          title
          fields(first: 20) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options {
                  id
                  name
                }
              }
            }
          }
        }
      }
    }
  `, { projectId });

  const statusField = fieldsRes.data?.node?.fields?.nodes?.find(f => f.name === 'Status');
  const inReviewOption = statusField?.options?.find(o => o.name.toLowerCase().includes('review'));
  const statusFieldId = statusField.id;
  const inReviewOptionId = inReviewOption ? inReviewOption.id : 'df73e18b';

  console.log(`✅ Status Field: ${statusFieldId}, Opção In Review: ${inReviewOptionId}`);

  const createDraftMutation = `
    mutation CreateDraft($projectId: ID!, $title: String!, $body: String!) {
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

  // --- Tarefa 1: Crawler de Normas Legais ---
  const task1Title = `[TASK] Ingestão Atômica e Commit Imediato por Arquivo no Web Crawler de Normas Legais (RAG, Chunking e Persistência)`;
  const task1Body = `## 📋 Estágio 1: Product Owner Regulatória (@compliance-specialist)
**Épico:** Ingestão de Normas Legais, RAG Deontológico & Resiliência Distribuída

### 🎯 Contexto e Necessidade de Negócio
No processo de varredura web e ingestão das normas deontológicas de saúde (CFM, LGPD, ANVISA e ANS), era imperativo eliminar atrasos e represamentos no fatiamento semântico (\`norms_chunk\`) e persistência (\`norms\`). Assim que um arquivo normativo válido é identificado e baixado (HTML, PDF ou DOCX), o pipeline deve processar de imediato os chunks por artigos, gerar embeddings e realizar o commit no MongoDB com telemetria \`[FILE_COMMIT_SUCCESS]\`, sem aguardar o enfileiramento ou telemetria de links filhos.

### 📝 Critérios de Aceitação
- [x] **Processamento Imediato de Arquivo Válido:**
  - Identificado um arquivo válido e classificado com score de norma legal nos temas de escopo (CFM, LGPD, ANVISA, ANS), o RAG, chunking por artigos e salvamento no MongoDB ocorrem imediatamente.
  - Links filhos só são registrados e enfileirados após o commit do arquivo atual, mantendo continuidade mesmo se houver falha de arquivo individual.
- [x] **Telemetria de Links Otimizada em Lote:**
  - Criação do método \`LinkTraceService.recordMany\` realizando \`createMany\` em lote no MongoDB para registrar todos os links descobertos da página em uma única ida à rede, eliminando round-trips sequenciais que atrasavam o processo.
- [x] **Fallback Defensivo de Embeddings (Regra 4.3):**
  - Caso ocorra lentidão, cota excedida ou timeout na API externa de embeddings, o arquivo normativo e seus chunks são commitados imediatamente com a flag e tag \`EMBEDDING_PENDING\` e \`embedding_model: 'PENDING_REINDEX'\`, permitindo reindexação em background via \`reindexNormEmbeddings.ts\` sem abortar o salvamento da norma.
- [x] **Telemetria e Observabilidade por Arquivo (Regra 5):**
  - Emissão mandatória do log \`[FILE_COMMIT_SUCCESS]\` tanto para novas normas criadas (\`created\`), novas versões (\`updated_version\`) quanto para confirmações de integridade idempotente (\`skipped_idempotent\`).
  - Emissão de \`[EMBEDDING_PENDING]\` (WARN) sempre que houver necessidade de reindexação vetorial posterior.
- [x] **Qualidade & Testes (Regra 6 & QA):**
  - 18 testes unitários e de contrato 100% verdes cobrindo \`legalNormCrawler.test.ts\` e \`firecrawlContract.test.ts\`.
  - Typecheck TypeScript do dashboard com 0 erros (\`tsc --noEmit\`).

---

## ⚙️ Estágio 2: Engenharia Backend & Arquitetura (@backend-specialist, @architect)
- Refatoração do loop principal em \`dashboard/src/services/legalNormCrawlerService.ts\`:
  - Reordenação da ordem de execução: chunking, embedding e \`persistNormWithIdempotency\` antes de \`enqueueChildLinks\`.
  - Implementação de fallback resiliente com log de aviso e marcação semântica em caso de indisponibilidade de IA.
  - \`dashboard/src/shared/linkTrace.ts\`: adição de \`LinkTraceService.recordMany\` para telemetria em batch.

---

## 🛡️ Estágio 3: Auditoria de Segurança & DevSecOps (@security-reviewer)
- Garantia inalterada das validações anti-SSRF (\`validateSafeUrlAsync\`).
- Proteção contra DoS e limite defensivo de 25MB por arquivo.
- Normas revogadas permanecem sem geração de chunks vetoriais (\`dbStatus === 'REVOGADA'\`), atendendo à Regra 4.3.

---

## 🧪 Estágio 4: QA Gate & Testes Automatizados (@test-specialist)
- \`npm --prefix dashboard test src/tests/legalNormCrawler.test.ts\`: 12/12 aprovados.
- \`npm --prefix dashboard test src/tests/firecrawlContract.test.ts\`: 6/6 aprovados.
- \`npx tsc --noEmit --project dashboard/tsconfig.json\`: 0 erros.
`;

  console.log("\n📌 Criando Item 1 no Board #3 (Crawler de Normas)...");
  const res1 = await requestGraphQL(createDraftMutation, {
    projectId,
    title: task1Title,
    body: task1Body
  });

  const item1Id = res1.data?.addProjectV2DraftIssue?.projectItem?.id;
  if (!item1Id) {
    console.error("❌ Falha ao criar Item 1:", JSON.stringify(res1));
    process.exit(1);
  }
  console.log(`✅ Item 1 criado no Board #3! ID: ${item1Id}`);

  await requestGraphQL(setStatusMutation, {
    projectId,
    itemId: item1Id,
    fieldId: statusFieldId,
    optionId: inReviewOptionId
  });
  console.log(`✅ Item 1 posicionado na coluna [In review] do Board #3!`);

  // --- Tarefa 2: Agente Especialista em MongoDB ---
  const task2Title = `[TASK] Implementação do Agente Especialista em MongoDB e Governança NoSQL (@mongodb-specialist)`;
  const task2Body = `## 📋 Estágio 1: Product Owner Regulatória (@compliance-specialist)
**Épico:** Governança Arquitetural, Banco de Dados NoSQL e Atlas Vector Search

### 🎯 Contexto e Necessidade de Negócio
Com o crescimento exponencial do acervo de normas regulatórias e dos dados de auditoria deontológica, é indispensável contar com um agente especialista dedicado à governança do MongoDB 7+, modelagem no Prisma ORM, otimização de índices (ESR, multikey para tags), operações em lote idempotentes (\`bulkWrite\`) e busca vetorial de alta performance no Atlas Vector Search.

### 📝 Critérios de Aceitação
- [x] Criação da especificação do agente em \`.agents/agents/mongodb-specialist.md\` com perfil, missões e responsabilidades claras.
- [x] Criação da skill dedicada em \`.agents/skills/mongodb-specialist/SKILL.md\` com guias de schema design, busca vetorial, ESR e pipelines de agregação.
- [x] Integração do agente ao fluxo de governança do \`.agents/rules/architecture-rules.md\` e \`.agents/rules/plan-pipeline.md\`.
`;

  console.log("\n📌 Criando Item 2 no Board #3 (Especialista MongoDB)...");
  const res2 = await requestGraphQL(createDraftMutation, {
    projectId,
    title: task2Title,
    body: task2Body
  });

  const item2Id = res2.data?.addProjectV2DraftIssue?.projectItem?.id;
  if (item2Id) {
    console.log(`✅ Item 2 criado no Board #3! ID: ${item2Id}`);
    await requestGraphQL(setStatusMutation, {
      projectId,
      itemId: item2Id,
      fieldId: statusFieldId,
      optionId: inReviewOptionId
    });
    console.log(`✅ Item 2 posicionado na coluna [In review] do Board #3!`);
  }

  console.log("\n🎉 Todas as tarefas foram criadas e posicionadas com sucesso no Board #3!");
}

run().catch(console.error);
