// ============================================================
// 日语歌词学习 - 前端逻辑
// 纯静态页面 + hash 路由，数据来自 /data 目录（GitHub Pages 直接托管）
// 写操作（导入歌曲 / AI解析 / 保存回GitHub）都会转发给 Cloudflare Worker
// ============================================================

// TODO: 部署 Worker 后，把这里换成你的 Worker 
// 例如 "https://jplearn-worker.<your-subdomain>.workers.dev"
const DATA_BASE = './data';

function getWorkerBase() {
  const stored = (localStorage.getItem('jplearn_worker_base') || '').trim();
  return stored || 'https://jplearn-worker.ancenchan.workers.dev';
}
function setWorkerBase(url) {
  const trimmed = (url || '').trim();
  if (trimmed) {
    localStorage.setItem('jplearn_worker_base', trimmed);
  } else {
    localStorage.removeItem('jplearn_worker_base');
  }
}

const state = {
  index: null,          // data/index.json 缓存
  currentSong: null,    // 当前歌曲详情
  currentAnalysis: null, // 当前解析版本
  lyricsMode: 'kana'    // 歌词显示模式: 'kana' | 'romaji'
};
const PENDING_SONG_PREFIX = 'jplearn_pending_song_';
const VOCABULARY_PATH = './5757词.json';
let localVocabulary = null;

// ---------- 假名→罗马音转换 (Hepburn) ----------
const KANA_ROMAJI_MAP = {
  'あ':'a','い':'i','う':'u','え':'e','お':'o',
  'か':'ka','き':'ki','く':'ku','け':'ke','こ':'ko',
  'さ':'sa','し':'shi','す':'su','せ':'se','そ':'so',
  'た':'ta','ち':'chi','つ':'tsu','て':'te','と':'to',
  'な':'na','に':'ni','ぬ':'nu','ね':'ne','の':'no',
  'は':'ha','ひ':'hi','ふ':'fu','へ':'he','ほ':'ho',
  'ま':'ma','み':'mi','む':'mu','め':'me','も':'mo',
  'や':'ya','ゆ':'yu','よ':'yo',
  'ら':'ra','り':'ri','る':'ru','れ':'re','ろ':'ro',
  'わ':'wa','ゐ':'wi','ゑ':'we','を':'wo','ん':'n',
  'が':'ga','ぎ':'gi','ぐ':'gu','げ':'ge','ご':'go',
  'ざ':'za','じ':'ji','ず':'zu','ぜ':'ze','ぞ':'zo',
  'だ':'da','ぢ':'ji','づ':'zu','で':'de','ど':'do',
  'ば':'ba','び':'bi','ぶ':'bu','べ':'be','ぼ':'bo',
  'ぱ':'pa','ぴ':'pi','ぷ':'pu','ぺ':'pe','ぽ':'po',
  'きゃ':'kya','きゅ':'kyu','きょ':'kyo',
  'しゃ':'sha','しゅ':'shu','しょ':'sho',
  'ちゃ':'cha','ちゅ':'chu','ちょ':'cho',
  'にゃ':'nya','にゅ':'nyu','にょ':'nyo',
  'ひゃ':'hya','ひゅ':'hyu','ひょ':'hyo',
  'みゃ':'mya','みゅ':'myu','みょ':'myo',
  'りゃ':'rya','りゅ':'ryu','りょ':'ryo',
  'ぎゃ':'gya','ぎゅ':'gyu','ぎょ':'gyo',
  'じゃ':'ja','じゅ':'ju','じょ':'jo',
  'びゃ':'bya','びゅ':'byu','びょ':'byo',
  'ぴゃ':'pya','ぴゅ':'pyu','ぴょ':'pyo',
  // 外来语特殊音节（平假名）
  'いぇ':'ye','きぇ':'kye','しぇ':'she','じぇ':'je','ちぇ':'che',
  'ふぁ':'fa','ふぃ':'fi','ふぇ':'fe','ふぉ':'fo','ふゅ':'fyu',
  'てぃ':'ti','でぃ':'di','てゅ':'tyu','でゅ':'dyu',
  'とぅ':'tu','どぅ':'du','すぃ':'si','ずぃ':'zi',
  'うぃ':'wi','うぇ':'we','うぉ':'wo',
  'つぁ':'tsa','つぃ':'tsi','つぇ':'tse','つぉ':'tso',
  // 片仮名
  'ア':'a','イ':'i','ウ':'u','エ':'e','オ':'o',
  'カ':'ka','キ':'ki','ク':'ku','ケ':'ke','コ':'ko',
  'サ':'sa','シ':'shi','ス':'su','セ':'se','ソ':'so',
  'タ':'ta','チ':'chi','ツ':'tsu','テ':'te','ト':'to',
  'ナ':'na','ニ':'ni','ヌ':'nu','ネ':'ne','ノ':'no',
  'ハ':'ha','ヒ':'hi','フ':'fu','ヘ':'he','ホ':'ho',
  'マ':'ma','ミ':'mi','ム':'mu','メ':'me','モ':'mo',
  'ヤ':'ya','ユ':'yu','ヨ':'yo',
  'ラ':'ra','リ':'ri','ル':'ru','レ':'re','ロ':'ro',
  'ワ':'wa','ヰ':'wi','ヱ':'we','ヲ':'wo','ン':'n',
  'ガ':'ga','ギ':'gi','グ':'gu','ゲ':'ge','ゴ':'go',
  'ザ':'za','ジ':'ji','ズ':'zu','ゼ':'ze','ゾ':'zo',
  'ダ':'da','ヂ':'ji','ヅ':'zu','デ':'de','ド':'do',
  'バ':'ba','ビ':'bi','ブ':'bu','ベ':'be','ボ':'bo',
  'パ':'pa','ピ':'pi','プ':'pu','ペ':'pe','ポ':'po',
  'キャ':'kya','キュ':'kyu','キョ':'kyo',
  'シャ':'sha','シュ':'shu','ショ':'sho',
  'チャ':'cha','チュ':'chu','チョ':'cho',
  'ニャ':'nya','ニュ':'nyu','ニョ':'nyo',
  'ヒャ':'hya','ヒュ':'hyu','ヒョ':'hyo',
  'ミャ':'mya','ミュ':'myu','ミョ':'myo',
  'リャ':'rya','リュ':'ryu','リョ':'ryo',
  'ギャ':'gya','ギュ':'gyu','ギョ':'gyo',
  'ジャ':'ja','ジュ':'ju','ジョ':'jo',
  'ビャ':'bya','ビュ':'byu','ビョ':'byo',
  'ピャ':'pya','ピュ':'pyu','ピョ':'pyo',
  // 外来语特殊音节（片仮名）
  'イェ':'ye','キェ':'kye','シェ':'she','ジェ':'je','チェ':'che',
  'ファ':'fa','フィ':'fi','フェ':'fe','フォ':'fo','フュ':'fyu',
  'ティ':'ti','ディ':'di','テュ':'tyu','デュ':'dyu',
  'トゥ':'tu','ドゥ':'du','スィ':'si','ズィ':'zi',
  'ウィ':'wi','ウェ':'we','ウォ':'wo',
  'ツァ':'tsa','ツィ':'tsi','ツェ':'tse','ツォ':'tso',
  'ヴァ':'va','ヴィ':'vi','ヴ':'vu','ヴェ':'ve','ヴォ':'vo','ヴュ':'vyu',
  // 小写假名单独出现时的 fallback
  'ぁ':'a','ぃ':'i','ぅ':'u','ぇ':'e','ぉ':'o','ゎ':'wa',
  'ァ':'a','ィ':'i','ゥ':'u','ェ':'e','ォ':'o','ヮ':'wa'
};
function kanaToRomaji(kana) {
  if (!kana) return '';
  let result = '';
  let i = 0;
  while (i < kana.length) {
    const two = kana.substring(i, i + 2);
    const one = kana.substring(i, i + 1);
    if (one === 'っ' || one === 'ッ') {
      // 促音：双写下一个辅音
      const next = kana.substring(i + 1, i + 3);
      const nextRomaji = KANA_ROMAJI_MAP[next] || KANA_ROMAJI_MAP[kana.substring(i + 1, i + 2)] || '';
      if (nextRomaji) result += nextRomaji[0];
      i += 1;
      continue;
    }
    if (KANA_ROMAJI_MAP[two]) {
      result += KANA_ROMAJI_MAP[two];
      i += 2;
      continue;
    }
    if (KANA_ROMAJI_MAP[one]) {
      let r = KANA_ROMAJI_MAP[one];
      // ん 后面跟元音或 y 时加撇
      if ((one === 'ん' || one === 'ン') && i + 1 < kana.length) {
        const nextOne = kana.substring(i + 1, i + 2);
        if ('あいうえおやゆよアイウエオヤユヨ'.includes(nextOne)) r = "n'";
      }
      result += r;
      i += 1;
      continue;
    }
    // 长音符号 ー：保留前一个元音
    if (one === 'ー') {
      if (result) result += result[result.length - 1];
      i += 1;
      continue;
    }
    // 非假名字符直接保留
    result += one;
    i += 1;
  }
  return result;
}

// ---------- 工具 ----------
function $(sel, root = document) { return root.querySelector(sel); }
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function toast(msg) {
  const node = el(`<div class="toast">${msg}</div>`);
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2400);
}
function rememberPendingSong(song) {
  if (!song?.id) return;
  sessionStorage.setItem(`${PENDING_SONG_PREFIX}${song.id}`, JSON.stringify({ song, savedAt: Date.now() }));
}
function getPendingSong(songId) {
  try {
    const raw = sessionStorage.getItem(`${PENDING_SONG_PREFIX}${songId}`);
    if (!raw) return null;
    const { song, savedAt } = JSON.parse(raw);
    if (!song?.id || Date.now() - Number(savedAt || 0) > 10 * 60 * 1000) {
      sessionStorage.removeItem(`${PENDING_SONG_PREFIX}${songId}`);
      return null;
    }
    return song;
  } catch {
    sessionStorage.removeItem(`${PENDING_SONG_PREFIX}${songId}`);
    return null;
  }
}
function clearPendingSong(songId) {
  sessionStorage.removeItem(`${PENDING_SONG_PREFIX}${songId}`);
}
async function loadLocalVocabulary() {
  if (localVocabulary) return localVocabulary;
  const entries = await fetchJSON(VOCABULARY_PATH);
  if (!Array.isArray(entries)) throw new Error('词典文件格式不正确');
  localVocabulary = window.JpLearnVocab.buildIndex(entries);
  return localVocabulary;
}
async function fetchJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`加载失败: ${path}`);
  return res.json();
}

