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
console.log('Current token prefix:', token.slice(0, 20) + '...' + token.slice(-5));

const query = `
  query {
    viewer {
      login
    }
    organization(login: "Conform-AI-health") {
      viewerCanAdminister
      projectV2(number: 3) {
        id
        title
        viewerCanUpdate
      }
    }
  }
`;

const payload = JSON.stringify({ query });

const req = https.request({
  hostname: 'api.github.com',
  path: '/graphql',
  method: 'POST',
  headers: {
    'User-Agent': 'ConformIA',
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
}, res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => console.log('GraphQL Result:', JSON.stringify(JSON.parse(d), null, 2)));
});

req.write(payload);
req.end();

