// 模型 lint（lintModel）的判据测试（node --test）
//
// 要守的东西：闸② 的承诺是「不通过则列出病灶、拒绝导出」，而它的反面——**静默不渲染**——已经在
// API.md §十二 补记里咬过一次人：spike 工具缺 contentType / startTimeNow 时，渲染器照建 DOM 节点、
// 照生成 @keyframes、**不报错**，弹幕却永远停在缓冲、画面上什么都没有。
//
// 本文件不测「lint 的实现细节」，测的是**每条判据的两端**：
//   ① 故意做坏的夹具逐条必须被抓到，且 rule 可辨识（不然 UI 无法按类归并病灶）；
//   ② 合法模型零告警——夹具取 buildModel / buildAnimationFrames 的**真实产出**，不是手抄的形状
//      （手抄的形状会随构造函数一起漂，测的就不是同一条契约了）；边界值（255 码点、255 码点 × emoji、
//      坐标 ±1000）单独钉，防止判据被写成 >= / 数 UTF-16 长度 / 又退回区间检查；
//   ③ 纯函数：不写 model（深比较前后）、不抛错（null / 数组 / {} 都返回结果）；
//   ④ **不变量**：内置预设 × motion 引擎 × 代表性文本的真实产出必须全部过 lint（本文件最后两条）。
//      这条是 6.13.1 补的，也是本文件里最不会过时的一条：①② 只测「我写坏的它能不能抓」，
//      而 6.13.0 的 23 条全绿却没发现 frame-pos-range 误杀 motion.slide——因为没有任何一条在跑
//      **我们自己的产出**。今后任何一条判据只要开始误杀自己的产出，④ 立刻红灯。
//
// 判据出处一律写进断言文案（API.md 章节号），改判据必须先改这里的出处——没有出处的判据不该进 lint。
//
// 用法：npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// gdm-model 的 import 图（→ 40-core）在求值期会碰 window / document / localStorage（与冒烟测试同款最小桩）
globalThis.window = globalThis;
globalThis.unsafeWindow = globalThis;
globalThis.document = {
    readyState: 'loading',
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return { style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, setAttribute() {}, remove() {} }; },
};
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');

const { buildAnimationFrames, buildModel, lintModel, normalizeEffects } = await import('../../src/gdm-model.js');
const CORE = await import('../../src/40-core.js');
const { BUILTIN_PRESETS } = await import('../../src/10-constants.js');
const { COMPOSITIONS, ENGINES, expandSub } = await import('../../src/50-engine.js');
const { parseSub } = await import('../../src/30-parser.js');
const { TIMING_FUNCS } = await import('../../src/85-danmaku.js');

// ---------------- 夹具：合法模型取真实产出 ----------------

// 固定 cfg（不读 currentStyleConfig：lint 的契约不该随编辑器当前样式漂）
const CFG = {
    font: 'SimHei', size: 24, color: 0xffffff, bold: false, stroke: true,
    anchor: 4, posX: 50, posY: 85, moveTime: 3000, shadow: false,
};
const ADV0 = normalizeEffects(null);                     // 顶层 scale/rotate 回落默认（moves 的帧级回落靠它）

const okModel = () => buildModel({ time: 1000, text: '合法弹幕' }, CFG, 3000, null, null);
const okFrame = () => buildAnimationFrames(null, CFG, ADV0, 3000)[0];

const rulesOf = (v) => lintModel(v).problems.map((p) => p.rule);
const pathsOf = (v) => lintModel(v).problems.map((p) => p.path);
// 断「这条 rule 抓到，且指到了指定的位置」
function assertCaught(model, rule, pathLike, why) {
    const r = lintModel(model);
    assert.equal(r.ok, false, why + '：应判不通过，实际 ok=true（判据被放松了？）');
    const hit = r.problems.filter((p) => p.rule === rule);
    assert.ok(hit.length > 0, why + '：应报 rule=' + rule + '，实际 [' + rulesOf(model).join(', ') + ']');
    assert.ok(hit.some((p) => String(p.path).indexOf(pathLike) >= 0),
        why + '：rule=' + rule + ' 应指向 ' + pathLike + '，实际 [' + hit.map((p) => p.path).join(', ') + ']');
    hit.forEach((p) => assert.ok(p.detail && p.detail.length > 0, why + '：rule=' + rule + ' 的 detail 不能为空'));
}
// 改一帧（真实帧的浅拷贝）后塞回模型
function withFrame(patch, mutate) {
    const m = okModel();
    const f = Object.assign({}, okFrame(), patch);
    if (mutate) mutate(f);
    m.animationFrames = [f];
    return m;
}

