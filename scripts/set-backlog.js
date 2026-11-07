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

async function setBacklog() {
  const projectId = "PVT_kwDOFOE58c4BqQlU";
  const itemId = "PVTI_lADOFOE58c4BqQlUzhGtWnU";
  const statusFieldId = "PVTSSF_lADOFOE58c4BqQlUzhoof5Q";
  const backlogOptionId = "f75ad846";

  const mutation = `
    mutation($input: UpdateProjectV2ItemFieldValueInput!) {
      updateProjectV2ItemFieldValue(input: $input) {
        projectV2Item {
          id
        }
      }
    }
  `;

  const res = await requestGraphQL(mutation, {
    input: {
      projectId,
      itemId,
      fieldId: statusFieldId,
      value: { singleSelectOptionId: backlogOptionId }
    }
  });

  console.log('Result:', JSON.stringify(res, null, 2));
}

setBacklog().catch(console.error);

