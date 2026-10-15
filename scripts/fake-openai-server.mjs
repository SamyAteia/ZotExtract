#!/usr/bin/env node
// Deterministic OpenAI-compatible mock for ZotExtract GUI/e2e tests.
//
// It emits the same shapes the plugin actually parses today:
//   - default: sectioned "## reasoning / ## context / ## answer" text
//     (see content/zotextract-provider-runtime.js parseSectionedAnswer)
//   - line citations (L000123-L000128) drawn from the line IDs that are
//     actually present in the incoming context, so evidence linking is exercised
//   - an evidence-collection branch when the prompt is a "Window X/Y (range)" scan,
//     so single-window and oversized collection paths are covered
//   - an optional JSON branch only when the caller explicitly asks for JSON
//
// The answer text always contains a marker phrase the e2e harness asserts on
// ("Zotero workflow integration" / "deterministic fake LLM response").
import http from 'node:http';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT || 8789);
const delayMs = Number(process.env.FAKE_OPENAI_DELAY_MS || 0);

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

// OpenAI clients may send message content as a string or as an array of parts.
function messageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => (typeof part === 'string' ? part : part?.text || '')).join('\n');
  }
  return '';
}

// Cite line IDs that really appear in the supplied context so the cited
// range resolves against the line-numbered source map instead of inventing IDs.
function citationFromContext(text) {
  const ids = [...String(text).matchAll(/L\d{6}/g)].map(m => m[0]);
  if (!ids.length) return null;
  const unique = [...new Set(ids)];
  const start = unique[0];
  const end = unique[Math.min(unique.length - 1, 3)];
  return start === end ? start : `${start}-${end}`;
}

function sectioned({ windowed, citation, windowLabel }) {
  const lines = [];
  if (windowed) {
    lines.push('## reasoning');
    lines.push(
      citation
        ? `Scanned ${windowLabel || 'this window'}; the cited lines ${citation} mention the local Zotero PDF workflow used by the deterministic test.`
        : `Scanned ${windowLabel || 'this window'}; it holds no relevant evidence for the question.`
    );
    if (citation) {
      lines.push('', '## context');
      lines.push(`${citation} - Fixture text describing the local Zotero PDF workflow (deterministic fake evidence).`);
    }
    lines.push('', '## answer');
    lines.push(
      citation
        ? `Collected deterministic fake LLM response evidence for Zotero workflow integration from ${citation}.`
        : 'No relevant evidence in this window.'
    );
    return lines.join('\n') + '\n';
  }

  lines.push('## reasoning');
  lines.push(
    citation
      ? `The cited lines ${citation} describe the local Zotero PDF workflow, so the answer is grounded in that fixture evidence.`
      : 'No line-numbered full text was provided, so the answer is based on the supplied metadata only.'
  );
  if (citation) {
    lines.push('', '## context');
    lines.push(`${citation} - Fixture text describing the local Zotero PDF workflow (deterministic fake evidence).`);
  }
  lines.push('', '## answer');
  lines.push(
    citation
      ? `Zotero workflow integration: deterministic fake LLM response summarizing the selected question from the local Zotero PDF fixture (${citation}).`
      : 'Zotero workflow integration: deterministic fake LLM response based on the test paper metadata.'
  );
  return lines.join('\n') + '\n';
}

function jsonAnswer(model) {
  // Legacy/explicit-JSON shape; parsed by extractRelevantContextEntries.
  return JSON.stringify(
    {
      reasoning: 'The cited line range contains the local Zotero PDF workflow evidence used by the deterministic GUI test.',
      relevant_context: [{ lines: 'L000001-L000004', note: 'Fixture text describing the local Zotero PDF workflow.' }],
      answer: {
        title: 'Fake test paper',
        concepts: [
          {
            label: 'Zotero workflow integration',
            definition: 'Testing concept extraction from a local Zotero PDF workflow.',
            evidence: [{ lines: 'L000001-L000004', quote: 'local Zotero PDF workflow', note: 'deterministic fake evidence' }],
            confidence: 'high'
          }
        ],
        methods: ['deterministic fake LLM response'],
        datasets: [],
        limitations: ['fake server response for UI testing only'],
        source: { model: model || 'fake-model', promptId: 'fake-ui-test' }
      }
    },
    null,
    2
  );
}

// Pure decision logic, exported so tests can assert the response shape without
// opening a socket.
export function buildAssistantContent(user, model) {
  const text = String(user || '');
  const windowMatch = text.match(/Window\s+(\d+\s*\/\s*\d+\s*\([^)]*\))/i);
  const wantsJson = /\b(return|as|strict|in)\b[^.\n]*\bjson\b|\bjson\s+(object|array|shape)\b/i.test(text);
  if (wantsJson) return jsonAnswer(model);
  return sectioned({
    windowed: !!windowMatch,
    citation: citationFromContext(text),
    windowLabel: windowMatch ? `window ${windowMatch[1]}` : ''
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/v1/models')) {
    return req.url === '/health'
      ? json(res, 200, { ok: true })
      : json(res, 200, { object: 'list', data: [{ id: 'fake-model', object: 'model' }] });
  }
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    if (delayMs > 0) await delay(delayMs);
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch {}

    // Reject the same unsupported fields as the hosted GPT-6 chat API.
    // Log only request settings, never messages or authorization headers.
    const model = String(body.model || '').replace(/^openai\//, '');
    let invalid = '';
    if (/^gpt-6(?:[.\-]|$)/.test(model)) {
      if ('max_tokens' in body || !body.max_completion_tokens) invalid = 'max_tokens';
      else if ('temperature' in body && body.reasoning_effort !== 'none') invalid = 'temperature';
      else if (body.reasoning_effort === 'minimal') invalid = 'reasoning_effort';
      else if (/^gpt-(?:6-astra|6\.1-sol)(?:-|$)/.test(model) && body.reasoning_effort === 'none') invalid = 'reasoning_effort';
    }
    console.log(JSON.stringify({ model: body.model, max_tokens: body.max_tokens, max_completion_tokens: body.max_completion_tokens,
      temperature: body.temperature, reasoning_effort: body.reasoning_effort, status: invalid ? 400 : 200 }));
    if (invalid) return json(res, 400, { error: { message: `Unsupported parameter: ${invalid}`, param: invalid, code: 'unsupported_parameter' } });

    const user = (body.messages || []).filter(m => m.role === 'user').map(messageText).join('\n');
    const content = buildAssistantContent(user, body.model);

    return json(res, 200, {
      id: 'fake-chatcmpl',
      object: 'chat.completion',
      model: body.model || 'fake-model',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }]
    });
  }
  json(res, 404, { error: 'not_found' });
});

function isMainModule() {
  try {
    return process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  server.listen(port, '127.0.0.1', () => {
    console.log(`Fake OpenAI-compatible server listening on http://127.0.0.1:${port}`);
  });
}