// ---------------- ① 合法模型零告警 ----------------

test('合法模型零告警：buildModel 的真实产出（含 buildAnimationFrames 的真实帧）', () => {
    const m = okModel();
    // 夹具自检：确认它真的是「真实产出」而不是恰好成立的空壳
    assert.equal(m.id.length, 40, '夹具的 id 应是 40 位 hex（§五）');
    assert.equal(m.animationFrames.length, 1, '夹具应有 1 帧');
    assert.equal(m.animationFrames[0].from.pos.x, 50, '夹具帧坐标应来自 cfg.posX');
    assert.deepEqual(lintModel(m), { ok: true, problems: [] }, '合法模型不应有任何告警');
});

test('合法模型零告警：编辑器自己的 28 项缓动表全部合法（白名单是 §六，不是这张表）', async () => {
    const seen = new Set();
    TIMING_FUNCS.forEach(({ value }) => {
        seen.add(value);
        const r = lintModel(withFrame({ timingFunction: value }));
        assert.equal(r.ok, true, '缓动「' + value + '」是编辑器的合法选项（85-danmaku.TIMING_FUNCS），lint 不该拦：' + JSON.stringify(r.problems));
    });
    assert.equal(TIMING_FUNCS.length, 28, '缓动表应为 28 项');
    assert.ok(seen.size > 0, '缓动表为空？');
});

test('cubic-bezier 判据：x 分量须 ∈ [0,1]，y 分量不限（回退缓动的 1.275 合法）', () => {
    // §六 表内即有此值，是「y 超调也合法」的现成反例
    assert.equal(lintModel(withFrame({ timingFunction: 'cubic-bezier(0.175,0.885,0.32,1.275)' })).ok, true, 'y=1.275 超调合法');
    assert.ok(rulesOf(withFrame({ timingFunction: 'cubic-bezier(1.5,0,0,1)' })).indexOf('timing-function') >= 0, 'x1=1.5 超界应报');
    assert.ok(rulesOf(withFrame({ timingFunction: 'cubic-bezier(0.5,0,0.5)' })).indexOf('timing-function') >= 0, '参数不足四个应报');
    assert.ok(rulesOf(withFrame({ timingFunction: 'cubic-bezier(a,b,c,d)' })).indexOf('timing-function') >= 0, '非数字应报');
});

// ---------------- ② 故意做坏的夹具：逐条必须被抓到 ----------------

test('缺 contentType 被抓到（§五 12 字段 + §十二 补记：缺它 = 弹幕永停在缓冲、画面上什么都没有）', () => {
    const m = okModel();
    delete m.contentType;
    assertCaught(m, 'field-missing', 'contentType', '缺 contentType');
});

test('缺 startTimeNow 同样被抓到（§十二 补记：与 contentType 成对删除时二者皆不可见）', () => {
    const m = okModel();
    delete m.startTimeNow;
    assertCaught(m, 'field-missing', 'startTimeNow', '缺 startTimeNow');
});

test('坐标 101 / −1 / 195 / −95 都是合法技法，不该拦（屏幕外坐标是 slide 的实现方式，不是病灶）', () => {
    // motion.slide（50-engine）：w = min(90, max(10, 文本长×4))、出屏余量 M = 5、按锚点列取 off[col]
    //   从右滑入 col=2 → 100 + w + M = 195（上限）；从左滑入 col=0 → -(w + M) = -95（下限）。
    // 6.13.0 曾把判据写成「必须落在 0–100」，于是**所有 slide 弹幕**都被误杀（R10，见 6.13.1）。
    [101, -1, 195, -95, 105, -5].forEach((v) => {
        assert.equal(lintModel(withFrame(null, (f) => { f.from.pos.x = v; })).ok, true, 'x=' + v + ' 是屏幕外起点，合法（不该拦）');
        assert.equal(lintModel(withFrame(null, (f) => { f.to.pos.y = v; })).ok, true, 'y=' + v + ' 同上');
    });
    // 边界 ±1000 通过（判据边界本身不算量级错误）
    assert.equal(lintModel(withFrame(null, (f) => { f.from.pos.x = 1000; f.to.pos.y = -1000; })).ok, true, '±1000 是判据边界');
});

