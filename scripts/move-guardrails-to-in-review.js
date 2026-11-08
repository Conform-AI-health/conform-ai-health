const https = require('https');
const { execSync } = require('child_process');

function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const out = execSync("powershell -Command \"[System.Environment]::GetEnvironmentVariable('GITHUB_TOKEN', 'User')\"", { encoding: 'utf8' }).trim();
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
const itemId = "PVTI_lADOFOE58c4BqQlUzhHB1EI";

async function main() {
  const fieldsRes = await requestGraphQL(`
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 20) {
            nodes {
              ... on ProjectV2SingleSelectField {
                id
                name
                options {
                  id
                  name
                }
              }
            }
          }
        }
      }
    }
  `, { projectId });

  const statusField = fieldsRes.data.node.fields.nodes.find(f => f.name === 'Status');
  const inReviewOption = statusField.options.find(o => o.name.toLowerCase().includes('review'));

  if (!inReviewOption) {
    throw new Error('Opção In Review não encontrada');
  }

  console.log(`📋 [Estágio 4] Movendo item ${itemId} para [${inReviewOption.name}] (${inReviewOption.id})...`);
  const setStatusMutation = `
    mutation SetStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $optionId }
      }) {
        projectV2Item {
          id
        }
      }
    }
  `;

  const result = await requestGraphQL(setStatusMutation, {
    projectId,
    itemId,
    fieldId: statusField.id,
    optionId: inReviewOption.id
  });

  console.log('✅ Status atualizado com sucesso no Project Board #3:', JSON.stringify(result));
}

main().catch(err => {
  console.error('❌ Erro ao mover item:', err);
  process.exit(1);
});