function repairBrokenJSON(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  
  let cleaned = raw.replace(/```json\s*/g, '').replace(/```/g, '').trim();
  
  try { return JSON.parse(cleaned); } catch {}
  
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  let start = -1;
  let isArray = false;
  if (firstBrace === -1 && firstBracket === -1) return null;
  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    start = firstBracket;
    isArray = true;
  } else {
    start = firstBrace;
    isArray = false;
  }
  cleaned = cleaned.slice(start);
  
  let result = cleaned;
  let inString = false;
  let escape = false;
  let depth = 0;
  let arrayDepth = 0;
  let lastComplete = -1;
  
  for (let i = 0; i < result.length; i++) {
    const ch = result[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '[') arrayDepth++;
    else if (ch === ']') arrayDepth--;
    if (depth === 0 && arrayDepth === 0 && (ch === '}' || ch === ']')) {
      lastComplete = i;
    }
  }
  
  if (lastComplete > 0) {
    try { return JSON.parse(result.slice(0, lastComplete + 1)); } catch {}
  }

  // 策略5: 智能修复字符串内部未转义的双引号 (AI 最常见的错误)
  try {
    const quoteFixed = fixUnescapedQuotes(result);
    try { return JSON.parse(quoteFixed); } catch {}
  } catch {}
  
  let repaired = result;
  let inStr = false;
  let esc = false;
  let stack = [];
  
  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  
  if (inStr) repaired += '"';
  
  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    if (top === '{') {
      const lastComma = repaired.lastIndexOf(',');
      const lastColon = repaired.lastIndexOf(':');
      if (lastComma > lastColon && lastComma === repaired.length - 1) {
        repaired = repaired.slice(0, -1);
      }
      repaired += '}';
    } else if (top === '[') {
      repaired += ']';
    }
    stack.pop();
  }
  
  try { return JSON.parse(repaired); } catch {}

  // 最后再尝试一次带引号修复的括号补全
  try {
    const quoteFixed2 = fixUnescapedQuotes(repaired);
    try { return JSON.parse(quoteFixed2); } catch {}
  } catch {}
  
  console.warn('JSON 修复失败');
  return null;
}

/**
 * 智能修复 JSON 字符串值内部未转义的双引号
 * 核心思路：在字符串内部遇到 " 时，向前看跳过空白后的下一个非空白字符
 * 如果是 , } ] : 则认为是真正的字符串结束引号
 * 否则认为是字符串内部的引号，转义为 \"
 */
function fixUnescapedQuotes(jsonStr) {
  let result = '';
  let inString = false;
  let escape = false;
  let i = 0;
  const len = jsonStr.length;

  while (i < len) {
    const ch = jsonStr[i];

    if (escape) {
      result += ch;
      escape = false;
      i++;
      continue;
    }

    if (ch === '\\') {
      result += ch;
      escape = true;
      i++;
      continue;
    }

    if (ch === '"') {
      if (!inString) {
        // 进入字符串
        inString = true;
        result += ch;
        i++;
        continue;
      }

      // 在字符串内部遇到了一个双引号，需要判断是结束引号还是内部引号
      // 向前看：跳过空白字符后的第一个非空白字符
      let j = i + 1;
      while (j < len && /\s/.test(jsonStr[j])) {
        j++;
      }
      const nextNonSpace = j < len ? jsonStr[j] : '';

      // 如果下一个非空白字符是 JSON 结构字符，则这是字符串结束引号
      const isStructuralAfter = nextNonSpace === ',' 
        || nextNonSpace === '}' 
        || nextNonSpace === ']' 
        || nextNonSpace === ':'
        || nextNonSpace === '';

      // 还要向后看：这个引号前面的字符是否是冒号（表示可能是 key 的结束）
      // 回溯找到前一个非空白字符
      let k = result.length - 1;
      while (k >= 0 && /\s/.test(result[k])) {
        k--;
      }
      const prevNonSpaceInResult = k >= 0 ? result[k] : '';
      const isKeyValueColonBefore = prevNonSpaceInResult === ':';

      // 如果是 key: 后的值开始，或者前面是 [ { , 开头，则这是一个新值的开始引号（不应该在这里出现，因为 inString=true）
      // 更简单的判断：如果是字符串值结束后应该跟结构字符
      if (isStructuralAfter) {
        // 真正的结束引号
        inString = false;
        result += ch;
        i++;
      } else {
        // 这是字符串内部未转义的引号，转义它
        result += '\\"';
        i++;
      }
      continue;
    }

    // 普通字符
    result += ch;
    i++;
  }

  return result;
}

async function loadAnalysisBundle(songId, versionId) {
  const manifestPath = `${DATA_BASE}/analysis/${songId}/${versionId}.json`;
  const linesPath = `${DATA_BASE}/analysis/${songId}/${versionId}.lines.json`;
  
  const [manifest, linesDoc] = await Promise.all([
    fetchJSON(manifestPath),
    fetchJSON(linesPath)
  ]);

  return {
    ...manifest,
    lines: linesDoc.lines || [],
    sentences: linesDoc.sentences || []
  };
}
function getApiConfig() {
  return {
    apiUrl: localStorage.getItem('jplearn_api_url') || '',
    apiKey: localStorage.getItem('jplearn_api_key') || '',
    model: localStorage.getItem('jplearn_api_model') || ''
  };
}
function setApiConfig(cfg) {
  localStorage.setItem('jplearn_api_url', cfg.apiUrl || '');
  localStorage.setItem('jplearn_api_key', cfg.apiKey || '');
  localStorage.setItem('jplearn_api_model', cfg.model || '');
}
function getGitHubToken() {
  return localStorage.getItem('jplearn_github_token') || '';
}
function setGitHubToken(token) {
  if (token) {
    localStorage.setItem('jplearn_github_token', token);
  } else {
    localStorage.removeItem('jplearn_github_token');
  }
}
async function validateGitHubToken(token) {
  const trimmed = (token || '').trim();
  if (!trimmed) return { ok: false, message: '请输入 GitHub Token' };
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${trimmed}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'jplearn-app'
      },
      signal: controller.signal
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401) return { ok: false, message: 'Token 无效（401），请检查是否复制完整' };
      return { ok: false, message: text ? `校验失败：${text}` : '校验失败，请确认 Token 是否有效' };
    }
    const data = await res.json();
    if (!data?.login) {
      return { ok: false, message: '校验失败，请确认 Token 是否有效' };
    }
    return { ok: true, login: data.login };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, networkError: true, message: '校验超时：无法连接 api.github.com（10秒），请检查网络/代理。' };
    }
    return { ok: false, networkError: true, message: `网络错误：${err.message}，无法连接 api.github.com。` };
  } finally {
    clearTimeout(timeoutId);
  }
}

function ensureGlobalSettingsButton() {
  if ($('#settings-btn')) return;
  const btn = el(`<button id="settings-btn" type="button" style="position:fixed;top:14px;right:14px;z-index:260;border:1.5px solid var(--sakura-soft);border-radius:14px;padding:8px 12px;background:#fff;box-shadow:var(--shadow);cursor:pointer;font-size:13px;color:var(--sakura);font-weight:700;display:inline-flex;align-items:center;gap:6px;"><iconify-icon icon="ant-design:setting-outlined" width="14" height="14"></iconify-icon> GitHub</button>`);
  document.body.appendChild(btn);
  btn.addEventListener('click', openSettingsDialog);

  if ($('#reload-btn')) return;
  const reloadBtn = el(`<button id="reload-btn" type="button" style="position:fixed;top:14px;right:108px;z-index:260;border:1.5px solid var(--sakura-soft);border-radius:14px;padding:8px 12px;background:#fff;box-shadow:var(--shadow);cursor:pointer;font-size:13px;color:var(--sakura);font-weight:700;display:inline-flex;align-items:center;gap:6px;"><iconify-icon icon="ant-design:reload-outlined" width="14" height="14"></iconify-icon> 刷新</button>`);
  document.body.appendChild(reloadBtn);
  reloadBtn.addEventListener('click', () => location.reload());
  updateGitHubButtonState();
}

// ---------- 路由 ----------
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', () => {
  ensureGlobalSettingsButton();
  route();
});

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [page, ...rest] = hash.split('/');
  if (page === 'song' && rest[0]) {
    renderSongDetail(rest[0]);
  } else if (page === 'import') {
    renderImport();
  } else {
    renderHome();
  }
  window.scrollTo(0, 0);
}

function goto(hash) { location.hash = hash; }

// ---------- 首页 ----------
async function renderHome(query = '') {
  const app = $('#app');
  app.innerHTML = `
    <div class="brand" onclick="goto('')">
      <div class="brand-mark"><img src="./an.jpg" alt="logo" style="width:60px;height:60px;object-fit:cover;border-radius:50%;"></div>
      <div class="brand-text">
        <div class="title">日语歌词学习</div>
        <div class="sub">うたの言葉、ひとつずつ</div>
      </div>
    </div>
    <div class="search-wrap">
      <iconify-icon icon="ant-design:search-outlined" class="search-icon" width="16" height="16"></iconify-icon>
      <input id="search-input" placeholder="搜索歌曲 / 歌手 / 歌词关键词" value="${escapeHtml(query)}">
      <button id="refresh-btn" class="refresh-btn" type="button" title="刷新歌曲列表"><iconify-icon icon="ant-design:reload-outlined" width="16" height="16"></iconify-icon></button>
    </div>
    <div class="section-label">${query ? '搜索结果' : '全部歌曲'}</div>
    <div id="song-list"></div>
    <div class="fab-row">
      <button class="fab" onclick="goto('import')"><iconify-icon icon="ant-design:plus-outlined" width="16" height="16"></iconify-icon> 创建新的歌词解析</button>
    </div>
  `;

  $('#search-input').addEventListener('input', (e) => {
    renderSongList(e.target.value.trim());
  });
  $('#refresh-btn').addEventListener('click', async () => {
    const btn = $('#refresh-btn');
    btn.classList.add('refreshing');
    state.index = null;
    await renderSongList(query);
    btn.classList.remove('refreshing');
  });

  await renderSongList(query);
}

