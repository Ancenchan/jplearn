// ============================================================
// 日语歌词学习 - 前端逻辑
// 纯静态页面 + hash 路由，数据来自 /data 目录（GitHub Pages 直接托管）
// 写操作（导入歌曲 / AI解析 / 保存回GitHub）都会转发给 Cloudflare Worker
// ============================================================

// TODO: 部署 Worker 后，把这里换成你的 Worker 地址
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
  currentAnalysis: null // 当前解析版本
};

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
async function fetchJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`加载失败: ${path}`);
  return res.json();
}

async function loadAnalysisBundle(songId, versionId) {
  const manifestPath = `${DATA_BASE}/analysis/${songId}/${versionId}.json`;
  const manifest = await fetchJSON(manifestPath);

  if (Array.isArray(manifest.lines) && Array.isArray(manifest.sentences)) {
    return manifest;
  }

  const partPaths = manifest.parts || {};
  const [linesDoc, sentencesDoc] = await Promise.all([
    partPaths.lines ? fetchJSON(`${DATA_BASE}/analysis/${songId}/${partPaths.lines}`) : Promise.resolve({ lines: [] }),
    partPaths.sentences ? fetchJSON(`${DATA_BASE}/analysis/${songId}/${partPaths.sentences}`) : Promise.resolve({ sentences: [] })
  ]);

  return {
    ...manifest,
    lines: linesDoc.lines || [],
    sentences: sentencesDoc.sentences || []
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
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${trimmed}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'jplearn-app'
      }
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, message: text ? `校验失败：${text}` : '校验失败，请确认 Token 是否有效' };
    }
    const data = await res.json();
    if (!data?.login) {
      return { ok: false, message: '校验失败，请确认 Token 是否有效' };
    }
    return { ok: true, login: data.login };
  } catch (err) {
    return { ok: false, message: `校验失败：${err.message}` };
  }
}

function ensureGlobalSettingsButton() {
  if ($('#settings-btn')) return;
  const btn = el(`<button id="settings-btn" type="button" style="position:fixed;top:14px;right:14px;z-index:260;border:none;border-radius:999px;padding:8px 12px;background:#fff;box-shadow:0 8px 24px rgba(99,84,124,0.16);cursor:pointer;font-size:14px;">⚙️ GitHub</button>`);
  document.body.appendChild(btn);
  btn.addEventListener('click', openSettingsDialog);
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
      <div class="brand-mark">歌</div>
      <div class="brand-text">
        <div class="title">日语歌词学习</div>
        <div class="sub">うたの言葉、ひとつずつ</div>
      </div>
    </div>
    <div class="search-wrap">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#B7B2CF" stroke-width="2.4"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
      <input id="search-input" placeholder="搜索歌曲 / 歌手 / 歌词关键词" value="${escapeHtml(query)}">
    </div>
    <div class="search-hint">
      <span class="chip" data-q="千本樱">🌸 千本樱</span>
      <span class="chip" data-q="打上花火">🍵 打上花火</span>
      <span class="chip" data-q="lemon">🎐 lemon</span>
    </div>
    <div class="section-label">${query ? '搜索结果' : '全部歌曲'}</div>
    <div id="song-list"></div>
    <div class="fab-row">
      <button class="fab" onclick="goto('import')">＋ 创建新的歌词解析</button>
    </div>
  `;

  $('#search-input').addEventListener('input', (e) => {
    renderSongList(e.target.value.trim());
  });
  app.querySelectorAll('.chip').forEach(c => {
    c.addEventListener('click', () => {
      $('#search-input').value = c.dataset.q;
      renderSongList(c.dataset.q);
    });
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
          <div class="song-meta ${s.analysis_count ? '' : 'empty'}">
            ${s.analysis_count ? `已有解析 · ${s.analysis_count}个版本` : '暂无解析 · 待创建'}
          </div>
        </div>
        <div class="song-arrow">›</div>
      </div>
    `).join('');
    list.querySelectorAll('.song-card').forEach(card => {
      card.addEventListener('click', () => goto(`song/${card.dataset.id}`));
    });
  } catch (err) {
    list.innerHTML = `<div class="empty-sub" style="padding:30px 0;">加载歌曲列表失败：${err.message}</div>`;
  }
}

