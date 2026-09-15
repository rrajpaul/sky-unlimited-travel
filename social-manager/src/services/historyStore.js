const path = require('path');
const fs = require('fs/promises');

const HISTORY_PATH = path.join(__dirname, '..', '..', 'data', 'history.json');

async function readHistory() {
  try {
    const raw = await fs.readFile(HISTORY_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function appendHistory(entry) {
  const history = await readHistory();
  history.unshift({ ...entry, timestamp: new Date().toISOString() });
  // Keep the file from growing unbounded — retain the most recent 500 entries.
  const trimmed = history.slice(0, 500);
  await fs.mkdir(path.dirname(HISTORY_PATH), { recursive: true });
  await fs.writeFile(HISTORY_PATH, JSON.stringify(trimmed, null, 2));
  return trimmed[0];
}

module.exports = { readHistory, appendHistory };
