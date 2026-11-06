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

// Let's test updating issue labels on issue 54
const payload = JSON.stringify({ labels: ['user-story', 'padrão-po', 'compliance', 'backend', 'frontend', 'status:in-review'] });

const req = https.request({
  hostname: 'api.github.com',
  path: '/repos/Conform-AI-health/conform-ai-health/issues/54',
  method: 'PATCH',
  headers: {
    'User-Agent': 'ConformIA',
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => console.log('Issue edit test status:', res.statusCode));
});

req.write(payload);
req.end();

