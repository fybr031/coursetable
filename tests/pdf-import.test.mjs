import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Pdf = require('../assets/pdf-import.js');

/* ============ 1. PDF 字面量转义 + UCS-2 解码 ============
   真实 PDF 里中文以 UCS-2 存，字节中会出现 \t \b \( 等需要转义的情况 */
test('PDF 字面量转义：\\t \\b \\051 等应还原成原始字节', () => {
  // 中文 UCS-2 字节里常出现 0x09/0x08/0x28 等，PDF 里会被转义
  assert.deepEqual(Array.from(Pdf.literalToBytes('f\\tg\\tN\\t')), [0x66, 0x09, 0x67, 0x09, 0x4e, 0x09]);
  // \050=0x28 '('  \051=0x29 ')'  \052=0x2a '*'  \\ =0x5c
  assert.deepEqual(Array.from(Pdf.literalToBytes('\\050\\051\\052\\\\')), [0x28, 0x29, 0x2a, 0x5c]);
});

test('UCS-2 解码：中文/数字/括号', () => {
  // 中 U+4E2D、临 U+4E34、上 U+4E0A
  assert.equal(Pdf.decodeUcs2([0x4e, 0x2d, 0x4e, 0x34]), '中临');
  assert.equal(Pdf.decodeUcs2([0x4e, 0x2d, 0x4e, 0x0a]), '中上');
  // "(1-3节)" 的 UCS-2 字节
  const s = '(1-3节)';
  const enc = [];
  for (const ch of s) { const c = ch.codePointAt(0); enc.push(c >> 8, c & 0xff); }
  assert.equal(Pdf.decodeUcs2(enc), s);
});

