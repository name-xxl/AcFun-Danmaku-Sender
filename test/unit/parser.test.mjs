// 解析层单测（node --test）
//
// 覆盖范围：SRT / LRC / ASS 的解析契约 + parseColor 的 BBGGRR→RRGGBB 换算。
// 这些都是纯函数（字符串进、结构出，无 DOM/window），可以在 Node 里直接跑。
//
// 引擎层的覆盖仍归 tools/smoke-test.js（15 组）：50-engine 依赖 40-core 的模块级
// storeGet（读 localStorage），在单测里要拖一整套浏览器桩进来，不如留在冒烟层（RISKS R6）。
//
// 用法：npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSub, parseColor } from '../../src/30-parser.js';

// ---------------- SRT ----------------

test('SRT：解析时间轴与多行文本，按时间排序', () => {
    const srt = [
        '2',
        '00:00:05,000 --> 00:00:07,000',
        '第二条',
        '',
        '1',
        '00:00:01,000 --> 00:00:03,500',
        '第一行',
        '第二行',
        '',
    ].join('\n');
    const r = parseSub(srt, 'a.srt');
    assert.equal(r.length, 2);
    // 输入里第 2 条在前，输出应按 time 升序
    assert.deepEqual(r.map((x) => x.time), [1000, 5000]);
    assert.equal(r[0].endTime, 3500);
    assert.equal(r[0].text, '第一行\n第二行');
    assert.equal(r[1].text, '第二条');
    assert.equal(r[1].endTime, 7000);
});

test('SRT：无 --> 的块被跳过', () => {
    const r = parseSub('这是一段没有时间轴的垃圾\n\n1\n00:00:01,000 --> 00:00:02,000\n有内容', 'a.srt');
    assert.equal(r.length, 1);
    assert.equal(r[0].text, '有内容');
});

test('SRT：有箭头但正文为空的行不产出', () => {
    const r = parseSub('1\n00:00:01,000 --> 00:00:02,000\n\n', 'a.srt');
    assert.equal(r.length, 0);
});

// ---------------- LRC ----------------

test('LRC：解析 [mm:ss.xx] 与 [mm:ss.xxx]，无结束时间', () => {
    const r = parseSub('[00:01.00]第一句\n[00:05.50]第二句\n', 'a.lrc');
    assert.equal(r.length, 2);
    assert.deepEqual(r.map((x) => x.time), [1000, 5500]);
    assert.equal(r[0].text, '第一句');
    assert.equal('endTime' in r[0], false);   // LRC 无结束时间，靠相邻行反推
});

test('LRC：一行多个时间标签展开成多条', () => {
    const r = parseSub('[00:01.00][00:10.00]副歌\n', 'a.lrc');
    assert.equal(r.length, 2);
    assert.deepEqual(r.map((x) => x.time), [1000, 10000]);
    assert.deepEqual(r.map((x) => x.text), ['副歌', '副歌']);
});

test('LRC：无时间标签的行被忽略', () => {
    const r = parseSub('[ar:某歌手]\n[00:01.00]正文\n', 'a.lrc');
    assert.equal(r.length, 1);   // [ar:...] 不匹配 mm:ss，被忽略
    assert.equal(r[0].text, '正文');
});

test('LRC：同一行 / 或 | 分隔拆成 main / sub', () => {
    const r = parseSub('[00:01.00]hello / 你好\n', 'a.lrc');
    assert.equal(r.length, 1);
    assert.equal(r[0].main, 'hello');
    assert.equal(r[0].sub, '你好');
    assert.equal(r[0].text, 'hello / 你好');
});

test('LRC：同一时间戳相邻两行配对成 main / sub', () => {
    const r = parseSub('[00:01.00]abc\n[00:01.00]def\n', 'a.lrc');
    assert.equal(r.length, 1);
    assert.equal(r[0].main, 'abc');
    assert.equal(r[0].sub, 'def');
    assert.equal(r[0].text, 'abc / def');
});

test('LRC：时间戳不同则不配对', () => {
    const r = parseSub('[00:01.00]abc\n[00:02.00]def\n', 'a.lrc');
    assert.equal(r.length, 2);
    assert.equal(r[0].main, undefined);
});

// ---------------- ASS ----------------

const ASS_FIXTURE = [
    '[Script Info]',
    'Title: t',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, Alignment, Bold, Italic, Underline, Shadow, Outline',
    // 刻意让每个字段都【异于默认值】，这样用例才能区分「真的读到了文件值」与「落回默认」
    //   默认 = SimHei / 24 / 0xffffff / bold false / italic false / underline false / shadow true / stroke false
    'Style: Default,Arial,40,&H000000FF,7,0,-1,-1,0,0',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Text',
    'Dialogue: 0,0:00:01.00,0:00:03.00,Default,你好\\N世界',
    'Dialogue: 0,0:00:05.50,0:00:07.00,Default,{pos(1,2)}带标签',
    '',
].join('\n');

