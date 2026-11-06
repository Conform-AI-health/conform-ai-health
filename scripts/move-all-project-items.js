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
        'User-Agent': 'ConformIA',
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(d));
        } catch (e) {
          resolve({ error: e, raw: d });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function moveAllItemsToReview() {
  const projectId = "PVT_kwDOFOE58c4BqQlU";
  const statusFieldId = "PVTSSF_lADOFOE58c4BqQlUzhoof5Q";
  const inReviewOptionId = "df73e18b"; // "In review"

  console.log('1. Listando todos os itens do Projeto 3...');
  let hasNext = true;
  let cursor = null;
  let allItems = [];

  while (hasNext) {
    const listQuery = `
      query($cursor: String) {
        organization(login: "Conform-AI-health") {
          projectV2(number: 3) {
            items(first: 50, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                fieldValueByName(name: "Status") {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    optionId
                  }
                }
                content {
                  ... on Issue {
                    number
                    title
                  }
                }
              }
            }
          }
        }
      }
    `;

    const res = await requestGraphQL(listQuery, { cursor });
    const itemsData = res.data?.organization?.projectV2?.items;
    if (!itemsData) {
      console.error('Falha ao listar itens:', JSON.stringify(res, null, 2));
      return;
    }

    allItems.push(...itemsData.nodes);
    hasNext = itemsData.pageInfo.hasNextPage;
    cursor = itemsData.pageInfo.endCursor;
  }

  console.log(`Total de itens encontrados: ${allItems.length}`);

  const updateMutation = `
    mutation($input: UpdateProjectV2ItemFieldValueInput!) {
      updateProjectV2ItemFieldValue(input: $input) {
        projectV2Item {
          id
        }
      }
    }
  `;

  let successCount = 0;
  let failCount = 0;

  for (const item of allItems) {
    const currentStatus = item.fieldValueByName?.name;
    const title = item.content?.title || item.id;
    const number = item.content?.number ? `#${item.content.number}` : '';

    if (currentStatus === 'In review') {
      console.log(`Item ${number} (${title.slice(0, 30)}...) já está em "In review".`);
      continue;
    }

    const mutationRes = await requestGraphQL(updateMutation, {
      input: {
        projectId,
        itemId: item.id,
        fieldId: statusFieldId,
        value: {
          singleSelectOptionId: inReviewOptionId
        }
      }
    });

    if (mutationRes.data?.updateProjectV2ItemFieldValue?.projectV2Item) {
      console.log(`✅ ${number} (${title.slice(0, 30)}...) -> Movido para "In review" com sucesso!`);
      successCount++;
    } else {
      console.error(`❌ ${number} Falha ao mover:`, mutationRes.errors?.[0]?.message || JSON.stringify(mutationRes));
      failCount++;
      // Se for erro de permissão do token, não adianta continuar em loop
      if (mutationRes.errors?.[0]?.message?.includes('Resource not accessible')) {
        console.error('\n⚠️ ATENÇÃO: O token atual não possui a permissão "Projects: Read and write" da organização.');
        break;
      }
    }
  }

  console.log(`\nResumo: ${successCount} movidos com sucesso, ${failCount} falhas.`);
}

moveAllItemsToReview().catch(console.error);

