/* ============================================================
   课程表 App  ·  逻辑层
   依赖：assets/parser.js（CourseParser）
   ============================================================ */
(function () {
  'use strict';

  var P = window.CourseParser;
  var V = window.CourseTableValidate;
  var STORE_KEY = 'coursetable.v1';
  var APP_VERSION = '1.2.0';

  var WD_SHORT = ['一', '二', '三', '四', '五', '六', '日'];
  var WD_FULL = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  var PALETTE = [
    '#4f7cff', '#f2586f', '#16b6a4', '#f79c22', '#8a6bf6',
    '#2f9fe0', '#e8643f', '#2fb56b', '#d851a8', '#7a8ca8'
  ];

  var DEFAULT_PERIODS = [
    { n: 1, s: '08:00', e: '08:45' }, { n: 2, s: '08:55', e: '09:40' },
    { n: 3, s: '10:00', e: '10:45' }, { n: 4, s: '10:55', e: '11:40' },
    { n: 5, s: '14:00', e: '14:45' }, { n: 6, s: '14:55', e: '15:40' },
    { n: 7, s: '16:00', e: '16:45' }, { n: 8, s: '16:55', e: '17:40' },
    { n: 9, s: '19:00', e: '19:45' }, { n: 10, s: '19:55', e: '20:40' },
    { n: 11, s: '20:50', e: '21:35' }, { n: 12, s: '21:45', e: '22:30' }
  ];

  /* ---------------- 小工具 ---------------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseYmd(s) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || ''));
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function mondayOf(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); var w = (x.getDay() + 6) % 7; x.setDate(x.getDate() - w); return x; }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function md(d) { return (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
  function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function uniqNum(arr) {
    var seen = {}, out = [];
    arr.forEach(function (v) { v = Number(v); if (v >= 1 && v <= 60 && !seen[v]) { seen[v] = 1; out.push(v); } });
    return out.sort(function (a, b) { return a - b; });
  }

  /* ---------------- 存储 ---------------- */

  var storeOk = true;

  function defaultSettings() {
    return {
      title: '我的课程表',
      termStart: ymd(mondayOf(new Date())),
      totalWeeks: 20,
      periods: DEFAULT_PERIODS.map(function (p) { return { n: p.n, s: p.s, e: p.e }; })
    };
  }

  var state = {
    courses: [],
    settings: defaultSettings(),
    view: 'day',
    week: 1,
    day: 1
  };

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORE_KEY); }
    catch (e) { storeOk = false; }
    if (!raw) return;
    try {
      var data = JSON.parse(raw);
      if (data && Array.isArray(data.courses)) state.courses = data.courses.map(normalizeCourse).filter(Boolean);
      if (data && data.settings) state.settings = mergeSettings(data.settings);
    } catch (e) { /* 数据损坏，忽略 */ }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, courses: state.courses, settings: state.settings }));
      storeOk = true;
    } catch (e) {
      storeOk = false;
    }
  }

  function mergeSettings(s) {
    var d = defaultSettings();
    var out = {
      title: typeof s.title === 'string' && s.title ? s.title : d.title,
      termStart: parseYmd(s.termStart) ? ymd(parseYmd(s.termStart)) : d.termStart,
      totalWeeks: clamp(parseInt(s.totalWeeks, 10) || d.totalWeeks, 1, 40),
      periods: d.periods
    };
    if (Array.isArray(s.periods) && s.periods.length >= 1) {
      out.periods = s.periods.slice(0, 20).map(function (p, i) {
        return {
          n: i + 1,
          s: /^\d{1,2}:\d{2}$/.test(p && p.s) ? p.s : d.periods[i] ? d.periods[i].s : '08:00',
          e: /^\d{1,2}:\d{2}$/.test(p && p.e) ? p.e : d.periods[i] ? d.periods[i].e : '08:45'
        };
      }).map(function (p, i) { return { n: i + 1, s: p.s, e: p.e }; });
    }
    return out;
  }

  function normalizeCourse(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || '').trim().slice(0, 50);
    if (!name) return null;
    var start = clamp(parseInt(raw.start, 10) || 1, 1, 20);
    var end = clamp(parseInt(raw.end, 10) || start, start, 20);
    return {
      id: raw.id || uid(),
      name: name,
      teacher: String(raw.teacher || '').trim().slice(0, 40),
      room: String(raw.room || '').trim().slice(0, 40),
      day: clamp(parseInt(raw.day, 10) || 1, 1, 7),
      start: start,
      end: end,
      weeks: Array.isArray(raw.weeks) && raw.weeks.length ? uniqNum(raw.weeks) : null,
      note: String(raw.note || '').trim().slice(0, 200),
      color: /^#[0-9a-f]{3,8}$/i.test(raw.color || '') ? raw.color : null,
      confirmed: raw.confirmed === true
    };
  }

  /* ---------------- 日期 / 周次 ---------------- */

  function termStart() { return parseYmd(state.settings.termStart) || mondayOf(new Date()); }

  function currentWeekNo() {
    var diff = Math.floor((mondayOf(new Date()) - termStart()) / 86400000 / 7) + 1;
    return diff < 1 ? 1 : diff;
  }

  function weekDates(week) {
    var base = addDays(termStart(), (week - 1) * 7);
    var out = [];
    for (var i = 0; i < 7; i++) out.push(addDays(base, i));
    return out;
  }

  function courseActive(c, week) {
    if (!c.weeks || !c.weeks.length) return true;
    return c.weeks.indexOf(week) >= 0;
  }

  function coursesForDay(day, week) {
    return state.courses
      .filter(function (c) { return c.day === day && courseActive(c, week); })
      .sort(function (a, b) { return a.start - b.start || a.end - b.end || (a.name > b.name ? 1 : -1); });
  }

  function slotTime(start, end) {
    var ps = state.settings.periods;
    var a = ps[clamp(start, 1, ps.length) - 1];
    var b = ps[clamp(end, 1, ps.length) - 1];
    return { a: a ? a.s : '--:--', b: b ? b.e : '--:--' };
  }

  function weeksText(weeks) {
    if (!weeks || !weeks.length) return '每周';
    var s = uniqNum(weeks);
    var allOdd = s.every(function (w) { return w % 2 === 1; });
    var allEven = s.every(function (w) { return w % 2 === 0; });
    var parts = [], from = s[0], prev = s[0];
    for (var i = 1; i <= s.length; i++) {
      var w = s[i];
      if (w === prev + 1) { prev = w; continue; }
      parts.push(from === prev ? String(from) : from + '-' + prev);
      from = w; prev = w;
    }
    var txt = parts.join(',') + ' 周';
    if (s.length > 2 && allOdd) txt += '(单)';
    else if (s.length > 2 && allEven) txt += '(双)';
    return txt;
  }

  function colorFor(c) {
    if (c.color) return c.color;
    var h = 0;
    for (var i = 0; i < c.name.length; i++) h = (h * 31 + c.name.charCodeAt(i)) % 9973;
    return PALETTE[h % PALETTE.length];
  }

  function nowMinutes() {
    var d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }
  function hm2min(hm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hm || '');
    return m ? (+m[1]) * 60 + (+m[2]) : -1;
  }

  /* ---------------- toast ---------------- */

  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  /* ---------------- 弹层 ---------------- */

  function openSheet(title, bodyHtml, onMount, headExtra) {
    var sheet = $('#sheet');
    sheet.innerHTML =
      '<div class="sheet-head"><h2>' + esc(title) + '</h2>' + (headExtra || '') +
      '<button class="close" id="sheetClose" aria-label="关闭">✕</button></div>' +
      '<div class="sheet-body" id="sheetBody">' + bodyHtml + '</div>';
    $('#mask').classList.add('show');
    sheet.classList.add('show');
    $('#sheetClose').onclick = closeSheet;
    if (onMount) onMount($('#sheetBody'));
    sheet.scrollTop = 0;
    var body = $('#sheetBody');
    if (body) body.scrollTop = 0;
  }

  function closeSheet() {
    $('#sheet').classList.remove('show');
    $('#mask').classList.remove('show');
    setTimeout(function () {
      if (!$('#sheet').classList.contains('show')) $('#sheet').innerHTML = '';
    }, 280);
  }

  /* ---------------- 渲染：顶栏 / 星期条 ---------------- */

  function renderHeader() {
    var wk = state.week;
    $('#weekNum').textContent = '第 ' + wk + ' 周';
    var ds = weekDates(wk);
    $('#weekRange').textContent = md(ds[0]) + ' - ' + md(ds[6]);
    $('#curTag').hidden = wk !== currentWeekNo();
    document.title = state.settings.title || '课程表';
  }

  function renderStrip() {
    var todayYmd = ymd(new Date());
    var ds = weekDates(state.week);
    var html = '';
    for (var i = 0; i < 7; i++) {
      var day = i + 1;
      var d = ds[i];
      var isToday = ymd(d) === todayYmd;
      var has = coursesForDay(day, state.week).length > 0;
      html += '<button class="day-chip' +
        (day === state.day ? ' selected' : '') +
        (isToday ? ' today' : '') +
        (has ? ' has-course' : '') +
        '" data-day="' + day + '">' +
        '<span>' + WD_SHORT[i] + '</span><b>' + d.getDate() + '</b><i class="dot"></i></button>';
    }
    var el = $('#dayStrip');
    el.innerHTML = html;
    $all('.day-chip', el).forEach(function (btn) {
      btn.onclick = function () {
        state.day = +btn.dataset.day;
        switchView('day');
        renderAll();
      };
    });
  }

  /* ---------------- 渲染：日视图 ---------------- */

  function courseCard(c, isToday) {
    var t = slotTime(c.start, c.end);
    var now = nowMinutes();
    var a = hm2min(t.a), b = hm2min(t.b);
    var running = isToday && a >= 0 && b >= 0 && now >= a && now <= b;
    var past = isToday && b >= 0 && now > b;
    var f = flags()[c.id];
    var tag = running ? '<span class="tag">进行中</span>' : '';
    var warn = f ? '<span class="tag warn" title="' + esc(f.reasons.join('；')) + '">⚠ 待确认</span>' : '';
    var meta = [];
    if (c.teacher) meta.push('<i>👤 ' + esc(c.teacher) + '</i>');
    if (c.room) meta.push('<i>📍 ' + esc(c.room) + '</i>');
    return '<div class="lesson' + (running ? ' now' : '') + (past ? ' past' : '') + '" data-id="' + c.id + '" style="--c:' + colorFor(c) + '">' +
      '<div class="lesson-time"><b>' + c.start + (c.end !== c.start ? '-' + c.end : '') + '节</b>' +
      '<em>' + t.a + '</em><em>' + t.b + '</em></div>' +
      '<div class="lesson-body">' +
      '<div class="lesson-name">' + esc(c.name) + tag + warn + '</div>' +
      (meta.length ? '<div class="lesson-meta">' + meta.join('') + '</div>' : '') +
      '<div class="lesson-week">' + esc(weeksText(c.weeks)) + (c.note ? ' · ' + esc(c.note) : '') + '</div>' +
      '</div></div>';
  }

  function renderDay() {
    var el = $('#dayView');
    var list = coursesForDay(state.day, state.week);
    var d = weekDates(state.week)[state.day - 1];
    var isToday = ymd(d) === ymd(new Date());
    var html = '<div class="day-head"><b>' + WD_FULL[state.day - 1] + (isToday ? ' · 今天' : '') + '</b>' +
      '<span>' + md(d) + '</span><span style="margin-left:auto">' + list.length + ' 节课</span></div>';

    if (!list.length) {
      html += '<div class="empty"><div class="big">☕️</div><p>这天没有课。<br>可以先导入课表，或手动加一节课。</p>' +
        '<div class="row"><button class="btn primary" id="emptyImport">导入课表</button>' +
        '<button class="btn" id="emptyAdd">手动添加</button></div>' +
        '<div style="margin-top:14px"><button class="link" id="emptyDemo">先看示例课表 →</button></div></div>';
    } else {
      list.forEach(function (c) { html += courseCard(c, isToday); });
    }
    el.innerHTML = html;

    var ei = $('#emptyImport'); if (ei) ei.onclick = openImport;
    var ea = $('#emptyAdd'); if (ea) ea.onclick = function () { openEditor(null); };
    var ed = $('#emptyDemo');
    if (ed) ed.onclick = function () {
      if (state.courses.length && !confirm('示例会覆盖现有课程，继续？')) return;
      seedDemo();
      toast('已载入示例课表');
    };
    $all('.lesson', el).forEach(function (node) {
      node.onclick = function () { openCourseDetail(node.dataset.id); };
    });
  }

  /* ---------------- 渲染：周视图 ---------------- */

  function renderWeek() {
    var el = $('#weekView');
    var ps = state.settings.periods;
    var rows = ps.length;
    var todayYmd = ymd(new Date());
    var ds = weekDates(state.week);

    var style = 'grid-template-columns:40px repeat(7,minmax(0,1fr));grid-template-rows:38px repeat(' + rows + ',56px);';
    var html = '<div class="wk-wrap"><div class="wk-grid" style="' + style + '">';

    html += '<div class="wk-corner"></div>';
    for (var d = 0; d < 7; d++) {
      var isToday = ymd(ds[d]) === todayYmd;
      html += '<div class="wk-dayhead' + (isToday ? ' today' : '') + '" style="grid-column:' + (d + 2) + ';grid-row:1">' +
        '<b>' + WD_SHORT[d] + '</b><small>' + (ds[d].getMonth() + 1) + '/' + ds[d].getDate() + '</small></div>';
    }

    for (var p = 1; p <= rows; p++) {
      var row = p + 1;
      var pd = ps[p - 1];
      html += '<div class="wk-time" style="grid-column:1;grid-row:' + row + '"><b>' + p + '</b><small>' + esc(pd.s) + '</small></div>';
      for (var dd = 0; dd < 7; dd++) {
        html += '<div class="wk-cell" style="grid-column:' + (dd + 2) + ';grid-row:' + row + '"></div>';
      }
    }

    // 课程块（叠加在网格上）
    for (var day = 1; day <= 7; day++) {
      coursesForDay(day, state.week).forEach(function (c) {
        var s = clamp(c.start, 1, rows);
        var e = clamp(c.end, s, rows);
        var t = slotTime(c.start, c.end);
        html += '<div class="wk-course" data-id="' + c.id + '" style="grid-column:' + (day + 1) + ';grid-row:' + (s + 1) + ' / ' + (e + 2) + ';--c:' + colorFor(c) + '">' +
          '<b>' + (flags()[c.id] ? '⚠ ' : '') + esc(c.name) + '</b>' +
          (c.room ? '<span>@' + esc(c.room) + '</span>' : '') +
          '<span>' + t.a + '</span></div>';
      });
    }
    html += '</div></div>';
    el.innerHTML = html;
    $all('.wk-course', el).forEach(function (node) {
      node.onclick = function () { openCourseDetail(node.dataset.id); };
    });
  }

  /** 「待确认」标记：解析可疑 + 时间冲突；人工确认过的自动跳过 */
  var flagCache = { key: '', map: {} };
  function flags() {
    if (!V) return {};
    var key = state.courses.length + '|' + state.settings.totalWeeks + '|' + state.courses.map(function (c) {
      return c.id + (c.confirmed ? 'c' : '') + c.start + '-' + c.end + '[' + (c.weeks || []).join(',') + ']' + c.name;
    }).join(';');
    if (key !== flagCache.key) {
      flagCache.key = key;
      flagCache.map = V.annotate(state.courses, Math.max(state.settings.totalWeeks || 20, 20));
    }
    return flagCache.map;
  }
  function flagCount() {
    var f = flags(), n = 0;
    for (var k in f) n++;
    return n;
  }

  function renderAll() {
    renderHeader();
    renderStrip();
    // 周课表里已经有星期表头，隐藏上面的星期条，避免重复+对齐错位
    $('#dayStrip').hidden = state.view === 'week';
    if (state.view === 'day') {
      $('#dayView').hidden = false;
      $('#weekView').hidden = true;
      renderDay();
    } else {
      $('#dayView').hidden = true;
      $('#weekView').hidden = false;
      renderWeek();
    }
    $all('.tab[data-view]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === state.view);
    });
  }

  function switchView(v) {
    state.view = v;
    renderAll();
  }

  /* ---------------- 课程详情 ---------------- */

  function findCourse(id) {
    for (var i = 0; i < state.courses.length; i++) if (state.courses[i].id === id) return state.courses[i];
    return null;
  }

  function openCourseDetail(id) {
    var c = findCourse(id);
    if (!c) return;
    var t = slotTime(c.start, c.end);
    var rows = [
      ['课程', c.name],
      ['时间', WD_FULL[c.day - 1] + ' · 第 ' + c.start + (c.end !== c.start ? '-' + c.end : '') + ' 节（' + t.a + ' - ' + t.b + '）'],
      ['周次', weeksText(c.weeks)],
      ['教师', c.teacher || '—'],
      ['教室', c.room || '—'],
      ['备注', c.note || '—']
    ];
    var html = '<div style="border-left:4px solid ' + colorFor(c) + ';padding-left:12px;margin-bottom:14px">' +
      '<div style="font-size:18px;font-weight:600">' + esc(c.name) + '</div>' +
      '<div style="color:var(--text-3);font-size:12px">' + esc(weeksText(c.weeks)) + '</div></div>' +
      '<div class="settings-list">';
    rows.slice(1).forEach(function (r) {
      html += '<div class="settings-row"><div class="label">' + esc(r[0]) + '</div><div style="color:var(--text-2);font-size:13px;text-align:right">' + esc(r[1]) + '</div></div>';
    });
    var f = flags()[c.id];
    if (f) {
      html += '<div class="warn-box"><b>⚠ 这条课程需要你确认</b><ul>' +
        f.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') +
        '</ul><div class="warn-hint">确认无误后点「确认无误」标记就会消失；直接编辑保存也会自动清除。</div></div>';
    }
    html += '</div><div class="row-btns" style="margin-top:16px">' +
      (f ? '<button class="btn" id="btnConfirmCourse">✓ 确认无误</button>' : '') +
      '<button class="btn primary" id="btnEditCourse">编辑</button>' +
      '<button class="btn danger" id="btnDelCourse">删除</button></div>';

    openSheet('课程详情', html, function () {
      var bc = $('#btnConfirmCourse');
      if (bc) bc.onclick = function () {
        c.confirmed = true;
        save(); closeSheet(); renderAll();
        toast('已确认，标记已去掉');
      };
      $('#btnEditCourse').onclick = function () { openEditor(c); };
      $('#btnDelCourse').onclick = function () {
        if (!confirm('确定删除「' + c.name + '」？')) return;
        state.courses = state.courses.filter(function (x) { return x.id !== c.id; });
        save(); closeSheet(); renderAll(); toast('已删除');
      };
    });
  }

  /* ---------------- 课程编辑 ---------------- */

  function openEditor(course) {
    var isNew = !course;
    var c = course || {
      id: uid(), name: '', teacher: '', room: '',
      day: state.day, start: 1, end: 2, weeks: null, note: ''
    };
    var ps = state.settings.periods;
    var maxP = ps.length;

    var dayOpts = '';
    for (var i = 1; i <= 7; i++) dayOpts += '<option value="' + i + '"' + (c.day === i ? ' selected' : '') + '>' + WD_FULL[i - 1] + '</option>';
    var pOpts = '';
    for (var p = 1; p <= maxP; p++) pOpts += '<option value="' + p + '">第 ' + p + ' 节</option>';

    var weeks = c.weeks || null;
    var from = weeks ? weeks[0] : 1;
    var to = weeks ? weeks[weeks.length - 1] : clamp(state.settings.totalWeeks || 16, 1, 40);
    var parity = 'all';
    if (weeks && weeks.length > 2) {
      if (weeks.every(function (w) { return w % 2 === 1; })) parity = 'odd';
      else if (weeks.every(function (w) { return w % 2 === 0; })) parity = 'even';
    }

    var html =
      '<div class="field"><label>课程名称 *</label><input class="input" id="f_name" maxlength="50" placeholder="例如：高等数学" value="' + esc(c.name) + '"></div>' +
      '<div class="grid-2"><div class="field"><label>教师</label><input class="input" id="f_teacher" maxlength="40" placeholder="选填" value="' + esc(c.teacher) + '"></div>' +
      '<div class="field"><label>教室</label><input class="input" id="f_room" maxlength="40" placeholder="选填" value="' + esc(c.room) + '"></div></div>' +
      '<div class="grid-3"><div class="field"><label>星期</label><select class="select" id="f_day">' + dayOpts + '</select></div>' +
      '<div class="field"><label>开始节次</label><select class="select" id="f_start">' + pOpts + '</select></div>' +
      '<div class="field"><label>结束节次</label><select class="select" id="f_end">' + pOpts + '</select></div></div>' +
      '<div class="field"><label>周次</label><select class="select" id="f_wmode">' +
      '<option value="all"' + (!weeks ? ' selected' : '') + '>每周都有</option>' +
      '<option value="range"' + (weeks ? ' selected' : '') + '>指定周次范围</option></select></div>' +
      '<div class="grid-3" id="f_weekbox" style="' + (weeks ? '' : 'display:none') + '">' +
      '<div class="field"><label>起始周</label><input class="input" id="f_from" type="number" min="1" max="40" value="' + from + '"></div>' +
      '<div class="field"><label>结束周</label><input class="input" id="f_to" type="number" min="1" max="40" value="' + to + '"></div>' +
      '<div class="field"><label>单双周</label><select class="select" id="f_parity">' +
      '<option value="all"' + (parity === 'all' ? ' selected' : '') + '>全部</option>' +
      '<option value="odd"' + (parity === 'odd' ? ' selected' : '') + '>单周</option>' +
      '<option value="even"' + (parity === 'even' ? ' selected' : '') + '>双周</option></select></div></div>' +
      '<div class="field"><label>备注</label><input class="input" id="f_note" maxlength="200" placeholder="选填，例如：带教材" value="' + esc(c.note) + '"></div>' +
      '<div class="row-btns"><button class="btn" id="btnCancel">取消</button><button class="btn primary" id="btnSave">保存</button></div>';

    openSheet(isNew ? '添加课程' : '编辑课程', html, function () {
      $('#f_start').value = c.start;
      $('#f_end').value = c.end;
      $('#f_wmode').onchange = function () {
        $('#f_weekbox').style.display = this.value === 'range' ? '' : 'none';
      };
      $('#btnCancel').onclick = closeSheet;
      $('#btnSave').onclick = function () {
        var name = $('#f_name').value.trim();
        if (!name) { toast('请填写课程名称'); $('#f_name').focus(); return; }
        var start = clamp(parseInt($('#f_start').value, 10) || 1, 1, maxP);
        var end = clamp(parseInt($('#f_end').value, 10) || start, 1, maxP);
        if (end < start) { var t = start; start = end; end = t; }
        var mode = $('#f_wmode').value;
        var wk = null;
        if (mode === 'range') {
          var a = clamp(parseInt($('#f_from').value, 10) || 1, 1, 40);
          var b = clamp(parseInt($('#f_to').value, 10) || a, 1, 40);
          if (b < a) { var q = a; a = b; b = q; }
          var par = $('#f_parity').value;
          var arr = [];
          for (var w = a; w <= b; w++) {
            if (par === 'odd' && w % 2 === 0) continue;
            if (par === 'even' && w % 2 === 1) continue;
            arr.push(w);
          }
          wk = arr;
        }
        var data = normalizeCourse({
          id: c.id,
          confirmed: true,
          name: name,
          teacher: $('#f_teacher').value,
          room: $('#f_room').value,
          day: parseInt($('#f_day').value, 10),
          start: start, end: end,
          weeks: wk,
          note: $('#f_note').value,
          color: c.color || null
        });
        var idx = -1;
        for (var i = 0; i < state.courses.length; i++) if (state.courses[i].id === data.id) idx = i;
        if (idx >= 0) state.courses[idx] = data;
        else state.courses.push(data);
        save(); closeSheet(); renderAll();
        toast(isNew ? '已添加' : '已保存');
      };
    });
  }

  /* ---------------- 导入 ---------------- */

  var BOOKMARKLET = "javascript:(function(){" +
    "var T=[].slice.call(document.querySelectorAll('table')),B=null,M=0;" +
    "T.forEach(function(t){var n=0;[].forEach.call(t.querySelectorAll('td,th'),function(c){var x=(c.innerText||c.textContent||'').replace(/\\s/g,'');if(/(星期|周|礼拜)[一二三四五六日天]/.test(x)&&x.length<12)n++;});if(n>M){M=n;B=t;}});" +
    "var h=B?B.outerHTML:'';" +
    "var ta=document.createElement('textarea');ta.value=h;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();" +
    "var ok=false;try{ok=document.execCommand('copy');}catch(e){}" +
    "ta.remove();" +
    "alert(B?('已复制课表表格（共'+M+'个星期表头），\\n打开课程表 App →「导入→粘贴导入」即可。'):'页面上没找到课表表格。\\n请用手机/电脑「另存为 HTML」再导入，或直接手动添加。');" +
    "})();";

  function importSheetHtml(tab) {
    var tabs = '<div class="import-tabs">' +
      '<button data-tab="pdf" class="' + (tab === 'pdf' ? 'on' : '') + '">PDF 课表</button>' +
      '<button data-tab="paste" class="' + (tab === 'paste' ? 'on' : '') + '">粘贴导入</button>' +
      '<button data-tab="file" class="' + (tab === 'file' ? 'on' : '') + '">文件导入</button>' +
      '<button data-tab="bookmark" class="' + (tab === 'bookmark' ? 'on' : '') + '">书签抓取</button>' +
      '</div>';

    var body = '';
    if (tab === 'pdf') {
      body =
        '<div class="tip"><b>用学校导出的课表 PDF 直接导入：</b><ol>' +
        '<li>在「学教一体化」里导出课表 PDF（手机或电脑导出都行）；</li>' +
        '<li>把 PDF 传到手机（微信/QQ 发给自己），点下面的「选择课表 PDF」；</li>' +
        '<li>解析完先核对预览，没问题再点「替换全部」。</li></ol>' +
        '<div style="margin-top:8px">PDF <b>只在这台设备上解析，不会上传</b>；课表按「每次上课」逐条导入，' +
        '所以每周看到的教师和地点都是当周真实的。</div></div>' +
        '<div class="row-btns" style="margin-top:14px"><button class="btn primary block" id="btnPickPdf">📄 选择课表 PDF</button></div>' +
        '<input type="file" id="pdfInput" accept="application/pdf,.pdf" class="sr">' +
        '<div id="previewBox"></div>';
    } else if (tab === 'paste') {
      body =
        '<div class="tip"><b>从教务系统 / 学教一体化复制课表：</b><ol>' +
        '<li>电脑上打开课表页面，选中整张课表（或整个页面）复制；</li>' +
        '<li>回到这里点「读取剪贴板」；</li>' +
        '<li>或者手动粘贴到下框再点「解析」。</li></ol></div>' +
        '<div class="row-btns" style="margin:12px 0"><button class="btn primary block" id="btnClip">📋 读取剪贴板并解析</button></div>' +
        '<div class="field"><label>或者在这里粘贴（网页 HTML / Excel 表格 / CSV 都行）</label>' +
        '<textarea class="textarea" id="importText" placeholder="把课表内容粘贴到这里…"></textarea></div>' +
        '<div class="row-btns"><button class="btn block" id="btnParse">解析</button></div>' +
        '<div id="previewBox"></div>';
    } else if (tab === 'file') {
      body =
        '<div class="tip"><b>支持文件：</b>' + '<span class="chip">.pdf 课表</span><span class="chip">.html</span><span class="chip">.htm</span><span class="chip">.csv</span><span class="chip">.tsv</span><span class="chip">.txt</span><span class="chip">.json（备份）</span>' +
        '<div style="margin-top:8px">课表 PDF 直接选进来即可（会自动走 PDF 解析）；网页最稳的办法是按 <b>Ctrl+S 另存为「网页，仅 HTML」</b>。</div>' +
        '<div style="margin-top:6px">Excel 的 .xlsx 不直接支持 —— 在 Excel 里全选复制，用「粘贴导入」即可。</div></div>' +
        '<div class="row-btns" style="margin-top:14px"><button class="btn primary block" id="btnPick">选择文件</button></div>' +
        '<input type="file" id="fileInput" accept=".pdf,.html,.htm,.txt,.csv,.tsv,.json,.xls,.xlsx" class="sr">' +
        '<div id="previewBox"></div>';
    } else {
      body =
        '<div class="tip"><b>一键抓取（推荐，最省事）：</b><ol>' +
        '<li>把下面这段代码存成书签（或直接复制）；</li>' +
        '<li>在课表页面地址栏/书签栏运行它；</li>' +
        '<li>它会复制课表表格 → 回来用「粘贴导入」。</li></ol>' +
        '<div style="margin-top:8px;color:var(--text-3)">手机浏览器一般不支持书签脚本，手机上建议用「文件导入」或直接手动录入。</div></div>' +
        '<div class="field" style="margin-top:12px"><label>书签脚本</label>' +
        '<textarea class="textarea" id="bmText" rows="6" readonly style="font-size:10px;min-height:110px">' + esc(BOOKMARKLET) + '</textarea></div>' +
        '<div class="row-btns"><button class="btn primary block" id="btnCopyBm">复制书签脚本</button></div>';
    }

    return tabs + body +
      '<div class="row-btns" style="margin-top:18px"><button class="btn block" id="btnManual">＋ 手动添加一节课</button></div>';
  }

  /** 解析 PDF 文件并出预览 */
  function parsePdfFile(file, box) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name || '') && file.type !== 'application/pdf') {
      box.innerHTML = '<div class="tip" style="margin-top:14px;border:1px solid var(--danger)">请选择 .pdf 文件</div>';
      return;
    }
    if (!window.CourseTablePdf) {
      box.innerHTML = '<div class="tip" style="margin-top:14px;border:1px solid var(--danger)">PDF 模块没加载（页面不完整）</div>';
      return;
    }
    box.innerHTML = '<div class="tip" style="margin-top:14px">正在解析 PDF（' + esc((file.size / 1024).toFixed(0)) + ' KB）…</div>';
    var reader = new FileReader();
    reader.onload = function () {
      window.CourseTablePdf.parse(reader.result).then(function (res) {
        if (!res.ok) {
          box.innerHTML = '<div class="tip" style="margin-top:14px;border:1px solid var(--danger)"><b>没解析出来：</b>' +
            esc(res.reason || '未知原因') +
            '<div style="margin-top:6px">可以试试：<br>1. 确认是教务系统导出的<b>矢量 PDF</b>（能选中文字），不是拍照/扫描件；<br>2. 改用「粘贴导入」或手动添加。</div></div>';
          return;
        }
        var html = '<div class="tip" style="margin-top:14px"><b>从 PDF 解析到 ' + res.courses.length + ' 条上课记录</b>' +
          '<span style="color:var(--text-3)">（' + res.pageCount + ' 页，按每次上课逐条）</span>' +
          '<div style="margin-top:6px">请核对：导入后每周看到的教师/地点是当周真实的。</div></div>' +
          '<div class="preview-list">';
        var byDay = ['一', '二', '三', '四', '五', '六', '日'];
        res.courses.slice(0, 80).forEach(function (c) {
          html += '<div class="preview-item"><div class="pday">周' + byDay[c.day - 1] + '<br><span style="font-size:10px">' + c.start + '-' + c.end + '节</span></div>' +
            '<div><div class="pname">' + esc(c.name) + '</div><div class="pmeta">' +
            esc([c.teacher, c.room, c.weeks.length > 6 ? ('共' + c.weeks.length + '周') : (c.weeks.map(function (w) { return w + '周'; }).join(','))].filter(Boolean).join(' · ')) +
            '</div></div><div class="pmeta">' + (c.weeks[0] || '') + '</div></div>';
        });
        html += '</div>';
        if (res.courses.length > 80) {
          html += '<div class="pmeta" style="padding:6px">… 还有 ' + (res.courses.length - 80) + ' 条</div>';
        }
        html += '<div class="row-btns" style="margin-top:14px">' +
          '<button class="btn" id="btnAppend">追加合并</button>' +
          '<button class="btn primary" id="btnReplace">替换全部</button></div>';
        box.innerHTML = html;
        lastImport = res.courses.map(function (c) {
          return {
            name: c.name, teacher: c.teacher, room: c.room, day: c.day,
            start: c.start, end: c.end, weeks: c.weeks, note: c.note
          };
        });
        $('#btnReplace', box).onclick = function () { applyImport(lastImport, true); };
        $('#btnAppend', box).onclick = function () { applyImport(lastImport, false); };
      }).catch(function (err) {
        box.innerHTML = '<div class="tip" style="margin-top:14px;border:1px solid var(--danger)"><b>PDF 解析失败：</b>' +
          esc(String(err && err.message || err)) +
          '<div style="margin-top:6px">老版本浏览器可能不支持 PDF 解压，试试更新系统浏览器，或改用「粘贴导入」。</div></div>';
      });
    };
    reader.onerror = function () {
      box.innerHTML = '<div class="tip" style="margin-top:14px;border:1px solid var(--danger)">读取文件失败</div>';
    };
    reader.readAsArrayBuffer(file);
  }

  function openImport(tab) {
    tab = tab || 'pdf';
    openSheet('导入课表', importSheetHtml(tab), function (body) {
      $all('.import-tabs button', body).forEach(function (b) {
        b.onclick = function () { openImport(b.dataset.tab); };
      });
      var manual = $('#btnManual', body);
      if (manual) manual.onclick = function () { closeSheet(); setTimeout(function () { openEditor(null); }, 300); };

      var clip = $('#btnClip', body);
      if (clip) clip.onclick = async function () {
        clip.disabled = true;
        clip.textContent = '读取中…';
        var got = await readClipboard();
        clip.disabled = false;
        clip.textContent = '📋 读取剪贴板并解析';
        if (!got) { toast('读不到剪贴板，请手动粘贴'); return; }
        var content = got.html || got.text || '';
        if (got.html) { $('#importText', body).value = got.html; }
        else { $('#importText', body).value = content; }
        parseAndPreview(content, body);
      };

      var parseBtn = $('#btnParse', body);
      if (parseBtn) parseBtn.onclick = function () {
        parseAndPreview($('#importText', body).value, body);
      };

      // PDF 课表
      var pickPdf = $('#btnPickPdf', body);
      var pdfIn = $('#pdfInput', body);
      if (pickPdf && pdfIn) {
        pickPdf.onclick = function () { pdfIn.click(); };
        pdfIn.onchange = function () {
          var f = pdfIn.files && pdfIn.files[0];
          if (f) parsePdfFile(f, $('#previewBox', body));
        };
      }

      var pick = $('#btnPick', body);
      if (pick) pick.onclick = function () { $('#fileInput', body).click(); };
      var fi = $('#fileInput', body);
      if (fi) fi.onchange = function () {
        var f = fi.files && fi.files[0];
        if (!f) return;
        if (/\.pdf$/i.test(f.name)) { parsePdfFile(f, $('#previewBox', body)); return; }
        if (/\.(xlsx|xls)$/i.test(f.name)) { toast('xlsx 请先在 Excel 里全选复制，用「粘贴导入」'); return; }
        var reader = new FileReader();
        reader.onload = function () {
          var text = String(reader.result || '');
          if (/\.json$/i.test(f.name)) { importJsonText(text); return; }
          parseAndPreview(text, body);
        };
        reader.readAsText(f, 'utf-8');
      };

      var copyBm = $('#btnCopyBm', body);
      if (copyBm) copyBm.onclick = async function () {
        var ok = await copyText(BOOKMARKLET);
        toast(ok ? '已复制，去课表页面运行' : '复制失败，请手动全选复制');
      };
    });
  }

  function parseAndPreview(content, root) {
    var box = $('#previewBox', root) || $('#previewBox');
    if (!content || !content.trim()) { toast('内容是空的'); return; }
    var res;
    if (/^\s*[\[{]/.test(content)) {
      var json = tryParseJson(content);
      if (json) { importJsonText(content); return; }
    }
    res = P.autoParse(content);
    if (!res.ok) {
      box.innerHTML = '<div class="tip" style="margin-top:14px;border:1px solid var(--danger)"><b>没解析出来：</b>' + esc(res.reason || '未知原因') +
        '<div style="margin-top:6px">可以试试：<br>1. 用书签抓取；<br>2. 课表页面「另存为 HTML」后文件导入；<br>3. 手动添加。</div></div>';
      return;
    }
    lastImport = res.courses;
    var html = '<div class="tip" style="margin-top:14px"><b>解析到 ' + res.courses.length + ' 门课</b>' +
      '<span style="color:var(--text-3)">（请在课表里核对一下周次/节次）</span></div>' +
      '<div class="preview-list">';
    res.courses.slice(0, 60).forEach(function (c) {
      var t = slotTime(c.start, c.end);
      html += '<div class="preview-item"><div class="pday">' + WD_FULL[c.day - 1] + '<br><span style="font-size:10px">' + c.start + '-' + c.end + '节</span></div>' +
        '<div><div class="pname">' + esc(c.name) + '</div><div class="pmeta">' + esc([c.teacher, c.room, weeksText(c.weeks)].filter(Boolean).join(' · ')) + '</div></div>' +
        '<div class="pmeta">' + t.a + '</div></div>';
    });
    html += '</div>' + (res.courses.length > 60 ? '<div class="pmeta" style="padding:6px">… 还有 ' + (res.courses.length - 60) + ' 门</div>' : '');
    html += '<div class="row-btns" style="margin-top:14px"><button class="btn" id="btnAppend">追加合并</button>' +
      '<button class="btn primary" id="btnReplace">替换全部</button></div>';
    box.innerHTML = html;

    $('#btnReplace', box).onclick = function () { applyImport(lastImport, true); };
    $('#btnAppend', box).onclick = function () { applyImport(lastImport, false); };
  }

  var lastImport = null;

  function applyImport(courses, replace) {
    if (!courses || !courses.length) return;
    var list = courses.map(function (c) {
      return normalizeCourse({
        name: c.name, teacher: c.teacher, room: c.room,
        day: c.day, start: c.start, end: c.end, weeks: c.weeks, note: c.note
      });
    }).filter(Boolean);
    if (!list.length) { toast('没有可导入的课程'); return; }

    if (replace) {
      state.courses = list;
    } else {
      var seen = {};
      state.courses.forEach(function (c) {
        seen[[c.name, c.day, c.start, c.end, c.room].join('|')] = 1;
      });
      list.forEach(function (c) {
        var k = [c.name, c.day, c.start, c.end, c.room].join('|');
        if (!seen[k]) { seen[k] = 1; state.courses.push(c); }
      });
    }
    save();
    closeSheet();
    // 导入后跳到有课的第一天，方便核对
    var first = state.courses.slice().sort(function (a, b) { return a.day - b.day || a.start - b.start; })[0];
    if (first) state.day = first.day;
    state.week = clamp(currentWeekNo(), 1, state.settings.totalWeeks);
    renderAll();
    var needReview = flagCount();
    toast('已导入 ' + list.length + ' 门课' + (needReview ? '，' + needReview + ' 条待确认' : ''));
  }

  function tryParseJson(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  function importJsonText(text) {
    var data = tryParseJson(text);
    if (!data) { toast('JSON 格式不对'); return; }
    var arr = Array.isArray(data) ? data : (Array.isArray(data.courses) ? data.courses : null);
    if (!arr) { toast('这份 JSON 里没有 courses 字段'); return; }
    lastImport = arr;
    var box = $('#previewBox');
    if (box) {
      parseAndPreviewFromList(arr, box);
    } else {
      applyImport(arr, false);
    }
  }

  function parseAndPreviewFromList(arr, box) {
    var list = arr.map(function (c) { return normalizeCourse(c); }).filter(Boolean);
    if (!list.length) { toast('JSON 里没有有效课程'); return; }
    lastImport = list;
    var html = '<div class="tip" style="margin-top:14px"><b>备份文件里有 ' + list.length + ' 门课</b></div><div class="preview-list">';
    list.slice(0, 60).forEach(function (c) {
      html += '<div class="preview-item"><div class="pday">' + WD_FULL[c.day - 1] + '</div>' +
        '<div><div class="pname">' + esc(c.name) + '</div><div class="pmeta">' + esc([c.teacher, c.room, weeksText(c.weeks)].filter(Boolean).join(' · ')) + '</div></div>' +
        '<div class="pmeta">' + c.start + '-' + c.end + '</div></div>';
    });
    html += '</div><div class="row-btns" style="margin-top:14px"><button class="btn" id="btnAppend">追加合并</button>' +
      '<button class="btn primary" id="btnReplace">替换全部</button></div>';
    box.innerHTML = html;
    $('#btnReplace', box).onclick = function () { applyImport(lastImport, true); };
    $('#btnAppend', box).onclick = function () { applyImport(lastImport, false); };
  }

  /** 待确认课程列表：逐条查看 / 确认 */
  function openReviewList() {
    var f = flags();
    var ids = Object.keys(f);
    if (!ids.length) { toast('没有待确认的课程'); return; }
    var html = '<div class="tip">这些课程可能是解析错位、信息缺失或时间冲突。点进去核对：' +
      '内容对就点「确认无误」，不对就点「编辑」改掉（改完也会自动去掉标记）。</div><div class="preview-list">';
    ids.forEach(function (id) {
      var c = findCourse(id);
      if (!c) return;
      html += '<div class="preview-item" data-id="' + id + '">' +
        '<div class="pday">' + WD_FULL[c.day - 1] + '<br><span style="font-size:10px">' + c.start + '-' + c.end + '节</span></div>' +
        '<div><div class="pname">' + esc(c.name) + '</div><div class="pmeta">' + esc(f[id].reasons.join('；')) + '</div></div>' +
        '<div class="pmeta">查看</div></div>';
    });
    html += '</div>';
    openSheet('待确认课程（' + ids.length + '）', html, function (body) {
      $all('.preview-item', body).forEach(function (item) {
        item.onclick = function () {
          closeSheet();
          setTimeout(function () { openCourseDetail(item.dataset.id); }, 260);
        };
      });
    });
  }

  /* ---------------- 剪贴板 ---------------- */

  async function readClipboard() {
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        var items = await navigator.clipboard.read();
        for (var i = 0; i < items.length; i++) {
          if (items[i].types.indexOf('text/html') >= 0) {
            var blob = await items[i].getType('text/html');
            return { html: await blob.text() };
          }
        }
        for (var j = 0; j < items.length; j++) {
          if (items[j].types.indexOf('text/plain') >= 0) {
            var b2 = await items[j].getType('text/plain');
            return { text: await b2.text() };
          }
        }
      }
    } catch (e) { /* 走兜底 */ }
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        return { text: await navigator.clipboard.readText() };
      }
    } catch (e2) { /* ignore */ }
    return null;
  }

  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return legacyCopy(text); });
      }
    } catch (e) { /* ignore */ }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  /* ---------------- 设置 ---------------- */

  function openSettings() {
    var s = state.settings;
    var periodRows = '';
    s.periods.forEach(function (p, i) {
      periodRows += '<div class="period-row"><div class="pn">' + (i + 1) + '</div>' +
        '<input class="input" data-p="s" data-i="' + i + '" value="' + esc(p.s) + '" inputmode="numeric" placeholder="08:00">' +
        '<div class="pn">–</div>' +
        '<input class="input" data-p="e" data-i="' + i + '" value="' + esc(p.e) + '" inputmode="numeric" placeholder="08:45"></div>';
    });

    var html =
      '<div class="field"><label>课程表标题</label><input class="input" id="s_title" maxlength="20" value="' + esc(s.title) + '"></div>' +
      '<div class="field"><label>第 1 周的周一</label><input class="input" id="s_start" type="date" value="' + esc(s.termStart) + '">' +
      '<div class="hint">用来算「当前第几周」。默认是本周一，点下面按钮可改成这周一。</div>' +
      '<div class="row-btns" style="margin-top:8px"><button class="btn sm" id="btnThisMonday">设为本周一</button></div></div>' +
      '<div class="field"><label>学期总周数</label><input class="input" id="s_total" type="number" min="1" max="40" value="' + s.totalWeeks + '"></div>' +
      '<div class="field"><label>每节课时间</label><div id="periodBox">' + periodRows + '</div>' +
      '<div class="hint">只影响显示，不影响课表本身。改了记得保存。</div></div>' +
      '<div class="row-btns"><button class="btn" id="btnAddPeriod">＋ 加一节课</button><button class="btn" id="btnDelPeriod">－ 减一节</button></div>' +
      '<div style="height:18px"></div>' +
      '<div class="settings-row"><div><div class="label">待确认的课程</div><div class="desc">解析可疑或时间冲突，需要你核对</div></div>' +
      '<button class="btn sm' + (flagCount() ? ' danger' : '') + '" id="btnReview">' + (flagCount() ? flagCount() + ' 条' : '无') + '</button></div>' +
      '<div class="settings-row"><div><div class="label">导出备份</div><div class="desc">存成 .json 文件，换手机/重装可恢复</div></div>' +
      '<button class="btn sm" id="btnExport">导出</button></div>' +
      '<div class="settings-row"><div><div class="label">复制备份到剪贴板</div><div class="desc">方便发给自己微信收藏</div></div>' +
      '<button class="btn sm" id="btnCopyJson">复制</button></div>' +
      '<div class="settings-row"><div><div class="label">清空所有课程</div><div class="desc">只清课程，设置保留</div></div>' +
      '<button class="btn sm danger" id="btnClear">清空</button></div>' +
      '<div class="row-btns" style="margin-top:16px"><button class="btn primary block" id="btnSaveSettings">保存设置</button></div>' +
      '<div class="tip" style="margin-top:18px">' +
      '<b>数据只存在这台设备的浏览器里</b>（不上传任何服务器）。' +
      (storeOk ? '' : '<br><span style="color:var(--danger)">⚠ 当前浏览器禁止了本地存储，关掉页面数据会丢，请用「导出备份」。</span>') +
      '<br>版本 v' + APP_VERSION +
      '</div>';

    openSheet('设置', html, function (body) {
      $('#btnThisMonday', body).onclick = function () {
        $('#s_start', body).value = ymd(mondayOf(new Date()));
        toast('已设为本周一，记得保存');
      };
      $('#btnAddPeriod', body).onclick = function () {
        var n = $all('.period-row', body).length + 1;
        if (n > 20) return;
        var last = state.settings.periods[state.settings.periods.length - 1] || { s: '08:00', e: '08:45' };
        var box = $('#periodBox', body);
        var div = document.createElement('div');
        div.className = 'period-row';
        div.innerHTML = '<div class="pn">' + n + '</div>' +
          '<input class="input" data-p="s" data-i="' + (n - 1) + '" value="' + last.s + '" inputmode="numeric">' +
          '<div class="pn">–</div>' +
          '<input class="input" data-p="e" data-i="' + (n - 1) + '" value="' + last.e + '" inputmode="numeric">';
        box.appendChild(div);
      };
      $('#btnDelPeriod', body).onclick = function () {
        var rows = $all('.period-row', body);
        if (rows.length <= 1) return;
        rows[rows.length - 1].remove();
      };
      $('#btnReview', body).onclick = function () { closeSheet(); setTimeout(openReviewList, 260); };
      $('#btnExport', body).onclick = exportFile;
      $('#btnCopyJson', body).onclick = async function () {
        var ok = await copyText(buildJson());
        toast(ok ? '已复制备份 JSON' : '复制失败');
      };
      $('#btnClear', body).onclick = function () {
        if (!confirm('确定清空所有课程？此操作不可撤销。')) return;
        state.courses = [];
        save(); closeSheet(); renderAll(); toast('已清空');
      };
      $('#btnSaveSettings', body).onclick = function () {
        var title = $('#s_title', body).value.trim() || '我的课程表';
        var st = $('#s_start', body).value;
        var total = clamp(parseInt($('#s_total', body).value, 10) || 20, 1, 40);
        var periods = [];
        $all('.period-row', body).forEach(function (row, i) {
          var ins = $all('input', row);
          var a = ins[0] ? ins[0].value.trim() : '';
          var b = ins[1] ? ins[1].value.trim() : '';
          periods.push({
            n: i + 1,
            s: /^\d{1,2}:\d{2}$/.test(a) ? a : '08:00',
            e: /^\d{1,2}:\d{2}$/.test(b) ? b : '08:45'
          });
        });
        state.settings = {
          title: title,
          termStart: parseYmd(st) ? st : ymd(mondayOf(new Date())),
          totalWeeks: total,
          periods: periods.length ? periods : defaultSettings().periods
        };
        state.week = clamp(state.week, 1, total);
        save(); closeSheet(); renderAll(); toast('设置已保存');
      };
    });
  }

  function buildJson() {
    return JSON.stringify({
      app: 'coursetable',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      courses: state.courses
    }, null, 2);
  }

  function exportFile() {
    try {
      var blob = new Blob([buildJson()], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var d = new Date();
      a.href = url;
      a.download = '课程表备份-' + ymd(d) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
      toast('已导出备份文件');
    } catch (e) {
      toast('导出失败，试试「复制备份」');
    }
  }

  /* ---------------- 示例数据 ---------------- */

  function demoCourses() {
    var raw = [
      ['高等数学', '张三', 'A101', 1, 1, 2, 1, 16, 'all'],
      ['大学英语', '李四', 'B203', 1, 3, 4, 1, 16, 'all'],
      ['数据结构', '孙老师', 'C402', 2, 3, 4, 1, 16, 'all'],
      ['高等数学', '张三', 'A101', 3, 1, 2, 1, 16, 'all'],
      ['体育', '王五', '体育馆', 3, 5, 6, 2, 16, 'even'],
      ['大学物理', '赵六', '实验楼201', 4, 1, 2, 1, 16, 'all'],
      ['程序设计基础', '孙老师', '机房301', 4, 5, 6, 1, 8, 'all'],
      ['大学英语', '李四', 'B203', 5, 3, 4, 1, 16, 'all'],
      ['马克思主义基本原理', '周七', 'D101', 5, 7, 8, 1, 16, 'all']
    ];
    return raw.map(function (r) {
      // r = [课程名, 教师, 教室, 星期, 开始节, 结束节, 起始周, 结束周, 单双周]
      var weeks = [];
      for (var w = r[6]; w <= r[7]; w++) {
        if (r[8] === 'odd' && w % 2 === 0) continue;
        if (r[8] === 'even' && w % 2 === 1) continue;
        weeks.push(w);
      }
      return normalizeCourse({
        name: r[0], teacher: r[1], room: r[2], day: r[3],
        start: r[4], end: r[5], weeks: weeks
      });
    }).filter(Boolean);
  }

  function seedDemo() {
    state.courses = demoCourses();
    save();
    state.day = 1;
    state.week = clamp(currentWeekNo(), 1, state.settings.totalWeeks);
    renderAll();
  }

  /* ---------------- 手势 / 事件 ---------------- */

  function bindSwipe() {
    var main = $('#main');
    var sx = 0, sy = 0, tracking = false;
    main.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { tracking = false; return; }
      tracking = true;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    main.addEventListener('touchend', function (e) {
      if (!tracking) return;
      tracking = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      if (state.view === 'day') {
        var nd = state.day + (dx < 0 ? 1 : -1);
        if (nd < 1) { changeWeek(-1); nd = 7; }
        else if (nd > 7) { changeWeek(1); nd = 1; }
        state.day = nd;
        renderAll();
      } else {
        changeWeek(dx < 0 ? 1 : -1);
      }
    }, { passive: true });
  }

  function changeWeek(delta) {
    var w = state.week + delta;
    var maxW = Math.max(state.settings.totalWeeks, currentWeekNo(), 1);
    if (w < 1) w = 1;
    if (w > maxW) w = maxW;
    if (w === state.week) { toast(delta > 0 ? '已经是最后一周' : '已经是第一周'); return; }
    state.week = w;
    renderAll();
  }

  function bind() {
    $('#btnPrevWeek').onclick = function () { changeWeek(-1); };
    $('#btnNextWeek').onclick = function () { changeWeek(1); };
    $('#btnWeekLabel').onclick = gotoToday;
    $('#btnImport').onclick = function () { openImport('pdf'); };
    $('#btnSettings').onclick = openSettings;
    $('#btnToday').onclick = gotoToday;
    $('#mask').onclick = closeSheet;
    $all('.tab[data-view]').forEach(function (b) {
      b.onclick = function () { switchView(b.dataset.view); };
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSheet();
    });
    bindSwipe();
  }

  function gotoToday() {
    state.week = clamp(currentWeekNo(), 1, Math.max(state.settings.totalWeeks, currentWeekNo()));
    state.day = ((new Date().getDay() + 6) % 7) + 1;
    renderAll();
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
        // 每次打开都主动检查一次 SW 更新，避免停留在旧缓存
        if (reg && reg.update) reg.update().catch(function () {});
      }).catch(function () { /* 忽略 */ });
    });
  }

  /** 检查线上版本：发现更新就提示刷新（彻底解决"打开还是旧版"） */
  function checkNewVersion() {
    if (!/^https?:$/.test(location.protocol)) return;
    fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.version || j.version === APP_VERSION) return;
        showUpdateBar(j.version);
      })
      .catch(function () {});
  }

  function showUpdateBar(ver) {
    if ($('#updateBar')) return;
    var bar = document.createElement('div');
    bar.id = 'updateBar';
    bar.className = 'update-bar';
    bar.innerHTML = '<span>有新版本 v' + esc(ver) + '</span><button id="btnDoUpdate">立即刷新</button>';
    document.body.appendChild(bar);
    $('#btnDoUpdate').onclick = function () {
      var done = function () { location.reload(); };
      try {
        if (window.caches && caches.keys) {
          caches.keys().then(function (ks) {
            return Promise.all(ks.map(function (k) { return caches.delete(k); }));
          }).then(done, done);
        } else done();
      } catch (e) { done(); }
    };
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    load();
    var cw = currentWeekNo();
    state.week = clamp(cw, 1, Math.max(state.settings.totalWeeks, cw));
    state.day = ((new Date().getDay() + 6) % 7) + 1;
    bind();
    // ?demo=1 演示模式（也用于自动化验证）
    try {
      if (new URLSearchParams(location.search).get('demo') === '1' && !state.courses.length) {
        state.courses = demoCourses();
        save();
        state.day = 1;
      }
    } catch (e) { /* ignore */ }
    renderAll();
    registerSW();
    checkNewVersion();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') checkNewVersion();
    });
    if (!storeOk) {
      setTimeout(function () { toast('浏览器禁止本地存储，数据可能丢失，请用设置里的导出备份'); }, 800);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // 暴露给调试 / 单文件构建
  window.CourseTableApp = {
    state: state,
    render: renderAll,
    openImport: openImport,
    openSettings: openSettings,
    openEditor: openEditor,
    openCourseDetail: openCourseDetail,
    seedDemo: seedDemo,
    flags: flags,
    flagCount: flagCount,
    openReviewList: openReviewList,
    demoCourses: demoCourses,
    applyImport: applyImport,
    buildJson: buildJson,
    weeksText: weeksText,
    save: save,
    parser: P
  };
})();
