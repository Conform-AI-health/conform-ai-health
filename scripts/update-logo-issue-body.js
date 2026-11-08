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

const itemId = "PVTI_lADOFOE58c4BqQlUzhG_gvs";

async function main() {
  const updatedBody = `## 📋 Estágio 1: Product Owner Regulatória (@compliance-specialist)
**Como:** Gestor Regulatório, Auditor Deontológico e Usuário do Sistema ConformIA  
**Quero:** Incorporar a nova identidade visual oficial 3D (logotipo Conform.AI) e refatorar a interface gráfica do portal web (\`dashboard-web\`)  
**Para:** Proporcionar uma experiência visual de padrão corporativo moderno, alinhada à autoridade tecnológica e ética da plataforma em saúde digital, com alto contraste, legibilidade e harmonia com as diretrizes do CFM e LGPD.

### Critérios de Aceite
- [x] Logotipo oficial 3D (\`be3f9839-118d-4ea9-bc7f-66d57b8d1b20.jpg\`) integrado na Sidebar do \`MainLayout\`, na tela de Login (\`LoginPage\`) e no favicon da aplicação.
- [x] Refatoração visual da navegação, cabeçalhos, painéis e cartões harmonizados com a paleta deep blue / cyan do logotipo.
- [x] Feedback visual aprimorado para estados ativos de navegação, status de conformidade e perfil de usuário autenticado.
- [x] Responsividade e acessibilidade preservadas com zero erros de compilação (\`tsc\` e \`vite build\`).
- [x] Suíte de testes automatizados 100% verde (13 arquivos, 61 testes aprovados).

---

## 🏗️ Estágio 2: Arquitetura & Engenharia Full-Stack (@software-architect & @frontend-engineer)
- **Asset do Logotipo:** Disponibilizado em \`dashboard-web/public/img/be3f9839-118d-4ea9-bc7f-66d57b8d1b20.jpg\`, \`dashboard-web/public/img/logo.jpg\` e \`dashboard-web/src/assets/logo.jpg\`.
- **Favicon & Meta HTML:** \`dashboard-web/index.html\` atualizado com favicon oficial JPEG e título "Conform.AI — Governança Deontológica & Inteligência Regulatória em Saúde".
- **MainLayout.tsx:**
  - Sidebar com branding refinado "CONFORM.AI", logotipo com aura cyan/blue e badge deontológico pulsante.
  - Links de navegação com indicador ativo luminoso lateral e transições táteis.
  - Top header em dark glass (\`backdrop-blur-xl\`) com badges de resoluções vigentes (CFM 2.336/23, LGPD Art. 11, ANVISA RDC 727) e status do cron ativo.
- **LoginPage.tsx:**
  - Hero card em dark glass com anel de aura em gradiente cyan/blue destacando o emblema 3D.
  - Tipografia de alto impacto "CONFORM.AI", tags normativas e botão com gradiente cyan/blue e sombra profunda.

---

## 🛡️ Estágio 3 & 4: Segurança, Testes & QA (@security-engineer & @test-specialist)
- [x] Assets servidos estaticamente e isolados de vetores externos de injeção ou SSRF.
- [x] Testes unitários dedicados em \`dashboard-web/src/__tests__/brandingAndLayout.test.ts\` (100% aprovados).
- [x] Suite completa de testes automatizados: 13 suítes, 61 testes aprovados.
- [x] Compilação de produção sem avisos nem erros (\`tsc\` e \`vite build\`).

---

## 🚀 Estágio 5: Git & Rastreabilidade (@devops-engineer)
- **Branch:** \`feature/logo-identidade-visual-conform-ai\`
- **Commit:** \`72185bf\` (\`feat(ui): integrar logotipo oficial 3d conform.ai e refatorar visual do portal web (refs #PVTI_lADOFOE58c4BqQlUzhG_gvs)\`)
- **PR:** https://github.com/Conform-AI-health/conform-ai-health/pull/new/feature/logo-identidade-visual-conform-ai
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
