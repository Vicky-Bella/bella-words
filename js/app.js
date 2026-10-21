/* 主应用：视图路由、听写会话、判分、鼓励 */
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const view = $('#view');

  const PRAISE = [
    '太棒了！完全正确！🎉',
    '漂亮！这个词被你拿下啦！👏',
    '写得又快又准，真厉害！⭐️',
    'Excellent！就是这个感觉！',
    '满分表现，继续保持！💪',
    '哇，这么难的都写对了，聪明！🧠',
    '完全正确，你就是小小拼写达人！✨',
  ];
  const ENCOURAGE = [
    '差一点点，别灰心，再来一次一定行！',
    '没关系，错误是进步的机会，我们一起记住它～',
    '再试一次，你已经很努力了！',
    '错了不要紧，记住它下次就是你的啦！🌱',
    '加油！这个小坑我们把它填平～',
    '快接近了！认真看看正确答案，下次准对！',
  ];
  const pick = a => a[Math.floor(Math.random() * a.length)];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/[’‘`´]/g, "'")
      .replace(/[.,!?;:"“”\-—_()\[\]{}]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  // 编辑距离相似度，0~1
  function levRatio(a, b) {
    const m = a.length, n = b.length, max = Math.max(m, n);
    if (max === 0) return 1;
    const dp = new Array(n + 1);
    for (let j = 0; j <= n; j++) dp[j] = j;
    for (let i = 1; i <= m; i++) {
      let prev = dp[0]; dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = dp[j];
        dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
        prev = tmp;
      }
    }
    return 1 - dp[n] / max;
  }
  // 识别结果与正确答案的相似度：单字符/单词用编辑距离；多词按词逐个匹配
  function similarity(a, b) {
    a = norm(a); b = norm(b);
    if (a === b) return 1;
    if (!a || !b) return 0;
    const aw = a.split(' '), bw = b.split(' ');
    if (aw.length > 1 || bw.length > 1) {
      let matched = 0;
      const used = new Array(bw.length).fill(false);
      for (const w of aw) {
        let best = 0, bi = -1;
        for (let j = 0; j < bw.length; j++) {
          if (used[j]) continue;
          const r = levRatio(w, bw[j]);
          if (r > best) { best = r; bi = j; }
        }
        if (bi >= 0) { used[bi] = true; if (best >= 0.8) matched++; }
      }
      return matched / Math.max(aw.length, bw.length);
    }
    return levRatio(a, b);
  }
  const typeLabel = Scheduler.typeLabel;

  function toast(msg) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200);
  }

  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  function prettyDate() {
    const d = new Date();
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEK[d.getDay()];
  }

  /* ---------------- 路由 ---------------- */
  let currentTab = 'today';
  const RENDER = {
    today: renderToday, mistakes: renderMistakes,
    lexicon: renderLexicon, upload: renderUpload,
  };
  function go(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('#pageTitle').textContent = { today: '今日任务', mistakes: '错题本', lexicon: '词库', upload: '上传 Word' }[tab];
    $('#todayLabel').textContent = prettyDate();
    view.innerHTML = '';
    RENDER[tab]();
    window.scrollTo(0, 0);
  }

  /* ---------------- 今日任务 ---------------- */
  function todayLog() {
    const k = 'day:' + Scheduler.todayStr();
    const log = Store.getLog();
    if (!log[k]) log[k] = { newCount: { word: 0, phrase: 0, sentence: 0 }, reviewCount: { word: 0, phrase: 0, sentence: 0 }, correct: 0, wrong: 0 };
    const x = log[k];
    x.newCount = x.newCount || { word: 0, phrase: 0, sentence: 0 };
    x.reviewCount = x.reviewCount || { word: 0, phrase: 0, sentence: 0 };
    return x;
  }
  Store.bumpLog = function (patch) {
    const k = 'day:' + Scheduler.todayStr();
    const log = Store.getLog();
    const x = log[k] || todayLog();
    Object.assign(x, patch);
    localStorage.setItem(Store.K.log, JSON.stringify(log));
  };

  function buildSteps() {
    const s = Store.getSettings();
    const log = todayLog();
    const TYPES = ['word', 'phrase', 'sentence'];

    const allReview = Scheduler.reviewItems();
    const revByType = { word: [], phrase: [], sentence: [] };
    allReview.forEach(r => (revByType[r.type] || revByType.word).push(r));

    const newSteps = [], reviewSteps = [];
    const rows = TYPES.map(t => {
      const remain = Math.max(0, s.dailyNew[t] - (log.newCount[t] || 0));
      const newList = Scheduler.newItems(t, remain);
      const revList = revByType[t].slice(0, s.dailyReview[t]);
      newList.forEach(it => newSteps.push({ item: it, mode: 'new' }));
      revList.forEach(r => reviewSteps.push({ item: r, mode: 'review' }));
      return `<div class="task-row">
        <div class="n">${typeLabel(t)}</div>
        <div class="count">新学 <b>${newList.length}</b> / ${s.dailyNew[t]} · 复习 <b>${revList.length}</b></div>
      </div>`;
    }).join('');

    const steps = newSteps.concat(reviewSteps);
    return { steps, total: steps.length, rows };
  }

  function prettyDay(ds) {
    const d = new Date(ds + 'T00:00:00');
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  // 打卡卡片：连续天数 + 愿望 + 补签提示
  function checkinCard(today) {
    const c = Store.getCheckin();
    const streak = Store.currentStreak();
    const y = Scheduler.addDays(today, -1);
    const d2 = Scheduler.addDays(today, -2);
    const canMakeup = !Store.hasCheckin(y) && Store.hasCheckin(d2)
      && c.makeupLeft > 0 && c.skipMakeup !== today;

    if (canMakeup) {
      return `<div class="card checkin warn">
        <div class="ck-title">😢 打卡断在了 ${prettyDay(y)}</div>
        <p class="muted" style="margin:6px 0 0">你还有 <b>${c.makeupLeft}</b> 次补签机会。补上这一天，连续天数就能接着算！</p>
        <div class="actions">
          <button class="btn green" id="makeupBtn">补上 ${prettyDay(y)}（用 1 次机会）</button>
          <button class="btn gray" id="restartBtn">重新开始</button>
        </div>
      </div>`;
    }

    const next = Math.max(0, c.next100 - streak);
    return `<div class="card checkin">
      <div class="ck-top">
        <div class="ck-streak"><span class="fire">🔥</span> 连续打卡 <b>${streak}</b> 天</div>
        ${c.best ? `<div class="ck-best">最长 ${c.best} 天</div>` : ''}
      </div>
      <div class="ck-goal">连续打卡 100 天可以实现一个愿望</div>
      <div class="ck-wish" id="wishBox">${c.wish ? '🎯 ' + esc(c.wish) : '点这里写下你的愿望 ✍️'}</div>
      <div class="ck-meta">
        ${streak ? `再坚持 <b>${next}</b> 天就能实现愿望` : '从今天开始，完成今日任务即可打卡'}
        ${c.achieved ? ` · 已实现愿望 ${c.achieved} 次` : ''}
        ${c.makeupLeft ? ` · 补签机会 ${c.makeupLeft} 次` : ''}
      </div>
    </div>`;
  }

  function bindCheckin(today, total) {
    const wb = $('#wishBox');
    if (wb) wb.onclick = openWishEditor;

    const mk = $('#makeupBtn');
    if (mk) mk.onclick = () => {
      const r = Store.useMakeup(Scheduler.addDays(today, -1));
      if (!r) { toast('没有可补签的机会了'); return; }
      let celeb = r.celebration;
      if (total === 0 && !Store.hasCheckin(today)) {
        const r2 = Store.checkIn(today);
        if (r2.celebration) celeb = true;
      }
      toast('补签成功，连续打卡 ' + Store.currentStreak() + ' 天！🔥');
      go('today');
      if (celeb) showCelebration(Store.currentStreak());
    };

    const rb = $('#restartBtn');
    if (rb) rb.onclick = () => {
      Store.declineMakeup(today);
      if (total === 0 && !Store.hasCheckin(today)) Store.checkIn(today);
      toast('没关系，今天继续加油！💪');
      go('today');
    };
  }

  function renderToday() {
    const { steps, total, rows } = buildSteps();
    const today = Scheduler.todayStr();

    // 今日任务全部完成 → 自动打卡（每天只记一次）
    let just = null;
    if (total === 0 && !Store.hasCheckin(today)) {
      just = Store.checkIn(today);
    }

    view.innerHTML = `
      ${checkinCard(today)}

      <div class="card">
        <h2>今日任务</h2>
        ${rows}
        <p class="muted" style="margin:10px 2px 0">每天固定安排，学完自动排复习～</p>
      </div>

      <button id="startBtn" class="btn big" ${total ? '' : 'disabled'}>${total ? '开始听写 (' + total + ')' : '今日任务已完成 🎉'}</button>

      <div class="card" style="margin-top:14px">
        <h2>学习进度</h2>
        ${progressRows()}
      </div>
    `;

    const sb = $('#startBtn');
    if (sb && total) sb.onclick = () => startSession(steps, '今日听写');
    bindCheckin(today, total);

    if (just && just.changed) {
      if (just.celebration) showCelebration(just.streak);
      else toast('太棒了，你已连续打卡 ' + just.streak + ' 天！🔥');
    }
  }

  function progressRows() {
    const st = Scheduler.stats();
    return ['word', 'phrase', 'sentence'].map(t => {
      const x = st[t] || { total: 0, learned: 0, mastered: 0 };
      return `<div class="task-row"><div class="n">${typeLabel(t)}</div>
        <div class="count">已学 ${x.learned}/${x.total} · 已掌握 ${x.mastered}</div></div>`;
    }).join('');
  }

  /* ---------------- 听写会话 ---------------- */
  let sess = null;

  /* ---- 读音（浏览器内置 TTS，针对 iPad 做了兼容处理） ---- */
  let ttsVoice = null;
  function pickEnVoice() {
    try {
      const vs = window.speechSynthesis.getVoices() || [];
      return vs.find(v => /en[-_]US/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null;
    } catch (e) { return null; }
  }
  function initTts() {
    if (!('speechSynthesis' in window)) return;
    ttsVoice = pickEnVoice();
    window.speechSynthesis.onvoiceschanged = () => { ttsVoice = pickEnVoice(); };
    // iPad 首次必须在一个用户手势里“解锁”，否则以后点喇叭没声音
    document.addEventListener('pointerdown', function prime() {
      document.removeEventListener('pointerdown', prime);
      try {
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0; u.lang = 'en-US';
        window.speechSynthesis.speak(u);
        window.speechSynthesis.cancel();
      } catch (e) {}
    }, { once: true });
  }
  function speakEn(text) {
    if (!('speechSynthesis' in window)) { toast('这个设备不支持朗读'); return; }
    try {
      const syn = window.speechSynthesis;
      syn.cancel();
      const u = new SpeechSynthesisUtterance(String(text));
      u.lang = 'en-US';
      u.rate = 0.85;
      u.pitch = 1;
      u.volume = 1;
      const v = ttsVoice || pickEnVoice();
      if (v) { u.voice = v; ttsVoice = v; }
      syn.speak(u);
    } catch (e) { toast('朗读失败'); }
  }

  /* ---- OCR（Tesseract.js）---- */
  // 手写自动识别判分：默认关闭。改成 true 就会用 Tesseract 识别笔迹并给出参考。
  const AUTO_JUDGE = false;
  let ocrWorker = null, ocrReady = null;
  // 等 tesseract.min.js 加载完再初始化（最多等 20 秒）
  function waitForTesseract(timeout) {
    return new Promise((resolve, reject) => {
      if (window.Tesseract) { resolve(); return; }
      const t0 = Date.now();
      const id = setInterval(() => {
        if (window.Tesseract) { clearInterval(id); resolve(); }
        else if (Date.now() - t0 > timeout) { clearInterval(id); reject(new Error('OCR 脚本没加载出来')); }
      }, 200);
    });
  }
  function warmupOcr() {
    if (ocrWorker || ocrReady) return;
    ocrReady = (async () => {
      try {
        await waitForTesseract(20000);
        // 去掉 #hash 和 ?query 再取目录，避免主屏启动时路径拼错
        const base = location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
        const worker = await Tesseract.createWorker('eng', 1, {
          workerPath: base + 'lib/tesseract/worker.min.js',
          corePath: base + 'lib/tesseract/',
          langPath: base + 'lib/tesseract/',
          logger: () => {},
        });
        await worker.setParameters({
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.!? -,;",
          preserve_interword_spaces: '1',
          tessedit_pageseg_mode: '7',   // 单行文本，比默认的整页分析准得多
        });
        ocrWorker = worker;
        return worker;
      } catch (e) {
        ocrReady = null;   // 失败后允许下次重试
        throw e;
      }
    })();
    ocrReady.catch(() => {});   // 避免未处理的 Promise 报错
  }
  async function getOcr() {
    warmupOcr();
    return ocrReady;
  }
  // 带超时的识别：卡住就丢弃 worker，下次重新初始化，绝不让界面一直等
  function ocrWithTimeout(url, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try { if (ocrWorker) ocrWorker.terminate(); } catch (e) {}
        ocrWorker = null; ocrReady = null;
        reject(new Error('识别超时'));
      }, ms);
      getOcr()
        .then(worker => {
          if (!worker) throw new Error('OCR 未就绪');
          return worker.recognize(url);
        })
        .then(({ data }) => { clearTimeout(timer); resolve((data.text || '').trim()); })
        .catch(e => { clearTimeout(timer); reject(e); });
    });
  }

  /* ---- 手写笔迹（SVG：每一笔是一条 path，GPU 渲染，没有位图内存压力） ---- */
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PEN_W = 3;
  const ink = {
    mode: 'pen', drawing: false,
    stroke: null,        // 当前正在写的 <path>
    d: '',               // 当前 path 的 d 字符串
    lastX: 0, lastY: 0,
    rect: null,          // 落笔时缓存一次，避免每次移动都触发布局重排
  };
  function inkPos(e) {
    const board = $('#inkBoard');
    const r = ink.rect || (board ? board.getBoundingClientRect() : { left: 0, top: 0 });
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function inkClear() {
    const svg = $('#inkSvg');
    if (svg) while (svg.firstChild) svg.removeChild(svg.firstChild);
  }
  function inkUndo() {
    const svg = $('#inkSvg');
    if (svg && svg.lastChild) svg.removeChild(svg.lastChild);
  }
  function inkIsEmpty() {
    const svg = $('#inkSvg');
    return !svg || !svg.childElementCount;
  }
  // 橡皮：划过哪一笔就整笔擦掉（SVG 里没法按像素擦，整笔擦除更可控）
  function inkEraseAt(x, y) {
    const svg = $('#inkSvg'); if (!svg) return;
    const kids = Array.prototype.slice.call(svg.children);
    for (let i = kids.length - 1; i >= 0; i--) {
      let bb;
      try { bb = kids[i].getBBox(); } catch (err) { continue; }
      const pad = 12;
      if (x >= bb.x - pad && x <= bb.x + bb.width + pad &&
          y >= bb.y - pad && y <= bb.y + bb.height + pad) {
        svg.removeChild(kids[i]);
      }
    }
  }
  function inkDown(e) {
    const board = e.currentTarget;
    ink.rect = board.getBoundingClientRect();     // 整笔只取一次
    if (board.setPointerCapture) board.setPointerCapture(e.pointerId);
    ink.drawing = true;
    const p = inkPos(e);
    ink.lastX = p.x; ink.lastY = p.y;
    if (ink.mode === 'eraser') { inkEraseAt(p.x, p.y); e.preventDefault(); return; }
    const svg = $('#inkSvg'); if (!svg) return;
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#1b1f2a');
    path.setAttribute('stroke-width', PEN_W);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    ink.d = 'M ' + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
    path.setAttribute('d', ink.d);
    svg.appendChild(path);
    ink.stroke = path;
    e.preventDefault();
  }
  // 增量追加二次贝塞尔：只做字符串拼接（成本恒定），圆头圆角衔接平滑
  function inkMoveTo(p) {
    const path = ink.stroke; if (!path) return;
    const mx = (ink.lastX + p.x) / 2, my = (ink.lastY + p.y) / 2;
    ink.d += ' Q ' + ink.lastX.toFixed(1) + ' ' + ink.lastY.toFixed(1) +
             ' ' + mx.toFixed(1) + ' ' + my.toFixed(1);
    path.setAttribute('d', ink.d);
    ink.lastX = p.x; ink.lastY = p.y;
  }
  function inkMove(e) {
    if (!ink.drawing) return;
    // iPad 会把多个采样点合并成一个事件，取出来补全，笔迹才不虚
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    const list = evs && evs.length ? evs : [e];
    for (let i = 0; i < list.length; i++) {
      const p = inkPos(list[i]);
      if (ink.mode === 'eraser') inkEraseAt(p.x, p.y);
      else inkMoveTo(p);
    }
    e.preventDefault();
  }
  function inkUp(e) {
    if (!ink.drawing) return;
    ink.drawing = false;
    ink.rect = null;
    if (ink.stroke) {
      ink.d += ' L ' + ink.lastX.toFixed(1) + ' ' + ink.lastY.toFixed(1);
      ink.stroke.setAttribute('d', ink.d);
    }
    ink.stroke = null;
    ink.d = '';
    if (e && e.preventDefault) e.preventDefault();
  }
  function setupInk() {
    const board = $('#inkBoard');
    const svg = $('#inkSvg');
    if (!board || !svg) return;
    // 不设 viewBox：用户坐标 = CSS 像素，与指针坐标 1:1 对应，无需 dpr 缩放
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    const opt = { passive: false };
    board.addEventListener('pointerdown', inkDown, opt);
    board.addEventListener('pointermove', inkMove, opt);
    board.addEventListener('pointerup', inkUp, opt);
    board.addEventListener('pointercancel', inkUp, opt);
  }
  // 把笔迹转成 PNG（只有开启自动识别时才会用到）
  function inkToImage() {
    const svg = $('#inkSvg');
    if (!svg || !svg.childElementCount) return Promise.resolve('');
    let bb;
    try { bb = svg.getBBox(); } catch (e) { return Promise.resolve(''); }
    if (!bb.width && !bb.height) return Promise.resolve('');
    const pad = Math.max(bb.height * 0.12, 10);
    const vb = {
      x: bb.x - pad, y: bb.y - pad,
      w: Math.max(bb.width + pad * 2, 1),
      h: Math.max(bb.height + pad * 2, 1),
    };
    const scale = Math.min(4, Math.max(1, 120 / vb.h));   // 放大到高约 120px
    const w = Math.round(vb.w * scale), h = Math.round(vb.h * scale);
    const clone = svg.cloneNode(true);
    clone.removeAttribute('id');
    clone.setAttribute('xmlns', SVG_NS);
    clone.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
    clone.setAttribute('width', w);
    clone.setAttribute('height', h);
    const bg = document.createElementNS(SVG_NS, 'rect');
    bg.setAttribute('x', vb.x); bg.setAttribute('y', vb.y);
    bg.setAttribute('width', vb.w); bg.setAttribute('height', vb.h);
    bg.setAttribute('fill', '#ffffff');
    clone.insertBefore(bg, clone.firstChild);
    const src = 'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(new XMLSerializer().serializeToString(clone));
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const c = cv.getContext('2d');
        c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
        c.drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('笔迹转图片失败'));
      img.src = src;
    });
  }

  function startSession(steps, title) {
    if (!steps.length) { toast('没有需要听写的内容'); return; }
    sess = { steps, idx: -1, correct: 0, title, wrongList: [] };
    $('#session').classList.remove('hidden');
    $('#session').setAttribute('aria-hidden', 'false');
    warmupOcr();
    nextStep();
  }
  function endSession() {
    $('#session').classList.add('hidden');
    $('#session').setAttribute('aria-hidden', 'true');
    sess = null; go(currentTab);
  }

  function nextStep() {
    if (!sess) return;
    sess.idx++;
    if (sess.idx >= sess.steps.length) return showResult();
    renderStep();
  }

  function renderStep() {
    const step = sess.steps[sess.idx];
    const it = step.item;
    const total = sess.steps.length, done = sess.idx;
    const tag = step.mode === 'new' ? '新学' : '复习';
    const tagCls = step.mode === 'new' ? '' : 'rev';

    $('#session').innerHTML = `
      <div class="sess-top">
        <button class="close" id="sessClose">✕</button>
        <div class="bar"><i style="width:${Math.round(done / total * 100)}%"></i></div>
        <div class="sess-count">${done + 1}/${total}</div>
      </div>

      <div class="ask" id="askBox">
        <span class="tag">${tag} · ${typeLabel(it.type)}</span>
        <div class="zh">${esc(it.zh)} <button class="speak-btn" id="speakBtn" title="听一下读音">🔊</button></div>
        <div class="hint">用 Apple Pencil 在下面写出对应的英文</div>
      </div>

      <div class="draw-tools">
        <button class="tool-btn active" id="penBtn" data-mode="pen">🖊️ 笔</button>
        <button class="tool-btn" id="eraserBtn" data-mode="eraser">🧽 橡皮</button>
        <button class="tool-btn" id="undoBtn">↩️ 撤销</button>
        <button class="tool-btn" id="clearBtn">🗑️ 清空</button>
      </div>

      <div class="grid-wrap">
        <div class="grid-lines" id="inkBoard">
          <svg id="inkSvg" xmlns="http://www.w3.org/2000/svg"></svg>
        </div>
      </div>

      <div class="actions" id="stepActions">
        <button class="btn ghost" id="skipBtn">跳过</button>
        <button class="btn" id="submitBtn">对答案</button>
      </div>

      <div id="fb"></div>
    `;

    $('#sessClose').onclick = () => { if (confirm('要退出本次听写吗？')) endSession(); };
    $('#skipBtn').onclick = () => nextStep();
    $('#submitBtn').onclick = submit;
    $('#speakBtn').onclick = () => speakEn(it.en);

    // 工具切换
    const setMode = m => {
      ink.mode = m;
      document.querySelectorAll('.tool-btn[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    };
    const pb = $('#penBtn'); if (pb) pb.onclick = () => setMode('pen');
    const eb = $('#eraserBtn'); if (eb) eb.onclick = () => setMode('eraser');
    const ub = $('#undoBtn'); if (ub) ub.onclick = inkUndo;
    const cb = $('#clearBtn'); if (cb) cb.onclick = inkClear;

    setupInk();
    // OCR 默认关闭；只有打开开关时才在进题后预热引擎
    if (AUTO_JUDGE) setTimeout(() => { try { warmupOcr(); } catch (e) {} }, 1200);
  }

  async function submit() {
    const step = sess.steps[sess.idx];
    const it = step.item;
    if (inkIsEmpty()) { toast('先写点内容再对答案吧～'); return; }

    // 立刻出正确答案和三个按钮，不等任何识别
    showFeedback(step);
    if (!AUTO_JUDGE) return;          // 自动判分默认关闭，到此为止

    let url = '';
    try { url = await inkToImage(); } catch (e) { url = ''; }
    if (!url) { setOcrHint('（笔迹读取失败，自己对照着选吧）'); return; }

    try {
      const text = await ocrWithTimeout(url, 40000);
      if (sess.steps[sess.idx] !== step) return;   // 已经翻到下一题，丢弃结果
      if (!text) { setOcrHint('（没能识别出内容，自己对照着选吧）'); return; }
      const ok = similarity(text, it.en) >= 0.8;
      setOcrHint('识别到你写的是：<b>' + esc(text) + '</b>', ok);
    } catch (e) {
      if (sess.steps[sess.idx] !== step) return;
      setOcrHint('（自动识别没成功，自己对照着选吧）');
    }
  }

  function showFeedback(step) {
    const it = step.item;
    const fb = $('#fb');

    // 正确答案显示在画布上方，你的笔迹留在下面，方便上下对照
    const box = $('#askBox');
    if (box) {
      box.classList.add('graded');
      box.innerHTML = `
        <div class="feedback">
          <div class="answer">
            <div class="lbl">正确答案 <button class="speak-mini" id="speakAns" title="读一遍答案">🔊</button></div>
            <div class="val">${esc(it.en)}</div>
            <div class="youwrite" id="ocrHint">${AUTO_JUDGE ? '后台正在识别…（不影响你现在判分）' : '自己对着上面写的一笔笔比一比'}</div>
          </div>
        </div>`;
      const sa = $('#speakAns'); if (sa) sa.onclick = () => speakEn(it.en);
    }

    // 三个按钮：点哪个立刻生效，语义互不干扰
    fb.innerHTML = `
      <div class="actions three">
        <button class="btn ghost" id="okBtn">✅ 我写对了</button>
        <button class="btn ghost" id="noBtn">❌ 我写错了</button>
        <button class="btn ghost" id="skipBtn">⏭ 跳过</button>
      </div>`;
    $('#okBtn').onclick = () => finish(true);
    $('#noBtn').onclick = () => finish(false);
    $('#skipBtn').onclick = () => nextStep();

    function finish(ok) {
      if (ok) sess.correct++;
      commit(step, ok);
    }

    const stepActions = $('#stepActions');
    if (stepActions) stepActions.style.display = 'none';
  }

  // 后台识别结果回填（只做提示，不影响用户已点的按钮）
  function setOcrHint(html, suggested) {
    const el = $('#ocrHint');
    if (!el) return;
    el.innerHTML = html;
    const target = suggested === true ? $('#okBtn') : (suggested === false ? $('#noBtn') : null);
    if (target) target.classList.add('suggest');
  }

  function commit(step, correct) {
    const it = step.item;
    const d = Scheduler.todayStr();
    if (step.mode === 'new') {
      Store.learn(it, d);
      if (!correct) Store.answer(it, false, d);
      const log = todayLog();
      log.newCount[it.type] = (log.newCount[it.type] || 0) + 1;
      Store.bumpLog({ newCount: log.newCount, correct: (log.correct || 0) + (correct ? 1 : 0), wrong: (log.wrong || 0) + (correct ? 0 : 1) });
    } else {
      Store.answer(it, correct, d);
      const log = todayLog();
      log.reviewCount[it.type] = (log.reviewCount[it.type] || 0) + 1;
      Store.bumpLog({ reviewCount: log.reviewCount, correct: (log.correct || 0) + (correct ? 1 : 0), wrong: (log.wrong || 0) + (correct ? 0 : 1) });
    }
    if (!correct) sess.wrongList.push(it);
    nextStep();
  }

  function showResult() {
    const total = sess.steps.length;
    const sc = sess.correct;
    const rate = total ? Math.round(sc / total * 100) : 0;
    const emoji = rate >= 90 ? '🏆' : rate >= 70 ? '🌟' : rate >= 40 ? '💪' : '🌱';
    const word = rate >= 90 ? '太厉害了，几乎全对！' : rate >= 70 ? '表现很棒！' : rate >= 40 ? '继续加油，你在进步！' : '别急，多练几遍就记住啦！';
    const wrongHtml = sess.wrongList.length
      ? `<div class="card"><h2>需要再练的（已进错题本）</h2>${sess.wrongList.map(it =>
        `<div class="list-item"><div><div class="li-en">${esc(it.en)}</div><div class="li-zh">${esc(it.zh)}</div></div></div>`).join('')}</div>`
      : '';

    $('#session').innerHTML = `
      <div class="result">
        <div class="emoji">${emoji}</div>
        <div class="score">${sc} / ${total}</div>
        <p style="font-size:17px">${word}</p>
      </div>
      ${wrongHtml}
      <button class="btn big" id="doneBtn">完成</button>
    `;
    $('#doneBtn').onclick = endSession;
  }

  /* ---------------- 错题本 ---------------- */
  function renderMistakes() {
    const ms = Object.values(Store.getMistakes());
    if (!ms.length) {
      view.innerHTML = `<div class="card center"><div style="font-size:44px">🌈</div><h2>错题本是空的</h2><p class="muted">听写写错的内容会自动收进这里，按记忆曲线提醒你重练。</p></div>`;
      return;
    }
    ms.sort((a, b) => (b.lastWrong || '').localeCompare(a.lastWrong || ''));
    view.innerHTML = `
      <div class="card">
        <h2>错题本 · 共 ${ms.length} 条</h2>
        <p class="muted">这些都是听写写错过的，多练几次就会变成本能啦。</p>
      </div>
      <button class="btn big" id="practiceAll">重练全部 (${ms.length})</button>
      <div class="card" style="margin-top:14px">
        ${ms.map(m => `
          <div class="list-item">
            <div><div class="li-en">${esc(m.en)}</div><div class="li-zh">${esc(m.zh)}</div></div>
            <div class="li-unit">${typeLabel(m.type)}${m.unit ? ' · ' + esc(m.unit) : ''}</div>
          </div>`).join('')}
      </div>`;

    $('#practiceAll').onclick = () => {
      const steps = ms.map(m => ({ item: m, mode: 'review' }));
      startSession(steps, '错题重练');
    };
  }

  /* ---------------- 词库 ---------------- */
  let lexFilter = 'all';
  function renderLexicon() {
    const all = Store.lexicon();
    const st = Scheduler.stats();
    const list = lexFilter === 'all' ? all : all.filter(x => x.type === lexFilter);
    const fbtn = (k, lbl) => `<button class="${lexFilter === k ? 'on' : ''}" data-f="${k}">${lbl}</button>`;
    view.innerHTML = `
      <div class="card">
        <h2>词库总览</h2>
        <div class="task-row"><div class="n">单词</div><div class="count">${(st.word || {}).total || 0} 个</div></div>
        <div class="task-row"><div class="n">词组</div><div class="count">${(st.phrase || {}).total || 0} 个</div></div>
        <div class="task-row"><div class="n">句子</div><div class="count">${(st.sentence || {}).total || 0} 个</div></div>
        <div class="task-row"><div class="n">其中你上传的</div><div class="count">${Store.getUserLexCount()} 个</div></div>
      </div>
      <div class="card">
        <div class="seg" style="margin-bottom:12px">
          ${fbtn('all', '全部')}${fbtn('word', '单词')}${fbtn('phrase', '词组')}${fbtn('sentence', '句子')}
        </div>
        ${list.map(x => `
          <div class="list-item">
            <div><div class="li-en">${esc(x.en)}</div><div class="li-zh">${esc(x.zh)}</div></div>
            <div class="li-unit">${x.unit ? esc(x.unit) : (x.source ? esc(String(x.source).replace('.docx', '')) : '')}</div>
          </div>`).join('')}
      </div>`;
    view.querySelectorAll('.seg button').forEach(b => b.onclick = () => { lexFilter = b.dataset.f; go('lexicon'); });
  }

  /* ---------------- 上传 Word ---------------- */
  function renderUpload() {
    view.innerHTML = `
      <div class="card">
        <h2>上传 Word 文档，扩充词库</h2>
        <p class="muted">支持两种格式：① 词表（带 Unit 的单词/词组）；② 学习单（含中英对照句子）。系统会自动识别并拆分。</p>
        <div class="drop" id="drop">
          <div class="big">📄⬆️</div>
          <p><b>点击选择文件</b> 或把 .docx 拖到这里</p>
          <p class="muted">可一次选多个文件</p>
        </div>
        <input type="file" id="file" accept=".docx" multiple hidden>
      </div>
      <div id="upResult"></div>
      <div class="card">
        <h2>词库中你的上传</h2>
        <p class="muted">已上传 ${Store.getUserLexCount()} 条。内置词库（来自 3A 教材）不会被删除。</p>
        <button class="btn gray" id="clearUp" style="margin-top:10px">清空我上传的词库</button>
      </div>`;

    const drop = $('#drop'), file = $('#file');
    drop.onclick = () => file.click();
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', e => {
      e.preventDefault(); drop.classList.remove('drag');
      handleFiles(e.dataTransfer.files);
    });
    file.onchange = () => handleFiles(file.files);
    $('#clearUp').onclick = () => {
      if (confirm('确定清空所有上传的词条吗？（不影响内置词库）')) { Store.clearUserLex(); toast('已清空'); go('upload'); }
    };
  }

  async function handleFiles(files) {
    const arr = Array.from(files || []).filter(f => /\.docx$/i.test(f.name));
    if (!arr.length) { toast('请选择 .docx 文件'); return; }
    const box = $('#upResult');
    box.innerHTML = `<div class="card"><div class="spinner"></div><p class="center muted">正在解析…</p></div>`;
    try {
      let all = [];
      for (const f of arr) {
        const items = await DocxParser.parseFile(f);
        all = all.concat(items);
      }
      if (!all.length) { box.innerHTML = `<div class="card center"><p>没有解析出内容，请确认文件格式是否正确。</p></div>`; return; }

      // 查重：与已有词库（内置 + 之前上传）以及本批文件之间比较，重复的跳过
      const seen = new Set(Store.lexicon().map(x => Store.keyOf(x)));
      let dupCount = 0;
      all = all.filter(x => {
        const k = Store.keyOf(x);
        if (seen.has(k)) { dupCount++; return false; }
        seen.add(k); return true;
      });
      if (!all.length) {
        box.innerHTML = `<div class="card center"><p>没有新增内容：解析出的 ${dupCount} 条都已存在于词库中，已全部跳过。</p></div>`;
        return;
      }

      const cnt = { word: 0, phrase: 0, sentence: 0 };
      all.forEach(x => cnt[x.type] = (cnt[x.type] || 0) + 1);
      const sample = all.slice(0, 10).map(x => `<div class="list-item"><div><div class="li-en">${esc(x.en)}</div><div class="li-zh">${esc(x.zh)}</div></div><div class="li-unit">${typeLabel(x.type)}</div></div>`).join('');
      box.innerHTML = `
        <div class="card">
          <h2>解析结果</h2>
          <p class="muted">新增 ${all.length} 条：单词 ${cnt.word}，词组 ${cnt.phrase}，句子 ${cnt.sentence}${dupCount ? `<br>重复已跳过 ${dupCount} 条` : ''}</p>
          <div style="margin:12px 0">${sample}${all.length > 10 ? '<p class="muted center">…还有 ' + (all.length - 10) + ' 条</p>' : ''}</div>
          <div class="actions">
            <button class="btn ghost" id="cancelImp">取消</button>
            <button class="btn green" id="doImp">加入词库 (${all.length})</button>
          </div>
        </div>`;
      $('#cancelImp').onclick = () => go('upload');
      $('#doImp').onclick = () => {
        Store.addUserLex(all);
        toast('已加入词库，新增 ' + all.length + ' 条' + (dupCount ? '，跳过重复 ' + dupCount + ' 条' : ''));
        go('lexicon');
      };
    } catch (e) {
      box.innerHTML = `<div class="card center"><p>解析失败：${esc(e.message)}</p></div>`;
    }
  }

  /* ---------------- 愿望 & 庆祝 ---------------- */
  function openWishEditor() {
    const c = Store.getCheckin();
    const panel = $('#settingsPanel');
    panel.innerHTML = `
      <div class="panel">
        <h3>写下你的愿望</h3>
        <p class="muted">连续打卡 100 天，就能实现它。随时可以修改～</p>
        <textarea id="wishInput" class="wish-input" maxlength="200" placeholder="比如：买一本新的故事书 / 去一次游乐园 / 吃一顿大餐">${esc(c.wish)}</textarea>
        <div class="actions" style="margin-top:14px">
          <button class="btn ghost" id="wishCancel">取消</button>
          <button class="btn" id="wishSave">保存愿望</button>
        </div>
      </div>`;
    panel.classList.remove('hidden');
    panel.onclick = e => { if (e.target === panel) closeSettings(); };
    const ta = $('#wishInput');
    ta.focus();
    $('#wishCancel').onclick = closeSettings;
    $('#wishSave').onclick = () => {
      Store.setWish(ta.value.trim());
      closeSettings();
      toast(ta.value.trim() ? '愿望已记下 🎯' : '已清空愿望');
      go('today');
    };
  }

  function showCelebration(streak) {
    const c = Store.getCheckin();
    const panel = $('#settingsPanel');
    panel.innerHTML = `
      <div class="panel center">
        <div class="cele-emoji">🎉</div>
        <h3>太棒了！连续打卡 ${streak} 天！</h3>
        <p class="muted">你实现了自己的愿望：</p>
        <div class="wish-big">${c.wish ? esc(c.wish) : '（还没写下愿望，现在补一个吧）'}</div>
        <p class="muted" style="margin-top:14px">连续天数继续累加，下一个愿望就在 ${c.next100} 天！</p>
        <button class="btn big" id="celeOkay" style="margin-top:16px">继续加油 💪</button>
      </div>`;
    panel.classList.remove('hidden');
    panel.onclick = e => { if (e.target === panel) { closeSettings(); } };
    $('#celeOkay').onclick = () => {
      const noWish = !c.wish;
      closeSettings();
      if (noWish) openWishEditor();
    };
  }

  /* ---------------- 设置 ---------------- */
  function openSettings() {
    const s = Store.getSettings();
    const num = (k, v) => `<div class="field"><label>${k}</label><input type="number" min="0" max="50" data-new="${v}" value="${s.dailyNew[v]}"></div>`;
    const numR = (k, v) => `<div class="field"><label>${k}</label><input type="number" min="0" max="50" data-rev="${v}" value="${s.dailyReview[v]}"></div>`;
    const panel = $('#settingsPanel');
    panel.innerHTML = `
      <div class="panel">
        <h3>设置</h3>
        <p class="muted">记忆曲线：第 ${s.intervals.join('、')} 天复习</p>
        <div class="sec-title">每日新学上限</div>
        ${num('单词', 'word')}${num('词组', 'phrase')}${num('句子', 'sentence')}
        <div class="sec-title">每日复习上限</div>
        ${numR('单词', 'word')}${numR('词组', 'phrase')}${numR('句子', 'sentence')}
        <div class="sec-title">我的愿望</div>
        <button class="btn ghost" id="editWish" style="width:100%;margin-top:8px">${Store.getCheckin().wish ? '✏️ 修改我的愿望' : '✍️ 写下我的愿望'}</button>
        <div class="sec-title">数据备份</div>
        <button class="btn gray" id="exportData" style="width:100%;margin-top:8px">⬇️ 导出备份（存到「文件」App）</button>
        <button class="btn gray" id="importData" style="width:100%;margin-top:8px">⬆️ 导入备份（选文件恢复）</button>
        <input type="file" id="importFile" accept="application/json,.json" style="display:none">
        <div class="sec-title">数据</div>
        <button class="btn gray" id="resetData" style="width:100%;margin-top:8px">重置全部学习记录</button>
        <div class="actions" style="margin-top:18px">
          <button class="btn ghost" id="setCancel">取消</button>
          <button class="btn" id="setSave">保存</button>
        </div>
      </div>`;
    panel.classList.remove('hidden');
    panel.onclick = e => { if (e.target === panel) closeSettings(); };
    $('#setCancel').onclick = closeSettings;
    $('#editWish').onclick = openWishEditor;
    $('#exportData').onclick = () => {
      try {
        const name = '英语听写备份_' + Scheduler.todayStr() + '.json';
        const blob = new Blob([JSON.stringify(Store.dumpAll())], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('已导出：' + name + '（在「文件」App 里）');
      } catch (e) { toast('导出失败'); }
    };
    $('#importData').onclick = () => $('#importFile').click();
    $('#importFile').onchange = e => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const dump = JSON.parse(String(fr.result));
          if (!confirm('导入后会覆盖当前的打卡、学习记录和错题，确定恢复吗？')) return;
          Store.loadAll(dump);
          toast('已恢复，正在重新载入…');
          setTimeout(() => location.reload(), 900);
        } catch (err) { toast('备份文件无法识别'); }
      };
      fr.readAsText(f);
    };
    $('#resetData').onclick = () => { if (confirm('确定重置全部学习记录和错题本吗？词库不受影响。')) { Store.resetAll(); toast('已重置'); closeSettings(); go(currentTab); } };
    $('#setSave').onclick = () => {
      const dn = { word: 8, phrase: 2, sentence: 1 }, dr = { word: 8, phrase: 2, sentence: 1 };
      panel.querySelectorAll('[data-new]').forEach(i => dn[i.dataset.new] = Math.max(0, parseInt(i.value, 10) || 0));
      panel.querySelectorAll('[data-rev]').forEach(i => dr[i.dataset.rev] = Math.max(0, parseInt(i.value, 10) || 0));
      Store.saveSettings({ dailyNew: dn, dailyReview: dr });
      closeSettings(); toast('已保存'); go(currentTab);
    };
  }
  function closeSettings() { $('#settingsPanel').classList.add('hidden'); $('#settingsPanel').innerHTML = ''; }

  /* ---------------- 启动 ---------------- */
  document.querySelectorAll('.tab').forEach(b => b.onclick = () => go(b.dataset.tab));
  $('#settingsBtn').onclick = openSettings;
  initTts();
  go('today');
})();
