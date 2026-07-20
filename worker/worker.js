// ============================================================
// 日语歌词学习 - Cloudflare Worker
// 三个职责：
//   1. Utaten 歌词抓取代理      POST /api/utaten-import
//   2. AI 全文解析转发 + 保存    POST /api/parse
//   3. 手动创建歌曲记录          POST /api/songs
// GitHub 读写全部通过 GitHub Contents API 完成，Token 存在 Worker 环境变量里，
// 绝不经过前端，符合 PRD 十三、安全要求。
//
// 部署前需要在 Worker 的环境变量 / Secrets 里配置：
//   GITHUB_TOKEN   - 有 repo 写权限的 fine-grained token
//   GITHUB_OWNER   - 例如 "Ancenchan"
//   GITHUB_REPO    - 例如 "jplearn"
//   GITHUB_BRANCH  - 例如 "main"
// ============================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // 上线后建议改成你的 GitHub Pages 域名
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/utaten-import' && request.method === 'POST') {
        return await handleUtatenImport(request, env);
      }
      if (url.pathname === '/api/parse' && request.method === 'POST') {
        return await handleParse(request, env);
      }
      if (url.pathname === '/api/songs' && request.method === 'POST') {
        return await handleCreateSong(request, env);
      }
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: err.message || 'Unexpected error' }, 500);
    }
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

// ---------- 1. Utaten 抓取 ----------
async function handleUtatenImport(request, env) {
  const { url } = await request.json();
  if (!url || !url.startsWith('https://utaten.com/')) {
    return json({ error: '请提供有效的 Utaten 链接' }, 400);
  }

  let html;
  let status = 0;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; jplearn/1.0; +https://github.com/Ancenchan/jplearn)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.8,en;q=0.6'
      }
    });
    status = res.status;
    if (!res.ok) {
      return json({ error: `Utaten 页面请求失败（HTTP ${status}），请确认链接是否为歌词页，或改用手动输入。` }, 502);
    }
    html = await res.text();
  } catch (err) {
    return json({ error: `Utaten 页面请求失败：${err.message || '网络异常'}，请稍后重试或改用手动输入。` }, 502);
  }

  const lyricsRaw = extractUtatenLyrics(html);
  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  if (!lyricsRaw.length) {
    return json({ error: '已取得 Utaten 页面，但未识别到歌词正文。页面结构可能已变化，请改用手动输入或更新抓取规则。' }, 502);
  }

  const lyricsWithFurigana = extractLyricsWithFurigana(html);

  const title = titleMatch ? decodeHtml(titleMatch[1]).split('/')[0].trim() : '未命名歌曲';
  const song = await createSongRecord(env, {
    title, artist: '', lyrics_raw: lyricsRaw, lyrics_with_furigana: lyricsWithFurigana, source: url, note: 'Utaten自动导入'
  });
  return json({ id: song.id, song });
}

function extractUtatenLyrics(html) {
  const containers = [
    extractByClass(html, 'hiragana'),
    extractByClass(html, 'lyricBody'),
    extractByClass(html, 'lyricsBody'),
    extractByClass(html, 'lyric-body'),
    extractByClass(html, 'romaji')
  ].filter(Boolean);

  for (const container of containers) {
    const lines = normalizeLyricsHtml(container);
    if (lines.length) return lines;
  }

  return [];
}