async function renderSongList(query) {
  const list = $('#song-list');
  if (!list) return;
  list.innerHTML = `<div class="empty-sub" style="padding:20px 0;">加载中…</div>`;
  try {
    if (!state.index) state.index = await fetchJSON(`${DATA_BASE}/index.json`);
    const q = (query || '').toLowerCase();
    const songs = state.index.songs.filter(s => {
      if (!q) return true;
      const hay = [s.title, s.artist, ...(s.aliases || [])].join(' ').toLowerCase();
      return hay.includes(q);
    });
    if (songs.length === 0) {
      list.innerHTML = `<div class="empty-sub" style="padding:30px 0;">没有找到相关歌曲，去「创建新的歌词解析」导入一首吧</div>`;
      return;
    }
    list.innerHTML = songs.map(s => `
      <div class="song-card ${s.analysis_count ? '' : 'no-analysis'}" data-id="${s.id}">
        <div class="song-info">
          <div class="song-title">${escapeHtml(s.title)}</div>
          <div class="song-artist">${escapeHtml(s.artist)}</div>
          <div class="song-meta ${s.analysis_count ? '' : 'empty'}" id="meta-${s.id}">
            ${s.analysis_count ? `已有解析 · ${s.analysis_count}个版本` : '暂无解析 · 待创建'}
          </div>
        </div>
        <div class="song-arrow">›</div>
      </div>
    `).join('');
    list.querySelectorAll('.song-card').forEach(card => {
      card.addEventListener('click', () => goto(`song/${card.dataset.id}`));
    });

    songs.forEach(async s => {
      if (!s.analysis_count) {
        try {
          const songRes = await fetch(`${DATA_BASE}/songs/${s.id}.json`, { cache: 'no-cache' });
          if (songRes.ok) {
            const songData = await songRes.json();
            const versions = songData.analysis_versions || [];
            if (versions.length > 0) {
              const metaEl = $(`#meta-${s.id}`);
              if (metaEl) {
                metaEl.textContent = `已有解析 · ${versions.length}个版本`;
                metaEl.classList.remove('empty');
                metaEl.parentElement.parentElement.classList.remove('no-analysis');
              }
              if (state.index) {
                const entry = state.index.songs.find(entry => entry.id === s.id);
                if (entry) entry.analysis_count = versions.length;
              }
            }
          }
        } catch (err) {
          console.debug(`检查解析状态失败 ${s.id}:`, err);
        }
      }
    });
  } catch (err) {
    list.innerHTML = `<div class="empty-sub" style="padding:30px 0;">加载歌曲列表失败：${err.message}</div>`;
  }
}

// ---------- 歌词详情页 ----------
async function renderSongDetail(songId) {
  const app = $('#app');
  app.innerHTML = `<div class="back-row" onclick="goto('')"><iconify-icon icon="ant-design:arrow-left-outlined" width="14" height="14"></iconify-icon> 返回搜索</div><div class="empty-sub" style="padding:40px 0;text-align:center;">加载中…</div>`;

  let song, indexEntry;
  const pendingSong = getPendingSong(songId);
  if (pendingSong) {
    song = pendingSong;
    indexEntry = null;
    toast('歌词已创建，正在显示刚导入的内容');
  } else {
    try {
      song = await fetchJSON(`${DATA_BASE}/songs/${songId}.json`);
      if (!state.index) state.index = await fetchJSON(`${DATA_BASE}/index.json`);
      indexEntry = state.index.songs.find(s => s.id === songId);
    } catch (err) {
      app.innerHTML = `<div class="back-row" onclick="goto('')"><iconify-icon icon="ant-design:arrow-left-outlined" width="14" height="14"></iconify-icon> 返回搜索</div><div class="empty-sub" style="padding:40px 0;text-align:center;">找不到这首歌：${err.message}</div>`;
      return;
    }
  }
  if (songId === song.id && indexEntry) clearPendingSong(songId);
  state.currentSong = song;

  const hasAnalysis = song.analysis_versions && song.analysis_versions.length > 0;
  if (!hasAnalysis) {
    renderEmptyState(song);
    return;
  }

  const latestVersion = song.analysis_versions[song.analysis_versions.length - 1];
  let analysis;
  try {
    analysis = await loadAnalysisBundle(songId, latestVersion);
  } catch (err) {
    app.innerHTML = `<div class="back-row" onclick="goto('')"><iconify-icon icon="ant-design:arrow-left-outlined" width="14" height="14"></iconify-icon> 返回搜索</div><div class="empty-sub" style="padding:40px 0;text-align:center;">解析数据加载失败：${err.message}</div>`;
    return;
  }
  state.currentAnalysis = analysis;

  app.innerHTML = `
    <div class="back-row" onclick="goto('')"><iconify-icon icon="ant-design:arrow-left-outlined" width="14" height="14"></iconify-icon> 返回搜索</div>
    <div class="song-head">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div style="min-width:0;">
          <div class="title">${escapeHtml(song.title)}</div>
          <div class="artist">${escapeHtml(song.artist)}</div>
          <div class="version-tag"><iconify-icon icon="ant-design:tag-outlined" width="11" height="11"></iconify-icon> ${escapeHtml(analysis.ai_model)}解析版 · ${song.analysis_versions.length}个版本</div>
        </div>
        <button class="delete-song-btn" id="delete-song-btn" title="删除歌曲"><iconify-icon icon="ant-design:delete-outlined" width="16" height="16"></iconify-icon></button>
      </div>
    </div>
    <button class="parse-btn" id="reparse-btn" style="width:auto;padding:8px 20px;font-size:12px;border-radius:12px;margin-bottom:14px;margin-left:auto;margin-right:0;"><iconify-icon icon="ant-design:thunderbolt-outlined" width="16" height="16"></iconify-icon> 用新版本重新解析</button>
    <div class="lyrics-tabs" id="lyrics-tabs">
      <button class="lyrics-tab ${state.lyricsMode === 'kana' ? 'active' : ''}" data-mode="kana">かな</button>
      <button class="lyrics-tab ${state.lyricsMode === 'romaji' ? 'active' : ''}" data-mode="romaji">Romaji</button>
    </div>
    <div class="song-detail-layout">
      <div class="lyrics-block" id="lyrics-block"></div>
    </div>
  `;

  renderLyricsBlock(analysis, song, state.lyricsMode);
  bindLyricsTabs(() => renderLyricsBlock(analysis, song, state.lyricsMode));

  $('#reparse-btn').addEventListener('click', () => startParse(song, { rerun: true }));
  $('#delete-song-btn').addEventListener('click', () => deleteSong(song));
}

function renderRawLyricsBlock(lines, furiganaLines, mode) {
  mode = mode || 'kana';
  return (lines || []).map((line, idx) => {
    let content = '';
    if (furiganaLines && furiganaLines[idx]) {
      const parts = mode === 'romaji' ? mergeSokuonParts(furiganaLines[idx]) : furiganaLines[idx];
      content = parts.map(part => {
        if (part.furigana) {
          const rt = mode === 'romaji' ? kanaToRomaji(part.furigana) : part.furigana;
          return `<ruby><rb>${escapeHtml(part.text)}</rb><rt>${escapeHtml(rt)}</rt></ruby>`;
        }
        if (mode === 'romaji') {
          return parseUtatenLyrics(part.text, 'romaji');
        }
        return escapeHtml(part.text);
      }).join('');
    } else {
      content = parseUtatenLyrics(line, mode);
    }
    return `<div class="lyric-line"><div class="lyric-jp" data-line="${idx}">${content}</div></div>`;
  }).join('');
}

function parseUtatenLyrics(text, mode) {
  mode = mode || 'kana';
  let result = '';
  let i = 0;
  const kanjiRegex = /[\u4e00-\u9fa5\u3400-\u4dbf]/;
  const kanaRegex = /[\u3040-\u30ff]/;
  while (i < text.length) {
    const char = text[i];
    if (kanjiRegex.test(char)) {
      let kanji = '';
      while (i < text.length && kanjiRegex.test(text[i])) {
        kanji += text[i];
        i++;
      }
      let kana = '';
      const maxKana = kanji.length * 4;
      while (i < text.length && kanaRegex.test(text[i]) && kana.length < maxKana) {
        kana += text[i];
        i++;
      }
      if (kanji && kana) {
        const rt = mode === 'romaji' ? kanaToRomaji(kana) : kana;
        result += `<ruby><rb>${escapeHtml(kanji)}</rb><rt>${escapeHtml(rt)}</rt></ruby>`;
      } else {
        result += escapeHtml(kanji);
      }
    } else if (kanaRegex.test(char)) {
      let kana = '';
      while (i < text.length && kanaRegex.test(text[i])) {
        kana += text[i];
        i++;
      }
      result += mode === 'romaji'
        ? `<ruby><rb>${escapeHtml(kana)}</rb><rt>${escapeHtml(kanaToRomaji(kana))}</rt></ruby>`
        : escapeHtml(kana);
    } else {
      result += escapeHtml(char);
      i++;
    }
  }
  return result;
}

