import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../assets/parser.js');

/* ---------------- 样例 1：典型教务系统课表（rowspan + 多行单元格） ---------------- */
const HTML_TEACH = `<!DOCTYPE html><html><head><title>我的课表</title></head>
<body>
<div class="nav">首页 选课 成绩</div>
<table id="kb">
  <tr><th>节次</th><th>时间</th><th>星期一</th><th>星期二</th><th>星期三</th><th>星期四</th><th>星期五</th></tr>
  <tr><td rowspan="2">第1-2节</td><td rowspan="2">08:00-09:40</td>
      <td rowspan="2">高等数学<br>张三<br>1-16周<br>A101</td>
      <td></td>
      <td rowspan="2">大学英语<br>李四<br>1-16周(单)<br>B203</td>
      <td></td><td rowspan="2">体育<br>王五<br>1-16周<br>体育馆</td></tr>
  <tr><td></td><td></td></tr>
  <tr><td rowspan="2">第3-4节</td><td rowspan="2">10:00-11:40</td>
      <td></td>
      <td rowspan="2">程序设计基础<br>赵六<br>1-8周<br>机房301</td>
      <td></td><td></td><td></td></tr>
  <tr><td></td><td></td><td></td></tr>
</table>
</body></html>`;

test('HTML 课表：rowspan 合并单元格 + 单双周 + 教室', () => {
  const r = P.parseHtml(HTML_TEACH);
  assert.equal(r.ok, true, r.reason);
  const byName = Object.fromEntries(r.courses.map(c => [c.name, c]));
  assert.deepEqual(Object.keys(byName).sort(), ['体育', '大学英语', '程序设计基础', '高等数学']);

  const math = byName['高等数学'];
  assert.equal(math.day, 1);
  assert.equal(math.start, 1);
  assert.equal(math.end, 2);
  assert.equal(math.teacher, '张三');
  assert.equal(math.room, 'A101');
  assert.deepEqual(math.weeks, Array.from({ length: 16 }, (_, i) => i + 1));

  const eng = byName['大学英语'];
  assert.equal(eng.day, 3);
  assert.equal(eng.parity, 'odd');
  assert.equal(eng.weeks.length, 8);
  assert.equal(eng.weeks[0], 1);

  const pe = byName['体育'];
  assert.equal(pe.day, 5);
  assert.equal(pe.end, 2);

  const prog = byName['程序设计基础'];
  assert.equal(prog.day, 2);
  assert.equal(prog.start, 3);
  assert.equal(prog.end, 4);
  assert.deepEqual(prog.weeks, [1,2,3,4,5,6,7,8]);
});

/* ---------------- 样例 2：单元格自带节次、课程名带括号周次 ---------------- */
const HTML_ALT = `<html><body>
<table>
 <tr><td>时间</td><td>周一</td><td>周二</td><td>周三</td><td>周四</td><td>周五</td></tr>
 <tr><td>上午</td>
   <td>线代(1-16周) 陈老师 教三-201</td>
   <td></td><td></td><td></td><td></td></tr>
 <tr><td>1</td><td></td><td>数据结构 第3-4节 1-16周 孙老师 C区402</td><td></td><td></td><td></td></tr>
</table></body></html>`;

test('HTML 课表：单行单元格 / 括号周次 / 表格列名用「周一」', () => {
  const r = P.parseHtml(HTML_ALT);
  assert.equal(r.ok, true, r.reason);
  const ds = r.courses.find(c => c.name === '数据结构');
  assert.ok(ds, '应解析出 数据结构: ' + JSON.stringify(r.courses));
  assert.equal(ds.day, 2);
  assert.equal(ds.start, 3);
  assert.equal(ds.end, 4);
  assert.equal(ds.teacher, '孙老师');
  assert.equal(ds.room, 'C区402');

  const lin = r.courses.find(c => c.name.startsWith('线代'));
  assert.ok(lin, '应解析出 线代');
  assert.equal(lin.day, 1);
});

/* ---------------- 样例 3：从 Excel / 网页复制出来的制表符文本 ---------------- */
const TSV = `节次\t星期一\t星期二\t星期三\t星期四\t星期五
1\t高等数学\t\t\t\t
2\t\t线性代数\t\t\t
3\t\t\t\t概率论\t`;

test('TSV 导入：节次列 + 星期表头', () => {
  const r = P.parseTsv(TSV);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.courses.length, 3);
  const g = r.courses.find(c => c.name === '高等数学');
  assert.equal(g.day, 1); assert.equal(g.start, 1);
  const l = r.courses.find(c => c.name === '线性代数');
  assert.equal(l.day, 2); assert.equal(l.start, 2);
  const p = r.courses.find(c => c.name === '概率论');
  assert.equal(p.day, 4); assert.equal(p.start, 3);
});

/* ---------------- 样例 4：字段解析单元 ---------------- */
test('周次解析：范围 / 列表 / 单双周 / 全周', () => {
  assert.deepEqual(P.parseWeeks('1-8周').weeks, [1,2,3,4,5,6,7,8]);
  assert.deepEqual(P.parseWeeks('1-8周(单)').weeks, [1,3,5,7]);
  assert.deepEqual(P.parseWeeks('2-10双周').weeks, [2,4,6,8,10]);
  assert.deepEqual(P.parseWeeks('1-8,10-16周').weeks, [1,2,3,4,5,6,7,8,10,11,12,13,14,15,16]);
  assert.deepEqual(P.parseWeeks('第3周').weeks, [3]);
  assert.equal(P.parseWeeks('1-16周').parity, 'all');
  assert.equal(P.parseWeeks('每天'), null);
});

test('节次解析', () => {
  assert.deepEqual(P.parseSlots('第3-4节'), { start: 3, end: 4 });
  assert.deepEqual(P.parseSlots('3-4'), { start: 3, end: 4 });
  assert.deepEqual(P.parseSlots('第5节'), { start: 5, end: 5 });
  assert.deepEqual(P.parseSlots('十一节'), { start: 11, end: 11 });
  assert.equal(P.parseSlots('08:00-09:40'), null);
});

test('单元格拆分：无分隔符 / 仅课程名', () => {
  const a = P.splitCellText('高等数学');
  assert.equal(a.name, '高等数学');
  assert.equal(a.weeks, null);

  const b = P.splitCellText('2024-2025学年 高等数学\n张三\n1~16周\n教3-201');
  assert.equal(b.name, '高等数学');
  assert.equal(b.teacher, '张三');
  assert.equal(b.room, '教3-201');
});

/* ---------------- 样例 5：不是课表的页面不应误报 ---------------- */
test('非课表页面：明确失败而不是乱解析', () => {
  const r = P.parseHtml('<html><body><table><tr><td>成绩单</td></tr><tr><td>90</td></tr></table></body></html>');
  assert.equal(r.ok, false);
  assert.match(r.reason, /表头|没找到/);
});

/* ---------------- 样例 6：autoParse 自动识别 ---------------- */
test('autoParse 自动识别 HTML / TSV / 纯文本', () => {
  assert.equal(P.autoParse(HTML_TEACH).source, 'html');
  assert.equal(P.autoParse(TSV).source, 'tsv');
  const txt = `星期一\t星期二\n第1节\t高数\t英语`;
  assert.equal(P.autoParse(txt).source, 'tsv');
});
