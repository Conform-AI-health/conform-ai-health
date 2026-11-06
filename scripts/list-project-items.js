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

function request(query, variables) {
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

async function listAllProjectItems() {
  let hasNext = true;
  let cursor = null;
  let allItems = [];

  while (hasNext) {
    const query = `
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
                    state
                  }
                }
              }
            }
          }
        }
      }
    `;

    const res = await request(query, { cursor });
    const data = res.data?.organization?.projectV2?.items;
    if (!data) {
      console.error('Error fetching project items:', JSON.stringify(res, null, 2));
      break;
    }

    allItems.push(...data.nodes);
    hasNext = data.pageInfo.hasNextPage;
    cursor = data.pageInfo.endCursor;
  }

  console.log(`Total de itens no Projeto 3: ${allItems.length}`);
  allItems.forEach(item => {
    const status = item.fieldValueByName?.name || 'Sem Status';
    const title = item.content?.title || 'Draft Item';
    const num = item.content?.number ? `#${item.content.number}` : '-';
    console.log(`[${status}] ${num} ${title} (Item ID: ${item.id})`);
  });
}

listAllProjectItems().catch(console.error);