function renderTokenizedLyricsBlock(lines, tokensByLine, { showSentenceActions = false } = {}) {
  return (lines || []).map((line, lineIndex) => `
    <div class="lyric-line">
      <div class="lyric-jp local-token-line" data-line="${lineIndex}">
        ${(tokensByLine[lineIndex] || []).map((token, tokenIndex) => token.matched
          ? `<button type="button" class="local-token matched" data-token="${tokenIndex}">${parseUtatenLyrics(token.text)}</button>`
          : `<button type="button" class="local-token" data-token="${tokenIndex}">${parseUtatenLyrics(token.text)}</button>`
        ).join('')}
      </div>
      ${showSentenceActions ? `<button type="button" class="line-trans-btn" data-line="${lineIndex}">查看句子</button>` : ''}
    </div>
  `).join('');
}

async function enableLocalVocabularyLookup(song, { showSentenceActions = false } = {}) {
  const button = $('#local-vocab-btn');
  if (!button) return;
  button.disabled = true;
  button.textContent = '正在加载词典并切词…';
  try {
    const vocabulary = await loadLocalVocabulary();
    const tokensByLine = (song.lyrics_raw || []).map(line => window.JpLearnVocab.tokenize(line, vocabulary));
    const block = $('#lyrics-block');
    block.innerHTML = renderTokenizedLyricsBlock(song.lyrics_raw, tokensByLine, { showSentenceActions });
    block.querySelectorAll('.local-token').forEach(node => {
      node.addEventListener('click', () => {
        block.querySelectorAll('.local-token.picked').forEach(item => item.classList.remove('picked'));
        node.classList.add('picked');
        const lineTokens = tokensByLine[Number(node.closest('.local-token-line').dataset.line)];
        const token = lineTokens[Number(node.dataset.token)];
        showLocalWordPop(token.text, token.candidates || window.JpLearnVocab.findMatches(token.text, vocabulary));
      });
    });
    if (showSentenceActions) {
      block.querySelectorAll('.line-trans-btn').forEach(node => {
        node.addEventListener('click', () => showUnanalyzedSentence(song.lyrics_raw[Number(node.dataset.line)]));
      });
    }
    button.textContent = '✓ 已按本地词典切词，点击词块查释义';
  } catch (err) {
    button.disabled = false;
    button.innerHTML = '<iconify-icon icon="ant-design:book-outlined" width="14" height="14"></iconify-icon> 自动切词并查本地词典';
    toast(`本地词典加载失败：${err.message}`);
  }
}

function bindLyricsTabs(rerender) {
  const tabs = document.querySelectorAll('.lyrics-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.lyricsMode = tab.dataset.mode;
      rerender();
    });
  });
}

function renderLyricsBlock(analysis, song, mode) {
  mode = mode || 'kana';
  const block = $('#lyrics-block');
  const furiganaLines = song?.lyrics_with_furigana;
  block.innerHTML = analysis.lines.map((line, idx) => `
    <div class="lyric-line">
      <div class="lyric-jp" data-line="${idx}">${mode === 'romaji' ? buildRomajiMarkup(line, furiganaLines, idx) : buildRubyMarkup(line, furiganaLines, idx)}</div>
      ${line.translation_cn ? `<div class="line-trans">${escapeHtml(line.translation_cn)}</div>` : ''}
      ${line.sentence_id ? `<button type="button" class="line-trans-btn" data-sentence="${line.sentence_id}"><iconify-icon icon="ant-design:link-outlined" width="12" height="12"></iconify-icon> 句子</button>` : ''}
    </div>
  `).join('');

  block.querySelectorAll('.line-trans-btn').forEach(btn => {
    btn.addEventListener('click', () => showSentence(analysis, btn.dataset.sentence));
  });
}

// 合并促音部分：っ/ッ 需要和后续假名一起转罗马音（如 っ+さい → ssai）
function mergeSokuonParts(parts) {
  const result = [];
  for (let i = 0; i < parts.length; i++) {
    let text = parts[i].text;
    let furigana = parts[i].furigana;
    let checkStr = furigana || text;
    while (checkStr && (checkStr.endsWith('っ') || checkStr.endsWith('ッ')) && i + 1 < parts.length) {
      if (!furigana) furigana = text;
      i++;
      text += parts[i].text;
      furigana += parts[i].furigana || parts[i].text;
      checkStr = furigana || text;
    }
    result.push({ text, furigana });
  }
  return result;
}

// 罗马音模式：用 furigana 数据转罗马音，furigana 为空时用 text 转
function buildRomajiMarkup(line, furiganaLines, lineIdx) {
  if (furiganaLines && furiganaLines[lineIdx]) {
    const parts = mergeSokuonParts(furiganaLines[lineIdx]);
    return parts.map(part => {
      if (part.furigana) {
        const romaji = kanaToRomaji(part.furigana);
        return `<ruby><rb>${escapeHtml(part.text)}</rb><rt>${escapeHtml(romaji)}</rt></ruby>`;
      }
      return parseUtatenLyrics(part.text, 'romaji');
    }).join('');
  }
  return parseUtatenLyrics(line.text || '', 'romaji');
}

// 把一行歌词的 words[] 转成 <ruby> 标记，助词等无 reading 差异的词直接输出文字
function buildRubyMarkup(line, furiganaLines, lineIdx) {
  if (line.words && line.words.length) {
    return line.words.map((w, i) => {
      if (w.pos === '助词' && w.surface === w.reading) {
        return escapeHtml(w.surface);
      }
      return `<ruby>${escapeHtml(w.surface)}<rt>${escapeHtml(w.reading)}</rt></ruby>`;
    }).join('');
  }
  if (furiganaLines && furiganaLines[lineIdx]) {
    return furiganaLines[lineIdx].map(part => {
      if (part.furigana) {
        return `<ruby><rb>${escapeHtml(part.text)}</rb><rt>${escapeHtml(part.furigana)}</rt></ruby>`;
      }
      return escapeHtml(part.text);
    }).join('');
  }
  return escapeHtml(line.text || '');
}

function showSentence(analysis, sentenceId) {
  const sentence = analysis.sentences?.find(s => s.id === sentenceId);
  if (!sentence) {
    $('#sentence-label').style.display = 'flex';
    $('#sentence-slot').innerHTML = `
      <div class="sentence-card">
        <div class="sentence-label">SENTENCE · 暂不可用</div>
        <div class="sentence-jp"></div>
        <div class="sentence-cn">当前解析版本中没有句子数据，无法显示跨行合并的句子翻译。</div>
      </div>
    `;
    return;
  }
  $('#sentence-label').style.display = 'flex';
  const grammarHtml = (sentence.grammar_analysis && sentence.grammar_analysis.length)
    ? sentence.grammar_analysis.map(g => `
        <div class="grammar-item">
          <div class="grammar-word">${escapeHtml(g.word)}</div>
          <div class="grammar-meta">
            <span class="grammar-pos">${escapeHtml(g.pos)}</span>
            ${g.base && g.base !== g.word ? `<span class="grammar-base">原形: ${escapeHtml(g.base)}</span>` : ''}
          </div>
          <div class="grammar-role">${escapeHtml(g.role)}</div>
        </div>
      `).join('')
    : '';
  $('#sentence-slot').innerHTML = `
    <div class="sentence-card">
      <div class="sentence-label">SENTENCE · 跨行自动合并</div>
      <div class="sentence-jp">${escapeHtml(sentence.text_jp)}</div>
      <div class="sentence-cn">${escapeHtml(sentence.translation_cn)}</div>
      ${grammarHtml ? `<div class="grammar-section"><div class="grammar-title">语法拆解</div>${grammarHtml}</div>` : ''}
    </div>
  `;
}

