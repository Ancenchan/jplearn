// ============================================================
// 日语歌词学习 - 前端逻辑
// 纯静态页面 + hash 路由，数据来自 /data 目录（GitHub Pages 直接托管）
// 写操作（导入歌曲 / AI解析 / 保存回GitHub）都会转发给 Cloudflare Worker
// ============================================================

// TODO: 部署 Worker 后，把这里换成你的 Worker 地址
// 例如 "https://jplearn-worker.<your-subdomain>.workers.dev"
const WORKER_BASE = localStorage.getItem('jplearn_worker_base') || '';

function getGithubToken(){ return localStorage.getItem('jplearn_github_token') || ''; }
function setGithubToken(v){ localStorage.setItem('jplearn_github_token', v); }

const DATA_BASE = './data';

const state = {
  index: null,          // data/index.json 缓存
  currentSong: null,    // 当前歌曲详情
  currentAnalysis: null // 当前解析版本
};

// kuromoji tokenizer instance (loaded from CDN)
let kuromojiTokenizer = null;
if (window.kuromoji) {
  try {
    window.kuromoji.builder({ dicPath: 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dist/dict/' }).build((err, tokenizer) => {
      if (!err && tokenizer) {
        kuromojiTokenizer = tokenizer;
        // 如果已经有加载中的解析，重新渲染以应用更精确的分词
        if (state.currentAnalysis) renderLyricsBlock(state.currentAnalysis);
      }
    });
  } catch (e) {
    console.warn('kuromoji init failed', e);
  }
}

function tokenizeTextWithKuromoji(text) {
  if (!kuromojiTokenizer) return [];
  try {
    const toks = kuromojiTokenizer.tokenize(text);
    return toks.map(t => ({
      surface: t.surface_form || '',
      reading: t.reading || t.surface_form || '',
      base: (t.basic_form && t.basic_form !== '*') ? t.basic_form : (t.surface_form || ''),
      pos: t.pos || t.pos_detail_1 || ''
    }));
  } catch (e) {
    console.warn('tokenize error', e);
    return [];
  }
}

// 小型本地词典加载与查询（来自 5757词.json）
let _localDict = null; // map: 词汇 -> entry
let _localDictPromise = null;
function loadLocalDict() {
  if (_localDictPromise) return _localDictPromise;
  _localDictPromise = fetch('./5757词.json').then(r => {
    if (!r.ok) throw new Error('字典加载失败');
    return r.json();
  }).then(arr => {
    const m = new Map();
    arr.forEach(item => {
      const key = (item['词汇'] || item['词'] || item['surface'] || '').trim();
      if (!key) return;
      m.set(key, item);
      // 也索引读音
      const yomi = (item['读音'] || item['罗马音'] || '').trim();
      if (yomi) m.set(yomi, item);
    });
    _localDict = m;
    return m;
  }).catch(e => { console.warn('loadLocalDict error', e); _localDict = new Map(); return _localDict; });
  return _localDictPromise;
}

function findLocalDictEntry(surface) {
  if (!_localDict) return loadLocalDict().then(() => findLocalDictEntry(surface));
  const s = (surface || '').trim();
  if (!s) return null;
  if (_localDict.has(s)) return _localDict.get(s);
  // 尝试去掉假名小写、标点等简单归一化
  const norm = s.replace(/[。、！？，,.!?\s]/g, '');
  if (_localDict.has(norm)) return _localDict.get(norm);
  // 尝试片假名/平假名转换未实现——返回 null
  return null;
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
async function fetchJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`加载失败: ${path}`);
  return res.json();
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

