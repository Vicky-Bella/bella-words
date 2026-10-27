/* Word(.docx) 解析：读取 docx -> 段落 -> 词库条目
   与 build_lexicon.py 逻辑完全对齐，解决：
   - 一行挤多条的切分（无空格连接、中文嵌英文括号等）
   - 词性点剥除导致的词性残留
   - 全角标点被错误回退到英文块
   - 省略号结尾被误判为 sentence
   - PAIR_RE 中文嵌英文截断问题
*/
const DocxParser = (function () {
  const JSZIP_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  const IDEOGRAPH = /[\u4e00-\u9fff]/;
  // 词性后缀：点可选（有的文档带 n. 有的只写 n）
  const POS_BASE = '(?:n|v|adj|adv|prep|conj|pron|num|int|art|abbr|pl|vt|vi)';
  // 词性后缀必须单独成词（前面有空格），点号可省略
  const POS_RE = new RegExp('(?:\\s+' + POS_BASE + '\\.?)+\\s*$');
  // 中文释义里的词性标记必须带点，避免误删普通英文
  const POS_ANY = new RegExp('\\s*' + POS_BASE + '\\.\\s*', 'g');
  const PAREN_RE = /\s*\((?:pl\.|.*?)\)\s*$/;

  let zipReady = null;
  function loadJSZip() {
    if (window.JSZip) return Promise.resolve();
    if (zipReady) return zipReady;
    zipReady = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = JSZIP_CDN;
      s.onload = res;
      s.onerror = () => rej(new Error('无法加载解压组件（需要联网）'));
      document.head.appendChild(s);
    });
    return zipReady;
  }

  async function paragraphs(file) {
    await loadJSZip();
    const buf = await file.arrayBuffer();
    const zip = await window.JSZip.loadAsync(buf);
    const entry = zip.file('word/document.xml');
    if (!entry) throw new Error('不是有效的 .docx 文件');
    const xml = await entry.async('string');
    const paras = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
    return paras.map(p => {
      const ts = p.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || [];
      return ts.map(t => t.replace(/<[^>]+>/g, ''))
        .join('')
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    });
  }

  /* ===== 基础工具 ===== */

  function splitEnZh(line) {
    const m = IDEOGRAPH.exec(line);
    if (!m) return { en: line.trim(), zh: '' };
    let j = m.index;
    // 只回退空白和全角空格(0x3000)，不回退全角标点（！？等）
    while (j > 0) {
      const c = line.charCodeAt(j - 1);
      if (!(c === 32 || c === 0x3000 || c === 9)) break;
      j--;
    }
    return { en: line.slice(0, j).trim(), zh: line.slice(j).trim() };
  }

  function cleanEn(head) {
    head = head.replace(PAREN_RE, '');
    head = head.replace(POS_RE, '');
    head = head.replace(/\s+/g, ' ').trim(' …');  // 只 strip 空白和省略号，不点号
    return head.trim();
  }

  function cleanZh(zh) { return zh.replace(POS_ANY, ' ').replace(/\s+/g, ' ').trim(); }

  function classify(en) {
    // 只有真正的句号/感叹号/问号结尾才算句子（排除 ... 省略号、etc. 缩写等）
    if (/(?:(?<![.\u2026])[.!?！？])$/.test(en)) return 'sentence';
    if (en.indexOf(' ') >= 0) return 'phrase';
    return 'word';
  }

  const hasEn = s => /[A-Za-z]/.test(s);

  const SKIP_LINE = /^(?:[一二三四五六七八九十]、|朗读下列|重要提示|正确朗读|表演儿歌|说一说|写一写|姓名|班级|学号|辅音\[|元音\[|英语音标|动词ing|过去式|可数名词|不可数名词|现在进行时|[0-9]+\.\s*$)/;

  /* ===== 核心：一行挤多条的切分 =====
     用 "中英切换边界" 来分隔英文块和中文块。
     中文块内允许包含括号及其内部所有内容（哪怕有英文），
     因此能正确处理：
       - snail蜗牛bird鸟        (无空格连接)
       - lost失去；输掉（lose的过去式）  (中文嵌英文括号)
       - read阅读book书         (无空格连接)
       - tomatoes番茄（复数，以o结尾有生命加es）  (长中文说明)
  */
  function splitPairs(line) {
    const pairs = [];
    let i = 0;
    const n = line.length;
    while (i < n) {
      while (i < n && (line[i] === ' ' || line[i] === '\t' || line[i] === '\r' || line[i] === '\n')) i++;
      if (i >= n) break;
      if (!hasEn(line[i])) { i++; continue; }

      // 找英文块：从当前位置开始，直到遇到第一个中文字符
      const enStart = i;
      while (i < n && !IDEOGRAPH.test(line[i])) {
        if (line[i] === '(') {
          let depth = 1; i++;
          while (i < n && depth > 0) {
            if (line[i] === '(') depth++;
            else if (line[i] === ')') depth--;
            i++;
          }
        } else {
          i++;
        }
      }
      let en = line.slice(enStart, i).trim(' …');
      if (!en || en.length < 2 || !hasEn(en)) continue;

      // 找中文块：从当前中文字符开始，直到遇到下一个"独立英文单词"开头
      const zhStart = i;
      let parenDepth = 0;
      while (i < n) {
        const c = line[i];
        if (c === '（' || c === '(') parenDepth++;
        else if (c === '）' || c === ')') parenDepth--;
        else if (parenDepth === 0 && hasEn(c)) {
          const prev = i > 0 ? line[i - 1] : '';
          if (IDEOGRAPH.test(prev)) break;          // 前面是汉字：新英文块开始
          if ('。；：！？、…，）)'.indexOf(prev) >= 0) break;  // 前面是中文标点
          if (prev === ' ' || prev === '\t') break; // 前面是空格
        }
        i++;
      }
      const zh = line.slice(zhStart, i).trim();
      if (zh) pairs.push([en, zh]);
    }
    return pairs;
  }

  /* ===== 条目入库 ===== */

  function pushItem(items, seen, en, zh, unit, src, forceType) {
    const en2 = cleanEn(en);
    const zh2 = cleanZh(zh);
    if (!en2 || !hasEn(en2) || !zh2) return;
    if (en2.length < 2) return;
    if ((en2.match(/[A-Za-z]/g) || []).length < 2) return;
    if (/^[的地]/.test(zh2)) return;
    const key = en2.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ en: en2, zh: zh2, pos: '', type: forceType || classify(en2), unit: unit || '', source: src });
  }

  /* ===== 单词/词组 ===== */

  function parseWords(paras, skipRange, items, seen, src) {
    // 从文件名提取 unit（3A学习单N -> Unit N）
    let unitHint = null;
    const mnum = /学习单\s*(\d+)/.exec(src || '');
    if (mnum) unitHint = 'Unit ' + mnum[1];
    let unit = unitHint || '';

    paras.forEach((raw, i) => {
      if (skipRange && i >= skipRange.start && i <= skipRange.end) return;
      const t = raw.trim();
      if (!t) return;
      if (!unitHint) {
        const um = /^Unit\s*(\d+)/i.exec(t);
        if (um) { unit = 'Unit ' + um[1]; return; }
      }
      if (SKIP_LINE.test(t)) return;
      if (!IDEOGRAPH.test(t)) return;  // 纯英文行跳过（儿歌、标题等）

      const pairs = splitPairs(t);
      if (pairs.length >= 2) {
        pairs.forEach(p => pushItem(items, seen, p[0], p[1], unit, src));
      } else if (pairs.length === 1) {
        pushItem(items, seen, pairs[0][0], pairs[0][1], unit, src);
      } else {
        const { en, zh } = splitEnZh(t);
        pushItem(items, seen, en, zh, unit, src);
      }
    });
  }

  /* ===== 句子 ===== */

  function splitSentences(text) {
    const m = text.match(/[^。！？.!?\n]+[。！？.!?]+/g) || [];
    return m.map(s => s.trim()).filter(Boolean);
  }

  function findSentRange(paras) {
    let start = -1;
    for (let i = 0; i < paras.length; i++) {
      if (paras[i].indexOf('朗读下列句子') >= 0 || paras[i].indexOf('正确朗读下列句子') >= 0) {
        start = i; break;
      }
    }
    if (start < 0) return null;
    let end = paras.length - 1;
    for (let i = start + 1; i < paras.length; i++) {
      if (/^\s*[四五六七]、/.test(paras[i]) || paras[i].indexOf('表演儿歌') >= 0 || paras[i].indexOf('说一说') >= 0) {
        end = i - 1; break;
      }
    }
    return { start, end };
  }

  function parseSentences(paras, range, items, seen, src) {
    if (!range) return;
    const mnum = /学习单\s*(\d+)/.exec(src || '');
    const unit = mnum ? 'Unit ' + mnum[1] : '';
    for (let i = range.start + 1; i <= range.end; i++) {
      let raw = paras[i].trim();
      if (!raw) continue;
      raw = raw.replace(/^\s*\d+\.\s*/, '');
      if (raw.indexOf('朗读下列') >= 0 || raw.indexOf('重要提示') >= 0 || SKIP_LINE.test(raw)) continue;

      raw.split('--').forEach(seg => {
        seg = seg.trim();
        if (!seg) return;
        const { en, zh } = splitEnZh(seg);
        if (!en || !zh || !hasEn(en)) return;
        let ens = splitSentences(en), zhs = splitSentences(zh);
        if (ens.length !== zhs.length || !ens.length) { ens = [en]; zhs = [zh]; }
        ens.forEach((e, idx) => {
          e = e.trim();
          if (!e || !hasEn(e)) return;
          const key = e.toLowerCase();
          if (seen.has(key)) return;
          seen.add(key);
          items.push({ en: e, zh: (zhs[idx] || '').trim(), pos: '', type: 'sentence', unit: unit, source: src });
        });
      });
    }
  }

  /* ===== 主入口 ===== */

  async function parseFile(file) {
    const paras = await paragraphs(file);
    const items = [], seen = new Set();
    const range = findSentRange(paras);
    parseSentences(paras, range, items, seen, file.name);
    parseWords(paras, range, items, seen, file.name);
    return items;
  }

  return { parseFile };
})();
