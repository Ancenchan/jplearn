const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalysisBundle } = require('../assets/analysis-utils');

test('loads a split analysis bundle from manifest and part files', async () => {
  const files = {
    '/data/analysis/song001/song001.json': {
      id: 'song001',
      ai_model: 'gpt-4o',
      parts: {
        lines: 'song001.lines.json',
        sentences: 'song001.sentences.json'
      }
    },
    '/data/analysis/song001/song001.lines.json': {
      lines: [{ index: 0, text: 'hello', words: [] }]
    },
    '/data/analysis/song001/song001.sentences.json': {
      sentences: [{ id: 's1', text_jp: 'hello', translation_cn: '你好' }]
    }
  };

  async function fetchJSON(path) {
    if (!(path in files)) {
      throw new Error(`missing ${path}`);
    }
    return files[path];
  }

  const bundle = await loadAnalysisBundle({
    fetchJSON,
    dataBase: '/data',
    songId: 'song001',
    versionId: 'song001'
  });

  assert.equal(bundle.ai_model, 'gpt-4o');
  assert.equal(bundle.lines[0].text, 'hello');
  assert.equal(bundle.sentences[0].id, 's1');
});

test('keeps backward compatibility with legacy single-file analysis payloads', async () => {
  const files = {
    '/data/analysis/song002/v1.json': {
      id: 'v1',
      ai_model: 'legacy',
      lines: [{ index: 0, text: 'legacy line', words: [] }],
      sentences: [{ id: 's0', text_jp: 'legacy line', translation_cn: '旧格式' }]
    }
  };

  async function fetchJSON(path) {
    if (!(path in files)) throw new Error(`missing ${path}`);
    return files[path];
  }

  const bundle = await loadAnalysisBundle({
    fetchJSON,
    dataBase: '/data',
    songId: 'song002',
    versionId: 'v1'
  });

  assert.equal(bundle.ai_model, 'legacy');
  assert.equal(bundle.lines[0].text, 'legacy line');
  assert.equal(bundle.sentences[0].translation_cn, '旧格式');
});
