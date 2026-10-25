import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const V = require('../assets/validate.js');

function c(over) {
  return Object.assign({
    id: 'x1', name: '内科学B', teacher: '张三', room: '18325',
    day: 1, start: 2, end: 5, weeks: [6], note: '', confirmed: false
  }, over || {});
}

/* ================= 单条可疑检测 ================= */
test('正常的课不该被标记', () => {
  assert.equal(V.detectSuspect(c()), null);
  // 没有周次 = 「每周都上」，是合法状态（手动添加的课默认如此），不该标记
  assert.equal(V.detectSuspect(c({ weeks: null })), null);
});

test('课程名被污染 => 标记', () => {
  const r1 = V.detectSuspect(c({ name: '2班/选课备注:外科学B' }));
  assert.ok(r1 && r1.some((x) => /含「:」或「\/」/.test(x)), JSON.stringify(r1));

  const r2 = V.detectSuspect(c({ name: '场地:17119/教师:徐克军/教学班:急诊医学-0001' }));
  assert.ok(r2 && r2.some((x) => /混入了教师\/场地/.test(x)), JSON.stringify(r2));

  const r3 = V.detectSuspect(c({ name: '注:内科学B' }));
  assert.ok(r3 && r3.some((x) => /被截断/.test(x)), JSON.stringify(r3));

  assert.ok(V.detectSuspect(c({ name: '这是一门课程名字特别特别长已经超过三十个字符了真的很长很长很长' })));
});

test('节次异常 / 缺教师地点 => 标记', () => {
  assert.ok(V.detectSuspect(c({ start: 5, end: 2 })).some((x) => /节次异常/.test(x)));
  assert.ok(V.detectSuspect(c({ teacher: '', room: '' })).some((x) => /没有教师和地点/.test(x)));
  assert.ok(V.detectSuspect(c({ start: 25, end: 26 })).some((x) => /超出范围/.test(x)));
  // 只有教师、没有地点 => 不算可疑
  assert.equal(V.detectSuspect(c({ room: '' })), null);
});

/* ================= 时间冲突 ================= */
test('同天同节次且周次有交集 => 冲突，双向都标记', () => {
  const a = c({ id: 'a', name: '急诊医学', teacher: '范哲林', weeks: [1] });
  const b = c({ id: 'b', name: '急诊医学', teacher: '宛传奇', weeks: [1, 2, 4, 5, 6] });
  const r = V.detectConflicts([a, b], 20);
  assert.ok(r['a'] && r['a'].length === 1, JSON.stringify(r));
  assert.ok(r['b'] && r['b'].length === 1, JSON.stringify(r));
  assert.match(r['a'][0], /与「急诊医学」时间冲突（第 1 周）/);
});

test('周次不重叠 / 节次不重叠 / 不同天 => 不算冲突', () => {
  const a = c({ id: 'a', weeks: [1, 2] });
  const b = c({ id: 'b', weeks: [3, 4] });
  assert.deepEqual(V.detectConflicts([a, b], 20), {});

  const c2 = c({ id: 'c', start: 6, end: 8, weeks: [1] });
  const d = c({ id: 'd', start: 2, end: 5, weeks: [1] });
  assert.deepEqual(V.detectConflicts([c2, d], 20), {});

  const e = c({ id: 'e', day: 2, weeks: [1] });
  const f = c({ id: 'f', day: 3, weeks: [1] });
  assert.deepEqual(V.detectConflicts([e, f], 20), {});
});

test('周次为空按「每周」参与冲突检测', () => {
  const a = c({ id: 'a', weeks: null });
  const b = c({ id: 'b', weeks: [10] });
  const r = V.detectConflicts([a, b], 20);
  assert.ok(r['a'] && r['b'], JSON.stringify(r));
});

/* ================= 汇总 + 人工确认 ================= */
test('annotate：人工确认过的课程不再标记', () => {
  const a = c({ id: 'a', name: '脏名:病例子', teacher: '', room: '' });
  const b = c({ id: 'b', confirmed: true, name: '脏名:病例子二', teacher: '', room: '' });
  const r = V.annotate([a, b], 20);
  assert.ok(r['a'], '未确认的应有标记');
  assert.equal(r['b'], undefined, '已确认的不该有标记');
});

test('annotate：kind 取值正确', () => {
  const only = V.annotate([c({ id: 's', teacher: '', room: '' })], 20);
  assert.equal(only['s'].kind, 'suspect');

  const a = c({ id: 'a', weeks: [1] });
  const b = c({ id: 'b', weeks: [1] });
  const both = V.annotate([a, b], 20);
  assert.equal(both['a'].kind, 'conflict');

  const a2 = c({ id: 'a2', weeks: [1], teacher: '', room: '' });
  const b2 = c({ id: 'b2', weeks: [1] });
  const mix = V.annotate([a2, b2], 20);
  assert.equal(mix['a2'].kind, 'both');
});