function showUnanalyzedSentence(line) {
  $('#sentence-label').style.display = 'flex';
  $('#sentence-slot').innerHTML = `
    <div class="sentence-card">
      <div class="sentence-label">SENTENCE · 尚未进行 AI 解析</div>
      <div class="sentence-jp">${escapeHtml(line || '')}</div>
      <div class="sentence-cn">这首歌还没有 AI 语法分析，因此暂时无法提供句子合并、翻译和语法解读。</div>
    </div>
  `;
  $('#sentence-slot').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------- 未解析状态 ----------
function renderEmptyState(song) {
  const app = $('#app');
  app.innerHTML = `
    <div class="back-row" onclick="goto('')"><iconify-icon icon="ant-design:arrow-left-outlined" width="14" height="14"></iconify-icon> 返回搜索</div>
    <div class="song-head" style="background: linear-gradient(135deg, rgba(102,211,192,0.14), rgba(255,158,182,0.14));">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div style="min-width:0;">
          <div class="title">${escapeHtml(song.title)}</div>
          <div class="artist">${escapeHtml(song.artist || '未知歌手')}</div>
          <div class="version-tag empty">🌱 还没有解析版本</div>
        </div>
        <button class="delete-song-btn" id="delete-song-btn" title="删除歌曲"><iconify-icon icon="ant-design:delete-outlined" width="16" height="16"></iconify-icon></button>
      </div>
    </div>
    <button class="parse-btn" id="start-parse-btn" style="width:auto;padding:8px 20px;font-size:12px;border-radius:12px;margin-bottom:14px;margin-left:auto;margin-right:0;"><iconify-icon icon="ant-design:thunderbolt-outlined" width="16" height="16"></iconify-icon> AI 解析（切词+翻译）</button>
    <div class="lyrics-tabs" id="lyrics-tabs">
      <button class="lyrics-tab ${state.lyricsMode === 'kana' ? 'active' : ''}" data-mode="kana">かな</button>
      <button class="lyrics-tab ${state.lyricsMode === 'romaji' ? 'active' : ''}" data-mode="romaji">Romaji</button>
    </div>
    <div class="song-detail-layout">
      <div class="lyrics-block" id="lyrics-block">${renderRawLyricsBlock(song.lyrics_raw, song.lyrics_with_furigana, state.lyricsMode)}</div>
    </div>
  `;
  $('#start-parse-btn').addEventListener('click', () => startAiTokenizeAndParse(song));
  bindLyricsTabs(() => {
    $('#lyrics-block').innerHTML = renderRawLyricsBlock(song.lyrics_raw, song.lyrics_with_furigana, state.lyricsMode);
  });
  $('#delete-song-btn').addEventListener('click', () => deleteSong(song));
}

// 在未解析状态下调用 AI 进行分词和翻译（临时，不写入 GitHub）
async function startAiTokenize(song) {
  const cfg = getApiConfig();
  if (!cfg.apiUrl || !cfg.apiKey || !cfg.model) {
    openApiConfigDialog(() => startAiTokenize(song));
    return;
  }

  const logWindow = el(`
    <div class="ai-log-window">
      <div class="log-header">
        <span class="log-title">AI 解析日志</span>
        <button class="log-close" type="button"><iconify-icon icon="ant-design:close-outlined" width="16" height="16"></iconify-icon></button>
      </div>
      <div class="log-body" id="ai-log-content"></div>
    </div>
  `);
  document.body.appendChild(logWindow);
  logWindow.querySelector('.log-close')?.addEventListener('click', () => logWindow.remove());

  function log(msg, type = 'info') {
    const content = $('#ai-log-content');
    if (!content) return;
    const line = el(`<div class="log-line log-${type}">${escapeHtml(msg)}</div>`);
    content.appendChild(line);
    content.scrollTop = content.scrollHeight;
    console.log(`[AI解析] ${msg}`);
  }

  const btn = $('#start-parse-btn');
  btn.disabled = true; btn.innerHTML = '<iconify-icon icon="ant-design:robot-outlined" width="16" height="16"></iconify-icon> AI 解析中…';
  try {
    const startTime = Date.now();
    log(`⏳ 开始解析「${song.title}」`);
    log(`📤 发送请求到: ${cfg.apiUrl}`);
    log(`📊 模型: ${cfg.model}`);
    log(`📝 歌词行数: ${song.lyrics_raw.length}`);

    const prompt = `你是日语歌词语法教学助手。请分析以下日语歌词每行的语法结构，输出 JSON：

${song.lyrics_raw.map((l, i) => `${i}: ${l}`).join('\n')}

输出格式（只返回 JSON，不要其他文字）：
{
  "lines": [{"index":0,"text":"...","translation_cn":"语法分析"}]
}
语法分析 写法要求（严格遵循）：
参考风格：
「哀しい」形容词基本形，意为"悲伤的"；「ほど」副助词，表程度，"……到……程度"，修饰后文；「とり憑かれて」动词「とり憑く」被动形连用形，"被附身"；「仕舞いたい」动词「仕舞う」+愿望助动词「たい」，谓语，"想要彻底……"。整句意为"想要悲伤到被彻底附身"。

规则：
1. 每句必须逐词解析：写出单词原形、词性（含活用形）、中文意思
2.句末用"整句意为：……"收尾
直接输出JSON，不要其他文字。`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000);
    
    const res = await fetch(cfg.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: prompt }], max_tokens: 16000 }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    log(`✅ 请求完成 (${elapsed}s)`, 'success');
    log(`📡 HTTP 状态: ${res.status} ${res.statusText}`);

    if (!res.ok) {
      let errorDetail = '';
      try {
        const errText = await res.text();
        try {
          const errData = JSON.parse(errText);
          errorDetail = errData.error?.message || errData.message || errText;
        } catch {
          errorDetail = errText || '';
        }
      } catch {}
      const errMsg = `AI 接口调用失败 (${res.status}): ${errorDetail || '服务器内部错误'}`;
      log(`❌ ${errMsg}`, 'error');
      if (res.status === 404) {
        log(`💡 404 通常意味着：1) API 地址 URL 路径错误；2) 模型名已弃用或不存在`, 'warning');
        log(`💡 Gemini 当前可用模型：gemini-2.0-flash, gemini-2.5-flash 等（gemini-1.5-flash 已弃用）`, 'warning');
        log(`💡 Gemini OpenAI 兼容端点：https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, 'warning');
      }
      throw new Error(errMsg);
    }

    const data = await res.json();
    log(`📥 响应结构: ${JSON.stringify(Object.keys(data))}`, 'success');
    log(`📥 响应预览: ${JSON.stringify(data).slice(0, 500)}${JSON.stringify(data).length > 500 ? '...' : ''}`, 'info');
    
    const finishReason = data.choices?.[0]?.finish_reason || '';
    if (finishReason === 'length') {
      log(`⚠️ 响应被截断 (finish_reason: length)，请求数量可能不足`, 'warning');
    }
    
    const text = data.choices?.[0]?.message?.content 
      || data.choices?.[0]?.message?.reasoning_content
      || data?.result 
      || data?.content 
      || data?.response 
      || data?.output?.text 
      || data?.output 
      || '';
    if (!text) {
      log('❌ AI 返回内容为空', 'error');
      log('💡 响应完整结构:', 'warning');
      log(JSON.stringify(data, null, 2), 'warning');
      throw new Error('AI 返回内容为空，请检查API响应格式是否匹配。当前支持的格式：choices[0].message.content、result、content、response、output.text');
    }
    
    log(`📝 AI 返回长度: ${text.length} 字符`, 'success');
    log(`📝 AI 返回开头: ${text.slice(0, 100)}${text.length > 100 ? '...' : ''}`, 'info');

    let parsed = repairBrokenJSON(text);
    if (parsed) {
      const isTruncated = finishReason === 'length';
      if (isTruncated) {
        log(`⚠️ 响应被截断但已自动修复，部分歌词可能未解析`, 'warning');
      } else {
        log(`✅ JSON 解析成功`, 'success');
      }
    } else {
      log(`❌ JSON 解析失败，无法修复`, 'error');
      log(`📝 原始内容: ${text.slice(0, 300)}${text.length > 300 ? '...' : ''}`, 'error');
      if (finishReason === 'length') {
        log(`💡 建议：响应被截断导致JSON不完整。请尝试：1) 减少歌词行数；2) 使用支持更长输出的模型`, 'warning');
        throw new Error(`JSON 解析失败（响应被截断）`);
      }
      throw new Error(`JSON 解析失败`);
    }

    const analysis = { lines: [], sentences: [] };
    if (parsed.lines) {
      parsed.lines.forEach(l => analysis.lines.push({ index: l.index, text: l.text || song.lyrics_raw[l.index] || '', translation_cn: l.translation_cn }));
      const totalLines = song.lyrics_raw.length;
      const parsedLines = analysis.lines.length;
      if (parsedLines < totalLines) {
        log(`⚠️ 部分解析: ${parsedLines}/${totalLines} 行（输出被截断）`, 'warning');
      } else {
        log(`✅ 解析完成: ${analysis.lines.length} 行`, 'success');
      }
    } else if (Array.isArray(parsed)) {
      parsed.forEach((words, idx) => analysis.lines.push({ index: idx, text: song.lyrics_raw[idx] || '', words }));
      log(`✅ 解析完成: ${analysis.lines.length} 行`, 'success');
    } else {
      log('❌ AI 返回格式不符合预期', 'error');
      throw new Error('AI 返回格式不符合预期');
    }

    if (analysis.lines.length === 0) {
      log('❌ 没有解析出任何行', 'error');
      throw new Error('没有解析出任何歌词行');
    }

    state.currentAnalysis = analysis;
    renderLyricsBlock(analysis, song, state.lyricsMode);
    log(`🎉 本地渲染完成`, 'success');
    const isTruncated = finishReason === 'length' || analysis.lines.length < song.lyrics_raw.length;
    if (isTruncated) {
      toast(`已解析 ${analysis.lines.length}/${song.lyrics_raw.length} 行（部分截断），点击任意词查看释义`);
    } else {
      toast('AI 解析完成（临时视图），点击任意词查看释义');
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      log(`❌ 请求超时: AI接口在60秒内未响应`, 'error');
      log(`💡 建议：请稍后重试，或检查网络连接`, 'warning');
      toast(`AI 解析超时：请稍后重试`);
    } else {
      log(`❌ 错误: ${err.message}`, 'error');
      toast(`AI 解析失败：${err.message}`);
    }
  } finally {
    btn.disabled = false; btn.innerHTML = '<iconify-icon icon="ant-design:thunderbolt-outlined" width="16" height="16"></iconify-icon> AI 解析（切词+翻译）';
  }
  return logWindow;
}

// 执行 AI 解析（前端临时渲染）和调用 Worker 发起完整解析并保存到 GitHub（若已配置）
async function startAiTokenizeAndParse(song) {
  const cfg = getApiConfig();
  if (!cfg.apiUrl || !cfg.apiKey || !cfg.model) {
    openApiConfigDialog(() => startAiTokenizeAndParse(song));
    return;
  }
  if (!getGitHubToken()) {
    toast('⚠️ 未配置 GitHub Token，解析结果将无法保存！请点击右上角设置按钮配置。');
  }
  const logWindow = await startAiTokenize(song);

  const workerBase = getWorkerBase();
  if (!workerBase) {
    toast('Worker 地址未配置，已本地显示 AI 解析；若想保存解析，请在设置中填写 Worker 地址。');
    return;
  }

  if (logWindow) logWindow.remove();
  startParse(song, { rerun: false });
}

// ---------- 导入 / 创建新解析 ----------
function renderImport() {
  const app = $('#app');
  app.innerHTML = `
    <div class="back-row" onclick="goto('')"><iconify-icon icon="ant-design:arrow-left-outlined" width="14" height="14"></iconify-icon> 返回搜索</div>
    <div class="section-label">创建新的歌词解析</div>
    <div class="tab-row">
      <div class="tab-btn active" data-tab="manual">手动输入</div>
      <div class="tab-btn" data-tab="utaten">Utaten导入</div>
    </div>
    <div id="import-form"></div>
  `;
  const tabs = app.querySelectorAll('.tab-btn');
  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    renderImportForm(t.dataset.tab);
  }));
  renderImportForm('manual');
}

function renderImportForm(mode) {
  const slot = $('#import-form');
  if (mode === 'manual') {
    slot.innerHTML = `
      <div class="field"><label>歌曲名称</label><input id="f-title" placeholder="例如：千本桜"></div>
      <div class="field"><label>歌手</label><input id="f-artist" placeholder="例如：初音ミク"></div>
      <div class="field"><label>歌词（每行一句，按原始换行输入）</label><textarea id="f-lyrics" placeholder="夢を探してた
広げた戒和洋世界"></textarea></div>
      <button class="parse-btn" id="submit-manual" style="width:auto;padding:8px 20px;font-size:12px;border-radius:12px;margin-bottom:14px;margin-left:auto;margin-right:auto;">提交并创建歌词记录</button>
    `;
    $('#submit-manual').addEventListener('click', submitManualImport);
  } else {
    slot.innerHTML = `
      <div class="field"><label>Utaten 歌词页链接</label><input id="f-url" placeholder="https://utaten.com/lyric/xxx"></div>
      <button class="parse-btn" id="submit-utaten" style="width:auto;padding:8px 20px;font-size:12px;border-radius:12px;margin-bottom:14px;margin-left:auto;margin-right:auto;">抓取歌词</button>
      <div class="empty-sub" style="text-align:left;padding:0 4px;">抓取失败时会提示你改用手动输入</div>
    `;
    $('#submit-utaten').addEventListener('click', submitUtatenImport);
  }
}

async function submitManualImport() {
  const title = $('#f-title').value.trim();
  const artist = $('#f-artist').value.trim();
  const lyricsRaw = $('#f-lyrics').value.split('\n').map(l => l.trim()).filter(Boolean);
  if (!title || !artist || lyricsRaw.length === 0) {
    toast('请填写歌曲名称、歌手和歌词');
    return;
  }
  const workerBase = getWorkerBase();
  if (!workerBase) {
    toast('还没有配置 Worker 地址，暂时无法写入公共库（见设置按钮）');
    console.log('待写入歌曲预览：', { title, artist, lyricsRaw });
    return;
  }
  try {
    const res = await fetch(`${workerBase}/api/songs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title, artist, lyrics_raw: lyricsRaw,
        source: 'manual',
        note: '',
        github_token: getGitHubToken()
      })
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, '创建失败，请稍后重试'));
    const { id, song } = await res.json();
    rememberPendingSong(song);
    toast('歌词记录已创建');
    goto('');
  } catch (err) {
    toast(`创建失败：${err.message}`);
  }
}

