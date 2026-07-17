const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAnalysisBundle } = require('../assets/analysis-utils');

test('loads analysis data from manifest and lines file', async () => {
  const files = {
    '/data/analysis/song001/song001.json': {
      id: 'song001',
      ai_model: 'gpt-4o'
    },
    '/data/analysis/song001/song001.lines.json': {
      lines: [{ index: 0, text: 'hello', words: [] }],
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

test('loads analysis data with both lines and sentences in single file', async () => {
  const files = {
    '/data/analysis/song002/v1.json': {
      id: 'v1',
      ai_model: 'deepseek-chat'
    },
    '/data/analysis/song002/v1.lines.json': {
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

  assert.equal(bundle.ai_model, 'deepseek-chat');
  assert.equal(bundle.lines[0].text, 'legacy line');
  assert.equal(bundle.sentences[0].translation_cn, '旧格式');
});
