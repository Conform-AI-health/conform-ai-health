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

function request(path) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'api.github.com',
      path,
      headers: {
        'User-Agent': 'ConformIA',
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github.v3+json'
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(d));
        } catch (e) {
          resolve({ raw: d });
        }
      });
    }).on('error', reject);
  });
}

async function checkOrg() {
  const org = await request('/orgs/Conform-AI-health');
  console.log('Org info:', org.login, '| Plan:', org.plan?.name, '| Type:', org.type);

  const membership = await request('/orgs/Conform-AI-health/memberships/03fred');
  console.log('User membership in org:', membership);
}

checkOrg().catch(console.error);

