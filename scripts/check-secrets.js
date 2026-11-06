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

https.get({
  hostname: 'api.github.com',
  path: '/repos/Conform-AI-health/conform-ai-health/actions/secrets',
  headers: {
    'User-Agent': 'ConformIA',
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github.v3+json'
  }
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => console.log('Secrets:', d));
});

