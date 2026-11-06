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

const mutation = `
  mutation {
    updateProjectV2ItemFieldValue(input: {
      projectId: "PVT_kwDOFOE58c4BqQlU",
      itemId: "PVTI_lADOFOE58c4BqQlUzhGsEjs",
      fieldId: "PVTSSF_lADOFOE58c4BqQlUzhoof5Q",
      value: {
        singleSelectOptionId: "df73e18b"
      }
    }) {
      projectV2Item {
        id
      }
    }
  }
`;

const payload = JSON.stringify({ query: mutation });

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
  res.on('end', () => {
    console.log('Status code:', res.statusCode);
    console.log('Headers:', res.headers['x-accepted-github-permissions']);
    console.log('Response:', JSON.stringify(JSON.parse(d), null, 2));
  });
});

req.write(payload);
req.end();

