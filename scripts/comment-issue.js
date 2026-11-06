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

const comment = {
  body: `🚀 **Branch vinculada e tarefas concluídas com sucesso!**

- **Branch Dedicada:** [\`feat/issue-54-batch-scraping-cfm\`](https://github.com/Conform-AI-health/conform-ai-health/tree/feat/issue-54-batch-scraping-cfm)
- **Commit:** [\`cc3ceae\`](https://github.com/Conform-AI-health/conform-ai-health/commit/cc3ceae)
- **PR Draft:** https://github.com/Conform-AI-health/conform-ai-health/pull/new/feat/issue-54-batch-scraping-cfm
- **Status do Pipeline:** Concluído com sucesso nos 5 estágios (@compliance-specialist ➔ @software-architect / @backend-engineer ➔ @security-engineer ➔ @test-specialist ➔ Git Branch).`
};

const payload = JSON.stringify(comment);

const req = https.request({
  hostname: 'api.github.com',
  path: '/repos/Conform-AI-health/conform-ai-health/issues/54/comments',
  method: 'POST',
  headers: {
    'User-Agent': 'ConformIA-Bot',
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => console.log('Comment created, status:', res.statusCode));
});

req.write(payload);
req.end();