test('坐标量级错误被抓到（像素当百分比传、100 写成 10000 那类错 → 弹幕永远看不见）', () => {
    assertCaught(withFrame(null, (f) => { f.from.pos.x = 10100; }), 'frame-pos-range', 'from.pos.x', '按视频宽度传了像素（10100）');
    assertCaught(withFrame(null, (f) => { f.to.pos.y = -5000; }), 'frame-pos-range', 'to.pos.y', '负数错到 -5000');
    assertCaught(withFrame(null, (f) => { f.from.pos.y = 1001; }), 'frame-pos-range', 'from.pos.y', '越边界一格（1001）');
    assertCaught(withFrame(null, (f) => { f.to.pos.x = -1001; }), 'frame-pos-range', 'to.pos.x', '越边界一格（-1001）');
});

test('负时长被抓到（§五 总存活时长 + §十二 附录 #2：入池窗口 startTime < n ≤ startTime+durationTime 恒空）', () => {
    assertCaught(Object.assign(okModel(), { durationTime: -1 }), 'duration-time', 'durationTime', 'durationTime=-1');
    assertCaught(Object.assign(okModel(), { durationTime: 0 }), 'duration-time', 'durationTime', 'durationTime=0');
});

test('timingFunction 非法值被抓到（§六：只有 CSS 合法值生效，非法值 = 弹幕停在 (0,0)）', () => {
    assertCaught(withFrame({ timingFunction: 'wobble' }), 'timing-function', 'timingFunction', 'timingFunction=wobble');
    // §六 明记：Canvas 渲染器的 30 种 key（quadEaseIn 一族）在默认 DOM_CSS 路径下会让 animation 非法
    assertCaught(withFrame({ timingFunction: 'quadEaseIn' }), 'timing-function', 'timingFunction', 'timingFunction=quadEaseIn');
    assertCaught(withFrame(null, (f) => { delete f.timingFunction; }), 'timing-function', 'timingFunction', '缺 timingFunction');
});

test('空 content 被抓到（§二 body 文本非空）', () => {
    assertCaught(Object.assign(okModel(), { content: '' }), 'content-empty', 'content', 'content=""');
    assertCaught(Object.assign(okModel(), { content: '   ' }), 'content-empty', 'content', 'content=全空白');
});

test('超 255 码点被抓到，且按【码点】而不是 UTF-16 长度算（§二 body + buildModel 的 Array.from 截断）', () => {
    assertCaught(Object.assign(okModel(), { content: 'a'.repeat(256) }), 'content-too-long', 'content', '256 个 ASCII');
    // 255 个 emoji：UTF-16 长度 510，码点 255 —— 合法（buildModel 也按码点截断，两边必须同口径）
    assert.equal(lintModel(Object.assign(okModel(), { content: '😀'.repeat(255) })).ok, true, '255 个码点的 emoji 合法（不是按 UTF-16 长 510 判）');
    assertCaught(Object.assign(okModel(), { content: '😀'.repeat(256) }), 'content-too-long', 'content', '256 个码点的 emoji');
});

test('zIndex: 0 被抓到（§五 字段表：层级 1~99）', () => {
    assertCaught(Object.assign(okModel(), { zIndex: 0 }), 'z-index-range', 'zIndex', 'zIndex=0');
    assertCaught(Object.assign(okModel(), { zIndex: 100 }), 'z-index-range', 'zIndex', 'zIndex=100');
    assert.equal(lintModel(Object.assign(okModel(), { zIndex: 1 })).ok, true, '1 是合法端点');
    assert.equal(lintModel(Object.assign(okModel(), { zIndex: 99 })).ok, true, '99 是合法端点');
});

test('anchor 越界 / 非整数被抓到（§五 + §六 九宫格 0~8）', () => {
    assertCaught(Object.assign(okModel(), { anchor: 9 }), 'anchor-range', 'anchor', 'anchor=9');
    assertCaught(Object.assign(okModel(), { anchor: 4.5 }), 'anchor-range', 'anchor', 'anchor=4.5');
});

