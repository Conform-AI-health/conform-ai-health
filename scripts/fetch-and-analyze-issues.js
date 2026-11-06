const https = require('https');
const fs = require('fs');

function fetchIssues(page = 1) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/Conform-AI-health/conform-ai-health/issues?state=all&per_page=100&page=${page}`,
      method: 'GET',
      headers: {
        'User-Agent': 'ConformIA-Agent-Analyzer',
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    https.get(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function run() {
  const page1 = await fetchIssues(1);
  const issues = page1.filter(item => !item.pull_request); // apenas issues, descartando PRs
  console.log(`Encontradas ${issues.length} issues.`);

  const summary = issues.map(iss => ({
    number: iss.number,
    title: iss.title,
    state: iss.state,
    labels: iss.labels.map(l => l.name),
    body: iss.body
  }));

  fs.writeFileSync('scripts/issues_dump.json', JSON.stringify(summary, null, 2));
  console.log('Salvo em scripts/issues_dump.json');
}

run().catch(console.error);