// ---------- 路由 ----------
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);

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
    <button class="config-btn" onclick="openGithubTokenDialog()">🔑 GitHub配置</button>
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
      <button class="fab" onclick="goto('import')">＋ 导入新歌词</button>
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
      list.innerHTML = `<div class="empty-sub" style="padding:30px 0;">没有找到歌曲，去「导入新歌词」添加一首吧</div>`;
      return;
    }
    list.innerHTML = songs.map(s => `
      <div class="song-card ${s.analysis_count ? '' : 'no-analysis'}" data-id="${s.id}">
        <div class="song-info">
          <div class="song-title">${escapeHtml(s.title)}</div>
          <div class="song-artist">${escapeHtml(s.artist)}</div>
          <div class="song-meta ${s.analysis_count ? '' : 'empty'}">
            ${s.analysis_count ? `解析版本：${s.analysis_count}个` : '暂无解析 · 待创建'}
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


// ---------- GitHub Token 配置 ----------
function openGithubTokenDialog(){
 const old=getGithubToken();
 const box=el(`
 <div class="modal-mask">
  <div class="modal">
   <button class="modal-close" onclick="this.closest('.modal-mask').remove()">×</button>
   <h3>GitHub Token</h3>
   <p class="empty-sub">用于提交歌词到仓库。Token仅保存在本机浏览器。</p>
   <input id="github-token-input" type="password" value="${old}" placeholder="ghp_xxx">
   <div class="modal-actions">
    <button onclick="this.closest('.modal-mask').remove()">取消</button>
    <button onclick="saveGithubToken()">确定</button>
   </div>
  </div>
 </div>`);
 document.body.appendChild(box);
}
function saveGithubToken(){
 const v=document.querySelector('#github-token-input').value.trim();
 if(!v) return toast('请输入Token');
 fetch(WORKER_BASE+'/api/auth/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:v})})
 .then(r=>r.json()).then(d=>{
  if(!d.ok) return toast('Token验证失败');
  setGithubToken(v); toast('GitHub Token验证通过'); document.querySelector('.modal-mask').remove();
 });
}

// ---------- 导入歌词 ----------
function renderImport(){
 $('#app').innerHTML=`
 <div class="back-row" onclick="goto('')">‹ 返回</div>
 <div class="section-label">导入新歌词</div>
 <div class="modal" style="margin:auto">
  <button class="import-choice" onclick="showManualImport()">✍️ 手动输入歌词</button>
  <button class="import-choice" onclick="showUtatenImport()">🌐 Utaten链接导入</button>
 </div>`;
}
function showManualImport(){
 $('#app').innerHTML=`<div class="back-row" onclick="goto('import')">‹ 返回</div>
 <h2>手动输入歌词</h2>
 <input id="song-title" placeholder="歌曲名">
 <textarea id="song-lyrics" placeholder="粘贴歌词"></textarea>
 <button onclick="submitManualSong()">提交到GitHub</button>`;
}
async function submitManualSong(){
 if(!getGithubToken()) return toast('请先配置GitHub Token');
 const body={title:$('#song-title').value, lyrics:$('#song-lyrics').value, token:getGithubToken()};
 const r=await fetch(WORKER_BASE+'/api/songs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,artist:'',lyrics_raw:body.lyrics.split('\n').filter(Boolean)})});
 toast(r.ok?'提交成功':'提交失败');
}
function showUtatenImport(){
 $('#app').innerHTML=`<div class="back-row" onclick="goto('import')">‹ 返回</div>
 <h2>Utaten导入</h2>
 <input id="utaten-url" placeholder="https://utaten.com/...">
 <button onclick="submitUtaten()">抓取歌词</button>`;
}
async function submitUtaten(){
 const url=$('#utaten-url').value;
 const r=await fetch(WORKER_BASE+'/api/utaten-import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url,token:getGithubToken()})});
 toast(r.ok?'导入成功':'导入失败');
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
    analysis = await fetchJSON(`${DATA_BASE}/analysis/${songId}/${latestVersion}.json`);
  } catch (err) {
    app.innerHTML = `<div class="back-row" onclick="goto('')">‹ &nbsp;返回搜索</div><div class="empty-sub" style="padding:40px 0;text-align:center;">解析数据加载失败：${err.message}</div>`;
    return;
  }
  state.currentAnalysis = analysis;

  // 兼容：将旧字段映射到新字段，保证前端字段可用
  analysis.ai_model = analysis.ai_model || analysis.model || analysis.model_name || analysis.aiModel || analysis.version || '';
  // 确保 sentences 存在，避免 showSentence 时报错
  analysis.sentences = analysis.sentences || [];

  // 兼容：部分示例数据使用不同结构（例如只有 analysis.words），
  // 如果缺少 analysis.lines，则根据 song.lyrics 或 analysis.words 回退构造简单的 lines
  if (!analysis.lines || !Array.isArray(analysis.lines)) {
    const lines = [];
    if (song && Array.isArray(song.lyrics) && song.lyrics.length > 0) {
      // song.lyrics 中可能是 {jp, kana} 的数组
      song.lyrics.forEach((ln, i) => {
        const text = ln.jp || ln[0] || '';
        let tokens = [];
        // 先按空白拆分
        tokens = text.split(/\s+/).map(s => s.trim()).filter(Boolean);
        // 如果只有一个片段，尝试按常见日文标点拆分并保留标点
        if (tokens.length <= 1) {
          tokens = text.split(/([、。！？,\.])/u).map(s => s.trim()).filter(Boolean);
        }
        // 如果仍然只有一个长片段，按固定宽度切分（每6个字符）以避免整个句子被当作一个词
        if (tokens.length <= 1 && text.length > 12) {
          const re = new RegExp('.{1,6}', 'ugu');
          tokens = text.match(re) || [text];
        }
        // 最终回退：至少一个 token
        if (tokens.length === 0) tokens = [text];

        const words = tokens.map(t => ({ surface: t, reading: ln.kana || t, base: t, pos: '' }));
        lines.push({ sentence_id: `s${i}`, words });
      });
    } else if (analysis.words && Array.isArray(analysis.words)) {
      // 将扁平的 words 列表每个作为单行
      analysis.words.forEach((w, i) => {
        lines.push({ sentence_id: `s${i}`, words: [{ surface: w.word || w.surface || '', reading: w.reading || '', base: w.base || '', pos: w.pos || '' }] });
      });
    }
    if (lines.length > 0) analysis.lines = lines;
  }

  app.innerHTML = `
    <div class="back-row" onclick="goto('')">‹ &nbsp;返回搜索</div>
    <div class="song-head">
      <div class="title">${escapeHtml(song.title)}</div>
      <div class="artist">${escapeHtml(song.artist)}</div>
      <div class="version-tag">🍡 ${escapeHtml(analysis.ai_model)}解析版 · ${song.analysis_versions.length}个版本</div>
      <div class="version-list">
        ${song.analysis_versions.map((v,i)=>`<button class="version-btn ${v===latestVersion?'active':''}" data-version="${escapeHtml(v)}">版本${i+1}</button>`).join('')}
      </div>
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
  app.querySelectorAll('.version-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const v = btn.dataset.version;
      try {
        const a = await fetchJSON(`${DATA_BASE}/analysis/${songId}/${v}.json`);
        state.currentAnalysis = a;
        renderLyricsBlock(a);
        app.querySelectorAll('.version-btn').forEach(x => x.classList.toggle('active', x === btn));
        toast(`已切换到版本${Array.from(app.querySelectorAll('.version-btn')).indexOf(btn)+1}`);
      } catch(e) {
        toast('版本加载失败：'+e.message);
      }
    });
  });
}

