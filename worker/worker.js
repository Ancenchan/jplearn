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
      if (url.pathname === '/api/auth/check' && request.method === 'POST') {
        return await handleAuthCheck(request);
      }
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

// ---------- Token验证 ----------
async function handleAuthCheck(request){
  const {token}=await request.json();
  if(!token) return json({ok:false});
  const res=await fetch('https://api.github.com/user',{headers:{'Authorization':`Bearer ${token}`,'User-Agent':'jplearn'}});
  return json({ok:res.ok});
}

async function checkToken(request){
 const body=await request.clone().json();
 const token=body.token;
 if(!token) throw new Error('请先配置GitHub Token');
 const r=await fetch('https://api.github.com/user',{headers:{'Authorization':`Bearer ${token}`,'User-Agent':'jplearn'}});
 if(!r.ok) throw new Error('GitHub Token无效');
}

// ---------- 1. Utaten 抓取 ----------
async function handleUtatenImport(request, env) {
  await checkToken(request);
  const { url } = await request.json();
  if (!url || !url.startsWith('https://utaten.com/')) {
    return json({ error: '请提供有效的 Utaten 链接' }, 400);
  }

  let html;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error('抓取失败');
    html = await res.text();
  } catch {
    return json({ error: '歌词获取失败，请手动输入歌词' }, 502);
  }

  // TODO: Utaten 的页面结构可能会变，这里只是一个占位提取逻辑，
  // 上线前请对照实际 HTML 结构调整选择器（歌词一般在 <p class="hiragana"> 或类似容器里）。
  const lyricsRaw = extractUtatenLyrics(html);
  const titleMatch = html.match(/<title>(.*?)<\/title>/);
  if (!lyricsRaw.length) {
    return json({ error: '歌词获取失败，请手动输入歌词' }, 502);
  }

  const title = titleMatch ? titleMatch[1].split('/')[0].trim() : '未命名歌曲';
  const songId = await createSongRecord(env, {
    title, artist: '', lyrics_raw: lyricsRaw, source: url, note: 'Utaten自动导入'
  });
  return json({ id: songId });
}

function extractUtatenLyrics(html) {
  // 占位实现：真实项目里建议用 HTMLRewriter 精确定位歌词容器
  const match = html.match(/<div[^>]*class="[^"]*lyricBody[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (!match) return [];
  return match[1]
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
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
  const analysisDoc = {
    id: versionId,
    song_id,
    created_at: new Date().toISOString(),
    lyrics_source: 'manual',
    ai_model: model,
    status: 'completed',
    lyrics_snapshot: lyrics,
    sentences: parsed.sentences,
    lines: parsed.lines
  };

  await githubPutJSON(env, `data/analysis/${song_id}/${versionId}.json`, analysisDoc,
    `解析: ${song_id} (${model})`);
  await appendAnalysisVersion(env, song_id, versionId);
  await bumpIndexCount(env, song_id);

  return json({ analysis_id: versionId });
}

function buildParsePrompt(lyrics) {
  return `你是日语歌词教学助手。给定以下按行排列的日语歌词（歌词因为配合旋律被拆成多行，请自动判断哪些行属于同一个完整句子）：

${lyrics.map((l, i) => `${i}: ${l}`).join('\n')}

请只输出一个 JSON 对象，不要任何解释文字，结构如下：
{
  "sentences": [{"id":"sentence1","line_indices":[0],"text_jp":"...","translation_cn":"..."}],
  "lines": [{"index":0,"text":"...","sentence_id":"sentence1","translation_cn":"...","words":[
    {"surface":"...","reading":"...","base":"...","pos":"...","conjugation":"...","chain":"...","meaning":"..."}
  ]}]
}`;
}

function tryParseJSON(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json|```/g, '').trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

async function callAI(apiUrl, apiKey, model, prompt) {
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!res.ok) throw new Error(`AI 接口调用失败: ${res.status}`);
  const data = await res.json();
  // 兼容 OpenAI Compatible 格式
  return data.choices?.[0]?.message?.content || '';
}

// ---------- 3. 手动创建歌曲 ----------
async function handleCreateSong(request, env) {
  await checkToken(request);
  const body = await request.json();
  const { title, artist, lyrics_raw, source, note } = body;
  if (!title || !artist || !Array.isArray(lyrics_raw) || lyrics_raw.length === 0) {
    return json({ error: '缺少必要字段' }, 400);
  }
  const id = await createSongRecord(env, { title, artist, lyrics_raw, source, note });
  return json({ id });
}

async function createSongRecord(env, { title, artist, lyrics_raw, source, note }) {
  const id = `song${String(Date.now()).slice(-6)}`;
  const doc = {
    id, title, artist,
    aliases: [],
    source: source || 'manual',
    note: note || '',
    created_at: new Date().toISOString(),
    lyrics_raw,
    analysis_versions: []
  };
  await githubPutJSON(env, `data/songs/${id}.json`, doc, `新增歌曲: ${title}`);
  await addToIndex(env, { id, title, artist, aliases: [], analysis_count: 0 });
  return id;
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