async function submitUtatenImport() {
  const url = $('#f-url').value.trim();
  if (!url) { toast('请输入 Utaten 链接'); return; }
  const workerBase = getWorkerBase();
  if (!workerBase) { toast('还没有配置 Worker 地址，暂时无法抓取'); return; }
  try {
    const res = await fetch(`${workerBase}/api/utaten-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, github_token: getGitHubToken() })
    });
    if (!res.ok) throw new Error(await readErrorMessage(res, '歌词获取失败，请手动输入歌词'));
    const { id, song } = await res.json();
    rememberPendingSong(song);
    toast('抓取成功，歌词记录已创建');
    goto('');
  } catch (err) {
    toast(err.message);
  }
}

// ---------- 设置对话框 ----------
function updateGitHubButtonState() {
  const btn = $('#settings-btn');
  if (!btn) return;
  const token = getGitHubToken();
  const worker = getWorkerBase();
  const dot = token ? '🟢' : '🔴';
  const tip = token ? 'GitHub Token 已配置' : 'GitHub Token 未配置';
  btn.innerHTML = `<iconify-icon icon="ant-design:setting-outlined" width="14" height="14"></iconify-icon> GitHub ${dot}`;
  btn.title = `${tip}${worker ? '，Worker 已配置' : '，Worker 未配置'}`;
}

async function verifyGitHubToken(token) {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'jplearn-app'
    }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `验证失败 (HTTP ${res.status})`);
  }
  const user = await res.json();
  return user.login;
}

// ---------- 删除歌曲 ----------
async function deleteSong(song) {
  const token = getGitHubToken();
  if (!token) {
    toast('请先在右上角配置 GitHub Token');
    openSettingsDialog();
    return;
  }
  if (!confirm(`确定要删除「${song.title}」吗？此操作不可撤销。`)) return;

  const songPath = `data/songs/${song.id}.json`;
  const progressDiv = el(`<div class="delete-progress"><div class="progress-bar"><div class="progress-fill"></div></div><div class="progress-text">删除中…</div></div>`);
  document.body.appendChild(progressDiv);

  try {
    updateDeleteProgress(10, '获取文件信息');
    const getRes = await fetch(`https://api.github.com/repos/Ancenchan/jplearn/contents/${songPath}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'jplearn-app'
      }
    });
    if (!getRes.ok) {
      throw new Error(`获取文件信息失败 (HTTP ${getRes.status})`);
    }
    const { sha } = await getRes.json();

    updateDeleteProgress(30, '删除歌曲文件');
    const deleteRes = await fetch(`https://api.github.com/repos/Ancenchan/jplearn/contents/${songPath}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'jplearn-app',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `删除歌曲: ${song.title}`,
        sha,
        branch: 'main'
      })
    });
    if (!deleteRes.ok) {
      const err = await deleteRes.json().catch(() => ({}));
      throw new Error(err.message || `删除失败 (HTTP ${deleteRes.status})`);
    }

    updateDeleteProgress(50, '更新索引');
    const indexRes = await fetch('https://api.github.com/repos/Ancenchan/jplearn/contents/data/index.json', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'jplearn-app'
      }
    });
    if (!indexRes.ok) {
      throw new Error(`获取 index.json 失败 (HTTP ${indexRes.status})`);
    }
    const indexData = await indexRes.json();
    const indexContent = JSON.parse(decodeURIComponent(escape(atob(indexData.content.replace(/\n/g, '')))));
    const before = indexContent.songs.length;
    indexContent.songs = indexContent.songs.filter(s => s.id !== song.id);
    if (indexContent.songs.length === before) {
      throw new Error('index.json 中未找到该歌曲记录');
    }
    const putRes = await fetch('https://api.github.com/repos/Ancenchan/jplearn/contents/data/index.json', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'jplearn-app',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `index: 删除 ${song.id}`,
        content: btoa(unescape(encodeURIComponent(JSON.stringify(indexContent, null, 2)))),
        sha: indexData.sha,
        branch: 'main'
      })
    });
    if (!putRes.ok) {
      const err = await putRes.json().catch(() => ({}));
      throw new Error(err.message || `更新 index.json 失败 (HTTP ${putRes.status})`);
    }

    updateDeleteProgress(70, '删除解析文件');
    const analysisDirPath = `data/analysis/${song.id}`;
    const analysisDirRes = await fetch(`https://api.github.com/repos/Ancenchan/jplearn/contents/${analysisDirPath}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'jplearn-app'
      }
    });
    if (analysisDirRes.ok) {
      const analysisFiles = await analysisDirRes.json();
      for (const file of analysisFiles) {
        const deleteFileRes = await fetch(`https://api.github.com/repos/Ancenchan/jplearn/contents/${file.path}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'jplearn-app',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            message: `删除解析文件: ${file.name}`,
            sha: file.sha,
            branch: 'main'
          })
        });
        if (!deleteFileRes.ok) {
          const err = await deleteFileRes.json().catch(() => ({}));
          console.warn(`删除解析文件 ${file.name} 失败: ${err.message || deleteFileRes.status}`);
        }
      }
    }

    updateDeleteProgress(80, '等待同步');
    await waitForDeletion(song.id);

    updateDeleteProgress(100, '删除完成');
    setTimeout(() => {
      progressDiv.remove();
      state.index = null;
      goto('');
    }, 500);
  } catch (err) {
    progressDiv.remove();
    toast(`删除失败：${err.message}`);
  }
}

function updateDeleteProgress(percent, text) {
  const fill = document.querySelector('.progress-fill');
  const textEl = document.querySelector('.progress-text');
  if (fill) fill.style.width = `${percent}%`;
  if (textEl) textEl.textContent = text;
}

async function waitForDeletion(songId) {
  const maxAttempts = 10;
  const delay = 500;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${DATA_BASE}/index.json`, { cache: 'no-cache' });
      if (!res.ok) continue;
      const data = await res.json();
      const exists = data.songs && data.songs.some(s => s.id === songId);
      if (!exists) return;
      updateDeleteProgress(70 + Math.min(20, (i / maxAttempts) * 20), `等待同步… ${i + 1}/${maxAttempts}`);
    } catch {}
    await new Promise(r => setTimeout(r, delay));
  }
}

