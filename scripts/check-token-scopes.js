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
  path: '/user',
  headers: {
    'User-Agent': 'Node',
    'Authorization': 'Bearer ' + token
  }
}, res => {
  console.log('Status:', res.statusCode);
  console.log('Scopes:', res.headers['x-oauth-scopes']);
  console.log('Accepted Scopes:', res.headers['x-accepted-oauth-scopes']);
  console.log('GitHub-Authentication-Token-Expiration:', res.headers['github-authentication-token-expiration']);
  console.log('Headers:', res.headers);
});