test('contentType 越界被抓到（§五 / §六：0=文本 Text，1=Base64 图片）', () => {
    assertCaught(Object.assign(okModel(), { contentType: 2 }), 'content-type-value', 'contentType', 'contentType=2');
    assert.equal(lintModel(Object.assign(okModel(), { contentType: 1 })).ok, true, 'contentType=1 合法');
});

test('id 形态被抓到（§五：40 位 hex）', () => {
    assertCaught(Object.assign(okModel(), { id: 'abc' }), 'id-format', 'id', 'id 太短');
    assertCaught(Object.assign(okModel(), { id: 'z'.repeat(40) }), 'id-format', 'id', 'id 含非 hex 字符');
});

test('帧结构 / 帧数值缺失被抓到（§五 运动帧表：两端各 pos/scale/rotate 三组三轴）', () => {
    assertCaught(withFrame(null, (f) => { delete f.to; }), 'frame-shape', 'to', '缺 to 端点');
    assertCaught(withFrame(null, (f) => { delete f.from.scale; }), 'frame-shape', 'from.scale', '缺 from.scale');
    assertCaught(withFrame(null, (f) => { f.to.pos.x = '50'; }), 'frame-number', 'to.pos.x', '坐标是字符串');
    assertCaught(withFrame(null, (f) => { f.from.rotate.z = NaN; }), 'frame-number', 'from.rotate.z', '旋转是 NaN');
});

test('帧 moveTime 下限被抓到（buildAnimationFrames 的 Math.max(100, …)；API.md 帧表只记「运动耗时」）', () => {
    assertCaught(withFrame({ moveTime: 99 }), 'frame-move-time', 'moveTime', 'moveTime=99');
    assertCaught(withFrame({ moveTime: 0 }), 'frame-move-time', 'moveTime', 'moveTime=0');
    assertCaught(withFrame(null, (f) => { delete f.moveTime; }), 'frame-move-time', 'moveTime', '缺 moveTime');
    assert.equal(lintModel(withFrame({ moveTime: 100 })).ok, true, '100 是合法端点（构造函数的下限本身）');
});

test('animationFrames 空数组被抓到（§五 运动帧列表 + §十二 T1：渲染器只为带 animationFrames 的 model 建节点）', () => {
    assertCaught(Object.assign(okModel(), { animationFrames: [] }), 'frames-empty', 'animationFrames', '空帧列表');
});

test('必填 12 字段全缺时：12 条 field-missing，一条不漏（§五 顶层结构）', () => {
    const r = lintModel({});
    assert.equal(r.ok, false, '空对象应判不通过');
    assert.equal(r.problems.length, 12, '§五 顶层结构是 12 个字段，实际报 ' + r.problems.length);
    r.problems.forEach((p) => assert.equal(p.rule, 'field-missing', '空对象只该报 field-missing'));
});

test('类型错报 field-type（§五 字段表「类型」列）', () => {
    assertCaught(Object.assign(okModel(), { startTime: '1000' }), 'field-type', 'startTime', 'startTime 是字符串');
    assertCaught(Object.assign(okModel(), { startTime: NaN }), 'field-type', 'startTime', 'startTime 是 NaN');
    assertCaught(Object.assign(okModel(), { startTimeNow: 0 }), 'field-type', 'startTimeNow', 'startTimeNow 不是 boolean');
    assertCaught(Object.assign(okModel(), { animationFrames: {} }), 'field-type', 'animationFrames', 'animationFrames 不是数组');
});

// ---------------- ③ 纯函数：不写 model、不抛错 ----------------

test('纯函数：lint 不改动 model（前后深比较相等）', () => {
    const m = okModel();
    const before = JSON.parse(JSON.stringify(m));
    lintModel(withFrame({ timingFunction: 'wobble' }));   // 顺带跑一次必报的路径
    lintModel(m);
    assert.deepEqual(m, before, 'lintModel 不该写 model（它是闸，不是修理工）');
});

test('坏输入不抛错：null / undefined / 数组 / 数字 → model-shape', () => {
    [null, undefined, [], 42, 'model'].forEach((v) => {
        const r = lintModel(v);
        assert.equal(r.ok, false, '非对象输入应判不通过：' + JSON.stringify(v));
        assert.deepEqual(r.problems.map((p) => p.rule), ['model-shape'], '非对象输入应只报 model-shape');
    });
});