// ---------- 歌词详情页 ----------
async function renderSongDetail(songId) {
  const app = $('#app');
  app.innerHTML = `<div class="back-row" onclick="goto('')">‹ &nbsp;返回搜索</div><div class="empty-sub" style="padding:40px 0;text-align:center;">加载中…</div>`;

  let song, indexEntry;
  try {
    song = await fetchJSON(`${DATA_BASE}/songs/${songId}.json`);
    if (!state.index) state.index = await fetchJSON(`${DATA_BASE}/index.json`);
    indexEntry = state.index.songs.find(s => s.id === songId);
  } catch (err) {
    app.innerHTML = `<div class="back-row" onclick="goto('')">‹ &nbsp;返回搜索</div><div class="empty-sub" style="padding:40px 0;text-align:center;">找不到这首歌：${err.message}</div>`;
    return;
  }
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
    app.innerHTML = `<div class="back-row" onclick="goto('')">‹ &nbsp;返回搜索</div><div class="empty-sub" style="padding:40px 0;text-align:center;">解析数据加载失败：${err.message}</div>`;
    return;
  }
  state.currentAnalysis = analysis;

  app.innerHTML = `
    <div class="back-row" onclick="goto('')">‹ &nbsp;返回搜索</div>
    <div class="song-head">
      <div class="title">${escapeHtml(song.title)}</div>
      <div class="artist">${escapeHtml(song.artist)}</div>
      <div class="version-tag">🍡 ${escapeHtml(analysis.ai_model)}解析版 · ${song.analysis_versions.length}个版本</div>
    </div>
    <button class="parse-btn" id="reparse-btn">✨ 用新版本重新解析</button>
    <div class="section-label">歌词</div>
    <div class="lyrics-block" id="lyrics-block"></div>
    <div class="section-label">单词解析</div>
    <div id="word-pop-slot">
      <div class="word-pop"><div class="pop-empty">点击上方任意一个词，查看它的语法拆解</div></div>
    </div>
    <div class="section-label" id="sentence-label" style="display:none;">当前句子</div>
    <div id="sentence-slot"></div>
  `;

  renderLyricsBlock(analysis);

  $('#reparse-btn').addEventListener('click', () => startParse(song, { rerun: true }));
}

function renderLyricsBlock(analysis) {
  const block = $('#lyrics-block');
  block.innerHTML = analysis.lines.map((line, idx) => `
    <div class="lyric-line">
      <div class="lyric-jp" data-line="${idx}">${buildRubyMarkup(line)}</div>
      <div class="line-trans-btn" data-sentence="${line.sentence_id}">查看句子</div>
    </div>
  `).join('');

  block.querySelectorAll('.w').forEach(node => {
    node.addEventListener('click', () => {
      block.querySelectorAll('.w.picked').forEach(n => n.classList.remove('picked'));
      node.classList.add('picked');
      const lineIdx = Number(node.closest('.lyric-jp').dataset.line);
      const wordIdx = Number(node.dataset.widx);
      showWordPop(analysis.lines[lineIdx].words[wordIdx]);
    });
  });
  block.querySelectorAll('.line-trans-btn').forEach(btn => {
    btn.addEventListener('click', () => showSentence(analysis, btn.dataset.sentence));
  });
}

// 把一行歌词的 words[] 转成 <ruby> 标记，助词等无 reading 差异的词直接输出文字
function buildRubyMarkup(line) {
  return line.words.map((w, i) => {
    if (w.pos === '助词' && w.surface === w.reading) {
      return escapeHtml(w.surface); // 助词不加注音，避免视觉噪音
    }
    return `<ruby class="w" data-widx="${i}">${escapeHtml(w.surface)}<rt>${escapeHtml(w.reading)}</rt></ruby>`;
  }).join('');
}