// ---------- 保存解析结果到 GitHub ----------
async function saveAnalysisToGitHub(song, analysis, versionId) {
  const token = getGitHubToken();
  if (!token) {
    throw new Error('未配置 GitHub Token，无法保存。请点击右上角设置按钮配置 GitHub Token 后重试');
  }

  const GITHUB_API = 'https://api.github.com';
  const OWNER = 'Ancenchan';
  const REPO = 'jplearn';
  const BRANCH = 'main';

  function githubHeaders() {
    return {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'jplearn-frontend'
    };
  }

  function encodeBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  async function githubGetFile(path) {
    const res = await fetch(
      `${GITHUB_API}/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`,
      { headers: githubHeaders() }
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`读取 ${path} 失败: ${res.status}`);
    const data = await res.json();
    const content = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ''))));
    return { json: JSON.parse(content), sha: data.sha };
  }

  async function githubPutJSON(path, obj, message) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await githubGetFile(path).catch(() => null);
      const res = await fetch(
        `${GITHUB_API}/repos/${OWNER}/${REPO}/contents/${path}`,
        {
          method: 'PUT',
          headers: githubHeaders(),
          body: JSON.stringify({
            message,
            content: encodeBase64(JSON.stringify(obj, null, 2)),
            branch: BRANCH,
            ...(existing ? { sha: existing.sha } : {})
          })
        }
      );
      if (res.ok) return;
      if (res.status === 409 && attempt < 2) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      const errText = await res.text();
      throw new Error(`写入 ${path} 失败: ${errText}`);
    }
  }

  const linesPath = `data/analysis/${song.id}/${versionId}.lines.json`;
  const manifestPath = `data/analysis/${song.id}/${versionId}.json`;

  const linesDoc = {
    lines: analysis.lines || [],
    sentences: analysis.sentences || []
  };

  const manifestDoc = {
    id: versionId,
    song_id: song.id,
    created_at: new Date().toISOString(),
    lyrics_source: 'manual',
    ai_model: getApiConfig().model,
    status: 'completed',
    lyrics_snapshot: song.lyrics_raw
  };

  await githubPutJSON(linesPath, linesDoc, `解析: ${song.id} (${getApiConfig().model})`);
  await githubPutJSON(manifestPath, manifestDoc, `解析: ${song.id} (${getApiConfig().model})`);

  const songFile = await githubGetFile(`data/songs/${song.id}.json`);
  if (songFile) {
    songFile.json.analysis_versions = songFile.json.analysis_versions || [];
    songFile.json.analysis_versions.push(versionId);
    await githubPutJSON(`data/songs/${song.id}.json`, songFile.json, `新增解析版本: ${versionId}`);
  }

  const indexFile = await githubGetFile('data/index.json');
  if (indexFile) {
    const entry = indexFile.json.songs.find(s => s.id === song.id);
    if (entry) {
      entry.analysis_count = (entry.analysis_count || 0) + 1;
      await githubPutJSON('data/index.json', indexFile.json, `index: 更新解析计数 ${song.id}`);
    }
  }
}

// ---------- AI 解析 ----------
async function startParse(song, { rerun }) {
  const cfg = getApiConfig();
  if (!cfg.apiUrl || !cfg.apiKey || !cfg.model) {
    openApiConfigDialog(() => startParse(song, { rerun }));
    return;
  }

  const ghToken = getGitHubToken();
  if (!ghToken) {
    toast('⚠️ 未配置 GitHub Token，解析完成后将无法保存到 GitHub。请在设置中配置。');
  }

  const logWindow = el(`
    <div class="ai-log-window">
      <div class="log-header">
        <span class="log-title">AI 解析日志</span>
        <button class="log-close" type="button"><iconify-icon icon="ant-design:close-outlined" width="16" height="16"></iconify-icon></button>
      </div>
      <div class="log-body" id="ai-log-content"></div>
    </div>
  `);
  document.body.appendChild(logWindow);
  logWindow.querySelector('.log-close')?.addEventListener('click', () => logWindow.remove());

  function log(msg, type = 'info') {
    const content = $('#ai-log-content');
    if (!content) return;
    const line = el(`<div class="log-line log-${type}">${escapeHtml(msg)}</div>`);
    content.appendChild(line);
    content.scrollTop = content.scrollHeight;
    console.log(`[AI解析] ${msg}`);
  }

  const btn = rerun ? $('#reparse-btn') : $('#start-parse-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<iconify-icon icon="ant-design:robot-outlined" width="16" height="16"></iconify-icon> AI 解析中…'; }

  log(`⏳ 开始解析「${song.title}」`);
  log(`📤 发送请求到: ${cfg.apiUrl}`);
  log(`📊 模型: ${cfg.model}`);
  log(`📝 歌词行数: ${song.lyrics_raw.length}`);

  try {
    const startTime = Date.now();

    const prompt = `你是日语歌词语法教学助手。请分析以下日语歌词每行的语法结构，输出 JSON：

${song.lyrics_raw.map((l, i) => `${i}: ${l}`).join('\n')}

输出格式（只返回 JSON，不要其他文字）：
{
  "lines": [{"index":0,"text":"...","translation_cn":"语法分析"}]
}
语法分析 写法要求（严格遵循）：
参考风格：
「哀しい」形容词基本形，意为"悲伤的"；「ほど」副助词，表程度，"……到……程度"，修饰后文；「とり憑かれて」动词「とり憑く」被动形连用形，"被附身"；「仕舞いたい」动词「仕舞う」+愿望助动词「たい」，谓语，"想要彻底……"。整句意为"想要悲伤到被彻底附身"。

规则：
1. 每句必须逐词解析：写出单词原形、词性（含活用形）、中文意思
2.句末用"整句意为：……"收尾
直接输出JSON，不要其他文字。`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 300000);

    const res = await fetch(cfg.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: prompt }], max_tokens: 16000 }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    log(`✅ 请求完成 (${elapsed}s)`, 'success');
    log(`📡 HTTP 状态: ${res.status} ${res.statusText}`);

    if (!res.ok) {
      let errorDetail = '';
      try {
        const errText = await res.text();
        try {
          const errData = JSON.parse(errText);
          errorDetail = errData.error?.message || errData.message || errText;
        } catch {
          errorDetail = errText || '';
        }
      } catch {}
      const errMsg = `AI 接口调用失败 (${res.status}): ${errorDetail || '服务器内部错误'}`;
      log(`❌ ${errMsg}`, 'error');
      if (res.status === 404) {
        log(`💡 404 通常意味着：1) API 地址 URL 路径错误；2) 模型名已弃用或不存在`, 'warning');
      }
      throw new Error(errMsg);
    }

    const data = await res.json();
    log(`📥 响应结构: ${JSON.stringify(Object.keys(data))}`, 'success');
    log(`📥 响应预览: ${JSON.stringify(data).slice(0, 500)}${JSON.stringify(data).length > 500 ? '...' : ''}`, 'info');

    const finishReason = data.choices?.[0]?.finish_reason || '';
    if (finishReason === 'length') {
      log(`⚠️ 响应被截断 (finish_reason: length)，请求数量可能不足`, 'warning');
    }

    const text = data.choices?.[0]?.message?.content 
      || data.choices?.[0]?.message?.reasoning_content
      || data?.result 
      || data?.content 
      || data?.response 
      || data?.output?.text 
      || data?.output 
      || '';
    if (!text) {
      log('❌ AI 返回内容为空', 'error');
      log('💡 响应完整结构:', 'warning');
      log(JSON.stringify(data, null, 2), 'warning');
      throw new Error('AI 返回内容为空，请检查API响应格式是否匹配。当前支持的格式：choices[0].message.content、result、content、response、output.text');
    }

    log(`📝 AI 返回长度: ${text.length} 字符`, 'success');
    log(`📝 AI 返回开头: ${text.slice(0, 100)}${text.length > 100 ? '...' : ''}`, 'info');

    let parsed = repairBrokenJSON(text);
    if (parsed) {
      const isTruncated = finishReason === 'length';
      if (isTruncated) {
        log(`⚠️ 响应被截断但已自动修复，部分歌词可能未解析`, 'warning');
      } else {
        log(`✅ JSON 解析成功`, 'success');
      }
    } else {
      log(`❌ JSON 解析失败，无法修复`, 'error');
      log(`📝 原始内容: ${text.slice(0, 300)}${text.length > 300 ? '...' : ''}`, 'error');
      if (finishReason === 'length') {
        log(`💡 建议：响应被截断导致JSON不完整。请尝试：1) 减少歌词行数；2) 使用支持更长输出的模型`, 'warning');
        throw new Error(`JSON 解析失败（响应被截断）`);
      }
      throw new Error(`JSON 解析失败`);
    }

    const analysis = { lines: [], sentences: [] };
    if (parsed.lines) {
      parsed.lines.forEach(l => analysis.lines.push({ index: l.index, text: l.text || song.lyrics_raw[l.index] || '', translation_cn: l.translation_cn }));
      const totalLines = song.lyrics_raw.length;
      const parsedLines = analysis.lines.length;
      if (parsedLines < totalLines) {
        log(`⚠️ 部分解析: ${parsedLines}/${totalLines} 行（输出被截断）`, 'warning');
      } else {
        log(`✅ 解析完成: ${analysis.lines.length} 行`, 'success');
      }
    } else {
      log('❌ AI 返回格式不符合预期', 'error');
      throw new Error('AI 返回格式不符合预期');
    }

    if (analysis.lines.length === 0) {
      log('❌ 没有解析出任何行', 'error');
      throw new Error('没有解析出任何歌词行');
    }

    if (btn) btn.textContent = '正在保存到 GitHub… 80%';
    const analysisId = `${song.id}_${Date.now()}`;
    await saveAnalysisToGitHub(song, analysis, analysisId);
    if (btn) btn.textContent = '保存完成 100%';
    log(`🎉 解析完成！analysis_id: ${analysisId}`, 'success');
    log(`⏳ 等待 GitHub Pages 同步，60秒后自动刷新页面…`, 'warning');
    toast('解析完成，60秒后自动刷新页面');
    setTimeout(() => {
      logWindow.remove();
      location.reload();
    }, 60000);

  } catch (err) {
    log(`❌ 错误: ${err.message}`, 'error');
    toast(`解析失败：${err.message}`);
    if (btn) { btn.disabled = false; btn.innerHTML = rerun ? '<iconify-icon icon="ant-design:thunderbolt-outlined" width="16" height="16"></iconify-icon> 用新版本重新解析' : '<iconify-icon icon="ant-design:thunderbolt-outlined" width="16" height="16"></iconify-icon> 开始AI解析'; }
  }

  $('#ai-log-window .log-close')?.addEventListener('click', () => logWindow.remove());
}