test('ASS：解析时间、\\N 硬换行、剥覆盖标签', () => {
    const r = parseSub(ASS_FIXTURE, 'a.ass');
    assert.equal(r.length, 2);
    assert.deepEqual(r.map((x) => x.time), [1000, 5500]);
    assert.equal(r[0].text, '你好\n世界');      // \N → 换行
    assert.equal(r[1].text, '带标签');          // {...} 覆盖标签被剥掉
});

test('ASS：当前不产出 endTime（既有行为，特征化固定）', () => {
    const r = parseSub(ASS_FIXTURE, 'a.ass');
    assert.equal('endTime' in r[0], false);
});

test('ASS：style 逐字段取自 [V4+ Styles]（6.9.1 修掉两个成因后生效）', () => {
    const r = parseSub(ASS_FIXTURE, 'a.ass');
    const st = r[0].style;
    // 夹具 Style: Default,Arial,40,&H000000FF,7,0,-1,-1,0,0
    //   Fontname=Arial  Fontsize=40  PrimaryColour=&H000000FF  Alignment=7
    //   Bold=0  Italic=-1  Underline=-1  Shadow=0  Outline=0
    // 每个字段都异于默认值，故本用例能区分「读到文件值」与「落回默认」。
    assert.equal(typeof st, 'object');
    assert.equal(st.font, 'Arial');
    assert.equal(st.size, 40);
    assert.equal(st.color, 0xff0000);   // &H000000FF = BBGGRR → 红
    assert.equal(st.bold, false);       // 0 = 关
    assert.equal(st.italic, true);      // -1 = 开
    assert.equal(st.underline, true);
    assert.equal(st.shadow, false);     // 0 = 关
    assert.equal(st.stroke, false);     // Outline=0 → 无描边
    assert.equal(st.anchor, 0);         // ASS numpad 7 → A 站锚点 0
});

test('ASS：Format 里未声明的字段落回默认值', () => {
    const mini = [
        '[V4+ Styles]',
        'Format: Name, Fontname',
        'Style: Default,Arial',
        '',
        '[Events]',
        'Format: Layer, Start, End, Style, Text',
        'Dialogue: 0,0:00:01.00,0:00:02.00,Default,文本',
        '',
    ].join('\n');
    const st = parseSub(mini, 'a.ass')[0].style;
    assert.equal(st.font, 'Arial');      // 文件给了
    assert.equal(st.size, 24);           // 未声明 → 默认
    assert.equal(st.color, 0xffffff);    // 未声明 → 默认
    assert.equal(st.bold, false);        // 未声明 → 默认
    assert.equal(st.anchor, 7);          // Alignment 缺省按 2 → A 站 7
});

test('扩展名分发：.ass 与 .ssa 都走 ASS 解析器（.ssa 为 6.9.1 修复）', () => {
    assert.equal(parseSub(ASS_FIXTURE, 'a.ass').length, 2);
    assert.equal(parseSub(ASS_FIXTURE, 'a.ssa').length, 2);
    assert.equal(parseSub(ASS_FIXTURE, 'a.SSA').length, 2);   // 大小写不敏感
});

test('未知扩展名走 SRT 解析', () => {
    const r = parseSub('1\n00:00:01,000 --> 00:00:02,000\n内容', 'a.txt');
    assert.equal(r.length, 1);
});

// ---------------- parseColor ----------------

test('parseColor：&HAABBGGRR → 0xRRGGBB', () => {
    assert.equal(parseColor('&H00FFFFFF'), 0xffffff);
    // &H00 00 00 FF → BB=00 GG=00 RR=FF → 红
    assert.equal(parseColor('&H000000FF'), 0xff0000);
    // &H00 00 FF 00 → BB=00 GG=FF RR=00 → 绿
    assert.equal(parseColor('&H0000FF00'), 0x00ff00);
    // 省略 alpha 的 6 位形式
    assert.equal(parseColor('&HFF0000'), 0x0000ff);
});

test('parseColor：末尾可选的 & 后缀被接受', () => {
    assert.equal(parseColor('&H000000FF&'), 0xff0000);
});

test('parseColor：非法输入回退白色', () => {
    assert.equal(parseColor('$FFFFFF'), 0xffffff);
    assert.equal(parseColor(''), 0xffffff);
    assert.equal(parseColor(undefined), 0xffffff);
});
