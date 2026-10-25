/*!
 * 课程数据校验 CourseTableValidate v1.0
 * 纯函数，无依赖，可在浏览器与 Node 中测试。
 *
 * 用途：
 *   1. detectSuspect(course)   —— 单条课程本身是否可疑（解析可能出错）
 *   2. detectConflicts(list)   —— 多条课程之间是否时间冲突（同天 + 节次重叠 + 周次有交集）
 *   3. annotate(list, maxWeek)  —— 汇总成 { id: { kind, reasons } }
 * 人工确认过的课程（course.confirmed === true）不再打标记。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CourseTableValidate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DETAIL_WORDS = /(校区|场地|教师|教学班|选课备注|课备注):/;
  var LEADING_JUNK = /^(注|备注|班|组成|学班|学组成)[:：]/;

  /** 单条课程的可疑点（返回原因数组，无问题返回 null） */
  function detectSuspect(c) {
    if (!c) return ['课程数据为空'];
    var reasons = [];

    var name = String(c.name || '').trim();
    if (!name) {
      reasons.push('课程名为空');
    } else {
      if (name.length > 30) reasons.push('课程名过长（可能混入了其它内容）');
      if (/[:：\/]/.test(name)) reasons.push('课程名含「:」或「/」，疑似解析错位');
      if (DETAIL_WORDS.test(name)) reasons.push('课程名混入了教师/场地等字段');
      if (LEADING_JUNK.test(name)) reasons.push('课程名以「注/组成」等开头，疑似被截断');
      // 注意：JS 正则里中文属于 \W，不能用 \W 判断，必须用汉字/字母白名单
      if (!/[\u4e00-\u9fa5A-Za-z]/.test(name)) reasons.push('课程名里没有文字内容');
    }

    if (!String(c.teacher || '').trim() && !String(c.room || '').trim()) {
      reasons.push('没有教师和地点');
    }

    if (!(c.start >= 1) || !(c.end >= c.start)) reasons.push('节次异常');
    if (c.end > 20 || c.start > 20) reasons.push('节次超出范围');

    if (!(c.day >= 1 && c.day <= 7)) reasons.push('星期异常');

    return reasons.length ? reasons : null;
  }

  /** 把 weeks 展开成集合；没有周次时按 1..maxWeek 视作每周 */
  function weekSet(c, maxWeek) {
    var set = {};
    if (Array.isArray(c.weeks) && c.weeks.length) {
      c.weeks.forEach(function (w) { set[w] = 1; });
    } else {
      for (var w = 1; w <= maxWeek; w++) set[w] = 1;
    }
    return set;
  }

  /**
   * 两两检查冲突
   * @returns {Object} id -> 原因数组
   */
  function detectConflicts(list, maxWeek) {
    maxWeek = maxWeek || 20;
    // 先按「与哪门课冲突」聚合周次，避免同一条课程刷出十几条原因
    var acc = {};   // id -> { 课程名: { 周: true } }
    var n = list.length;
    function addWeek(id, name, w) {
      if (!acc[id]) acc[id] = {};
      if (!acc[id][name]) acc[id][name] = {};
      acc[id][name][w] = true;
    }
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        var a = list[i], b = list[j];
        if (a.day !== b.day) continue;
        if (a.start > b.end || b.start > a.end) continue;   // 节次不重叠

        var sa = weekSet(a, maxWeek), sb = weekSet(b, maxWeek);
        for (var w in sa) {
          if (!sb[w]) continue;
          addWeek(a.id, b.name, +w);
          addWeek(b.id, a.name, +w);
        }
      }
    }
    var out = {};
    Object.keys(acc).forEach(function (id) {
      var reasons = [];
      Object.keys(acc[id]).forEach(function (name) {
        var weeks = Object.keys(acc[id][name]).map(Number).sort(function (x, y) { return x - y; });
        var short = weeks.length > 4
          ? (weeks.slice(0, 4).join('、') + ' 等 ' + weeks.length + ' 周')
          : (weeks.join('、') + ' 周');
        reasons.push('与「' + name + '」时间冲突（第 ' + short + '）');
      });
      out[id] = reasons;
    });
    return out;
  }

  /**
   * 汇总标记
   * @returns {Object} id -> { kind: 'conflict'|'suspect'|'both', reasons: [] }
   */
  function annotate(list, maxWeek) {
    var conflicts = detectConflicts(list, maxWeek);
    var result = {};
    list.forEach(function (c) {
      if (!c || c.confirmed === true) return;   // 人工确认过的不再标记
      var reasons = [];
      var suspect = detectSuspect(c);
      var conflict = conflicts[c.id] || [];
      if (suspect) reasons = reasons.concat(suspect);
      if (conflict.length) reasons = reasons.concat(conflict);
      if (!reasons.length) return;
      if (reasons.length > 5) {
        reasons = reasons.slice(0, 4).concat(['…另有 ' + (reasons.length - 4) + ' 条问题（点「编辑」可逐条核对）']);
      }
      result[c.id] = {
        kind: suspect && conflict.length ? 'both' : (conflict.length ? 'conflict' : 'suspect'),
        reasons: reasons
      };
    });
    return result;
  }

  return {
    version: '1.0',
    detectSuspect: detectSuspect,
    detectConflicts: detectConflicts,
    annotate: annotate,
    weekSet: weekSet
  };
});