/* ============ 2. 周次解析 ============ */
test('周次：单周 / 区间 / 列表 / 单双周', () => {
  assert.deepEqual(Pdf.expandWeeks('5周'), [5]);
  assert.deepEqual(Pdf.expandWeeks('5-6周'), [5, 6]);
  assert.deepEqual(Pdf.expandWeeks('2周,7周'), [2, 7]);
  assert.deepEqual(Pdf.expandWeeks('1周,8-13周'), [1, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual(Pdf.expandWeeks('7-9周(单)'), [7, 9]);
  assert.deepEqual(Pdf.expandWeeks('4-10周(双)'), [4, 6, 8, 10]);
});

/* ============ 3. 单元格文本 → 课程字段 ============ */
test('单元格解析：课程名/节次/周次/教师/场地/校区', () => {
  const c = Pdf.parseBlockText(
    '中西医临床儿科学*(1-3节)5周/校区:滨文校区/场地:17206/教师:王庆/教学班:中西医临床儿科学-0001D/教学班组成:临床2023级2班/选课备注:'
  );
  assert.equal(c.name, '中西医临床儿科学');
  assert.equal(c.start, 1);
  assert.equal(c.end, 3);
  assert.deepEqual(c.weeks, [5]);
  assert.equal(c.teacher, '王庆');
  assert.equal(c.room, '17206');
  assert.equal(c.campus, '滨文校区');

  const c2 = Pdf.parseBlockText('内科学B*(8-9节)11周,16周/校区:滨文校区/场地:18325/教师:丁月平/教学班:内科学B-0001/选课备注:');
  assert.deepEqual(c2.weeks, [11, 16]);
  assert.equal(c2.name, '内科学B');
  assert.equal(c2.room, '18325');

  // 折行导致的名字粘连（PDF 里名字可能折行，"○" 标记被拆到下一行）
  const c3 = Pdf.parseBlockText('急诊医学○(2-4节)13周/校区:校外校区/场地:新华医院-潮王院区-急诊科/教师:宛传奇');
  assert.equal(c3.name, '急诊医学');
  assert.equal(c3.room, '新华医院-潮王院区-急诊科');
});

/* ============ 4. 坐标 → 网格（模拟真实 PDF 的文字项） ============
   匿名化 fixture：结构与真实课表一致（第1页表头 + 7 列 + 溢出到第2页），
   内容用虚构课程，不含任何真实个人信息 */
const H = 521;   // 表头 y
const HEADER_X = { 1: 133, 2: 236.8, 3: 340.7, 4: 444.5, 5: 548.4, 6: 652.2, 7: 756.1 };
const CELL_X = { 1: 104.1, 2: 207.9, 3: 311.8, 4: 415.6, 5: 519.5, 6: 623.3, 7: 727.2 };

function item(day, y, text, page = 1, size = 8) {
  return { page, x: CELL_X[day], y, size, text };
}

const ITEMS = [
  // 表头
  { page: 1, x: 21.4, y: H, size: 12, text: '时间段' },
  { page: 1, x: 68.9, y: H, size: 12, text: '节次' },
  ...[1, 2, 3, 4, 5, 6, 7].map((d) => ({
    page: 1, x: HEADER_X[d], y: H, size: 12,
    text: '星期' + '一二三四五六日'[d - 1]
  })),
  // 标题/学号（应被过滤掉，不能被当成课程）
  { page: 1, x: 361, y: 545, size: 24, text: '测试同学课表' },
  { page: 1, x: 690.5, y: 553, size: 8, text: ' 学号：000000000000000' },

  // 周一：两门课，各 2 行
  item(1, 505.5, '高等数学', 1, 9),
  item(1, 493.5, '(1-2节)1-16周/校区:主校区/场地:A101/教师:张三/教学班:X-01/选课备注:'),
  item(1, 420.0, '大学物理', 1, 9),
  item(1, 408.0, '(3-4节)5周/校区:主校区/场地:B202/教师:李四/教学班:X-02/选课备注:'),

  // 周二：一门课，文字溢出到第 2 页（同一列 x，行距仍是 12）
  item(2, 505.5, '程序设计基础', 1, 9),
  item(2, 493.5, '(5-6节)1-8周/校区:主校区/场地:机房301/教师:王五/教学班:X-03/教学班组成:测试', 1, 8),
  // 第 2 页继续同一单元格
  item(2, 565.5, '班级1班;测试班级2班/选课备注:', 2, 8),

  // 周三：单行（名字与详情同一行，无折行）
  item(3, 505.5, '体育(7-8节)2周/校区:主校区/场地:体育馆/教师:赵六/选课备注:', 1, 9)
];

test('文字项 → 课程：列归属、块切分、跨页续行、过滤标题', () => {
  const res = Pdf.itemsToCourses(ITEMS);
  assert.equal(res.ok, true, res.reason);
  const byName = {};
  res.courses.forEach((c) => { byName[c.name] = c; });

  // 标题/学号不应变成课程
  assert.equal(byName['测试同学课表'], undefined);
  assert.ok(!res.courses.some((c) => /学号/.test(c.name)), '学号行不该成为课程');

  assert.equal(res.courses.length, 4, '应有 4 门课，实际：' + res.courses.map((c) => c.name).join(','));

  const math = byName['高等数学'];
  assert.equal(math.day, 1);
  assert.equal(math.start, 1);
  assert.equal(math.end, 2);
  assert.deepEqual(math.weeks, Array.from({ length: 16 }, (_, i) => i + 1));
  assert.equal(math.teacher, '张三');
  assert.equal(math.room, 'A101');

  const phy = byName['大学物理'];
  assert.equal(phy.day, 1);
  assert.equal(phy.start, 3);
  assert.deepEqual(phy.weeks, [5]);

  // 跨页续行的课程应完整（教师/场地来自第 1 页，备注行来自第 2 页，不影响字段）
  const prog = byName['程序设计基础'];
  assert.equal(prog.day, 2);
  assert.equal(prog.start, 5);
  assert.deepEqual(prog.weeks, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(prog.teacher, '王五');
  assert.equal(prog.room, '机房301');

  const pe = byName['体育'];
  assert.equal(pe.day, 3);
  assert.deepEqual(pe.weeks, [2]);
  assert.equal(pe.room, '体育馆');
});

test('没有课的 PDF：明确失败而不是瞎解析', () => {
  const res = Pdf.itemsToCourses([{ page: 1, x: 10, y: 10, size: 12, text: '随便一段文字' }]);
  assert.equal(res.ok, false);
  assert.match(res.reason, /表头|文字层/);
});

test('空输入不崩', async () => {
  const res = await Pdf.parse(new ArrayBuffer(0));
  assert.equal(res.ok, false);
});