// ---------------- ④ 搬迁的结构守卫（A 部分） ----------------

test('40-core 不再导出这三个名字（re-export 会成环，check-deps 立即红）', () => {
    ['buildModel', 'buildAnimationFrames', 'normalizeEffects'].forEach((k) => {
        assert.equal(k in CORE, false, '40-core 不该再有 ' + k + '——它的家在 gdm-model.js');
    });
    ['advancedConfig', 'timeOffset', 'num', 'clamp', 'normalizeFont'].forEach((k) => {
        assert.equal(k in CORE, true, 'gdm-model 从 40-core 读的活绑定 ' + k + ' 必须仍然导出');
    });
});

test('gdm-model 不引 DOM：代码里没有 document / window / localStorage / querySelector', () => {
    const code = read('gdm-model.js').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    ['document', 'window', 'localStorage', 'querySelector', 'setTimeout'].forEach((n) => {
        assert.equal(new RegExp('\\b' + n + '\\b').test(code), false, 'gdm-model 的代码里不该出现 ' + n + '（lint 与构造都是纯函数）');
    });
});

// ---------------- ⑤ 不变量：我们自己的产出必须过 lint ----------------

// 这条测试的来历（6.13.1）：6.13.0 的判据测试全绿，却没发现 frame-pos-range 把【所有 motion.slide 弹幕】
// 判成病灶——因为那些测试只问「我写坏的它抓不抓得到」，从没跑过**我们自己的产出**。
// 这里补上：内置预设 × motion 引擎 × 代表性文本，走真实入口 expandSub 产出模型，逐条过 lint。
// 好处是它不依赖任何人记住维护清单：以后新增引擎/预设/判据，只要开始误杀自己，这里立刻红灯。
const MOTION_KEYS = Object.keys(ENGINES.motion);
const SLIDE_DIRS = ['left', 'right', 'top', 'bottom'];
const SAMPLES = [
    { label: '单字', text: '甲' },
    { label: '20 字', text: '一二三四五六七八九十一二三四五六七八九十' },
    { label: '多行（SRT 多行原样）', text: '第一行\n第二行' },
    { label: '中英混排', text: 'Hello 世界 mixed 混排 123' },
    { label: 'emoji', text: '😀😀😀' },
    { label: '120 字（顶到 slide 的文本宽度上限 w=90）', text: '字'.repeat(120) },
];

// 组合：① 每个内置预设本身（不换 motion，最真实的那条路径）；② 每个预设 × 每个 motion 引擎。
// 'none' 预设没有 composition（expandSub 对它直落 buildModel），故合成一个最小组合
// { split:none, layout:none, color:single, timing:uniform } 来承载 motion 维度——用的仍是真引擎。
// slide 单独拆成 4 个方向 × 2 个锚点列（col 0 与 col 2），把 -(w+M)=-95 与 100+w+M=195 两个极端都打到。
function invariantCases() {
    const cases = [];
    BUILTIN_PRESETS.forEach((p) => cases.push({ label: '预设 ' + p.id, presetId: p.id, anchor: 4 }));
    BUILTIN_PRESETS.forEach((p) => {
        const base = p.composition || COMPOSITIONS[p.transform]
            || { split: 'none', layout: 'none', color: 'single', timing: 'uniform' };
        MOTION_KEYS.forEach((m) => {
            const mk = (id, options, anchor, label) => {
                CORE.customPresets.push({ id, name: id, composition: Object.assign({}, base, { motion: m }), options });
                cases.push({ label, presetId: id, anchor });
            };
            if (m === 'slide') {
                SLIDE_DIRS.forEach((dir) => {
                    [0, 2].forEach((anchor) => mk('__inv_' + p.id + '_slide_' + dir + '_a' + anchor,
                        Object.assign({}, p.options || {}, { slide: { from: dir } }), anchor,
                        '预设 ' + p.id + ' × motion slide(' + dir + ', anchor=' + anchor + ')'));
                });
                return;
            }
            mk('__inv_' + p.id + '_' + m, Object.assign({}, p.options || {}), 4, '预设 ' + p.id + ' × motion ' + m);
        });
    });
    return cases;
}

