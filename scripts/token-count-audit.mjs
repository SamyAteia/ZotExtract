import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodingForModel, getEncoding } from 'js-tiktoken';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(repoRoot, 'test-artifacts', 'token-audit');
const outPath = join(outDir, `audit-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4);
}

function tokenizerFor(model) {
  try {
    return encodingForModel(model);
  } catch {
    return getEncoding('cl100k_base');
  }
}

async function loadSamples() {
  const paths = [
    join(repoRoot, 'README.md'),
    join(repoRoot, 'content', 'zotextract.js'),
    join(repoRoot, 'content', 'zotextract-context.js'),
    join(repoRoot, 'content', 'zotextract-runner.js'),
    join(repoRoot, 'content', 'prompt-presets.js'),
  ];
  const samples = [];
  for (const path of paths) {
    const text = await readFile(path, 'utf8');
    samples.push({
      name: path.slice(repoRoot.length + 1).replaceAll('\\', '/'),
      text: text.slice(0, 12000),
    });
  }
  samples.push({
    name: 'synthetic-line-numbered-context',
    text: Array.from({ length: 160 }, (_, index) => {
      const id = `L${String(index + 1).padStart(6, '0')}`;
      return `${id}: This is a representative extracted PDF line with method names, citations, numbers ${index}, and punctuation.`;
    }).join('\n'),
  });
  return samples;
}

const model = process.argv[2] || 'gpt-4o-mini';
const enc = tokenizerFor(model);
const samples = await loadSamples();
const rows = samples.map(sample => {
  const heuristic = estimateTokens(sample.text);
  const actual = enc.encode(sample.text).length;
  return {
    name: sample.name,
    characters: sample.text.length,
    heuristic,
    actual,
    ratioHeuristicToActual: Number((heuristic / Math.max(1, actual)).toFixed(3)),
    absoluteError: Math.abs(heuristic - actual),
  };
});

const summary = {
  model,
  generatedAt: new Date().toISOString(),
  rows,
  maxAbsoluteError: Math.max(...rows.map(row => row.absoluteError)),
  worstRatio: rows.reduce((worst, row) => {
    const distance = Math.abs(1 - row.ratioHeuristicToActual);
    return distance > worst.distance ? { name: row.name, ratio: row.ratioHeuristicToActual, distance } : worst;
  }, { name: '', ratio: 1, distance: 0 }),
};

await mkdir(outDir, { recursive: true });
await writeFile(outPath, JSON.stringify(summary, null, 2));
console.log(`Token audit written to ${outPath}`);
for (const row of rows) {
  console.log(`${row.name}: heuristic=${row.heuristic} actual=${row.actual} ratio=${row.ratioHeuristicToActual}`);
}