function extractByClass(html, className) {
  const safeClassName = escapeRegExp(className);
  const tagPattern = new RegExp(String.raw`<([a-zA-Z][\w:-]*)[^>]*class=["'][^"']*${safeClassName}[^"']*["'][^>]*>`, 'i');
  const match = tagPattern.exec(html);
  if (!match) return '';

  const tag = match[1].toLowerCase();
  let depth = 1;
  let cursor = match.index + match[0].length;
  const tagBoundary = new RegExp(String.raw`</?${tag}\b[^>]*>`, 'gi');
  tagBoundary.lastIndex = cursor;

  while (depth > 0) {
    const boundary = tagBoundary.exec(html);
    if (!boundary) return html.slice(cursor);
    if (boundary[0][1] === '/') depth -= 1;
    else depth += 1;
    if (depth === 0) return html.slice(cursor, boundary.index);
  }

  return '';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeLyricsHtml(fragment) {
  return fragment
    .replace(/<rp[\s\S]*?<\/rp>/gi, '')
    .replace(/<span class="ruby"[^>]*><span class="rb"[^>]*>([\s\S]*?)<\/span><span class="rt"[^>]*>([\s\S]*?)<\/span><\/span>/gi, (_, rb, rt) => {
      const kanji = rb.trim();
      const kana = rt.trim();
      return kanji && kana ? `${kanji}${kana}` : kanji;
    })
    .replace(/<ruby[^>]*>([\s\S]*?)<\/ruby>/gi, (_, content) => {
      const kanji = content.replace(/<rt[\s\S]*?<\/rt>/gi, '').trim();
      const rtMatch = content.match(/<rt[\s\S]*?>([\s\S]*?)<\/rt>/i);
      const kana = rtMatch ? rtMatch[1].trim() : '';
      return kanji && kana ? `${kanji}${kana}` : kanji;
    })
    .replace(/<rt[\s\S]*?<\/rt>/gi, '')
    .replace(/<ruby[^>]*>/gi, '')
    .replace(/<\/ruby>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map(line => decodeHtml(line).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter(line => !/^この歌詞|^無料歌詞検索|^歌詞の位置/.test(line));
}

function extractLyricsWithFurigana(html) {
  const containers = [
    extractByClass(html, 'hiragana'),
    extractByClass(html, 'lyricBody'),
    extractByClass(html, 'lyricsBody'),
    extractByClass(html, 'lyric-body'),
    extractByClass(html, 'romaji')
  ].filter(Boolean);

  for (const container of containers) {
    const fragment = container
      .replace(/<rp[\s\S]*?<\/rp>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li)>/gi, '\n');

    const lines = fragment.split('\n').filter(line => line.trim() && !/^この歌詞|^無料歌詞検索|^歌詞の位置/.test(line.trim()));

    if (lines.length) {
      return lines.map(line => {
        const parts = [];
        let remaining = line;
        let textBuffer = '';

        const flushTextBuffer = () => {
          if (textBuffer) {
            parts.push({ text: decodeHtml(textBuffer), furigana: '' });
            textBuffer = '';
          }
        };

        while (remaining.length > 0) {
          // utaten 的 <span class="ruby"><span class="rb">汉字</span><span class="rt">假名</span></span> 结构
          const spanRubyMatch = remaining.match(/^<span class="ruby"[^>]*><span class="rb"[^>]*>([\s\S]*?)<\/span><span class="rt"[^>]*>([\s\S]*?)<\/span><\/span>/i);
          if (spanRubyMatch) {
            flushTextBuffer();
            const kanji = spanRubyMatch[1].trim();
            const furigana = spanRubyMatch[2].trim();
            if (kanji) {
              parts.push({ text: decodeHtml(kanji), furigana: decodeHtml(furigana) });
            }
            remaining = remaining.slice(spanRubyMatch[0].length);
          } else {
            // 标准 <ruby>汉字<rt>假名</rt></ruby> 结构
            const rubyMatch = remaining.match(/^<ruby[^>]*>([\s\S]*?)<\/ruby>/i);
            if (rubyMatch) {
              flushTextBuffer();
              const content = rubyMatch[1];
              const kanji = content.replace(/<rt[\s\S]*?<\/rt>/gi, '').trim();
              const rtMatch = content.match(/<rt[\s\S]*?>([\s\S]*?)<\/rt>/i);
              const furigana = rtMatch ? rtMatch[1].trim() : '';
              if (kanji) {
                parts.push({ text: decodeHtml(kanji), furigana: decodeHtml(furigana) });
              }
              remaining = remaining.slice(rubyMatch[0].length);
            } else {
              const tagMatch = remaining.match(/^<[^>]+>/);
              if (tagMatch) {
                remaining = remaining.slice(tagMatch[0].length);
              } else {
                textBuffer += remaining[0];
                remaining = remaining.slice(1);
              }
            }
          }
        }

        flushTextBuffer();
        return parts;
      });
    }
  }

  return [];
}

function decodeHtml(text) {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '
  };
  return String(text || '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, entity) => {
    if (entity[0] === '#') {
      const radix = entity[1]?.toLowerCase() === 'x' ? 16 : 10;
      const value = parseInt(entity.replace(/^#x?/i, ''), radix);
      return Number.isFinite(value) ? String.fromCodePoint(value) : _;
    }
    return Object.prototype.hasOwnProperty.call(named, entity) ? named[entity] : _;
  });
}

// ---------- 2. AI 全文解析 ----------
async function handleParse(request, env) {
  const { song_id, lyrics, api_url, api_key, model } = await request.json();
  if (!song_id || !lyrics || !api_url || !api_key || !model) {
    return json({ error: '缺少必要参数' }, 400);
  }

  const prompt = buildParsePrompt(lyrics);
  let aiResult = await callAI(api_url, api_key, model, prompt);

  // 校验格式，失败时按 PRD 模块十二自动请求修复一次
  let parsed = tryParseJSON(aiResult);
  if (!parsed) {
    aiResult = await callAI(api_url, api_key, model,
      prompt + '\n\n你上一次的输出不是合法 JSON，请重新输出符合JSON格式的数据，不要包含任何解释文字。');
    parsed = tryParseJSON(aiResult);
  }
  if (!parsed) {
    return json({ error: 'AI 多次返回的内容都不是合法 JSON，请检查模型或稍后重试' }, 502);
  }

  const versionId = `${song_id}_${timestamp()}`;
  const manifestPath = `data/analysis/${song_id}/${versionId}.json`;
  const linesPath = `data/analysis/${song_id}/${versionId}.lines.json`;

  const linesDoc = { 
    lines: parsed.lines || [],
    sentences: parsed.sentences || []
  };
  const manifestDoc = {
    id: versionId,
    song_id,
    created_at: new Date().toISOString(),
    lyrics_source: 'manual',
    ai_model: model,
    status: 'completed',
    lyrics_snapshot: lyrics
  };

  await githubPutJSON(env, linesPath, linesDoc, `解析: ${song_id} (${model})`);
  await githubPutJSON(env, manifestPath, manifestDoc, `解析: ${song_id} (${model})`);
  await appendAnalysisVersion(env, song_id, versionId);
  await bumpIndexCount(env, song_id);

  return json({ analysis_id: versionId });
}

function buildParsePrompt(lyrics) {
  return `你是日语歌词教学助手。给定以下按行排列的日语歌词（歌词因为配合旋律被拆成多行，请自动判断哪些行属于同一个完整句子）：

${lyrics.map((l, i) => `${i}: ${l}`).join('\n')}

请只输出一个 JSON 对象，不要任何解释文字，结构如下：
{
  "sentences": [{"id":"sentence1","line_indices":[0],"text_jp":"...","translation_cn":"...","grammar_analysis":[{"word":"新しい","base":"新しい","pos":"形容词连体形","role":"修饰「ミライ」"},{"word":"ミライ","base":"ミライ","pos":"名词","role":"片假名写法，意为'未来'；宾语的核心名词"},{"word":"を","base":"を","pos":"格助词","role":"提示「思い描く新しいミライ」整个名词短语为「探してた」的宾语"}]}],
  "lines": [{"index":0,"text":"...","sentence_id":"sentence1","translation_cn":"...","words":[
    {"surface":"...","reading":"...","base":"...","pos":"...","conjugation":"...","chain":"...","meaning":"..."}
  ]}]
}
其中 grammar_analysis 是对整个句子的语法拆解，对每个词（或最小单位）给出原形、词性，以及它在句中的语法作用（修饰谁、是主语/宾语/谓语等）。请用中文描述 role 字段。`;
}

function tryParseJSON(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json|```/g, '').trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

async function callAI(apiUrl, apiKey, model, prompt) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(`${res.status} ${res.statusText}: ${errorData.error?.message || errorData.message || '未知错误'}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('504 超时: AI接口在60秒内未响应，请稍后重试或尝试使用更快的模型');
    }
    throw err;
  }
}

