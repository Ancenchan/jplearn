const test = require('node:test');
const assert = require('node:assert/strict');
const { buildIndex, findMatches, tokenize, meanings } = require('../assets/local-vocab');

const entries = [
  { '词汇': '運命', '读音': 'うんめい', '词性': '名词', '释义1': '释义1@命运@例句@運命を変える。', '辞書形': null },
  { '词汇': '照らす', '读音': 'てらす', '词性': '他五词', '释义1': '释义1@照亮@例句@道を照らす。', '辞書形': '辞書形@てらす@〜て形@てらして@〜た形@てらした@' },
  { '词汇': '闇', '读音': 'やみ', '词性': '名词', '释义1': '释义1@黑暗@例句@闇の中。', '辞書形': null }
];

test('tokenizes lyrics with longest dictionary matches', () => {
  const vocab = buildIndex(entries);
  assert.deepEqual(tokenize('運命を照らして', vocab).map(token => token.text), ['運命', 'を', '照らして']);
});

test('matches an inflected form to its dictionary entry', () => {
  const vocab = buildIndex(entries);
  const matches = findMatches('照らして', vocab);
  assert.equal(matches[0].entry['词汇'], '照らす');
  assert.equal(matches[0].kind, '活用形');
});

test('finds related entries and extracts Chinese definitions', () => {
  const vocab = buildIndex(entries);
  assert.equal(findMatches('運命的', vocab)[0].entry['词汇'], '運命');
  assert.deepEqual(meanings(entries[0]), ['命运']);
});