function openApiConfigDialog(onSaved) {
  const cfg = getApiConfig();
  const wrap = el(`
    <div class="word-pop" style="position:fixed;left:16px;right:16px;bottom:16px;max-width:448px;margin:0 auto;z-index:200;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;">
        <div class="section-label" style="margin-top:0;">配置 AI API（仅保存在本机浏览器）</div>
        <button type="button" id="cfg-close" aria-label="关闭" style="border:0;background:transparent;color:var(--ink-soft);font-size:20px;cursor:pointer;line-height:1;display:flex;align-items:center;"><iconify-icon icon="ant-design:close-outlined" width="18" height="18"></iconify-icon></button>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <button type="button" id="preset-openai" style="font-size:11px;padding:4px 8px;border:1px solid var(--sakura-soft);border-radius:8px;background:#fff;cursor:pointer;color:var(--sakura);">OpenAI</button>
        <button type="button" id="preset-deepseek" style="font-size:11px;padding:4px 8px;border:1px solid var(--sakura-soft);border-radius:8px;background:#fff;cursor:pointer;color:var(--sakura);">DeepSeek</button>
        <button type="button" id="preset-zhipu" style="font-size:11px;padding:4px 8px;border:1px solid var(--sakura-soft);border-radius:8px;background:#fff;cursor:pointer;color:var(--sakura);">智谱GLM</button>
      </div>
      <div class="field"><label>API 地址</label><input id="cfg-url" value="${escapeHtml(cfg.apiUrl)}" placeholder="https://api.openai.com/v1/chat/completions"></div>
      <div class="field"><label>API Key</label><input id="cfg-key" type="password" value="${escapeHtml(cfg.apiKey)}"></div>
      <div class="field"><label>模型名称</label><input id="cfg-model" value="${escapeHtml(cfg.model)}" placeholder="例如 gpt-4o / glm-4.5-air"></div>
      <div id="cfg-test-result" style="min-height:24px;font-size:12px;color:var(--ink-soft);text-align:center;margin-bottom:8px;"></div>
      <div style="display:flex;gap:8px;">
        <button class="parse-btn" id="cfg-save">保存并继续</button>
        <button type="button" id="cfg-test" style="padding:12px 16px;border:1.5px solid var(--sakura-soft);border-radius:14px;background:#fff;color:var(--sakura);font-weight:700;font-size:12.5px;cursor:pointer;">测试连接</button>
      </div>
    </div>
  `);
  document.body.appendChild(wrap);

  const closeDialog = () => {
    wrap.remove();
  };

  $('#cfg-close', wrap).addEventListener('click', closeDialog);
  $('#preset-openai', wrap).addEventListener('click', () => {
    $('#cfg-url', wrap).value = 'https://api.openai.com/v1/chat/completions';
    $('#cfg-model', wrap).value = 'gpt-4o';
  });
  $('#preset-deepseek', wrap).addEventListener('click', () => {
    $('#cfg-url', wrap).value = 'https://api.deepseek.com/v1/chat/completions';
    $('#cfg-model', wrap).value = 'deepseek-chat';
  });
  $('#preset-zhipu', wrap).addEventListener('click', () => {
    $('#cfg-url', wrap).value = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
    $('#cfg-model', wrap).value = 'glm-4.5-air';
  });
  $('#cfg-test', wrap).addEventListener('click', () => {
    const url = $('#cfg-url', wrap).value.trim();
    const key = $('#cfg-key', wrap).value.trim();
    const model = $('#cfg-model', wrap).value.trim();
    testApiConnection(url, key, model, $('#cfg-test-result', wrap));
  });
  $('#cfg-save', wrap).addEventListener('click', () => {
    setApiConfig({
      apiUrl: $('#cfg-url', wrap).value.trim(),
      apiKey: $('#cfg-key', wrap).value.trim(),
      model: $('#cfg-model', wrap).value.trim()
    });
    closeDialog();
    onSaved();
  });
}

async function testApiConnection(apiUrl, apiKey, model, resultEl) {
  if (!apiUrl || !apiKey || !model) {
    if (resultEl) resultEl.innerHTML = '<span style="color:#E8637E;">请填写完整配置后再测试</span>';
    return 'error';
  }

  if (resultEl) {
    resultEl.innerHTML = '<span style="color:#8B78E8;">测试中…</span>';
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ 
        model, 
        messages: [{ role: 'user', content: '请返回 "OK" 两个字符，不要任何其他内容。' }],
        max_tokens: 100
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const contentType = res.headers.get('Content-Type') || '';
    const rawText = await res.text();
    console.log('API测试 - HTTP状态:', res.status, res.statusText);
    console.log('API测试 - Content-Type:', contentType);
    console.log('API测试 - 原始响应:', rawText);

    if (!res.ok) {
      let errorDetail = '';
      try {
        const errData = JSON.parse(rawText);
        errorDetail = errData.error?.message || errData.message || '';
      } catch {
        errorDetail = rawText.slice(0, 100);
      }
      if (resultEl) {
        resultEl.innerHTML = `<span style="color:#E8637E;">❌ 连接失败 (${res.status}): ${errorDetail || '服务器返回错误'}</span>`;
      }
      return 'error';
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      if (resultEl) {
        resultEl.innerHTML = `<span style="color:#E8637E;">❌ 响应不是JSON格式</span>`;
        resultEl.innerHTML += `<br><span style="font-size:10px;color:#837E9E;">Content-Type: ${contentType}</span>`;
        resultEl.innerHTML += `<br><span style="font-size:10px;color:#837E9E;">原始响应: "${rawText.slice(0, 100)}"</span>`;
      }
      return 'error';
    }

    const text = data.choices?.[0]?.message?.content 
      || data.choices?.[0]?.message?.reasoning_content
      || data?.result 
      || data?.content 
      || data?.response 
      || data?.output?.text 
      || data?.output 
      || data?.candidates?.[0]?.content?.parts?.[0]?.text 
      || '';

    if (!text) {
      if (resultEl) {
        resultEl.innerHTML = `<span style="color:#E8637E;">❌ 连接成功但返回内容为空</span>`;
        resultEl.innerHTML += `<br><span style="font-size:10px;color:#837E9E;">响应结构: ${JSON.stringify(Object.keys(data))}</span>`;
        resultEl.innerHTML += `<br><span style="font-size:10px;color:#837E9E;">原始响应预览: "${rawText.slice(0, 200)}"</span>`;
      }
      return 'error';
    } else {
      if (resultEl) {
        resultEl.innerHTML = `<span style="color:#2FAE97;">✅ 连接成功！返回内容: "${text.trim().slice(0, 50)}"</span>`;
      }
      return 'success';
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      if (resultEl) resultEl.innerHTML = '<span style="color:#E8637E;">❌ 请求超时（10秒）</span>';
    } else {
      if (resultEl) resultEl.innerHTML = `<span style="color:#E8637E;">❌ 连接失败: ${err.message}</span>`;
      if (err.message.includes('CORS')) {
        resultEl.innerHTML += `<br><span style="font-size:10px;color:#837E9E;">💡 提示：可能遇到CORS跨域限制，需要通过Worker代理</span>`;
      }
    }
    return 'error';
  }
}

function openSettingsDialog() {  const token = getGitHubToken();
  const workerBase = getWorkerBase();
  const wrap = el(`
    <div class="word-pop" style="position:fixed;left:16px;right:16px;bottom:16px;max-width:448px;margin:0 auto;z-index:250;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;">
        <div class="section-label" style="margin-top:0;">配置</div>
        <button type="button" id="settings-close" aria-label="关闭" style="border:0;background:transparent;color:var(--ink-soft);font-size:20px;cursor:pointer;line-height:1;display:flex;align-items:center;"><iconify-icon icon="ant-design:close-outlined" width="18" height="18"></iconify-icon></button>
      </div>
      <div class="field"><label>Worker 地址</label><input id="settings-worker" value="${escapeHtml(workerBase)}" placeholder="https://jplearn-worker.xxx.workers.dev"></div>
      <div class="field"><label>GitHub Token</label><input id="settings-token" type="password" value="${escapeHtml(token)}" placeholder="ghp_xxx"></div>
      <div class="empty-sub" style="margin-top:-6px;">Worker 地址用于调用导入 / 解析接口；Token 用于写入数据前的鉴权校验。两项都仅保存在本机浏览器。</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="parse-btn" id="settings-save">保存并验证</button>
        <button type="button" id="settings-clear" style="padding:12px 14px;border:1.5px solid var(--sakura-soft);border-radius:14px;background:#fff;color:var(--sakura);cursor:pointer;font-weight:700;">清空</button>
      </div>
    </div>
  `);
  document.body.appendChild(wrap);

  const closeDialog = () => wrap.remove();
  $('#settings-close', wrap).addEventListener('click', closeDialog);
  $('#settings-clear', wrap).addEventListener('click', () => {
    setWorkerBase('');
    setGitHubToken('');
    updateGitHubButtonState();
    toast('已清空 Worker 地址和 GitHub Token');
    closeDialog();
  });
  $('#settings-save', wrap).addEventListener('click', async () => {
    const saveBtn = $('#settings-save', wrap);
    const workerValue = $('#settings-worker', wrap).value.trim();
    const tokenValue = $('#settings-token', wrap).value.trim();
    saveBtn.disabled = true;
    const originalText = saveBtn.textContent;
    saveBtn.textContent = '验证中…';
    try {
      setWorkerBase(workerValue);
      if (tokenValue) {
        const result = await validateGitHubToken(tokenValue);
        if (result.ok) {
          setGitHubToken(tokenValue);
          toast(`已保存并验证 GitHub Token（${result.login}）`);
        } else if (result.networkError) {
          // 网络不通时跳过验证直接保存，避免用户被卡住
          setGitHubToken(tokenValue);
          toast(`⚠️ ${result.message} Token 已保存但未验证。`);
        } else {
          toast(result.message);
          saveBtn.disabled = false;
          saveBtn.textContent = originalText;
          return;
        }
      } else {
        setGitHubToken('');
        toast('已保存 Worker 地址；未填写 GitHub Token');
      }
      updateGitHubButtonState();
      closeDialog();
    } catch (err) {
      toast(`保存失败：${err.message}`);
      saveBtn.disabled = false;
      saveBtn.textContent = originalText;
    }
  });
}

async function readErrorMessage(res, fallback) {
  const copy = res.clone();
  try {
    const data = await res.json();
    return data?.error || fallback;
  } catch {
    try {
      return await copy.text() || fallback;
    } catch {
      return fallback;
    }
  }
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// expose for inline onclick handlers
window.goto = goto;
