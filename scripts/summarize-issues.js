const fs = require('fs');

const issues = JSON.parse(fs.readFileSync('scripts/issues_dump.json', 'utf8'));

console.log(`Total issues: ${issues.length}\n`);

// Sort by issue number ascending
issues.sort((a, b) => a.number - b.number);

const table = issues.map(iss => {
  // Extract epic and agent from body if present
  const epicMatch = iss.body ? iss.body.match(/Épico:?\s*([^\n\r]+)/) : null;
  const agentMatch = iss.body ? iss.body.match(/Agente Especialista Sugerido:?\s*`?@?([^`\n\r]+)`?/) : null;

  return {
    num: iss.number,
    state: iss.state,
    title: iss.title.replace(/^\[TASK-\d+\]\s*/i, ''),
    epic: epicMatch ? epicMatch[1].trim() : 'N/A',
    agent: agentMatch ? agentMatch[1].trim() : 'N/A'
  };
});

console.table(table);

