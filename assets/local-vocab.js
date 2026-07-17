// 本地词典的轻量分词与匹配。仅依赖 5757词.json，因此不需要把歌词发送到第三方服务。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.JpLearnVocab = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function normalize(text) {
    return String(text || '').normalize('NFKC').replace(/[\u30a1-\u30f6]/g, char =>
      String.fromCharCode(char.charCodeAt(0) - 0x60)
    );
  }

  function isJapanese(char) {
    return /[\u3040-\u30ff\u3400-\u9fff々〆ヶ]/.test(char);
  }

  function addTerm(index, term, entry, kind) {
    const normalized = normalize(term).trim();
    if (!normalized || normalized.length > 40) return;
    const matches = index.get(normalized) || [];
    if (!matches.some(match => match.entry === entry && match.kind === kind)) {
      matches.push({ entry, kind, term });
      index.set(normalized, matches);
    }
  }

  function buildIndex(entries) {
    const index = new Map();
    let maxTermLength = 1;
    entries.forEach(entry => {
      const word = String(entry['词汇'] || '').trim();
      addTerm(index, word, entry, '词条');
      maxTermLength = Math.max(maxTermLength, [...normalize(word)].length);

      const forms = String(entry['辞書形'] || '').split('@');
      const baseReading = forms[1] ? normalize(forms[1]) : '';
      for (let i = 1; i < forms.length; i += 2) {
        const form = forms[i].trim();
        addTerm(index, form, entry, '活用形');
        maxTermLength = Math.max(maxTermLength, [...normalize(form)].length);

        // 活用表通常只保存假名读音。根据原形与读音的共同词干，补出歌词中常见的汉字活用写法，
        // 例如「照らす / てらす」+「てらして」=>「照らして」。
        const normalizedForm = normalize(form);
        let shared = 0;
        while (shared < baseReading.length && shared < normalizedForm.length && baseReading[shared] === normalizedForm[shared]) shared += 1;
        const wordChars = [...word];
        const readingChars = [...baseReading];
        if (shared > 0 && wordChars.length >= readingChars.length - shared) {
          const writtenForm = wordChars.slice(0, wordChars.length - (readingChars.length - shared)).join('')
            + [...form].slice(shared).join('');
          addTerm(index, writtenForm, entry, '活用形');
          maxTermLength = Math.max(maxTermLength, [...normalize(writtenForm)].length);
        }
      }
    });
    return { entries, index, maxTermLength };
  }

  function findMatches(query, vocab, limit = 6) {
    const normalized = normalize(query).trim();
    if (!normalized) return [];
    const exact = vocab.index.get(normalized) || [];
    if (exact.length) return exact.slice(0, limit);

    const matches = [];
    for (const entry of vocab.entries) {
      const word = String(entry['词汇'] || '').trim();
      const candidate = normalize(word);
      if (candidate.length < 2) continue;
      if (candidate.includes(normalized) || normalized.includes(candidate)) {
        matches.push({ entry, kind: '模糊匹配', term: word });
      }
    }
    return matches
      .sort((a, b) => Math.abs(normalize(a.term).length - normalized.length) - Math.abs(normalize(b.term).length - normalized.length))
      .slice(0, limit);
  }

  // 使用最长词条优先的最大匹配：先识别词典中最长的词，再保留未知片段供用户点击搜索。
  function tokenize(line, vocab) {
    const chars = [...String(line || '')];
    const tokens = [];
    for (let offset = 0; offset < chars.length;) {
      const char = chars[offset];
      if (!isJapanese(char)) {
        let end = offset + 1;
        while (end < chars.length && !isJapanese(chars[end])) end += 1;
        tokens.push({ text: chars.slice(offset, end).join(''), matched: false });
        offset = end;
        continue;
      }

      const upper = Math.min(chars.length, offset + vocab.maxTermLength);
      let match = null;
      for (let end = upper; end > offset; end -= 1) {
        const text = chars.slice(offset, end).join('');
        const candidates = vocab.index.get(normalize(text));
        if (candidates?.length) {
          match = { text, candidates };
          break;
        }
      }
      if (match) {
        tokens.push({ text: match.text, matched: true, candidates: match.candidates });
        offset += [...match.text].length;
      } else {
        tokens.push({ text: char, matched: false });
        offset += 1;
      }
    }
    return tokens;
  }

  function meanings(entry) {
    return Array.from({ length: 10 }, (_, index) => entry[`释义${index + 1}`])
      .filter(Boolean)
      .map(value => String(value).split('@').filter((part, index) => index > 0 && part !== '例句').slice(0, 1)[0])
      .filter(Boolean);
  }

  return { buildIndex, findMatches, tokenize, meanings, normalize };
});
