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

const payload = JSON.stringify({
  title: 'feat: refresh token (1h), recuperacao de senha & notificacao de laudo via resend, circuit breaker e bulkhead',
  head: 'feat/issue-auth-email-resilience',
  base: 'main',
  body: `## 📋 Resumo da Demanda (Segurança, Resiliência e Notificações)

Esta PR atende integralmente à demanda de autenticação avançada, notificações transacionais de saúde via Resend e resiliência arquitetural distribuída, aderindo às diretrizes do \`.agents/rules/plan-pipeline.md\`.

---

### 🎯 Entregáveis Implementados:

#### 1. Autenticação com Refresh Token e Expiração de 1 hora
- Redução estrita da expiração do **JWT Access Token** de 7 dias para **1 hora** (\`1h\`).
- Implementação de **Refresh Token** seguro (7 dias, assinado criptograficamente) com rotação automática na rota \`POST /api/v1/auth/refresh\`.
- Armazenamento seguro de refresh token no MongoDB do usuário (\`User.refreshToken\`).
- Interceptor HTTP transparente no frontend (\`dashboard-web/src/services/api.ts\`) interceptando 401, renovando token silenciosamente e reprocessando a requisição sem deslogar o usuário.
- Atualização do \`AuthContext\` para gerenciar e persistir o par de tokens.

#### 2. Recuperação de Senha Segura via Resend Email API
- Serviço de mensageria transacional dedicado: \`dashboard/src/services/emailService.ts\` integrando o SDK oficial \`resend\`.
- Rota \`POST /api/v1/auth/forgot-password\` gerando token temporário de 1 hora com hash e despachando e-mail formatado e estilizado para o usuário.
- Rota \`POST /api/v1/auth/reset-password\` validando token não expirado, gerando hash \`bcrypt\` da nova senha e invalidando sessões anteriores.
- UI completa:
  - Botão e modal "Esqueci minha senha" na página de login (\`LoginPage.tsx\`).
  - Nova página de redefinição de senha segura (\`ResetPasswordPage.tsx\`) com validação de senha forte e rota registrada no React Router (\`/reset-password\`).

#### 3. Notificação Automática de Laudo Finalizado por E-mail
- Integração no ciclo de vida de auditoria (\`dashboard/src/services/auditExecutionService.ts\`):
  - Ao concluir a análise e persistir o status \`COMPLETED\`, consulta os dados da clínica auditada (\`Client\` e \`User\`).
  - Dispara e-mail profissional via \`EmailService.sendAuditReportCompletedEmail\` contendo o score de conformidade CFM 2.336/2023, nível de risco, resumo executivo e quantidade de não conformidades.

#### 4. Resiliência Arquitetural: Circuit Breaker & Bulkhead
- **Circuit Breaker Pattern** (\`dashboard/src/shared/circuitBreaker.ts\`):
  - Estados finitos (\`CLOSED\`, \`OPEN\`, \`HALF_OPEN\`), limiar de falhas consecutivas, timeout configurável e fallback de contingência.
  - Integrado e protegendo chamadas a provedores de IA (Google Gemini e Ollama) e à API do Firecrawl.
- **Bulkhead Pattern** (\`dashboard/src/shared/bulkhead.ts\`):
  - Limite de concorrência e piscina de filas isoladas (\`maxConcurrent\`, \`maxQueue\`).
  - Impede que gargalos de chamadas externas derrubem o servidor, isolando o consumo de CPU/I/O.

---

### 🧪 Testes Automatizados & Qualidade (QA):
- Nova suíte de testes unitários e de integração: \`dashboard/src/__tests__/authAndResilience.test.ts\` cobrindo 11 cenários (Refresh Token 1h, Forgot/Reset, Circuit Breaker, Bulkhead e EmailService).
- Suíte completa do backend executada com **64 testes verdes (100% passing)**.
- Compilação do TypeScript do Backend (\`tsc\`) concluída com **0 erros**.
- Compilação do Frontend Vite (\`tsc && vite build\`) concluída com **0 erros**.

---

### 🔗 Rastreabilidade (GitHub Projects #3):
- Item do Card: \`PVTI_lADOFOE58c4BqQlUzhHBCSA\` (movido para \`In review\`)
- Commit: \`6bcd4a6\`
`
});

const req = https.request({
  hostname: 'api.github.com',
  path: '/repos/Conform-AI-health/conform-ai-health/pulls',
  method: 'POST',
  headers: {
    'User-Agent': 'ConformIA-Bot',
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
}, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      if (json.html_url) {
        console.log(`🚀 Pull Request criada com sucesso: ${json.html_url}`);
      } else {
        console.log('Resposta da API:', JSON.stringify(json, null, 2));
      }
    } catch (e) {
      console.log('Erro ao analisar resposta:', data);
    }
  });
});

req.on('error', err => {
  console.error('Erro na requisição da PR:', err);
});

req.write(payload);
req.end();
