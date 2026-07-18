import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/worker.js';

test('imports Utaten lyrics from hiragana markup', async () => {
  const originalFetch = globalThis.fetch;
  const writes = [];

  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith('https://utaten.com/')) {
      return new Response(`
        <html>
          <head><title>テスト曲 / 歌詞</title></head>
          <body><p class="hiragana">夢を探してた<br>会いたくて</p></body>
        </html>
      `, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }

    if (options.method === 'PUT') {
      writes.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    return new Response(JSON.stringify({
      content: btoa(JSON.stringify({ songs: [] })),
      sha: 'index-sha'
    }), { status: 200 });
  };

  try {
    const request = new Request('https://worker.test/api/utaten-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://utaten.com/lyric/test' })
    });

    const response = await worker.fetch(request, {
      GITHUB_OWNER: 'owner',
      GITHUB_REPO: 'repo',
      GITHUB_BRANCH: 'main',
      GITHUB_TOKEN: 'token'
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.id, /^song\d+$/);

    const songWrite = writes.find(write => write.message === '新增歌曲: テスト曲');
    assert.ok(songWrite);
    const songDoc = JSON.parse(Buffer.from(songWrite.content, 'base64').toString('utf8'));
    assert.deepEqual(songDoc.lyrics_raw, ['夢を探してた', '会いたくて']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('imports Utaten lyrics from nested lyricBody markup', async () => {
  const originalFetch = globalThis.fetch;
  const writes = [];

  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith('https://utaten.com/')) {
      return new Response(`
        <html>
          <head><title>Nested Song / 歌詞</title></head>
          <body><div class="lyricBody"><div><ruby>桜<rt>さくら</rt></ruby></div><div>舞う</div></div></body>
        </html>
      `, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }

    if (options.method === 'PUT') {
      writes.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    return new Response(JSON.stringify({
      content: btoa(JSON.stringify({ songs: [] })),
      sha: 'index-sha'
    }), { status: 200 });
  };

  try {
    const request = new Request('https://worker.test/api/utaten-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://utaten.com/lyric/nested' })
    });

    const response = await worker.fetch(request, {
      GITHUB_OWNER: 'owner',
      GITHUB_REPO: 'repo',
      GITHUB_BRANCH: 'main',
      GITHUB_TOKEN: 'token'
    });

    assert.equal(response.status, 200);
    const songWrite = writes.find(write => write.message === '新增歌曲: Nested Song');
    assert.ok(songWrite);
    const songDoc = JSON.parse(Buffer.from(songWrite.content, 'base64').toString('utf8'));
    assert.deepEqual(songDoc.lyrics_raw, ['桜さくら', '舞う']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('returns a helpful error when Utaten markup has no lyrics', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).startsWith('https://utaten.com/')) {
      return new Response('<html><head><title>empty</title></head><body></body></html>', { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const request = new Request('https://worker.test/api/utaten-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://utaten.com/lyric/empty' })
    });

    const response = await worker.fetch(request, {});
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.match(body.error, /未识别到歌词正文/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