// ---------- 3. 手动创建歌曲 ----------
async function handleCreateSong(request, env) {
  const body = await request.json();
  const { title, artist, lyrics_raw, source, note } = body;
  if (!title || !artist || !Array.isArray(lyrics_raw) || lyrics_raw.length === 0) {
    return json({ error: '缺少必要字段' }, 400);
  }
  const song = await createSongRecord(env, { title, artist, lyrics_raw, source, note });
  return json({ id: song.id, song });
}

async function createSongRecord(env, { title, artist, lyrics_raw, lyrics_with_furigana, source, note }) {
  const id = `song${String(Date.now()).slice(-6)}`;
  const doc = {
    id, title, artist,
    aliases: [],
    source: source || 'manual',
    note: note || '',
    created_at: new Date().toISOString(),
    lyrics_raw,
    lyrics_with_furigana: lyrics_with_furigana || [],
    analysis_versions: []
  };
  await githubPutJSON(env, `data/songs/${id}.json`, doc, `新增歌曲: ${title}`);
  await addToIndex(env, { id, title, artist, aliases: [], analysis_count: 0 });
  return doc;
}

// ---------- GitHub Contents API 封装 ----------
const GITHUB_API = 'https://api.github.com';

async function githubGetFile(env, path) {
  const res = await fetch(
    `${GITHUB_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${env.GITHUB_BRANCH}`,
    { headers: githubHeaders(env) }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`读取 ${path} 失败`);
  const data = await res.json();
  const content = decodeBase64(data.content);
  return { json: JSON.parse(content), sha: data.sha };
}

