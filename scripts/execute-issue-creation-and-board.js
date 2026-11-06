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
  console.error('GITHUB_TOKEN not found');
  process.exit(1);
}

function request(method, path, body = null, isGraphQL = false) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path: isGraphQL ? '/graphql' : path,
      method: method,
      headers: {
        'User-Agent': 'ConformIA-Bot',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject({ status: res.statusCode, data: json });
          }
        } catch (e) {
          reject({ status: res.statusCode, raw: data, error: e });
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const issueTitle = `[STORY] Ingestão em Lote e Varredura de Diretórios de Normas CFM (GitHub Trees & Portais)`;

const issueBody = `## 📋 Estágio 1: Product Owner (P.O.) - @compliance-specialist
**Épico:** Ingestão Contínua, Varredura Regulatória e Base Vetorial de Deontologia em Saúde

### 🎯 Contexto e Necessidade de Negócio
No ecossistema médico e hospitalar, normas e resoluções (ex: Conselho Federal de Medicina - CFM, ANVISA, ANS) frequentemente residem agrupadas em repositórios e diretórios anuais ou temáticos (ex: \`https://github.com/md-augustolinhares/cfm-normas/tree/main/normas/resolucoes/1957\`).
Anteriormente, o sistema raspava apenas páginas HTML isoladas ou arquivos únicos. Ao submeter uma URL de diretório, ocorria falha ou ingestão incompleta de uma página intermediária.
Esta história estabelece a capacidade de inspecionar diretórios remotos, listar recursivamente todos os documentos normativos (Markdown/HTML/PDF) e persistir cada norma como um documento autônomo na coleção \`ScrapedPage\` do MongoDB, com marcação regulatória \`tags: ['CFM']\` e metadados completos.

### 📝 Critérios de Aceitação (User Stories)
1. **Detecção Automática:** Ao colar qualquer URL de repositório/árvore GitHub (\`/tree/\` ou \`/blob/\`), a UI e a API devem identificar automaticamente como diretório/varredura em lote.
2. **Ingestão Atômica por Documento:** Cada resolução ou norma contida no diretório deve ser baixada, parseada e indexada como um documento individual no MongoDB.
3. **Resiliência e Concorrência:** Download paralelo com controle de concorrência (p=5) e tolerância a falhas parciais sem interromper o lote.
4. **Extração e Enriquecimento:** Detecção do título formal (ex: "RESOLUÇÃO CFM Nº X/ANO"), sumário, entidades e contagem de tokens para RAG.
5. **Feedback Visual:** A interface web deve exibir badge informativo, contador de documentos e tabela atualizada em tempo real.

---

## 🏗️ Estágio 2: Arquitetura & Software Engineer (@software-architect & @backend-engineer)
- **Serviço Scraper (\`scraperService.ts\`):**
  - Implementação das funções \`isGitHubTreeUrl\`, \`isGitHubBlobUrl\`, \`parseGitHubUrl\` e \`scrapeGitHubTree\`.
  - Integração com GitHub Contents API com fallback para Raw Content.
  - Concurrency limiter nativo para evitar rate limit ou esgotamento de memória.
- **Controller Backend (\`scrapedPageController.ts\`):**
  - Rota \`POST /api/scraped-pages/scrape\` adaptada para branching de lote vs arquivo único.
  - Upsert idempotente no MongoDB Atlas via Prisma ORM (\`urlHash\`).
  - Registro de auditoria e telemetria no \`SystemLog\`.
- **Frontend Cockpit (\`ScrapingPage.tsx\`):**
  - Badge visual dinâmico com chips de diretório detectado.
  - Notificação de sucesso com sumário: total de documentos baixados, processados e tamanho em KB.

---

## 🛡️ Estágio 3: Segurança & DevSecOps (@security-engineer)
- **SSRF Defense:** Validação de formato de URL e bloqueio de IPs privados ou localhost na ingestão externa.
- **Payload & Memory Protection:** Limite estrito de 50 arquivos por requisição e teto de tamanho por arquivo (10MB) contra ataques de exaustão de recursos (Denial of Service).
- **Sanitização de Dados:** Remoção de scripts maliciosos, stripping de tags malformadas e escape de conteúdo antes da persistência no banco.

---

## 🧪 Estágio 4: Testes e Garantia de Qualidade (@test-specialist)
- **Suíte de Testes Criada:** \`dashboard/src/__tests__/scraperBatch.test.ts\`
- **Cenários Automatizados:**
  - Validação de identificação de URLs de árvore vs arquivos únicos.
  - Extração de metadados, títulos formais e contagem de tokens por documento.
  - Concorrência de download simulada e tolerância a erros.
- **Validação em Produção/Staging:**
  - Varredura real validada contra \`https://github.com/md-augustolinhares/cfm-normas/tree/main/normas/resolucoes/1957\`.
  - 8 resoluções persistidas com sucesso e visíveis no dashboard.

---
**Status da Pipeline:** Implementado & Testado. Movendo issue para Review no GitHub Projects.`;

async function run() {
  console.log('1. Criando GitHub Issue formal...');
  const newIssue = await request('POST', '/repos/Conform-AI-health/conform-ai-health/issues', {
    title: issueTitle,
    body: issueBody,
    labels: ['user-story', 'padrão-po', 'compliance', 'backend', 'frontend']
  });

  const issueNumber = newIssue.number;
  const issueNodeId = newIssue.node_id;
  const issueHtmlUrl = newIssue.html_url;
  console.log(`✅ Issue #${issueNumber} criada com sucesso! URL: ${issueHtmlUrl}`);
  console.log(`   Node ID: ${issueNodeId}`);

  console.log('\n2. Adicionando Issue ao GitHub Project 3 (Conform.AI - Backlog & Roadmap)...');
  const projectId = "PVT_kwDOFOE58c4BqQlU";
  const statusFieldId = "PVTSSF_lADOFOE58c4BqQlUzhoof5Q";
  const inReviewOptionId = "df73e18b"; // "In review"

  const addMutation = {
    query: `
      mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
          item {
            id
          }
        }
      }
    `,
    variables: {
      projectId: projectId,
      contentId: issueNodeId
    }
  };

  const addItemRes = await request('POST', '/graphql', addMutation, true);
  const projectItemId = addItemRes.data?.addProjectV2ItemById?.item?.id;
  console.log(`✅ Item adicionado ao Projeto 3! Item ID: ${projectItemId}`);

  console.log('\n3. Movendo status da tarefa para [In review] no Project Board...');
  const updateStatusMutation = {
    query: `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValueSingleSelectInput!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId,
          itemId: $itemId,
          fieldId: $fieldId,
          value: $value
        }) {
          projectV2Item {
            id
          }
        }
      }
    `,
    variables: {
      projectId: projectId,
      itemId: projectItemId,
      fieldId: statusFieldId,
      value: {
        singleSelectOptionId: inReviewOptionId
      }
    }
  };

  await request('POST', '/graphql', updateStatusMutation, true);
  console.log(`✅ Status no Project Board atualizado para "In review" com sucesso!`);

  console.log(JSON.stringify({
    issueNumber,
    issueHtmlUrl,
    issueNodeId,
    projectItemId
  }));
}

run().catch(err => {
  console.error('Erro na execução:', err);
  process.exit(1);
});

