/*!
 * 课表 PDF 解析 CourseTablePdf v1.0  ·  零依赖
 * ------------------------------------------------------------
 * 目标：把教务系统导出的「周维度课表 PDF」还原成课程数组。
 *
 * 适用特征（浙江中医药大学 iText 导出的课表）：
 *   - 矢量文本 PDF（不是扫描件），字体编码 UniGB-UCS2-H（文字即 UCS-2）
 *   - 第 1 页是网格：时间段 / 节次 / 星期一…星期日 7 列
 *   - 单元格内容形如：
 *       中西医临床儿科学*          ← 课程名（字号 9）
 *       (1-3节)5周/校区:滨文校区    ← 节次 + 周次 + 校区（字号 8）
 *       /场地:17206/教师:王庆/教学班:…
 *     文字过长会按行折行、甚至溢出到后续页（同样的列 x 坐标）
 *   - 因此按「列」把文字按 (页, y 降序) 拼回去，用 12pt 行距切分单元格块
 *
 * 浏览器：用自带 DecompressionStream 解压 PDF 数据流（无需 pdf.js）
 * Node：用内置 zlib（便于自动化测试）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CourseTablePdf = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY_CHARS = ['一', '二', '三', '四', '五', '六', '日'];
  var LINE_HEIGHT_MIN = 10.5;   // 同一单元格内相邻行的行距范围（pt）
  var LINE_HEIGHT_MAX = 13.5;

  /* ======================= 字节工具 ======================= */

  function bytesToLatin1(bytes) {
    var out = '';
    var CHUNK = 8192;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return out;
  }

  /** PDF 字面量字符串（不含两端括号）→ 字节数组 */
  function literalToBytes(s) {
    var out = [];
    for (var k = 0; k < s.length; k++) {
      var ch = s[k];
      if (ch !== '\\') { out.push(s.charCodeAt(k)); continue; }
      k++;
      var n = s[k];
      if (n === 'n') out.push(0x0a);
      else if (n === 'r') out.push(0x0d);
      else if (n === 't') out.push(0x09);
      else if (n === 'b') out.push(0x08);
      else if (n === 'f') out.push(0x0c);
      else if (n === '(') out.push(0x28);
      else if (n === ')') out.push(0x29);
      else if (n === '\\') out.push(0x5c);
      else if (n >= '0' && n <= '7') {
        var oct = n;
        while (oct.length < 3 && s[k + 1] >= '0' && s[k + 1] <= '7') oct += s[++k];
        out.push(parseInt(oct, 8) & 0xff);
      } else if (n !== '\n') {
        out.push(s.charCodeAt(k));
      }
    }
    return out;
  }

  /** UCS-2 大端（UniGB-UCS2-H / Identity-H 常见形式）→ 字符串 */
  function decodeUcs2(bytes) {
    var s = '';
    for (var i = 0; i + 1 < bytes.length; i += 2) {
      var c = (bytes[i] << 8) | bytes[i + 1];
      if (c) s += String.fromCharCode(c);
    }
    return s;
  }

  /** 解压 PDF 数据流（zlib/deflate） */
  function inflate(u8) {
    // Node 环境优先用 zlib（同步、稳）
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      try {
        var z = require('zlib');
        return Promise.resolve(new Uint8Array(z.inflateSync(Buffer.from(u8))));
      } catch (e) { /* 落到浏览器分支 */ }
    }
    if (typeof DecompressionStream === 'function' && typeof Blob === 'function' && typeof Response === 'function') {
      var tryFmt = function (fmt) {
        var ds = new DecompressionStream(fmt);
        var stream = new Blob([u8]).stream().pipeThrough(ds);
        return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
      };
      return tryFmt('deflate').catch(function () { return tryFmt('deflate-raw'); });
    }
    if (typeof require === 'function') {
      try {
        var z2 = require('zlib');
        return Promise.resolve(new Uint8Array(z2.inflateSync(Buffer.from(u8))));
      } catch (e2) { /* ignore */ }
    }
    return Promise.reject(new Error('当前浏览器不支持解压 PDF（需要 DecompressionStream，安卓 Chrome 80+ / iOS Safari 16.4+）'));
  }

  /* ======================= PDF 对象解析 ======================= */

  function indexObjects(latin) {
    var re = /(\d+)\s+(\d+)\s+obj\b/g;
    var positions = [];
    var m;
    while ((m = re.exec(latin))) {
      positions.push({ num: +m[1], gen: +m[2], start: m.index, bodyStart: m.index + m[0].length });
    }
    var map = new Map();
    for (var i = 0; i < positions.length; i++) {
      var p = positions[i];
      var next = i + 1 < positions.length ? positions[i + 1].start : latin.length;
      var body = latin.slice(p.bodyStart, next);
      var si = body.indexOf('stream');
      var dict = si >= 0 ? body.slice(0, si) : body;
      var data = null;
      if (si >= 0) {
        var ds = p.bodyStart + si + 6;
        if (latin[ds] === '\r') ds++;
        if (latin[ds] === '\n') ds++;
        var lm = /\/Length\s+(\d+)(?:\s+(\d+)\s+R)?/.exec(dict);
        var len = null;
        if (lm) {
          if (!lm[2]) len = +lm[1];
          else {
            var ref = positions.filter(function (q) { return q.num === +lm[1] && q.gen === +lm[2]; })[0];
            if (ref) {
              var nm = /^\s*(\d+)/.exec(latin.slice(ref.bodyStart, ref.bodyStart + 60));
              if (nm) len = +nm[1];
            }
          }
        }
        if (len == null) {
          var ee = body.indexOf('endstream', dict.length);
          len = ee >= 0 ? (p.bodyStart + ee) - ds : undefined;
        }
        if (len != null && len >= 0) data = { start: ds, length: len };
      }
      map.set(p.num, { num: p.num, dict: dict, data: data });
    }
    return map;
  }

  /* ======================= 内容流解析 ======================= */

  function parseContent(text, pageNo, items, rects) {
    var tm = [1, 0, 0, 1, 0, 0];
    var fontSize = 0;
    var st = [];
    var i = 0;
    var n = text.length;
    while (i < n) {
      var c = text[i];
      if (c === '(') {
        var depth = 1, j = i + 1, body = '';
        while (j < n && depth > 0) {
          var ch = text[j];
          if (ch === '\\') { body += ch + (text[j + 1] || ''); j += 2; continue; }
          if (ch === '(') depth++;
          else if (ch === ')') { depth--; if (depth === 0) break; }
          body += ch;
          j++;
        }
        st.push({ str: literalToBytes(body) });
        i = j + 1;
        continue;
      }
      var opm = /^[A-Za-z'"*]+/.exec(text.slice(i, i + 6));
      if (opm) {
        var op = opm[0];
        i += op.length;
        if (op === 'Tm' && st.length >= 6) {
          tm = st.slice(-6).map(function (v) { return typeof v.num === 'number' ? v.num : 0; });
        } else if (op === 'Td') {
          var nums = st.filter(function (v) { return typeof v.num === 'number'; });
          if (nums.length >= 2) {
            var dx = nums[nums.length - 1].num;
            var dy = nums[nums.length - 2].num;
            tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + dx, tm[5] + dy];
          }
        } else if (op === 'Tf') {
          var nums2 = st.filter(function (v) { return typeof v.num === 'number'; });
          if (nums2.length) fontSize = nums2[nums2.length - 1].num;
        } else if (op === 'Tj' || op === 'TJ') {
          for (var s = 0; s < st.length; s++) {
            if (st[s].str) {
              items.push({ page: pageNo, x: tm[4], y: tm[5], size: fontSize, text: decodeUcs2(st[s].str) });
            }
          }
        } else if (op === 're' && rects) {
          var nums3 = st.filter(function (v) { return typeof v.num === 'number'; });
          if (nums3.length >= 4) {
            var a = nums3.slice(-4).map(function (v) { return v.num; });
            rects.push({ page: pageNo, x: a[0], y: a[1], w: a[2], h: a[3] });
          }
        }
        st.length = 0;
        continue;
      }
      var nm2 = /^-?\d*\.?\d+/.exec(text.slice(i, i + 24));
      if (nm2) { st.push({ num: parseFloat(nm2[0]) }); i += nm2[0].length; continue; }
      i++;
    }
  }

  /** 读取 PDF → [{page,x,y,size,text}] */
  function extractItems(arrayBuffer) {
    var bytes = new Uint8Array(arrayBuffer);
    var latin = bytesToLatin1(bytes);
    var objs = indexObjects(latin);

    var pageStreams = [];
    objs.forEach(function (o) {
      if (!/\/Type\s*\/Page[^s]/.test(o.dict)) return;
      var cm = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(o.dict);
      if (cm) pageStreams.push(+cm[1]);
    });
    if (!pageStreams.length) return Promise.resolve({ items: [], pageCount: 0 });

    var items = [];
    var rects = [];
    var chain = Promise.resolve();
    pageStreams.forEach(function (num, idx) {
      chain = chain.then(function () {
        var o = objs.get(num);
        if (!o || !o.data) return;
        var raw = bytes.subarray(o.data.start, o.data.start + o.data.length);
        var isFlate = /FlateDecode/.test(o.dict);
        var ready = isFlate ? inflate(raw) : Promise.resolve(raw);
        return ready.then(function (out) {
          parseContent(bytesToLatin1(out), idx + 1, items, idx === 0 ? rects : null);
        }).catch(function () { /* 单页失败不影响其它页 */ });
      });
    });
    return chain.then(function () {
      return { items: items, rects: rects, pageCount: pageStreams.length };
    });
  }

  /* ======================= 网格 → 课程 ======================= */

  /** 从表头找 7 列 x 坐标 */
  function findDayColumns(items) {
    var head = items.filter(function (it) {
      return it.page === 1 && /^星期[一二三四五六日]$/.test(it.text);
    });
    if (head.length < 5) return null;
    var cols = head.map(function (h) {
      return { day: DAY_CHARS.indexOf(h.text.slice(-1)) + 1, x: h.x };
    }).sort(function (a, b) { return a.x - b.x; });
    // 表头文字居中，列左边界 ≈ 表头 x - 45（由实际 PDF 反推，约半列宽减字宽）
    var bounds = cols.map(function (c) { return c.x - 45; });
    return { cols: cols, bounds: bounds, headerY: head[0].y };
  }

  /** 判断碎片文本是不是「上一格详情的尾巴」而不是「下一格的课程名开头」 */
  function looksLikeDetailTail(text) {
    var t = (text || '').trim();
    if (!t) return true;
    if (/^\//.test(t)) return true;                                   // /场地:…
    if (/(校区|场地|教师|教学班|选课备注|课备注):/.test(t)) return true; // 任何详情字段
    if (/^(注:|班:|组成:|学班|学组成|教学班)/.test(t)) return true;     // 续行常见开头
    if (/\/$/.test(t)) return true;                                   // 以 / 结尾 = 被截断的详情
    return false;
  }

  /** 按行距切分单元格块 */
  function splitBlocks(list) {
    var blocks = [];
    var cur = [];
    var prev = null;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var newPage = prev && it.page !== prev.page;
      var dy = prev ? prev.y - it.y : 0;
      var sameBlock = prev && !newPage && dy > LINE_HEIGHT_MIN && dy < LINE_HEIGHT_MAX;
      if (cur.length && !sameBlock) { blocks.push(cur); cur = []; }
      cur.push(it);
      prev = it;
    }
    if (cur.length) blocks.push(cur);

    // 没有 (x-y节) 的碎片：详情尾巴并回「上一块」，名字碎片挂到「下一块」
    var out = [];
    var pending = null;
    for (var b = 0; b < blocks.length; b++) {
      var joined = blocks[b].map(function (x) { return x.text; }).join('');
      if (/\(\d{1,2}-\d{1,2}节\)/.test(joined)) {
        out.push(pending ? pending.concat(blocks[b]) : blocks[b]);
        pending = null;
      } else if (looksLikeDetailTail(joined) && out.length) {
        out[out.length - 1] = out[out.length - 1].concat(blocks[b]);
      } else {
        pending = pending ? pending.concat(blocks[b]) : blocks[b];
      }
    }
    if (pending) {
      if (out.length) out[out.length - 1] = out[out.length - 1].concat(pending);
      else out.push(pending);
    }
    return out;
  }

  /** 周次字符串 → 周号数组，支持 5周 / 2周,7周 / 5-6周 / 7-9周(单) */
  function expandWeeks(s) {
    var parity = 'all';
    if (/[单双]/.test(s)) parity = /双/.test(s) ? 'even' : 'odd';
    var weeks = [];
    var re = /(\d{1,2})(?:\s*[-~至]\s*(\d{1,2}))?/g;
    var m;
    while ((m = re.exec(s))) {
      var a = +m[1];
      var b = m[2] ? +m[2] : a;
      for (var w = a; w <= b && w <= 60; w++) {
        if (parity === 'odd' && w % 2 === 0) continue;
        if (parity === 'even' && w % 2 === 1) continue;
        if (weeks.indexOf(w) < 0) weeks.push(w);
      }
    }
    return weeks.sort(function (x, y) { return x - y; });
  }

  /** 单元格文本 → 课程字段 */
  function parseBlockText(raw) {
    var slotM = /\((\d{1,2})\s*-\s*(\d{1,2})节\)/.exec(raw);
    if (!slotM) return null;
    var name = raw.slice(0, slotM.index).trim();
    // 兜底：如果课程名里混进了详情字段（块拼接不完美时），取最后一个 : 或 / 之后的部分
    if (/^\/|(校区|场地|教师|教学班|选课备注|课备注):/.test(name)) {
      var cut = Math.max(name.lastIndexOf(':'), name.lastIndexOf('/'));
      if (cut >= 0) name = name.slice(cut + 1).trim();
    }
    name = name.replace(/^[/:]+/, '').replace(/[○*※☆●◆]+$/, '').trim();
    if (!name) return null;
    if (/^(注|备注)$/.test(name)) return null;

    var after = raw.slice(slotM.index + slotM[0].length);
    var weekPart = (after.split('/')[0] || '').trim();
    var weeks = expandWeeks(weekPart);
    var grab = function (key) {
      var mm = new RegExp('/' + key + ':([^/]*)').exec(after);
      return mm ? mm[1].trim() : '';
    };
    var campus = grab('校区');
    return {
      name: name,
      start: +slotM[1],
      end: +slotM[2],
      weeks: weeks,
      teacher: grab('教师'),
      room: grab('场地'),
      campus: campus,
      note: campus ? '校区:' + campus : '',
      raw: raw
    };
  }

  function dedupe(list) {
    var seen = {};
    var out = [];
    list.forEach(function (c) {
      var key = [c.name, c.day, c.start, c.end, (c.weeks || []).join(','), c.teacher, c.room].join('|');
      if (!seen[key]) { seen[key] = 1; out.push(c); }
    });
    return out;
  }

  /** 纯函数：文字项 → 课程（便于单测） */
  function itemsToCourses(items) {
    if (!items || !items.length) return { ok: false, courses: [], reason: 'PDF 里没有文字层（可能是扫描件）' };
    var grid = findDayColumns(items);
    if (!grid) {
      return { ok: false, courses: [], reason: '没找到「星期一…星期日」表头，可能不是课表 PDF' };
    }

    var buckets = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
    items.forEach(function (it) {
      if (!it.text) return;
      if (it.page === 1 && it.y > grid.headerY - 2) return;     // 表头/标题/学号行
      if (it.page !== 1 && it.size > 10) return;                 // 续页大标题
      if (/^星期[一二三四五六日]$/.test(it.text)) return;
      var col = 0;
      for (var b = grid.bounds.length - 1; b >= 0; b--) {
        if (it.x >= grid.bounds[b]) { col = b + 1; break; }
      }
      if (!col) return;
      buckets[grid.cols[col - 1].day].push(it);
    });

    var courses = [];
    for (var d = 1; d <= 7; d++) {
      var list = buckets[d].slice().sort(function (a, b) {
        return (a.page - b.page) || (b.y - a.y);
      });
      splitBlocks(list).forEach(function (block) {
        var parsed = parseBlockText(block.map(function (x) { return x.text; }).join(''));
        if (parsed) { parsed.day = d; courses.push(parsed); }
      });
    }

    courses = dedupe(courses).sort(function (a, b) {
      return a.day - b.day || a.start - b.start || (a.name > b.name ? 1 : -1);
    });
    return {
      ok: courses.length > 0,
      courses: courses,
      pageCount: 0,
      reason: courses.length ? '' : '找到了表头但没解析出课程，可能格式与预期不同'
    };
  }

  /** 主入口：ArrayBuffer → 课程 */
  function parse(arrayBuffer) {
    return extractItems(arrayBuffer).then(function (res) {
      var out = itemsToCourses(res.items);
      out.pageCount = res.pageCount;
      out.itemCount = res.items.length;
      return out;
    });
  }

  return {
    version: '1.0',
    parse: parse,
    extractItems: extractItems,
    itemsToCourses: itemsToCourses,
    expandWeeks: expandWeeks,
    parseBlockText: parseBlockText,
    literalToBytes: literalToBytes,
    decodeUcs2: decodeUcs2
  };
});
