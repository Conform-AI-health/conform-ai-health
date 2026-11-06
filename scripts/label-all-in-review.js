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

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'User-Agent': 'ConformIA',
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(d) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: d });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function addInReviewLabelToAll() {
  console.log('Buscando issues abertas...');
  const res = await request('GET', '/repos/Conform-AI-health/conform-ai-health/issues?state=open&per_page=100');
  const issues = res.data;
  console.log(`Encontradas ${issues.length} issues abertas.`);

  for (const issue of issues) {
    if (issue.pull_request) continue; // Pular PRs
    const currentLabels = issue.labels.map(l => l.name);
    if (!currentLabels.includes('in-review')) {
      const updatedLabels = [...currentLabels, 'in-review'];
      const patchRes = await request('PATCH', `/repos/Conform-AI-health/conform-ai-health/issues/${issue.number}`, {
        labels: updatedLabels
      });
      console.log(`Issue #${issue.number} [${issue.title.slice(0, 40)}...] marcada com 'in-review': ${patchRes.status === 200 ? 'OK' : 'FALHA'}`);
    } else {
      console.log(`Issue #${issue.number} já possui 'in-review'.`);
    }
  }
}

addInReviewLabelToAll().catch(console.error);

