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

const PROJECT_ID = 'PVT_kwDOFOE58c4BqQlU';
const STATUS_FIELD_ID = 'PVTSSF_lADOFOE58c4BqQlUzhoof5Q';
const IN_REVIEW_OPTION_ID = 'df73e18b';

const itemIds = [
  'PVTI_lADOFOE58c4BqQlUzhGuJx0', // Task 1
  'PVTI_lADOFOE58c4BqQlUzhGuJyo', // Task 2
  'PVTI_lADOFOE58c4BqQlUzhGuJzw'  // Task 3
];

async function main() {
  for (const itemId of itemIds) {
    const mutation = `
      mutation UpdateStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(
          input: {
            projectId: $projectId
            itemId: $itemId
            fieldId: $fieldId
            value: { singleSelectOptionId: $optionId }
          }
        ) {
          projectV2Item {
            id
          }
        }
      }
    `;
    const res = await requestGraphQL(mutation, {
      projectId: PROJECT_ID,
      itemId,
      fieldId: STATUS_FIELD_ID,
      optionId: IN_REVIEW_OPTION_ID
    });
    console.log(`Updated ${itemId} to In review:`, JSON.stringify(res));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