test('不变量：内置预设 × motion 引擎 × 代表性文本的真实产出必须全部过 lint', () => {
    const savedCustom = CORE.customPresets.length;
    const savedPreset = CORE.activePresetId;
    const cases = invariantCases();
    const lines = [];
    const failures = [];
    let models = 0, flagged = 0;
    let xMin = Infinity, xMax = -Infinity;   // 顺带记录产出坐标的极值：证明 slide 的屏幕外起点真被跑到了
    try {
        cases.forEach((c) => {
            CORE.setActivePresetId(c.presetId);
            const cfg = Object.assign({}, CFG, { anchor: c.anchor });
            let nCase = 0, badCase = 0;
            SAMPLES.forEach((s) => {
                const out = expandSub({ time: 1000, text: s.text }, cfg, 3000, 1, null);
                const bad = out.map(lintModel).filter((r) => !r.ok);
                out.forEach((m) => m.animationFrames.forEach((f) => {
                    ['from', 'to'].forEach((e) => {
                        xMin = Math.min(xMin, f[e].pos.x, f[e].pos.y);
                        xMax = Math.max(xMax, f[e].pos.x, f[e].pos.y);
                    });
                }));
                models += out.length; nCase += out.length; flagged += bad.length; badCase += bad.length;
                if (bad.length) {
                    failures.push('  ✗ ' + c.label + ' × 样例「' + s.label + '」：' + bad.length + '/' + out.length + ' 条不通过 → '
                        + bad[0].problems.map((p) => p.rule + '@' + p.path).join(', '));
                }
            });
            lines.push('  ' + c.label + ' → ' + nCase + ' 条 model，' + badCase + ' 条不通过');
        });
    } finally {
        CORE.setActivePresetId(savedPreset);
        CORE.customPresets.length = savedCustom;
    }
    console.log('[不变量] 预设 ' + BUILTIN_PRESETS.length + ' 个 × motion 引擎 ' + MOTION_KEYS.length + ' 个（' + MOTION_KEYS.join('/') + '）'
        + ' × 文本样例 ' + SAMPLES.length + ' 例 → 预设/引擎组合 ' + cases.length + ' 组、expandSub 调用 ' + (cases.length * SAMPLES.length) + ' 次'
        + ' → model 共 ' + models + ' 条，不通过 ' + flagged + ' 条；产出坐标范围 [' + xMin + ', ' + xMax + ']'
        + '（slide 的屏幕外起点 -95…195 就在其中——按「必须 0–100」判会把这些全拦下）');
    console.log(lines.join('\n'));
    assert.deepEqual(failures, [], '我们自己的产出被判不通过——lint 判据开始误杀自己（先看下面的定位，再改判据而不是改测试）：\n' + failures.join('\n'));
    assert.equal(flagged, 0, '不通过数应为 0，实际 ' + flagged);
});

test('空文本样例：lint 刻意拦 content-empty（且只拦这一条）——上游两条路径都已挡住空文本', () => {
    // 空文本**不是**「我们自己的产出」，所以它不进上面那条不变量，而是单独钉在这里：
    //   ① 解析器丢弃空文本条目（就地取证）；
    //   ② 弹幕模式在发送前用 status 拦（85-danmaku「请输入弹幕内容」）。
    // lint 仍应把它拦下（§二 body：弹幕文本内容），且不得连带报出别的 rule。
    const NL = String.fromCharCode(10);
    const srt = ['1', '00:00:01,000 --> 00:00:02,000', '', '2', '00:00:03,000 --> 00:00:04,000', '有字'].join(NL);
    assert.deepEqual(parseSub(srt, 'a.srt').map((s) => s.text), ['有字'], '解析器应丢弃空文本条目（空文本到不了模型层）');
    assert.match(read('85-danmaku.js'), /!text \|\| !text\.trim\(\)[\s\S]{0,80}请输入弹幕内容/, '弹幕模式应仍在发送前拦住空文本');
    CORE.setActivePresetId('none');
    ['', '   '].forEach((text) => {
        const out = expandSub({ time: 1000, text }, CFG, 3000, 1, null);
        assert.equal(out.length, 1, '空文本应产出 1 条 model（这就是要拦它的原因：一条什么都看不见的弹幕）');
        assert.deepEqual(lintModel(out[0]).problems.map((p) => p.rule), ['content-empty'],
            '空文本只该报 content-empty，实际 ' + JSON.stringify(lintModel(out[0]).problems.map((p) => p.rule)));
    });
});
