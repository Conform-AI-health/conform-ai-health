const https = require('https');
const { execSync } = require('child_process');

function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const out = execSync('powershell -Command "[System.Environment]::GetEnvironmentVariable(\'GITHUB_TOKEN\', \'User\')"', { encoding: 'utf8' }).trim();
    if (out) return out;
  } catch (e) {}
  try {
    const out = execSync('powershell -Command "[System.Environment]::GetEnvironmentVariable(\'GH_TOKEN\', \'User\')"', { encoding: 'utf8' }).trim();
    if (out) return out;
  } catch (e) {}
  return null;
}

const token = getGitHubToken();
if (!token) {
  console.error('GITHUB_TOKEN not found');
  process.exit(1);
}

function request(method, path, body = null, isGraphQL = false) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path: isGraphQL ? '/graphql' : path,
      method: method,
      headers: {
        'User-Agent': 'ConformIA-Bot',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject({ status: res.statusCode, data: json });
          }
        } catch (e) {
          reject({ status: res.statusCode, raw: data, error: e });
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('Testing GitHub connection...');
  const user = await request('GET', '/user');
  console.log(`Connected as: ${user.login} (${user.name})`);

  // Check recent issues
  const recentIssues = await request('GET', '/repos/Conform-AI-health/conform-ai-health/issues?state=all&per_page=10');
  console.log('Recent issues count:', recentIssues.length);
  recentIssues.forEach(i => console.log(` - #${i.number}: ${i.title} [${i.state}]`));

  // Query Project 3
  const queryProject = {
    query: `
      query {
        organization(login: "Conform-AI-health") {
          projectV2(number: 3) {
            id
            title
            fields(first: 20) {
              nodes {
                ... on ProjectV2FieldCommon {
                  id
                  name
                }
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
    `
  };

  try {
    const projRes = await request('POST', '/graphql', queryProject, true);
    console.log('Project 3 details:', JSON.stringify(projRes, null, 2));
  } catch (err) {
    console.warn('Could not query project 3 via org query:', err);
  }
}

main().catch(err => {
  console.error('Error in script:', err);
  process.exit(1);
});
