/* 艾宾浩斯记忆调度 + 今日任务生成 */
const Scheduler = (function () {

  function todayStr(d) {
    const t = d ? new Date(d) : new Date();
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, '0');
    const day = String(t.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return todayStr(d);
  }

  function diffDays(a, b) {
    const da = new Date(a + 'T00:00:00'), db = new Date(b + 'T00:00:00');
    return Math.round((db - da) / 86400000);
  }

  const isDue = (dateStr) => dateStr <= todayStr();

  // 单元序号：Unit 1 -> 1, Unit 2 -> 2 ...；无单元的排最后
  function unitNum(u) {
    const m = /Unit\s*(\d+)/i.exec(u || '');
    return m ? parseInt(m[1], 10) : 999;
  }

  // 今日新学：该类型里还没学过（无记录）的，按单元顺序取前 limit 个
  function newItems(type, limit) {
    const lex = Store.lexicon().filter(x => x.type === type)
      .sort((a, b) => unitNum(a.unit) - unitNum(b.unit));
    const records = Store.getRecords();
    const fresh = lex.filter(x => !records[Store.keyOf(x)]);
    return fresh.slice(0, limit);
  }

  // 今日复习：到期且未掌握的，按单元顺序排列
  function reviewItems() {
    const records = Store.getRecords();
    const out = [];
    for (const k in records) {
      const r = records[k];
      if (r.mastered || !r.nextDue) continue;
      if (isDue(r.nextDue)) out.push(r);
    }
    return out.sort((a, b) => {
      const d = unitNum(a.unit) - unitNum(b.unit);
      return d !== 0 ? d : String(a.learnedAt || '').localeCompare(String(b.learnedAt || ''));
    });
  }

  // 按类型限制复习数量（新学的当天不计入复习）
  function cappedReview() {
    const lim = Store.getSettings().dailyReview;
    const groups = { word: [], phrase: [], sentence: [] };
    for (const r of reviewItems()) (groups[r.type] || groups.word).push(r);
    const out = [];
    for (const t of ['word', 'phrase', 'sentence']) {
      out.push(...groups[t].slice(0, lim[t]));
    }
    return out;
  }

  // 学习进度统计
  function stats() {
    const lex = Store.lexicon();
    const records = Store.getRecords();
    const byType = {};
    for (const it of lex) {
      const t = byType[it.type] || (byType[it.type] = { total: 0, learned: 0, mastered: 0 });
      t.total++;
      const r = records[Store.keyOf(it)];
      if (r) t.learned++;
      if (r && r.mastered) t.mastered++;
    }
    return byType;
  }

  function todayProgress() {
    const key = 'day:' + todayStr();
    const log = Store.getLog();
    return log[key] || { learned: 0, reviewed: 0, correct: 0, wrong: 0, optional: 0 };
  }

  return {
    todayStr, addDays, diffDays, isDue,
    newItems, reviewItems, cappedReview, stats, todayProgress,
    typeLabel: (t) => ({ word: '单词', phrase: '词组', sentence: '句子' }[t] || t),
  };
})();
