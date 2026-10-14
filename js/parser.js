/* Word(.docx) 解析：读取 docx -> 段落 -> 词库条目 */
const DocxParser = (function () {
  const JSZIP_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  const IDEOGRAPH = /[\u4e00-\u9fff]/;
  const POS_TOKEN = '(?:n|v|adj|adv|prep|conj|pron|num|int|art|abbr|pl|vt|vi)\\.';
  const POS_RE = new RegExp('(?:\\s*' + POS_TOKEN + ')+\\s*$');
  const POS_ANY = new RegExp('\\s*' + POS_TOKEN + '\\s*', 'g');
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
      // 注意: 必须是 <w:t 后跟空格或 > , 否则会误匹配 <w:textAlignment .../> 等标签
      const ts = p.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || [];
      return ts.map(t => t.replace(/<[^>]+>/g, ''))
        .join('')
        .replace(/<[^>]*>/g, '')   // 兜底：清掉任何残留标签
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    });
  }

  function splitEnZh(line) {
    const m = IDEOGRAPH.exec(line);
    if (!m) return { en: line.trim(), zh: '' };
    let j = m.index;
    while (j > 0) {
      const c = line.charCodeAt(j - 1);
      if (!(c === 32 || (c >= 0x3000 && c <= 0x303f) || (c >= 0xff00 && c <= 0xffef) || c === 9)) break;
      j--;
    }
    return { en: line.slice(0, j).trim(), zh: line.slice(j).trim() };
  }

  function cleanEn(head) {
    head = head.replace(PAREN_RE, '');
    head = head.replace(POS_RE, '');
    head = head.replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '');
    return head.trim();
  }
  function cleanZh(zh) { return zh.replace(POS_ANY, ' ').replace(/\s+/g, ' ').trim(); }

  function classify(en) {
    if (/[.!?！？…]$/.test(en)) return 'sentence';
    if (en.indexOf(' ') >= 0) return 'phrase';
    return 'word';
  }
  const hasEn = s => /[A-Za-z]/.test(s);

  // 跳过明显的标题/说明行
  const SKIP_LINE = /^(?:[一二三四五六七八九十]、|朗读下列|重要提示|正确朗读|表演儿歌|说一说|写一写|姓名|班级|学号)/;
  // 一行里串联的「英文+中文」对（用于学习单里被挤在一起的单词/词组）
  const PAIR_RE = /([A-Za-z][A-Za-z0-9'’\-\.]*(?:\s+[A-Za-z][A-Za-z0-9'’\-\.]*)*)\s*([\u4e00-\u9fff][^A-Za-z]*)/g;

  function pushItem(items, seen, en, zh, unit, src, forceType) {
    const en2 = cleanEn(en);
    const zh2 = cleanZh(zh);
    if (!en2 || !hasEn(en2) || !zh2) return;
    if (en2.length < 2) return;                 // 单个字母不算
    if (/^[的地]/.test(zh2)) return;            // 过滤「的目标」这类碎片
    const key = en2.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ en: en2, zh: zh2, pos: '', type: forceType || classify(en2), unit: unit || '', source: src });
  }

  // 逐段解析单词/词组（兼容「一行一个」和「一行多个挤在一起」两种格式）
  function parseWords(paras, skipRange, items, seen, src) {
    let unit = '';
    paras.forEach((raw, i) => {
      const t = raw.trim();
      if (!t) return;
      if (skipRange && i >= skipRange.start && i <= skipRange.end) return;
      const um = /^Unit\s*(\d+)/i.exec(t);
      if (um) { unit = 'Unit ' + um[1]; return; }
      if (SKIP_LINE.test(t)) return;

      const pairs = [];
      let m; PAIR_RE.lastIndex = 0;
      while ((m = PAIR_RE.exec(t)) !== null) pairs.push([m[1], m[2]]);

      if (pairs.length >= 2) {
        pairs.forEach(p => pushItem(items, seen, p[0], p[1], unit, src));
      } else {
        const { en, zh } = splitEnZh(t);
        pushItem(items, seen, en, zh, unit, src);
      }
    });
  }

  function splitSentences(text) {
    const m = text.match(/[^。！？.!?\n]+[。！？.!?]+/g) || [];
    return m.map(s => s.trim()).filter(Boolean);
  }

  function findSentRange(paras) {
    let start = -1;
    for (let i = 0; i < paras.length; i++) if (paras[i].indexOf('朗读下列句子') >= 0) { start = i; break; }
    if (start < 0) return null;
    let end = paras.length - 1;
    for (let i = start + 1; i < paras.length; i++) {
      if (/^\s*[四五六七]、/.test(paras[i]) || paras[i].indexOf('表演儿歌') >= 0) { end = i - 1; break; }
    }
    return { start, end };
  }

  // 学习单：解析「朗读下列句子」段落；学习单N 归入 Unit N
  function parseSentences(paras, range, items, seen, src) {
    if (!range) return;
    const mnum = /学习单\s*(\d+)/.exec(src || '');
    const unit = mnum ? 'Unit ' + mnum[1] : '';
    for (let i = range.start + 1; i <= range.end; i++) {
      let raw = paras[i].trim();
      if (!raw) continue;
      raw = raw.replace(/^\s*\d+\.\s*/, '');
      if (raw.indexOf('朗读下列') >= 0 || raw.indexOf('重要提示') >= 0) continue;
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

  // 解析一个 docx 文件 -> 词库条目（单词 + 词组 + 句子 都会尝试解析）
  async function parseFile(file) {
    const paras = await paragraphs(file);
    const items = [], seen = new Set();
    const range = findSentRange(paras);
    parseSentences(paras, range, items, seen, file.name);   // 句子
    parseWords(paras, range, items, seen, file.name);       // 单词/词组（跳过句子区）
    return items;
  }

  return { parseFile };
})();