async function githubPutJSON(env, path, obj, message) {
  const existing = await githubGetFile(env, path).catch(() => null);
  const res = await fetch(
    `${GITHUB_API}/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`,
    {
      method: 'PUT',
      headers: githubHeaders(env),
      body: JSON.stringify({
        message,
        content: encodeBase64(JSON.stringify(obj, null, 2)),
        branch: env.GITHUB_BRANCH,
        ...(existing ? { sha: existing.sha } : {})
      })
    }
  );
  if (!res.ok) throw new Error(`写入 ${path} 失败: ${await res.text()}`);
}

function githubHeaders(env) {
  return {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'jplearn-worker'
  };
}

async function addToIndex(env, songEntry) {
  const file = await githubGetFile(env, 'data/index.json');
  const index = file ? file.json : { songs: [] };
  index.songs.push(songEntry);
  await githubPutJSON(env, 'data/index.json', index, `index: 新增 ${songEntry.title}`);
}

async function bumpIndexCount(env, songId) {
  const file = await githubGetFile(env, 'data/index.json');
  if (!file) return;
  const entry = file.json.songs.find(s => s.id === songId);
  if (entry) entry.analysis_count = (entry.analysis_count || 0) + 1;
  await githubPutJSON(env, 'data/index.json', file.json, `index: 更新解析计数 ${songId}`);
}

async function appendAnalysisVersion(env, songId, versionId) {
  const file = await githubGetFile(env, `data/songs/${songId}.json`);
  if (!file) return;
  file.json.analysis_versions = file.json.analysis_versions || [];
  file.json.analysis_versions.push(versionId);
  await githubPutJSON(env, `data/songs/${songId}.json`, file.json, `新增解析版本: ${versionId}`);
}

function encodeBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function decodeBase64(b64) {
  return decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))));
}
function timestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
