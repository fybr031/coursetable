/*!
 * 课程表解析引擎 CourseParser v1.0
 * 无依赖，同时适用于浏览器与 Node。
 * 能力：
 *   1. 课表网面 HTML -> 课程（自动找最像课表的 <table>，处理 rowspan/colspan）
 *   2. Excel / 网页复制的制表符文本(TSV) -> 课程
 *   3. CSV -> 课程
 *   4. 纯文本兜底解析
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CourseParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ============================ 基础工具 ============================ */

  var CN_NUM = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '十一': 11, '十二': 12 };
  var WD_CN = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7, '七': 7 };
  var WD_EN = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

  function toHalfWidth(s) {
    return s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    });
  }

  /** 归一化文本：全角转半角、统一换行、压缩空白、去掉不可见字符（保留制表符） */
  function normText(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/\u00a0|\u3000/g, ' ')
      .replace(/\u200b|\ufeff/g, '')
      .replace(/[０-９Ａ-Ｚａ-ｚ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[（【]/g, '(')
      .replace(/[）】]/g, ')')
      .replace(/[－—–―]/g, '-')
      .replace(/～/g, '~')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(function (line) {
        return line
          .replace(/^[ \t]+|[ \t]+$/g, '')   // 行首行尾空白
          .replace(/ {2,}/g, ' ');           // 压缩连续空格，但保留 \t
      })
      .join('\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  function cnNum(str) {
    if (!str) return 0;
    if (/^\d+$/.test(str)) return parseInt(str, 10);
    return CN_NUM[str] || 0;
  }

  function uniq(arr) {
    var seen = {}, out = [];
    arr.forEach(function (v) { if (v != null && !seen[v]) { seen[v] = 1; out.push(v); } });
    return out;
  }

  /* ============================ 字段解析 ============================ */

  /** 从文本中识别星期几，1=周一 ... 7=周日 */
  function weekdayFromText(text) {
    var s = normText(text).replace(/\s+/g, '');
    if (!s || s.length > 24) return 0;
    var m = s.match(/(?:星期|周|礼拜)([一二三四五六日天])/);
    if (m) return WD_CN[m[1]];
    m = s.match(/^(mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?$/i);
    if (m) return WD_EN[m[1].slice(0, 3).toLowerCase()];
    return 0;
  }

  /** 解析节次，返回 {start, end} */
  function parseSlots(text) {
    var s = normText(text).replace(/\s+/g, '');
    if (!s) return null;
    var m = s.match(/第?(\d{1,2})(?:[-,、~至](\d{1,2}))?节/);
    if (m) return { start: +m[1], end: +(m[2] || m[1]) };
    m = s.match(/^(\d{1,2})(?:[-,~](\d{1,2}))?$/);
    if (m) return { start: +m[1], end: +(m[2] || m[1]) };
    m = s.match(/第?([一二三四五六七八九十]{1,3})节/);
    if (m) { var n = cnNum(m[1]); if (n) return { start: n, end: n }; }
    return null;
  }

  /** 解析周次，返回 {weeks:[...], parity:'all'|'odd'|'even', raw} 或 null */
  function parseWeeks(text) {
    var s = normText(text).replace(/\s+/g, '');
    if (!s || s.indexOf('周') < 0) return null;
    var parity = 'all';
    // 只有「单/双」紧跟周次时才算单双周，避免课程名里的「单」「双」误伤
    if (/[单双]\s*周/.test(s) || /周\s*[(]?\s*[单双]\s*[)]?/.test(s)) {
      parity = /双\s*周/.test(s) || /周\s*[(]?\s*双/.test(s) ? 'even' : 'odd';
    }

    var weeks = [];
    // 取出所有 “…周” 前面的那段（可能是 1-16 / 1,3,5 / 3 / 1-8,10-16）
    var re = /(\d{1,2}(?:\s*[-~至]\s*\d{1,2})?(?:\s*[,、]\s*\d{1,2}(?:\s*[-~至]\s*\d{1,2})?)*)\s*[单双]?\s*周/g;
    var m, hit = false;
    while ((m = re.exec(s))) {
      hit = true;
      m[1].split(/[,、]/).forEach(function (seg) {
        var r = seg.split(/[-~至]/);
        var a = parseInt(r[0], 10);
        var b = parseInt(r[1], 10);
        if (isNaN(a)) return;
        if (isNaN(b)) b = a;
        if (b < a) { var t = a; a = b; b = t; }
        for (var i = a; i <= b && i <= 60; i++) weeks.push(i);
      });
    }
    if (!hit) {
      // “第3周” 之类已被覆盖；“全周/每周” 无数字
      return null;
    }
    weeks = uniq(weeks).sort(function (a, b) { return a - b; });
    if (parity === 'odd') weeks = weeks.filter(function (w) { return w % 2 === 1; });
    if (parity === 'even') weeks = weeks.filter(function (w) { return w % 2 === 0; });
    if (!weeks.length) return null;
    return { weeks: weeks, parity: parity, raw: normText(text) };
  }

  /** 教室/地点识别 */
  function looksLikeRoom(t) {
    var s = normText(t).replace(/\s+/g, '');
    if (!s || s.length > 30) return false;
    if (/(楼|教室|机房|实验|实训|报告厅|阶梯|语音|体育馆|操场|馆|室|lab|Lab|LAB|中心|基地)/.test(s)) return true;
    if (/^[A-Za-z]{1,2}\d{2,4}[A-Za-z]?$/.test(s)) return true;          // A101 / B203
    if (/^[A-Za-z]?\d{1,2}[-#]\d{2,4}(-\d{1,3})?$/.test(s)) return true; // 3-201 / 1#305
    if (/^[A-Za-z]{2,6}\d{2,4}$/.test(s)) return true;                    // JX0301
    return false;
  }

  /** 教师名识别（弱判断，仅作兜底） */
  function looksLikeTeacher(t) {
    var s = normText(t).replace(/\s+/g, '');
    if (!s || s.length > 20) return false;
    if (/\d/.test(s)) return false;
    if (/[周节室楼馆课学导论（(]/.test(s)) return false;
    if (/^(星期一|星期二|星期三|星期四|星期五|星期六|星期日|周一|周二|周三|周四|周五|周六|周日)$/.test(s)) return false;
    return /^[\u4e00-\u9fa5]{2,4}$/.test(s) || /^[\u4e00-\u9fa5]{2,4}(、[\u4e00-\u9fa5]{2,4})+$/.test(s) || /^[A-Za-z][A-Za-z. ]{1,24}$/.test(s) || /^[\u4e00-\u9fa5]{2,4}(老师|教师)$/.test(s);
  }

  /** 判断一个词是不是教室/地点（含数字的基本都是） */
  function isRoomToken(t) {
    var s = normText(t).replace(/\s+/g, '');
    if (!s || s.length > 24) return false;
    if (/周|节/.test(s)) return false;
    if (looksLikeRoom(s)) return true;
    if (/\d/.test(s) && !/^[\u4e00-\u9fa5]{2,}$/.test(s)) return true;
    return false;
  }

  function stripParensAboutWeeks(line) {
    return line.replace(/[(（][^()（）]*周[^()（）]*[)）]/g, '').trim();
  }

  /** 清洗课程名：去掉学年、学期、括号标记、周次、节次、时间等噪音 */
  function cleanName(line) {
    var s = stripParensAboutWeeks(normText(line));
    s = s
      .replace(/^\d{4}\s*[-~]\s*\d{4}\s*学年(度)?/, '')
      .replace(/^第[一二三四五六七八九十\d]+\s*学期/, '')
      .replace(/^\d{1,2}(?:\s*[-~至,、]\s*\d{1,2})*\s*[单双]?\s*周/, '')
      .replace(/^[(（\[【][^)）\]】]{0,20}[)）\]】]/, '')
      .replace(/\d{1,2}(?:\s*[-~至,、]\s*\d{1,2})*\s*[单双]?\s*周/g, '')
      .replace(/第?\d{1,2}(?:[-,、~至]\d{1,2})?节/g, '')
      .replace(/\d{1,2}:\d{2}\s*[-~]\s*\d{1,2}:\d{2}/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return s.replace(/^[\s,，;；、]+|[\s,，;；、]+$/g, '');
  }

  /**
   * 把一个单元格文本拆成课程对象字段
   * 典型内容：
   *   高等数学\n张老师\n1-16周\nA101
   *   大学英语(1-16周) 王老师 B203
   *   体育\n1-16周(单)
   * 规则：第一个有效行/词 = 课程名，其余按「含数字=教室」「2-4汉字=教师」分类，剩下的进备注。
   */
  function splitCellText(text) {
    var raw = normText(text);
    if (!raw) return null;

    var weeks = parseWeeks(raw);
    var slots = parseSlots(raw);
    var room = null;
    var teacher = null;
    var note = '';
    var name = '';

    var lines = raw.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);

    if (lines.length === 1) {
      // 单行：先把 周次 / 节次 / 时间 片段抠掉，剩下的按空白切词
      var rest = lines[0]
        .replace(/[(（][^()（）]*周[^()（）]*[)）]/g, ' ')
        .replace(/\d{1,2}(?:\s*[-~至,、]\s*\d{1,2})*\s*[单双]?\s*周[^,，;；\s]*/g, ' ')
        .replace(/第?\d{1,2}(?:[-,、~至]\d{1,2})?节/g, ' ')
        .replace(/\d{1,2}:\d{2}\s*[-~]\s*\d{1,2}:\d{2}/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      var tokens = rest.split(/[\s,，;；|｜]+/).filter(Boolean);
      if (tokens.length) {
        name = cleanName(tokens.shift());
        tokens.forEach(function (tok) {
          if (!room && isRoomToken(tok)) { room = tok; return; }
          if (!teacher && looksLikeTeacher(stripParensAboutWeeks(tok))) { teacher = stripParensAboutWeeks(tok); return; }
          note = note ? note + ' ' + tok : tok;
        });
      }
    } else {
      var pool = lines.slice();
      name = cleanName(pool.shift() || '');
      if (!name && pool.length) name = cleanName(pool.shift() || '');
      pool.forEach(function (l) {
        var plain = stripParensAboutWeeks(l)
          .replace(/\d{1,2}(?:\s*[-~至,、]\s*\d{1,2})*\s*[单双]?\s*周/g, '')
          .replace(/第?\d{1,2}(?:[-,、~至]\d{1,2})?节/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (!plain) return;                                  // 纯周次行，跳过
        if (!room && isRoomToken(plain)) { room = plain; return; }
        if (!teacher && looksLikeTeacher(plain)) { teacher = plain; return; }
        note = note ? note + ' / ' + plain : plain;
      });
    }

    if (!name) return null;

    return {
      name: name,
      teacher: teacher || '',
      room: room || '',
      weeks: weeks ? weeks.weeks : null,
      parity: weeks ? weeks.parity : 'all',
      slotStart: slots ? slots.start : null,
      slotEnd: slots ? slots.end : null,
      note: note || '',
      raw: raw.replace(/\n/g, ' ')
    };
  }

  /* ============================ 极简 HTML 解析器（Node 兜底） ============================ */
  /* 浏览器里优先用原生 DOMParser；这里只需要支持 <table>/<tr>/<td>/<br> 等常见结构 */

  var VOID_TAGS = { br: 1, hr: 1, img: 1, input: 1, meta: 1, link: 1, area: 1, base: 1, col: 1, embed: 1, source: 1, track: 1, wbr: 1 };
  var RAW_TAGS = { script: 1, style: 1, textarea: 1, title: 1 };

  function makeEl(tagName, attrs) {
    return { nodeType: 1, tagName: tagName, attrs: attrs || {}, childNodes: [], parentNode: null };
  }
  function makeText(t) {
    return { nodeType: 3, nodeValue: t };
  }

  function findTagEnd(html, from) {
    var quote = 0;
    for (var i = from; i < html.length; i++) {
      var c = html.charAt(i);
      if (quote) { if (c === quote) quote = 0; continue; }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '>') return i;
    }
    return -1;
  }

  function parseAttrs(str) {
    var attrs = {}, re = /([^\s"'=<>\/]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g, m;
    while ((m = re.exec(str))) {
      var name = m[1].toLowerCase();
      var value = m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : (m[5] !== undefined ? m[5] : ''));
      attrs[name] = value;
    }
    return attrs;
  }

  function parseHTML(html) {
    var root = makeEl('#root');
    var stack = [root];
    var i = 0;
    var len = html.length;

    function appendText(t) {
      if (!t) return;
      var parent = stack[stack.length - 1];
      parent.childNodes.push(makeText(t));
    }

    while (i < len) {
      var lt = html.indexOf('<', i);
      if (lt < 0) { appendText(html.slice(i)); break; }
      if (lt > i) appendText(html.slice(i, lt));

      if (html.substr(lt, 4) === '<!--') {
        var ce = html.indexOf('-->', lt);
        i = ce < 0 ? len : ce + 3;
        continue;
      }
      if (html.charAt(lt + 1) === '!' || html.charAt(lt + 1) === '?') {
        var de = html.indexOf('>', lt);
        i = de < 0 ? len : de + 1;
        continue;
      }

      var gt = findTagEnd(html, lt + 1);
      if (gt < 0) { appendText(html.slice(lt)); break; }
      var tagStr = html.slice(lt + 1, gt);
      i = gt + 1;

      if (tagStr.charAt(0) === '/') {
        var closeName = tagStr.slice(1).trim().toLowerCase();
        for (var s = stack.length - 1; s > 0; s--) {
          if (stack[s].tagName === closeName) { stack.length = s; break; }
        }
        continue;
      }

      var selfClose = /\/$/.test(tagStr);
      if (selfClose) tagStr = tagStr.slice(0, -1);
      var sp = tagStr.search(/[\s]/);
      var tagName = (sp < 0 ? tagStr : tagStr.slice(0, sp)).toLowerCase();
      if (!/^[a-z][a-z0-9-]*$/.test(tagName)) continue;

      var el = makeEl(tagName, parseAttrs(sp < 0 ? '' : tagStr.slice(sp + 1)));
      var parent = stack[stack.length - 1];
      parent.childNodes.push(el);
      el.parentNode = parent;

      if (VOID_TAGS[tagName] || selfClose) continue;

      if (RAW_TAGS[tagName]) {
        var endRe = new RegExp('</' + tagName + '\\s*>', 'i');
        var rest = html.slice(i);
        var mm = rest.match(endRe);
        var raw = mm ? rest.slice(0, mm.index) : rest;
        if (raw) el.childNodes.push(makeText(raw));
        i += mm ? mm.index + mm[0].length : rest.length;
        continue;
      }
      stack.push(el);
    }
    return root;
  }

  /* ---------- DOM 通用读取（原生 DOM 与 shim 统一接口） ---------- */

  function childElements(node) {
    var out = [];
    var kids = node.childNodes || [];
    for (var i = 0; i < kids.length; i++) if (kids[i].nodeType === 1) out.push(kids[i]);
    return out;
  }

  function tagOf(node) {
    return (node.tagName || '').toLowerCase();
  }

  function attrOf(node, name) {
    if (node.getAttribute) return node.getAttribute(name);
    if (node.attrs) return node.attrs[name] != null ? node.attrs[name] : null;
    return null;
  }

  var BLOCK_TAGS = { div: 1, p: 1, li: 1, tr: 1, td: 1, th: 1, br: 1, hr: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, section: 1, article: 1, header: 1, footer: 1, ul: 1, ol: 1, dl: 1, dt: 1, dd: 1, pre: 1, table: 1, tbody: 1, thead: 1, option: 1 };

  /** 取元素可见文本；块级元素/br 转换行，便于拆分“课程名/教师/教室/周次” */
  function textOf(node) {
    var out = '';
    (function walk(n) {
      if (!n) return;
      if (n.nodeType === 3) { out += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      var tag = tagOf(n);
      if (tag === 'script' || tag === 'style') return;
      var block = !!BLOCK_TAGS[tag];
      if (block && out && out.charAt(out.length - 1) !== '\n') out += '\n';
      var kids = n.childNodes || [];
      for (var i = 0; i < kids.length; i++) walk(kids[i]);
      if (block && out && out.charAt(out.length - 1) !== '\n') out += '\n';
    })(node);
    return normText(out);
  }

  /** 深度遍历收集指定标签（不进入嵌套的同名/表格结构） */
  function collectByTag(node, tags, stopAtTags, out) {
    out = out || [];
    var kids = childElements(node);
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i], tag = tagOf(el);
      if (tags[tag]) { out.push(el); continue; }
      if (stopAtTags && stopAtTags[tag]) continue;
      collectByTag(el, tags, stopAtTags, out);
    }
    return out;
  }

  /** 表格 -> 二维字符串矩阵（处理 rowspan/colspan），同时返回每个单元格的 rowspan */
  function tableToMatrix(tableEl) {
    var rows = collectByTag(tableEl, { tr: 1 }, { table: 1 });
    var grid = [];       // grid[r][c] = string
    var spans = [];      // spans[r][c] = rowspan
    var occupied = {};

    for (var r = 0; r < rows.length; r++) {
      if (!grid[r]) grid[r] = [];
      if (!spans[r]) spans[r] = [];
      var cells = childElements(rows[r]).filter(function (el) {
        var t = tagOf(el); return t === 'td' || t === 'th';
      });
      var c = 0;
      for (var k = 0; k < cells.length; k++) {
        while (occupied[r + ',' + c]) c++;
        var cell = cells[k];
        var rs = Math.max(1, parseInt(attrOf(cell, 'rowspan'), 10) || 1);
        var cs = Math.max(1, parseInt(attrOf(cell, 'colspan'), 10) || 1);
        if (rs > 40) rs = 1; if (cs > 12) cs = 1;
        var text = textOf(cell);
        for (var dr = 0; dr < rs; dr++) {
          for (var dc = 0; dc < cs; dc++) {
            var rr = r + dr, cc = c + dc;
            if (!grid[rr]) grid[rr] = [];
            if (!spans[rr]) spans[rr] = [];
            if (dr === 0 && dc === 0) { grid[rr][cc] = text; spans[rr][cc] = rs; }
            else { grid[rr][cc] = ''; spans[rr][cc] = 0; }
            occupied[rr + ',' + cc] = 1;
          }
        }
        c += cs;
      }
    }
    // 补齐短行
    var width = 0;
    grid.forEach(function (row) { width = Math.max(width, row.length); });
    for (var i = 0; i < grid.length; i++) {
      for (var j = 0; j < width; j++) {
        if (grid[i][j] === undefined) grid[i][j] = '';
        if (spans[i][j] === undefined) spans[i][j] = 1;
      }
    }
    return { matrix: grid, spans: spans };
  }

  /** 评估一张表像不像课表：星期表头数量 + 课程单元数量 */
  function scoreTable(tableEl) {
    var t = tableToMatrix(tableEl);
    var best = 0;
    for (var r = 0; r < Math.min(t.matrix.length, 10); r++) {
      var days = {};
      var cnt = 0;
      t.matrix[r].forEach(function (cell, c) {
        var d = weekdayFromText(cell);
        if (d && !days[c]) { days[c] = d; cnt++; }
      });
      if (cnt > best) best = cnt;
    }
    return { days: best, cells: t.matrix.length * (t.matrix[0] ? t.matrix[0].length : 0), matrix: t.matrix, spans: t.spans };
  }

  /** 从整段 HTML 里找出最像课表的表格并解析 */
  function htmlToMatrix(html) {
    var doc;
    if (typeof DOMParser !== 'undefined') {
      doc = new DOMParser().parseFromString(html, 'text/html');
      if (!doc || !doc.body) throw new Error('HTML 解析失败');
      var tables = doc.querySelectorAll ? doc.querySelectorAll('table') : [];
      if (!tables.length) return null;
      var bestTable = null, bestScore = 0;
      for (var i = 0; i < tables.length; i++) {
        var s = scoreTable(tables[i]);
        var sc = s.days * 100 + Math.min(s.cells, 400);
        if (s.days >= 2 && sc > bestScore) { bestScore = sc; bestTable = tables[i]; }
      }
      if (!bestTable) return null;
      return tableToMatrix(bestTable);
    }
    // Node 兜底
    var dom = parseHTML(html);
    var all = collectByTag(dom, { table: 1 });
    var best = null, bestSc = 0;
    all.forEach(function (tb) {
      var s = scoreTable(tb);
      var sc = s.days * 100 + Math.min(s.cells, 400);
      if (s.days >= 2 && sc > bestSc) { bestSc = sc; best = tb; }
    });
    return best ? tableToMatrix(best) : null;
  }

  /* ============================ 矩阵 -> 课程 ============================ */

  function dedupeCourses(list) {
    var seen = {}, out = [];
    list.forEach(function (c) {
      var key = [c.name, c.day, c.start, c.end, c.room, c.teacher, (c.weeks || []).join(',')].join('|');
      if (!seen[key]) { seen[key] = 1; out.push(c); }
    });
    return out;
  }

  /**
   * 核心：二维矩阵 -> 课程数组
   * @param {string[][]} matrix
   * @param {{spans?: number[][]}} [opts]
   */
  function matrixToCourses(matrix, opts) {
    opts = opts || {};
    var spans = opts.spans || null;
    var result = { ok: false, courses: [], reason: '' };
    if (!matrix || !matrix.length) { result.reason = '内容是空的'; return result; }

    // 1. 找星期表头行
    var headerRow = -1, dayCols = null, bestCnt = 0;
    for (var r = 0; r < Math.min(matrix.length, 10); r++) {
      var map = {}, cnt = 0;
      matrix[r].forEach(function (cell, c) {
        var d = weekdayFromText(cell);
        if (d && !map[c]) { map[c] = d; cnt++; }
      });
      if (cnt >= 2 && cnt > bestCnt) { bestCnt = cnt; headerRow = r; dayCols = map; }
    }
    if (headerRow < 0 || !dayCols) {
      result.reason = '没找到「星期一…星期日」这样的表头，可能这不是课表页面的表格';
      return result;
    }

    var dayColIdx = Object.keys(dayCols).map(Number).sort(function (a, b) { return a - b; });
    var firstDayCol = dayColIdx[0];

    // 2. 逐行解析
    var courses = [];
    var slotCursor = 0;
    var slotCache = {};

    function slotsForRow(row) {
      if (slotCache[row] !== undefined) return slotCache[row];
      var found = null;
      for (var c = 0; c < firstDayCol && c < matrix[row].length; c++) {
        var s = parseSlots(matrix[row][c]);
        if (s) { found = s; break; }
      }
      if (!found) {
        for (var c2 = firstDayCol; c2 < matrix[row].length; c2++) {
          var s2 = parseSlots(matrix[row][c2]);
          if (s2) { found = s2; break; }
        }
      }
      if (!found) {
        slotCursor = slotCursor ? slotCursor + 1 : 1;
        found = { start: slotCursor, end: slotCursor };
      } else {
        slotCursor = found.start;
      }
      slotCache[row] = found;
      return found;
    }

    for (var r2 = headerRow + 1; r2 < matrix.length; r2++) {
      var row = matrix[r2];
      if (!row) continue;
      var rowSlots = slotsForRow(r2);
      for (var d = 0; d < dayColIdx.length; d++) {
        var col = dayColIdx[d];
        var cellText = row[col];
        if (!cellText || !String(cellText).trim()) continue;
        var meta = splitCellText(cellText);
        if (!meta) continue;
        var start = meta.slotStart || rowSlots.start;
        var end = meta.slotEnd || rowSlots.end;
        // rowspan 跨多行 => 课程跨越到最后一行的节次
        if (spans && spans[r2] && spans[r2][col] > 1) {
          var lastRow = Math.min(r2 + spans[r2][col] - 1, matrix.length - 1);
          var lastSlots = slotsForRow(lastRow);
          end = Math.max(end, lastSlots.end);
        }
        courses.push({
          name: meta.name,
          teacher: meta.teacher,
          room: meta.room,
          day: dayCols[col],
          start: start,
          end: end,
          weeks: meta.weeks,
          parity: meta.parity,
          note: meta.note,
          raw: meta.raw
        });
      }
    }

    courses = dedupeCourses(courses).sort(function (a, b) {
      return a.day - b.day || a.start - b.start || (a.name > b.name ? 1 : -1);
    });
    result.courses = courses;
    result.ok = courses.length > 0;
    if (!result.ok) result.reason = '表格结构像课表，但单元格里没解析出课程，可能课表还没发布';
    return result;
  }

  /* ============================ 各种输入 -> 课程 ============================ */

  function parseHtml(html) {
    var t;
    try { t = htmlToMatrix(html); } catch (e) { t = null; }
    if (!t) return { ok: false, courses: [], reason: 'HTML 里没找到课表表格' };
    var res = matrixToCourses(t.matrix, { spans: t.spans });
    res.matrix = t.matrix;
    return res;
  }

  /** 从 Document 解析（书签脚本用，最高保真） */
  function parseFromDocument(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    if (!doc) return { ok: false, courses: [], reason: '没有文档' };
    var tables = doc.querySelectorAll ? Array.prototype.slice.call(doc.querySelectorAll('table')) : [];
    var best = null, bestSc = 0;
    tables.forEach(function (tb) {
      var s = scoreTable(tb);
      var sc = s.days * 100 + Math.min(s.cells, 400);
      if (s.days >= 2 && sc > bestSc) { bestSc = sc; best = tb; }
    });
    if (!best) return { ok: false, courses: [], reason: '页面上没找到课表表格' };
    var t = tableToMatrix(best);
    var res = matrixToCourses(t.matrix, { spans: t.spans });
    res.matrix = t.matrix;
    return res;
  }

  /** 制表符文本（从 Excel / 网页表格复制）*/
  function parseTsv(text) {
    var lines = normText(text).split('\n').filter(function (l) { return l.trim() !== ''; });
    var matrix = lines.map(function (l) { return l.split('\t').map(function (c) { return c.trim(); }); });
    var res = matrixToCourses(matrix);
    res.matrix = matrix;
    return res;
  }

  /** 简易 CSV（支持引号）*/
  function parseCsv(text) {
    var s = String(text).replace(/\r\n?/g, '\n');
    var rows = [], row = [], cur = '', inQ = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (inQ) {
        if (ch === '"') { if (s.charAt(i + 1) === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
    var res = matrixToCourses(rows);
    res.matrix = rows;
    return res;
  }

  /** 纯文本兜底：按“星期四”等表头切分，逐行循环分配 */
  function parseText(text) {
    var raw = normText(text);
    if (!raw) return { ok: false, courses: [], reason: '没有内容' };
    if (raw.indexOf('\t') >= 0) return parseTsv(raw);

    var lines = raw.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    // 找表头行：一行里有 >=3 个星期词
    var dayOrder = null, headerIdx = -1;
    for (var i = 0; i < Math.min(lines.length, 10); i++) {
      var days = [], re = /(?:星期|周|礼拜)([一二三四五六日天])/g, m;
      while ((m = re.exec(lines[i]))) days.push(WD_CN[m[1]]);
      if (days.length >= 3) { dayOrder = days; headerIdx = i; break; }
    }
    if (!dayOrder) return { ok: false, courses: [], reason: '纯文本里没找到「周一…周日」表头，建议直接上传课表网页文件' };

    var courses = [];
    var body = lines.slice(headerIdx + 1);
    var slotCursor = 0;
    // 节次行标记
    var idx = 0;
    while (idx < body.length) {
      var line = body[idx];
      var slots = parseSlots(line);
      var isSlotLine = slots && /^第?\d{1,2}([-,、~至]\d{1,2})?节?$/.test(line.replace(/\s+/g, ''));
      if (isSlotLine) {
        slotCursor = slots.start;
        idx++;
        // 该行之后按顺序就是各天的内容行
        var taken = 0;
        while (idx < body.length && taken < dayOrder.length) {
          var cellLine = body[idx];
          if (/^第?\d{1,2}([-,、~至]\d{1,2})?节$/.test(cellLine)) break;
          var meta = splitCellText(cellLine);
          if (meta) {
            courses.push({
              name: meta.name, teacher: meta.teacher, room: meta.room,
              day: dayOrder[taken], start: slots.start, end: slots.end,
              weeks: meta.weeks, parity: meta.parity, note: meta.note, raw: meta.raw
            });
          }
          taken++;
          idx++;
        }
        continue;
      }
      idx++;
    }
    var uniq = dedupeCourses(courses);
    return {
      ok: uniq.length > 0,
      courses: uniq,
      reason: uniq.length ? '' : '纯文本识别失败，建议上传课表网页 HTML 文件'
    };
  }

  /** 统一入口：自动判断输入类型 */
  function autoParse(input) {
    var s = String(input || '');
    var looksHtml = /<table[\s>]/i.test(s) || /<html[\s>]/i.test(s) || /<div[\s>][\s\S]*<\/div>/i.test(s);
    if (looksHtml) {
      var r = parseHtml(s);
      if (r.ok) { r.source = 'html'; return r; }
    }
    if (s.indexOf('\t') >= 0) {
      var t = parseTsv(s);
      if (t.ok) { t.source = 'tsv'; return t; }
    }
    if (/,(?:[^,\n]*,[^,\n]*){3,}/.test(s) && /\n/.test(s)) {
      var c = parseCsv(s);
      if (c.ok) { c.source = 'csv'; return c; }
    }
    var p = parseText(s);
    p.source = 'text';
    return p;
  }

  return {
    version: '1.0',
    normText: normText,
    weekdayFromText: weekdayFromText,
    parseSlots: parseSlots,
    parseWeeks: parseWeeks,
    splitCellText: splitCellText,
    cleanName: cleanName,
    isRoomToken: isRoomToken,
    looksLikeRoom: looksLikeRoom,
    looksLikeTeacher: looksLikeTeacher,
    parseHTML: parseHTML,
    textOf: textOf,
    tableToMatrix: tableToMatrix,
    matrixToCourses: matrixToCourses,
    parseHtml: parseHtml,
    parseFromDocument: parseFromDocument,
    parseTsv: parseTsv,
    parseCsv: parseCsv,
    parseText: parseText,
    autoParse: autoParse
  };
});