function renderLyricsBlock(analysis) {
  const block = $('#lyrics-block');
  // 使用 kuromoji 进行更智能的分词：当行中只有一个长片段或内部词很长时触发分词。
  if (Array.isArray(analysis.lines)) {
    analysis.lines.forEach(line => {
      const originalWords = Array.isArray(line.words) ? line.words : [];
      const combined = originalWords.map(w => w.surface || w.word || '').join('');
      let shouldTokenize = false;
      if (kuromojiTokenizer && combined && combined.length > 1) {
        if (originalWords.length <= 1) {
          shouldTokenize = true;
        } else if (originalWords.some(w => (w.surface || '').length > 10)) {
          shouldTokenize = true;
        }
      }
      if (shouldTokenize && kuromojiTokenizer) {
        const toks = tokenizeTextWithKuromoji(combined);
        if (toks && toks.length > 0) {
          line.words = toks;
        }
      }
    });
  }

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
        <div class="k">原形</div><div class="base-slot">${escapeHtml(word.base)}</div>
        <div class="k">词性</div><div><span class="pop-tag pos-slot">${escapeHtml(word.pos)}</span></div>
        <div class="k">释义</div><div class="meaning-slot">${escapeHtml(word.meaning || '')}</div>
      </div>
      ${word.chain ? `<div class="pop-chain">变化过程 &nbsp;<b>${escapeHtml(word.chain)}</b>${word.conjugation ? `（${escapeHtml(word.conjugation)}）` : ''}</div>` : ''}
    </div>
  `;

  // 异步填充词典释义（如果本地字典可用且当前没有释义）
  if (!word.meaning) {
    Promise.resolve(findLocalDictEntry(word.base || word.surface || word.reading)).then(entry => {
      if (!entry) return;
      const defs = [];
      for (let i = 1; i <= 10; i++) {
        const key = `释义${i}`;
        if (entry[key]) defs.push(String(entry[key]).replace(/@/g, ' '));
      }
      const meaningText = defs.join(' / ');
      const meaningEl = slot.querySelector('.meaning-slot');
      if (meaningEl) meaningEl.textContent = meaningText;
      const baseEl = slot.querySelector('.base-slot');
      if (baseEl && (!word.base || word.base === '')) baseEl.textContent = entry['辞書形'] || '';
      const posEl = slot.querySelector('.pos-slot');
      if (posEl && (!word.pos || word.pos === '')) posEl.textContent = entry['词性'] || '';
    }).catch(e => console.warn('dict lookup err', e));
  }

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
  if (!WORKER_BASE) {
    toast('还没有配置 Worker 地址，暂时无法写入公共库（见下方说明）');
    console.log('待写入歌曲预览：', { title, artist, lyricsRaw });
    return;
  }
  try {
    const res = await fetch(`${WORKER_BASE}/api/songs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title, artist, lyrics_raw: lyricsRaw,
        source: $('#f-source').value.trim() || 'manual',
        note: $('#f-note').value.trim()
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
  if (!WORKER_BASE) { toast('还没有配置 Worker 地址，暂时无法抓取'); return; }
  try {
    const res = await fetch(`${WORKER_BASE}/api/utaten-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
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
  if (!WORKER_BASE) {
    toast('还没有配置 Worker 地址，暂时无法调用AI解析（见页面底部说明）');
    return;
  }
  const btn = rerun ? $('#reparse-btn') : $('#start-parse-btn');
  if (btn) { btn.disabled = true; btn.textContent = '正在分析歌词结构… 30%'; }
  try {
    const res = await fetch(`${WORKER_BASE}/api/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        song_id: song.id,
        lyrics: song.lyrics_raw,
        api_url: cfg.apiUrl,
        api_key: cfg.apiKey,
        model: cfg.model
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
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div class="section-label" style="margin-top:6px;">配置 AI API（仅保存在本机浏览器）</div>
        <button type="button" id="cfg-close" style="border:0;background:none;font-size:20px;cursor:pointer;">×</button>
      </div>
      <div class="field"><label>API 地址</label><input id="cfg-url" value="${escapeHtml(cfg.apiUrl)}" placeholder="https://api.openai.com/v1/chat/completions"></div>
      <div class="field"><label>API Key</label><input id="cfg-key" type="password" value="${escapeHtml(cfg.apiKey)}"></div>
      <div class="field"><label>模型名称</label><input id="cfg-model" value="${escapeHtml(cfg.model)}" placeholder="例如 gpt-4o / deepseek-chat"></div>
      <button class="parse-btn" id="cfg-save">保存并继续</button>
    </div>
  `);
  document.body.appendChild(wrap);
  $('#cfg-close', wrap).addEventListener('click', () => wrap.remove());
  $('#cfg-save', wrap).addEventListener('click', () => {
    setApiConfig({
      apiUrl: $('#cfg-url', wrap).value.trim(),
      apiKey: $('#cfg-key', wrap).value.trim(),
      model: $('#cfg-model', wrap).value.trim()
    });
    wrap.remove();
    onSaved();
  });
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// expose for inline onclick handlers
window.goto = goto;
