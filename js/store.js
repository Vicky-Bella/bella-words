/* 本地存储：词库、学习记录、错题、设置、每日进度 */
const Store = (function () {
  const K = {
    records: 'eb.records',      // 学习记录
    mistakes: 'eb.mistakes',    // 错题本
    userLex: 'eb.userLex',      // 上传新增的词库
    settings: 'eb.settings',    // 设置
    log: 'eb.log',              // 每日进度
    checkin: 'eb.checkin',      // 持续打卡
  };

  const DEFAULT_SETTINGS = {
    dailyNew: { word: 8, phrase: 2, sentence: 1 },
    dailyReview: { word: 8, phrase: 2, sentence: 1 },
    intervals: [1, 2, 4, 7, 15],
  };

  function read(key, def) {
    try {
      const s = localStorage.getItem(key);
      return s ? JSON.parse(s) : def;
    } catch (e) { return def; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  let records = read(K.records, {});
  let mistakes = read(K.mistakes, {});
  let userLex = read(K.userLex, []);
  let settings = Object.assign({}, DEFAULT_SETTINGS, read(K.settings, {}));
  settings.dailyNew = Object.assign({}, DEFAULT_SETTINGS.dailyNew, settings.dailyNew || {});
  settings.dailyReview = Object.assign({}, DEFAULT_SETTINGS.dailyReview, settings.dailyReview || {});
  // 设置迁移：每日计划已从 10/8/5 改为 8/2/1，旧数据自动升级
  if (settings.version !== 2) {
    settings.dailyNew = Object.assign({}, DEFAULT_SETTINGS.dailyNew);
    settings.dailyReview = Object.assign({}, DEFAULT_SETTINGS.dailyReview);
    settings.version = 2;
    write(K.settings, settings);
  }
  let log = read(K.log, {});

  /* ---------------- 词库迁移 v4 ----------------
     data.js 升级后部分条目的 en 清洗结果变了（词性后缀、全角标点、末尾省略号），
     旧记录的 key（type|en_lower）可能对不上；另外旧版解析有截断 bug（st / ru 等）。
     这里自动把 key 映射到新词库，并把对不上的旧解析残留清掉。
  */
  (function migrateLexiconV4() {
    if (settings.migratedLexiconV4) return;
    const pool = (window.LEXICON || []).concat(userLex || []);
    const enMap = {};
    const norm = s => String(s).toLowerCase().replace(/[.\u2026\s]+$/, '').replace(/\s+/g, ' ').trim();
    const normMap = {};
    for (const it of pool) {
      const e = String(it.en).toLowerCase();
      if (!enMap[e]) enMap[e] = it;
      const n = norm(it.en);
      if (!normMap[n]) normMap[n] = it;
    }
    let moved = 0, dropped = 0;
    const doMigrate = (obj, writeKey) => {
      const out = {};
      for (const oldK in obj) {
        const sep = oldK.indexOf('|');
        if (sep < 0) { out[oldK] = obj[oldK]; continue; }
        const oldEn = oldK.slice(sep + 1);
        const item = enMap[oldEn] || normMap[norm(oldEn)];
        if (!item) { dropped++; continue; }   // 旧解析残留（如 st / ru），清掉
        const newK = item.type + '|' + String(item.en).toLowerCase();
        if (newK !== oldK) moved++;
        out[newK] = Object.assign({}, obj[oldK], {
          key: newK, type: item.type, en: item.en,
          zh: item.zh || obj[oldK].zh, unit: item.unit || obj[oldK].unit || '',
        });
      }
      write(writeKey, out);
      return out;
    };
    records = doMigrate(records, K.records);
    mistakes = doMigrate(mistakes, K.mistakes);
    settings.migratedLexiconV4 = true;
    write(K.settings, settings);
    if (moved || dropped) console.log('[Store] 词库迁移：' + moved + ' 条已升级，' + dropped + ' 条旧解析残留已清理');
  })();

  /* ---------------- 持续打卡 ---------------- */
  const CHECKIN_DEFAULT = {
    dates: [],        // 已打卡日期（含补签）
    best: 0,          // 历史最长连续天数
    makeupLeft: 0,    // 剩余补签机会（0-3）
    wish: '',         // 愿望内容
    achieved: 0,      // 已实现愿望次数
    next100: 100,     // 下一个愿望所需连续天数
    milestone10: 0,   // 本段连续已发放的“10 天”里程碑
    skipMakeup: '',   // 用户当天已放弃补签的日期
  };
  let checkin = Object.assign({}, CHECKIN_DEFAULT, read(K.checkin, {}));
  checkin.dates = Array.isArray(checkin.dates) ? checkin.dates : [];

  function ckHas(date) { return checkin.dates.indexOf(date) >= 0; }
  function ckAdd(date) {
    if (!ckHas(date)) { checkin.dates.push(date); checkin.dates.sort(); }
  }
  function ckSave() { write(K.checkin, checkin); }

  // 当前连续天数：今天已打卡就从今天往前数，否则从昨天往前数；断签则为 0
  function currentStreak() {
    const set = new Set(checkin.dates);
    const today = Scheduler.todayStr();
    let d = set.has(today) ? today : Scheduler.addDays(today, -1);
    if (!set.has(d)) return 0;
    let n = 0;
    while (set.has(d)) { n++; d = Scheduler.addDays(d, -1); }
    return n;
  }

  // 结算里程碑：每满 10 天发 1 次补签（累计上限 3）；每满 100 天达成一个愿望
  function ckAwards(streak, restart) {
    const gained = [];
    if (restart) { checkin.milestone10 = 0; checkin.next100 = 100; }
    const target = Math.floor(streak / 10) * 10;
    while (checkin.milestone10 < target) {
      checkin.milestone10 += 10;
      checkin.makeupLeft = Math.min(3, checkin.makeupLeft + 1);
      gained.push(checkin.milestone10);
    }
    let celebration = false;
    while (streak >= checkin.next100) {
      checkin.achieved += 1;
      checkin.next100 += 100;
      celebration = true;
    }
    return { gained, celebration };
  }

  // 内置词库 + 用户上传词库
  let builtin = (window.LEXICON || []);
  let allLex = builtin.concat(userLex);

  function keyOf(item) { return item.type + '|' + String(item.en).toLowerCase(); }

  // 去重后的词库
  function lexicon() {
    const seen = new Set();
    const out = [];
    for (const it of allLex) {
      const k = keyOf(it);
      if (seen.has(k)) continue;
      seen.add(k); out.push(it);
    }
    return out;
  }

  return {
    K,
    lexicon,
    keyOf,
    getRecords() { return records; },
    getRecord(k) { return records[k]; },
    getMistakes() { return mistakes; },
    getSettings() { return settings; },
    getLog() { return log; },

    saveSettings(patch) {
      settings = Object.assign({}, settings, patch);
      write(K.settings, settings);
    },

    addUserLex(items) {
      userLex = userLex.concat(items);
      write(K.userLex, userLex);
      allLex = builtin.concat(userLex);
    },
    getUserLexCount() { return userLex.length; },

    clearUserLex() {
      userLex = []; write(K.userLex, userLex); allLex = builtin.concat(userLex);
    },

    // 首次学习：建立记录，安排下次复习
    learn(item, date) {
      const k = keyOf(item);
      const r = records[k] || {
        key: k, en: item.en, zh: item.zh, type: item.type, unit: item.unit || '',
        stage: 0, learnedAt: null, lastReview: null, nextDue: null,
        correct: 0, wrong: 0, mastered: false,
      };
      if (!r.learnedAt) r.learnedAt = date;
      r.nextDue = Scheduler.addDays(date, settings.intervals[0]);
      r.lastReview = date;
      records[k] = r;
      write(K.records, records);
      return r;
    },

    // 复习答题结果
    answer(item, isCorrect, date) {
      const k = keyOf(item);
      const r = records[k] || {
        key: k, en: item.en, zh: item.zh, type: item.type, unit: item.unit || '',
        stage: 0, learnedAt: date, lastReview: null, nextDue: null,
        correct: 0, wrong: 0, mastered: false,
      };
      const iv = settings.intervals;
      if (isCorrect) {
        r.correct++;
        r.stage++;
        if (r.stage >= iv.length) {
          r.mastered = true;
          r.nextDue = null;
          if (mistakes[k]) { delete mistakes[k]; write(K.mistakes, mistakes); }
        } else {
          r.nextDue = Scheduler.addDays(date, iv[r.stage]);
        }
      } else {
        r.wrong++;
        r.stage = 0;
        r.mastered = false;
        r.nextDue = Scheduler.addDays(date, iv[0]);
        mistakes[k] = { key: k, en: r.en, zh: r.zh, type: r.type, unit: r.unit || '', lastWrong: date, wrong: r.wrong };
        write(K.mistakes, mistakes);
      }
      r.lastReview = date;
      records[k] = r;
      write(K.records, records);
      return r;
    },

    // 跳过：推到明天再复习，不改掌握度、不进错题本
    postpone(item, date) {
      const k = keyOf(item);
      const r = records[k];
      if (!r) return;
      r.nextDue = Scheduler.addDays(date, 1);
      records[k] = r;
      write(K.records, records);
      return r;
    },

    // 手动把某条移出错题本
    removeMistake(k) { delete mistakes[k]; write(K.mistakes, mistakes); },

    /* ---- 持续打卡 ---- */
    getCheckin() { return checkin; },
    hasCheckin(date) { return ckHas(date); },
    lastCheckinDate() { return checkin.dates.length ? checkin.dates[checkin.dates.length - 1] : null; },
    currentStreak,
    bestStreak() { return checkin.best; },
    setWish(text) { checkin.wish = String(text || '').slice(0, 200); ckSave(); },
    declineMakeup(date) { checkin.skipMakeup = date; ckSave(); },

    // 当天完成全部任务 → 打卡
    checkIn(date) {
      if (ckHas(date)) {
        return { changed: false, streak: currentStreak(), best: checkin.best, gained: [], celebration: false, achieved: checkin.achieved };
      }
      const prev = checkin.dates.length ? checkin.dates[checkin.dates.length - 1] : null;
      const restart = !prev || Scheduler.diffDays(prev, date) >= 2;
      ckAdd(date);
      const streak = currentStreak();
      const { gained, celebration } = ckAwards(streak, restart);
      checkin.best = Math.max(checkin.best, streak);
      ckSave();
      return { changed: true, streak, best: checkin.best, gained, celebration, achieved: checkin.achieved };
    },

    // 用 1 次机会补上漏掉的那天，使连续天数接续
    useMakeup(date) {
      if (checkin.makeupLeft <= 0 || ckHas(date)) return null;
      ckAdd(date);
      checkin.makeupLeft -= 1;
      const streak = currentStreak();
      const { gained, celebration } = ckAwards(streak, false);
      checkin.best = Math.max(checkin.best, streak);
      ckSave();
      return { streak, best: checkin.best, gained, celebration };
    },

    /* ---- 备份 / 恢复：把全部本地数据导出成一个文件，换设备或被清理后可还原 ---- */
    dumpAll() {
      const data = {};
      Object.values(K).forEach(k => {
        const v = localStorage.getItem(k);
        if (v !== null) data[k] = v;
      });
      return { app: 'bella-words', version: 1, savedAt: new Date().toISOString(), data };
    },
    loadAll(dump) {
      const d = dump && dump.data;
      if (!d || typeof d !== 'object') throw new Error('备份文件格式不对');
      let n = 0;
      Object.values(K).forEach(k => {
        if (typeof d[k] === 'string') { localStorage.setItem(k, d[k]); n++; }
      });
      if (!n) throw new Error('备份文件里没有可用数据');
      return n;
    },

    resetAll() {
      records = {}; mistakes = {}; log = {};
      write(K.records, records); write(K.mistakes, mistakes); write(K.log, log);
    },
  };
})();
