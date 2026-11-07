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

const projectId = "PVT_kwDOFOE58c4BqQlU";
const statusFieldId = "PVTSSF_lADOFOE58c4BqQlUzhoof5Q";
const inProgressOptionId = "47fc9ee4";

const itemIds = [
  "PVTI_lADOFOE58c4BqQlUzhGtvLc", // Task 1: Remover /norms
  "PVTI_lADOFOE58c4BqQlUzhGtvMQ", // Task 2: Blindagem Login
  "PVTI_lADOFOE58c4BqQlUzhGtvNE", // Task 3: CRUD AiModelConfig
  "PVTI_lADOFOE58c4BqQlUzhGtvOM", // Task 4: Refatoração Layout com Abas
];

async function moveItems() {
  console.log("🔨 Movendo as 4 tarefas para In Progress no GitHub Projects...");
  for (const itemId of itemIds) {
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
        value: { singleSelectOptionId: inProgressOptionId }
      }
    });

    console.log(`✅ Item ${itemId} movido para IN PROGRESS.`);
  }
}

moveItems().catch(console.error);