function showWordPop(word) {
  const slot = $('#word-pop-slot');
  slot.innerHTML = `
    <div class="word-pop">
      <div class="word-pop-head">
        <div class="word-pop-jp">${escapeHtml(word.surface)}</div>
        <div class="word-pop-yomi">${escapeHtml(word.reading)}</div>
      </div>
      <div class="pop-grid">
        <div class="k">原形</div><div>${escapeHtml(word.base)}</div>
        <div class="k">词性</div><div><span class="pop-tag">${escapeHtml(word.pos)}</span></div>
        <div class="k">释义</div><div>${escapeHtml(word.meaning || '')}</div>
      </div>
      ${word.chain ? `<div class="pop-chain">变化过程 &nbsp;<b>${escapeHtml(word.chain)}</b>${word.conjugation ? `（${escapeHtml(word.conjugation)}）` : ''}</div>` : ''}
    </div>
  `;
  slot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showSentence(analysis, sentenceId) {
  const sentence = analysis.sentences.find(s => s.id === sentenceId);
  if (!sentence) return;
  $('#sentence-label').style.display = 'flex';
  $('#sentence-slot').innerHTML = `
    <div class="sentence-card">
      <div class="sentence-label">SENTENCE · 跨行自动合并</div>
      <div class="sentence-jp">${escapeHtml(sentence.text_jp)}</div>
      <div class="sentence-cn">${escapeHtml(sentence.translation_cn)}</div>
    </div>
  `;
  $('#sentence-slot').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------- 未解析状态 ----------
function renderEmptyState(song) {
  const app = $('#app');
  app.innerHTML = `
    <div class="back-row" onclick="goto('')">‹ &nbsp;返回搜索</div>
    <div class="song-head" style="background: linear-gradient(135deg, rgba(102,211,192,0.14), rgba(255,158,182,0.14));">
      <div class="title">${escapeHtml(song.title)}</div>
      <div class="artist">${escapeHtml(song.artist)}</div>
      <div class="version-tag empty">🌱 还没有解析版本</div>
    </div>
    <div class="empty-wrap">
      <div class="empty-mark">🌸💤</div>
      <div class="empty-title">这首歌还在睡觉呢</div>
      <div class="empty-sub">还没有人为「${escapeHtml(song.title)}」生成过语法解析<br>用你自己的 AI API，第一个唤醒它吧</div>
    </div>
    <div class="empty-card"><div class="n">1</div><div class="t"><b>配置 API</b> — 填写地址 / Key / 模型名称（仅存于本地浏览器）</div></div>
    <div class="empty-card"><div class="n">2</div><div class="t"><b>点击开始解析</b> — AI 会自动断句、翻译并拆解语法</div></div>
    <div class="empty-card"><div class="n">3</div><div class="t"><b>存入公共库</b> — 解析结果会保留下来，后来的人可以直接查看</div></div>
    <button class="parse-btn" id="start-parse-btn" style="margin-top:10px;">✨ 开始AI解析</button>
  `;
  $('#start-parse-btn').addEventListener('click', () => startParse(song, { rerun: false }));
}

// ---------- 导入 / 创建新解析 ----------
function renderImport() {
  const app = $('#app');
  app.innerHTML = `
    <div class="back-row" onclick="goto('')">‹ &nbsp;返回搜索</div>
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
      <div class="field"><label>来源（选填）</label><input id="f-source" placeholder="例如：手动输入 / 专辑歌词卡"></div>
      <div class="field"><label>备注（选填）</label><input id="f-note"></div>
      <button class="parse-btn" id="submit-manual">提交并创建歌词记录</button>
    `;
    $('#submit-manual').addEventListener('click', submitManualImport);
  } else {
    slot.innerHTML = `
      <div class="field"><label>Utaten 歌词页链接</label><input id="f-url" placeholder="https://utaten.com/lyric/xxx"></div>
      <button class="parse-btn" id="submit-utaten">抓取歌词</button>
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
        source: $('#f-source').value.trim() || 'manual',
        note: $('#f-note').value.trim(),
        github_token: getGitHubToken()
      })
    });
    if (!res.ok) throw new Error(await res.text());
    const { id } = await res.json();
    toast('歌词记录已创建');
    goto(`song/${id}`);
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
    if (!res.ok) throw new Error('歌词获取失败，请手动输入歌词');
    const { id } = await res.json();
    toast('抓取成功，歌词记录已创建');
    goto(`song/${id}`);
  } catch (err) {
    toast(err.message);
  }
}

// ---------- AI 解析 ----------
async function startParse(song, { rerun }) {
  const cfg = getApiConfig();
  if (!cfg.apiUrl || !cfg.apiKey || !cfg.model) {
    openApiConfigDialog(() => startParse(song, { rerun }));
    return;
  }
  const workerBase = getWorkerBase();
  if (!workerBase) {
    toast('还没有配置 Worker 地址，暂时无法调用AI解析（见设置按钮）');
    return;
  }
  const btn = rerun ? $('#reparse-btn') : $('#start-parse-btn');
  if (btn) { btn.disabled = true; btn.textContent = '正在分析歌词结构… 30%'; }
  try {
    const res = await fetch(`${workerBase}/api/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        song_id: song.id,
        lyrics: song.lyrics_raw,
        api_url: cfg.apiUrl,
        api_key: cfg.apiKey,
        model: cfg.model,
        github_token: getGitHubToken()
      })
    });
    if (btn) btn.textContent = '正在生成语法解析… 80%';
    if (!res.ok) throw new Error(await res.text());
    const { analysis_id } = await res.json();
    toast('解析完成');
    goto(`song/${song.id}`);
  } catch (err) {
    toast(`解析失败：${err.message}`);
    if (btn) { btn.disabled = false; btn.textContent = rerun ? '✨ 用新版本重新解析' : '✨ 开始AI解析'; }
  }
}

function openApiConfigDialog(onSaved) {
  const cfg = getApiConfig();
  const wrap = el(`
    <div class="word-pop" style="position:fixed;left:16px;right:16px;bottom:16px;max-width:448px;margin:0 auto;z-index:200;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;">
        <div class="section-label" style="margin-top:0;">配置 AI API（仅保存在本机浏览器）</div>
        <button type="button" id="cfg-close" aria-label="关闭" style="border:0;background:transparent;color:#8b7fa6;font-size:20px;cursor:pointer;line-height:1;">×</button>
      </div>
      <div class="field"><label>API 地址</label><input id="cfg-url" value="${escapeHtml(cfg.apiUrl)}" placeholder="https://api.openai.com/v1/chat/completions"></div>
      <div class="field"><label>API Key</label><input id="cfg-key" type="password" value="${escapeHtml(cfg.apiKey)}"></div>
      <div class="field"><label>模型名称</label><input id="cfg-model" value="${escapeHtml(cfg.model)}" placeholder="例如 gpt-4o / deepseek-chat"></div>
      <button class="parse-btn" id="cfg-save">保存并继续</button>
    </div>
  `);
  document.body.appendChild(wrap);

  const closeDialog = () => {
    wrap.remove();
  };

  $('#cfg-close', wrap).addEventListener('click', closeDialog);
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

function openSettingsDialog() {
  const token = getGitHubToken();
  const workerBase = getWorkerBase();
  const wrap = el(`
    <div class="word-pop" style="position:fixed;left:16px;right:16px;bottom:16px;max-width:448px;margin:0 auto;z-index:250;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;">
        <div class="section-label" style="margin-top:0;">配置</div>
        <button type="button" id="settings-close" aria-label="关闭" style="border:0;background:transparent;color:#8b7fa6;font-size:20px;cursor:pointer;line-height:1;">×</button>
      </div>
      <div class="field"><label>Worker 地址</label><input id="settings-worker" value="${escapeHtml(workerBase)}" placeholder="https://jplearn-worker.xxx.workers.dev"></div>
      <div class="field"><label>GitHub Token</label><input id="settings-token" type="password" value="${escapeHtml(token)}" placeholder="ghp_xxx"></div>
      <div class="empty-sub" style="margin-top:-6px;">Worker 地址用于调用导入 / 解析接口；Token 用于写入数据前的鉴权校验。两项都仅保存在本机浏览器。</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="parse-btn" id="settings-save">保存并验证</button>
        <button type="button" id="settings-clear" style="padding:12px 14px;border:none;border-radius:999px;background:#f3eef8;color:#625874;cursor:pointer;">清空</button>
      </div>
    </div>
  `);
  document.body.appendChild(wrap);

  const closeDialog = () => wrap.remove();
  $('#settings-close', wrap).addEventListener('click', closeDialog);
  $('#settings-clear', wrap).addEventListener('click', () => {
    setWorkerBase('');
    setGitHubToken('');
    toast('已清空 Worker 地址和 GitHub Token');
    closeDialog();
  });
  $('#settings-save', wrap).addEventListener('click', async () => {
    const workerValue = $('#settings-worker', wrap).value.trim();
    const tokenValue = $('#settings-token', wrap).value.trim();
    setWorkerBase(workerValue);
    if (tokenValue) {
      const result = await validateGitHubToken(tokenValue);
      if (!result.ok) {
        toast(result.message);
        return;
      }
      setGitHubToken(tokenValue);
      toast(`已保存 Worker 地址并验证 GitHub Token（${result.login}）`);
    } else {
      setGitHubToken('');
      toast('已保存 Worker 地址；未填写 GitHub Token');
    }
    closeDialog();
  });
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// expose for inline onclick handlers
window.goto = goto;
