// 发送前审计（auditSend = 闸② 输出 lint + 闸③ 计数/量级）的契约测试（node --test）
//
// 要守的东西：
//   ① **计数与 startSend 原循环逐字一致**——本文件里照抄了一份原循环作「参考实现」（referenceCount），
//      两处对每个预设逐一比对。闸③ 的常驻行、闸② 的拒绝判据、二次确认阈值全都搭在这个计数上，
//      计数一旦漂了，用户看到的 N 就是假数（比没有更糟）。
//   ② **病灶带得出字幕序号**——闸② 的价值是「拒绝 + 指出是哪一条」，只报 rule 不报序号，UI 无法定位。
//      测的是三元映射：subtitleIndex（发送序列内，+1 = seq）/ subListIndex（字幕列表内，UI 的 data-i）。
//   ③ **展开抛错的既有语义**——原循环是 catch 后按 1 条计入、绝不外抛；这条不能在本片被「顺手改成抛出去」
//      （那会让一整批发送在最后一条上崩掉）。
//   ④ **标定**——阈值与池影响分级的数字来自真实展开量，不是拍的：本文件最后一条把 3 个内置预设的
//      真实展开量打印出来（100 条字幕 → ? 条 model → 估算耗时），常量依据就摆在测试输出里。
//   ⑤ **接线的静态取证**——本仓无真浏览器，UI 无法端到端跑；能钉的是源码形状：常驻行/内联确认存在、
//      auditSend 在 confirm 之前调用、`confirm(` 全仓总数仍是 3（本片不得新增第 4 处）。
//
// 用法：npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 55-audit 的 import 图（→ 50-engine → gdm-model → 40-core）在求值期会碰 window / document / localStorage
// （与 model-lint.test.mjs 同款最小桩），另加**闸③ UI 的最小 DOM 桩**：
//   · fakeEl 是一个记录用的假节点（textContent / className / disabled / 事件表都能断言）
//   · createElement('div') 造的弹窗节点自带两个假按钮（[data-act=go] / [data-act=cancel]）——被验的是
//     80-ui 里的门控逻辑（禁用 → 倒计时 → 可点、取消即拒、只结算一次），不是 DOM 本身
//   · **真实渲染仍未覆盖**：没有浏览器，样式与观感只靠静态断言（见本文件最后两条测试）
const dom = { els: {}, created: [] };
function fakeEl(tag) {
    const el = {
        tagName: tag, id: '', className: '', textContent: '', title: '', value: '', checked: false,
        disabled: false, style: {}, children: [], handlers: {}, removed: false, parts: null, files: [],
        addEventListener(t, fn) { (el.handlers[t] = el.handlers[t] || []).push(fn); },
        dispatch(t) { (el.handlers[t] || []).forEach((fn) => fn({ target: el })); },
        querySelector(sel) { return (el.parts && el.parts[sel]) || null; },
        querySelectorAll() { return []; },
        appendChild(c) { el.children.push(c); return c; },
        setAttribute() {}, removeAttribute() {}, remove() { el.removed = true; },
        classList: { add() {}, remove() {}, toggle() {} },
    };
    return el;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

globalThis.window = globalThis;
globalThis.unsafeWindow = globalThis;
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.document = {
    readyState: 'loading',
    addEventListener() {},
    createElement(tag) {
        const el = fakeEl(tag);
        // 二次确认面板的两个按钮（80-ui/confirmHighVolume 里按 data-act 取）
        el.parts = { '[data-act=go]': fakeEl('button'), '[data-act=cancel]': fakeEl('button') };
        // canvas（50-engine 的离屏测宽会反复取）：不登记，免得几千个测宽用的假节点淹没「建了几个弹窗」
        if (tag !== 'canvas') dom.created.push(el);
        return el;
    },
    querySelector(sel) { return dom.els[sel] || null; },
    querySelectorAll() { return []; },
    body: { appendChild() {} },
    documentElement: { appendChild() {} },
};

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

const { POOL_IMPACT_BANDS, SEND_CONFIRM_MODEL_THRESHOLD, auditSend, estimatedSendMs, poolImpact } =
    await import('../../src/55-audit.js');
const CORE = await import('../../src/40-core.js');
const { MODEL_SEND_INTERVAL, BUILTIN_PRESETS } = await import('../../src/10-constants.js');
const { calcDurationMs, cfgFor, expandSub } = await import('../../src/50-engine.js');
const { parseSub } = await import('../../src/30-parser.js');
const { startSend, updateSendAudit } = await import('../../src/80-ui.js');

// ---------------- 夹具：真实字幕（走真实解析器，不手抄形状） ----------------

const NL = String.fromCharCode(10);
const SAMPLES = [
    '短',                       // 1 字
    '你好世界',                  // 4 字
    '今天天气不错呀',            // 7 字
    '这是一句长度中等的中文字幕',  // 13 字
    'Hello world 中英混排的一句',  // 中英混排
    '这一句故意写得长一些，用来把拆字预设的展开量推到典型值以上，看看一集字幕的下界在哪里',  // 40 字
];
const stamp = (sec) => {
    const p2 = (n) => String(n).padStart(2, '0');
    return p2(Math.floor(sec / 3600)) + ':' + p2(Math.floor(sec / 60) % 60) + ':' + p2(Math.floor(sec) % 60) + ',000';
};
function makeSrt(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const t = i * 4 + 1;
        out.push(String(i + 1), stamp(t) + ' --> ' + stamp(t + 2), SAMPLES[i % SAMPLES.length], '');
    }
    return out.join(NL);
}
const SUBS = parseSub(makeSrt(30), 'sample.srt');
assert.equal(SUBS.length, 30, '夹具：30 条字幕应全部解析出来（空文本会被解析器丢弃）');
SUBS.forEach((s) => { s.selected = true; s.st = ''; });

// 参考实现：**逐字照抄 80-ui/startSend 6.13.1 的计数循环**（本片把这段搬进 55-audit 时不许改语义）
function referenceCount(targets, subs) {
    let totalModels = 0;
    for (let k = 0; k < targets.length; k++) {
        const s = targets[k];
        try {
            const cfg = cfgFor(s);
            const prevTime = k > 0 ? targets[k - 1].time : null;
            totalModels += expandSub(s, cfg, calcDurationMs(subs.indexOf(s)), k + 1, prevTime).length;
        } catch (e) { totalModels += 1; }
    }
    return totalModels;
}
// 按子集造 targets（同时把「列表下标 ≠ 发送序号」这件事摆上台面）
const pick = (subs, idxs) => idxs.map((i) => subs[i]);

// 每个用例都自己收场：预设是模块级活绑定，跑完恢复成 none，免得污染同文件后面的用例
function withPreset(id, fn) {
    const saved = CORE.activePresetId;
    CORE.setActivePresetId(id);
    try { return fn(); } finally { CORE.setActivePresetId(saved); }
}

// ---------------- ① 正常路径：计数与原循环逐字一致 + problems 为空 ----------------

test('正常路径：真实预设 × 真实字幕，problems 为空，计数与原 startSend 循环一致', () => {
    CORE.setSubs(SUBS);
    const cases = [
        { id: 'none', label: '无预设' },
        { id: 'vertical', label: '竖排字幕（拆字 + 逐字延迟）' },
        { id: 'karaoke', label: 'KTV 唱词（拆字 + 扫光，两层）' },
    ];
    const lines = [];
    cases.forEach((c) => withPreset(c.id, () => {
        // 全体选中
        const all = SUBS.filter((s) => s.selected && s.st !== 'ok');
        const a = auditSend(all, SUBS);
        assert.deepEqual(a.problems, [], c.label + '：自家产出不该被闸② 拦（拦了就是误杀，先查判据）');
        assert.deepEqual(a.expandErrors, [], c.label + '：不应有展开抛错');
        assert.equal(a.subtitleCount, all.length, c.label + '：subtitleCount 应是发送序列长度');
        assert.equal(a.modelCount, referenceCount(all, SUBS), c.label + '：计数必须与原 startSend 循环逐字一致');

        // 子集（隔一条选一条）：列表下标 ≠ 发送序号，计数同样要对得上
        const sub = pick(SUBS, [1, 3, 5, 7, 9, 11]);
        const b = auditSend(sub, SUBS);
        assert.equal(b.modelCount, referenceCount(sub, SUBS), c.label + '：子集计数也必须一致');
        assert.deepEqual(b.problems, [], c.label + '：子集同样不该被拦');
        lines.push('  ' + c.label + '：30 条字幕 → ' + a.modelCount + ' 条 model（每条字幕 ' + (a.modelCount / 30).toFixed(2) + ' 条）');
    }));
    console.log('[正常路径]' + NL + lines.join(NL));

    // 无预设 = 一条字幕一条弹幕（这是「N 条弹幕」这个词最朴素的口径，钉住它）
    withPreset('none', () => {
        assert.equal(auditSend(SUBS, SUBS).modelCount, SUBS.length, '无预设时 modelCount 必须等于字幕条数');
    });
});

// ---------------- ② 病灶路径：拒绝发送的依据要带得出字幕序号 ----------------

test('病灶路径：自造坏预设的非法缓动/坐标量级被逐条抓到，且带出正确的字幕序号', () => {
    CORE.setSubs(SUBS);
    const savedCustom = CORE.customPresets.length;
    try {
        // 模拟「用户手写/导入的预设 JSON」：motion.advanced 读 options.moves，这里塞两处病灶——
        //   timingFunction 'easeIn'（非法：CSS 不认，弹幕会停在 (0,0)，§六）
        //   fromX -5000（像素当百分比传那一类量级错误，§五 + gdm-model 的 LINT_POS_MIN/MAX 注释）
        CORE.customPresets.push({
            id: 'bad-moves', name: '坏预设', transform: 'none',
            composition: { split: 'none', layout: 'none', color: 'single', timing: 'uniform', motion: 'advanced' },
            options: { moves: [{ fromX: -5000, fromY: 50, toX: 1500, toY: 50, moveTime: 3000, timingFunction: 'easeIn' }] },
            params: [],
        });
        CORE.setActivePresetId('bad-moves');

        // 发送序列只取列表里的偶数条：subtitleIndex（序列内）与 subListIndex（列表内）必须各归各位
        const targets = pick(SUBS, [0, 2, 4, 6]);
        const a = auditSend(targets, SUBS);
        assert.ok(a.problems.length > 0, '坏预设必须被判成病灶（否则闸② 就是摆设）');
        assert.equal(a.expandErrors.length, 0, '这是 lint 病灶，不是展开抛错，两者不可混');
        const rules = [...new Set(a.problems.map((p) => p.rule))].sort();
        assert.deepEqual(rules, ['frame-pos-range', 'timing-function'], '应的病灶类型：坐标量级 + 非法缓动，实际 ' + JSON.stringify(rules));

        // 序号映射：每条病灶都要能指回它的字幕（seq = 序列位置 + 1；subListIndex = 列表位置）
        const expectMap = [[0, 0], [1, 2], [2, 4], [3, 6]];
        a.problems.forEach((p) => {
            const pair = expectMap[p.subtitleIndex];
            assert.ok(pair, 'subtitleIndex ' + p.subtitleIndex + ' 越界（它必须落在发送序列 0..3）');
            assert.equal(p.seq, p.subtitleIndex + 1, 'seq 必须是序列位置 + 1（startSend 交给 expandSub 的就是它）');
            assert.equal(p.subListIndex, pair[1], 'subListIndex 应是该字幕在字幕列表里的下标（UI 定位用）');
            assert.ok(p.path && p.path.indexOf('model.animationFrames') === 0, 'path 要指到具体帧：实际 ' + p.path);
            assert.ok(p.detail && p.detail.length > 0, 'detail 不能为空（控制台逐条打印的就是它）');
        });
        assert.equal(a.modelCount, referenceCount(targets, SUBS), '病灶路径的计数同样要与原循环一致');

        // 每一条字幕都带病灶（这份坏预设对每一句都生效）
        assert.deepEqual([...new Set(a.problems.map((p) => p.subtitleIndex))], [0, 1, 2, 3],
            '4 条字幕都该被点出来，实际 ' + JSON.stringify([...new Set(a.problems.map((p) => p.subtitleIndex))]));
    } finally {
        CORE.setActivePresetId('none');
        CORE.customPresets.length = savedCustom;
    }
});

test('病灶路径：空文本字幕（content-empty）带得出序号；不在字幕列表里的对象 subListIndex = -1', () => {
    CORE.setSubs(SUBS);
    withPreset('none', () => {
        // 解析器会丢空文本条目，但「发送序列」是外部可构造的入口（防御性判据必须有）；
        // 这条同时验证「不在 subs 里的对象」的序号语义
        const stray = { time: 9999, text: '', selected: true, st: '' };
        const targets = [SUBS[1], SUBS[3], stray, SUBS[5]];
        const a = auditSend(targets, SUBS);
        const empty = a.problems.filter((p) => p.rule === 'content-empty');
        assert.equal(empty.length, 1, '应恰好抓到 1 条空文本病灶，实际 ' + JSON.stringify(a.problems.map((p) => p.rule)));
        assert.equal(empty[0].subtitleIndex, 2, '空文本那条在发送序列里是第 3 条（0 基 2）');
        assert.equal(empty[0].seq, 3, 'seq = 序列位置 + 1');
        assert.equal(empty[0].subListIndex, -1, '不在字幕列表里的对象 subListIndex 应为 -1');
        assert.equal(a.modelCount, referenceCount(targets, SUBS), '计数仍需与原循环一致');
    });
});

// ---------------- ③ 展开抛错：既有语义照旧（按 1 条计入 + 不外抛） ----------------

test('展开抛错：按 1 条计入、不外抛、不进 problems（既有语义，本片不许改）', () => {
    CORE.setSubs(SUBS);
    withPreset('none', () => {
        // text 取值即抛的「毒字幕」：buildModel 读 text 时炸，safeRun 的兜底回退同样炸 → 异常逃出 expandSub
        const poison = { time: 5000 };
        Object.defineProperty(poison, 'text', { get() { throw new Error('boom-展开失败'); } });
        const targets = [SUBS[2], poison, SUBS[4]];

        let a;
        assert.doesNotThrow(() => { a = auditSend(targets, SUBS); }, '展开抛错绝不能再抛出去（原循环就是 catch 掉的）');
        assert.equal(a.expandErrors.length, 1, '抛错要记账（expandErrors），供 UI 提示');
        assert.equal(a.expandErrors[0].subtitleIndex, 1, '抛错那条在发送序列里是第 2 条（0 基 1）');
        assert.equal(a.expandErrors[0].seq, 2, 'seq = 序列位置 + 1');
        assert.equal(a.expandErrors[0].subListIndex, -1, '毒字幕不在字幕列表里');
        assert.ok(a.expandErrors[0].message.indexOf('boom') >= 0, '要把原始错误信息带出来');
        assert.deepEqual(a.problems, [], '展开抛错不塞进 problems——否则闸② 会开始阻断既有可发送的批次（改了行为）');
        assert.equal(a.modelCount, referenceCount(targets, SUBS), '计数语义：抛错那条按 1 条计入（与参考实现一致）');
    });
});

// ---------------- ④ 标定：阈值与分级的数字来自真实展开量 ----------------

test('标定：内置预设的真实展开量 → 阈值与分级的依据（打印实测）', () => {
    // 大夹具：300 条字幕，用来量真实展开量 + 一遍审计的墙钟耗时
    const big = parseSub(makeSrt(300), 'big.srt');
    big.forEach((s) => { s.selected = true; s.st = ''; });
    const totalChars = big.reduce((n, s) => n + Array.from(s.text).length, 0);
    const savedSubs = CORE.subs;
    CORE.setSubs(big);
    const lines = [];
    const counts = {};
    let karaokeMs = 0;
    try {
        BUILTIN_PRESETS.forEach((p) => {
            withPreset(p.id, () => {
                const t0 = Date.now();
                const a = auditSend(big, big);
                const ms = Date.now() - t0;
                counts[p.id] = a.modelCount;
                if (p.id === 'karaoke') karaokeMs = ms;
                const per = a.modelCount / big.length;
                lines.push('  ' + p.name + '（' + p.id + '）：300 条字幕 → ' + a.modelCount + ' 条 model（'
                    + per.toFixed(2) + ' 条/字幕）· 100 条 → ' + Math.round(per * 100) + ' 条 · 审计耗时 ' + ms + 'ms');
            });
        });
    } finally {
        CORE.setSubs(savedSubs);
    }
    // 耗时估算与阈值的口径（本片所有数字的依据）
    lines.push('  —— 口径：句内 ' + MODEL_SEND_INTERVAL + 'ms/条（MODEL_SEND_INTERVAL）+ 句间 sendInterval（默认 400ms）'
        + '，不含网络往返，故是**下界**');
    lines.push('  二次确认阈值 ' + SEND_CONFIRM_MODEL_THRESHOLD + ' 条 → 下界 ' + Math.round(estimatedSendMs(SEND_CONFIRM_MODEL_THRESHOLD, 100, 400) / 1000) + ' 秒');
    POOL_IMPACT_BANDS.forEach((b) => lines.push('  池影响「' + b.label + '」（≤ ' + b.max + '）：' + b.note));
    lines.push('  最坏耗时估算：KTV × 300 条字幕的一遍审计 = ' + karaokeMs + 'ms（常驻行重算的节流下限取 250ms，见 80-ui）');
    console.log('[标定]' + NL + lines.join(NL));

    // 分级边界：分段函数两端都要钉（0 / 上界 / 上界+1）
    assert.equal(counts.none, big.length, '无预设 = 一条字幕一条弹幕');
    assert.ok(counts.vertical <= totalChars && counts.vertical > totalChars * 0.9,
        '竖排 ≈ 码点数（每字一条；空白/标点会被拆字引擎并进邻字，故是 0.9~1.0 倍）：'
        + counts.vertical + ' vs 码点 ' + totalChars);
    assert.equal(counts.karaoke, 2 * counts.vertical, 'KTV = 竖排 × 2（底层暗色 + 亮色扫光）');
    assert.equal(poolImpact(0).label, '低');
    assert.equal(poolImpact(POOL_IMPACT_BANDS[0].max).label, '低', '上界含在「低」里');
    assert.equal(poolImpact(POOL_IMPACT_BANDS[0].max + 1).label, '中', '上界 + 1 进「中」');
    assert.equal(poolImpact(POOL_IMPACT_BANDS[1].max + 1).label, '高', '第二段上界 + 1 进「高」');
    assert.equal(poolImpact(1e9).label, '高', '超大值仍在最高档（不能返回 undefined）');
    assert.equal(poolImpact(-5).level, 'low', '负数/脏输入按 0 处理');
    assert.ok(SEND_CONFIRM_MODEL_THRESHOLD > POOL_IMPACT_BANDS[0].max
        && SEND_CONFIRM_MODEL_THRESHOLD <= POOL_IMPACT_BANDS[1].max,
        '二次确认阈值应落在「中」段内（与「池影响 中」同时出现，两者不打架）');
    assert.equal(estimatedSendMs(1000, 100, 400), 1000 * MODEL_SEND_INTERVAL + 99 * 400, '耗时估算 = 条数 × 80ms + (句数-1) × 间隔');
});

// ---------------- ⑤ 接线：静态取证（本仓无真浏览器） ----------------

test('接线：闸② 在 startSend 里拒绝并列出病灶；闸③ 常驻行 + 内联二次确认（无新增 confirm()）', () => {
    const ui = read('80-ui.js');
    const boot = read('boot.js');
    const events = read('95-events.js');
    const presetUi = read('90-preset-ui.js');

    // 闸②：auditSend 必须在发送确认（confirm）之前调用，且病灶分支直接 return（不进入发送流程）
    const iAudit = ui.indexOf('auditSend(targets, subs)');
    const iConfirm = ui.indexOf('发送 ${targets.length} 条字幕');
    assert.ok(iAudit > 0, '80-ui 必须调用 auditSend(targets, subs)（闸② 的接线点）');
    assert.ok(iConfirm > 0, '首次 confirm 的措辞应保持原样');
    assert.ok(iAudit < iConfirm, 'lint 必须前置：auditSend 要在首次确认之前');
    assert.match(ui, /if \(audit\.problems\.length\)[\s\S]{0,900}已阻止发送/, '病灶分支要有「已阻止发送」的明确提示');
    assert.match(ui, /problems\.forEach/, '病灶要逐条打印到控制台');
    assert.match(ui, /已阻止发送[\s\S]{0,900}return;/, '有病灶必须直接 return，不进入发送流程');

    // 闸③ 常驻行：面板元素 + 样式 + 触发点
    assert.match(ui, /id="cf-audit"/, '面板里要有常驻审计行元素');
    assert.match(ui, /输出校验/, '常驻行文案要区分 ✅ / ⛔');
    assert.match(boot, /#cf-sub-panel \.cf-audit/, '常驻行要有样式（默认态/ok/warn/bad）');
    assert.match(ui, /function updateSendAudit\(/, '80-ui 要提供重算入口');
    assert.ok((events.match(/updateSendAudit\(\)/g) || []).length >= 3,
        '95-events：选中项 / 时间偏移 / 双语模式变化都要触发重算');
    assert.ok((presetUi.match(/updateSendAudit\(\)/g) || []).length >= 2,
        '90-preset-ui：预设切换与参数改动都要触发重算');
    assert.match(ui, /AUDIT_MIN_INTERVAL/, '重算要节流（逐字拆发 × 几百条字幕是重活）');

    // 闸③ 二次确认：内联面板（不是 confirm(）+ 可撤的倒计时
    assert.match(ui, /function confirmHighVolume\(/, '超过阈值要有第二次确认');
    assert.match(ui, /cf-audit-confirm/, '第二次确认走内联面板（沿用 90-preset-ui openExportDialog 的 mask 范式）');
    assert.match(ui, /仍要发送/, '要有一个「仍要发送」按钮');
    assert.match(ui, /SEND_CONFIRM_MODEL_THRESHOLD/, '阈值取自 55-audit 的常量');

    // 硬约束：`confirm(` 全仓总数仍是 3（本片不得新增第 4 处）——与 tools/check.mjs 的白名单同一条纪律
    const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js'));
    let n = 0;
    const where = [];
    files.forEach((f) => {
        const code = read(f).replace(/\/\/[^\n]*/g, '');
        const c = (code.match(/confirm\(|alert\(/g) || []).length;
        if (c) { n += c; where.push(f + '×' + c); }
    });
    assert.equal(n, 3, 'confirm(/alert( 总数必须仍是 3（只减不增）：实际 ' + where.join(', '));
});

// ---------------- ⑥ 闸③ 常驻行的行为（最小 DOM 桩；真实浏览器渲染仍未覆盖） ----------------

test('闸③ 常驻行：数字/校验态/池影响三段的文案与配色（最小 DOM 桩）', async () => {
    const auditEl = fakeEl('div');
    dom.els['#cf-audit'] = auditEl;
    await sleep(300);   // 躲开上一条测试可能留下的节流窗口

    // 态一：无字幕
    CORE.setSubs([]);
    updateSendAudit();
    assert.equal(auditEl.textContent, '本次将发送 0 条弹幕', '无字幕时的常驻行');

    // 态二：全选 + 无预设 → 30 条字幕 = 30 条弹幕、校验 ✅、池影响 低
    await sleep(300);
    CORE.setSubs(SUBS);
    withPreset('none', () => updateSendAudit());
    // 6.16.0 起行尾多一段身份（本文件的桩里没有 window.videoInfo / player.uid → unknown，三态文案见 identity.test.mjs）
    assert.equal(auditEl.textContent, '本次将发送 30 条弹幕 · 输出校验 ✅ · 池影响 低 · 身份未知',
        '常驻行文案（数字必须与 auditSend 同源；身份段见 6.16.0）');
    assert.match(auditEl.className, /\bok\b/, '✅ 态应是 ok 配色');
    assert.match(auditEl.title, /选中 30 条字幕 → 展开 30 条弹幕/, 'title 里给出字幕数 → 弹幕数');

    // 态三：KTV（27.33 条/字幕）→ 820 条，池影响进「中」
    await sleep(300);
    withPreset('karaoke', () => updateSendAudit());
    assert.equal(auditEl.textContent, '本次将发送 820 条弹幕 · 输出校验 ✅ · 池影响 中 · 身份未知', 'KTV × 30 条字幕 = 820 条');

    // 态四：全部取消选中
    await sleep(300);
    SUBS.forEach((s) => { s.selected = false; });
    updateSendAudit();
    assert.equal(auditEl.textContent, '本次没有可发送的字幕（未选中或已全部发送）');
    SUBS.forEach((s) => { s.selected = true; });

    // 态五：病灶 → ⛔ + bad 配色
    await sleep(300);
    const savedCustom = CORE.customPresets.length;
    try {
        CORE.customPresets.push({
            id: 'bad-ui', name: '坏预设', transform: 'none',
            composition: { split: 'none', layout: 'none', color: 'single', timing: 'uniform', motion: 'advanced' },
            options: { moves: [{ fromX: -5000, fromY: 50, toX: 50, toY: 50, moveTime: 3000, timingFunction: 'easeIn' }] },
            params: [],
        });
        withPreset('bad-ui', () => updateSendAudit());
        assert.match(auditEl.textContent, /本次将发送 30 条弹幕 · 输出校验 ⛔ 60 条病灶 · 池影响 低/,
            '病灶要显性化（坏 move 对每句都是 2 条病灶：frame-pos-range + timing-function → 30 × 2 = 60）：实际 ' + auditEl.textContent);
        assert.match(auditEl.className, /\bbad\b/, '⛔ 态应是 bad 配色');
        assert.match(auditEl.title, /首条病灶：frame-pos-range @ model\.animationFrames/, 'title 给出首条病灶定位');
    } finally {
        CORE.customPresets.length = savedCustom;
    }

    // 节流：紧接着的第二次触发不立刻重算（前沿 250ms 窗口内的重复被合并），窗口过后补一次
    CORE.setActivePresetId('karaoke');
    await sleep(300);
    updateSendAudit();
    const afterFirst = auditEl.textContent;
    SUBS.forEach((s) => { s.selected = false; });
    updateSendAudit();                       // 250ms 窗口内 → 只记尾随，不重算
    assert.equal(auditEl.textContent, afterFirst, '节流窗口内不应重算（面板会被拖卡）');
    await sleep(320);                        // 等尾随那一次
    assert.equal(auditEl.textContent, '本次没有可发送的字幕（未选中或已全部发送）', '尾随重算要把最终状态补上');
    SUBS.forEach((s) => { s.selected = true; });
    CORE.setActivePresetId('none');
});

// ---------------- ⑦ 闸②/闸③ 的实际门控（最小 DOM 桩；网络与真浏览器不在射程） ----------------

test('闸② 拒绝：有病灶时 startSend 直接返回，不弹确认、不进入发送流程', async () => {
    const statusEl = fakeEl('div');
    dom.els['#cf-status'] = statusEl;
    dom.created.length = 0;
    const savedConfirm = globalThis.confirm;
    const savedPlayer = globalThis.player;
    const savedLocation = globalThis.location;
    const savedCustom = CORE.customPresets.length;
    let confirmCalls = 0;
    try {
        // 首次 confirm 只应被「无病灶」的路径用到；这里用计数证明病灶路径根本没走到它
        globalThis.confirm = () => { confirmCalls += 1; return true; };
        globalThis.player = { vid: 123 };              // getVideoInfo 的来源（40-core）
        globalThis.location = { pathname: '/v/ac123' };
        CORE.setSubs(SUBS);
        SUBS.forEach((s) => { s.selected = true; s.st = ''; });
        CORE.customPresets.push({
            id: 'bad-send', name: '坏预设', transform: 'none',
            composition: { split: 'none', layout: 'none', color: 'single', timing: 'uniform', motion: 'advanced' },
            options: { moves: [{ fromX: -5000, fromY: 50, toX: 50, toY: 50, moveTime: 3000, timingFunction: 'easeIn' }] },
            params: [],
        });
        CORE.setActivePresetId('bad-send');

        await startSend();
        assert.equal(confirmCalls, 0, '病灶路径不该弹首次 confirm');
        assert.match(statusEl.textContent, /⛔ 输出校验未通过：\d+ 条病灶，已阻止发送（详见控制台）/, '状态栏要明确「已阻止发送」');
        assert.equal(statusEl.className, 'cf-status err', '阻止是 err 态');
        assert.equal(CORE.sending, false, '不能进入发送态');
        assert.equal(dom.created.length, 0, '不该建任何弹窗（更不该建内联确认面板）');
        assert.ok(SUBS.every((s) => s.st === ''), '一个字幕都不该被标 ing/ok/err');
    } finally {
        if (savedConfirm === undefined) delete globalThis.confirm; else globalThis.confirm = savedConfirm;
        if (savedPlayer === undefined) delete globalThis.player; else globalThis.player = savedPlayer;
        if (savedLocation === undefined) delete globalThis.location; else globalThis.location = savedLocation;
        CORE.setActivePresetId('none');
        CORE.customPresets.length = savedCustom;
    }
});

test('闸③ 阈值：超阈值批次弹内联二次确认，取消则一条都不发', async () => {
    const statusEl = dom.els['#cf-status'] || (dom.els['#cf-status'] = fakeEl('div'));
    const savedConfirm = globalThis.confirm;
    const savedPlayer = globalThis.player;
    const savedLocation = globalThis.location;
    const savedSubs = CORE.subs;
    try {
        globalThis.confirm = () => true;               // 首次确认（既有那处）直接过
        globalThis.player = { vid: 123 };
        globalThis.location = { pathname: '/v/ac123' };
        // 300 条字幕 × KTV = 8200 条 model（远过 1000 阈值）
        const big = parseSub(makeSrt(300), 'big.srt');
        big.forEach((s) => { s.selected = true; s.st = ''; });
        CORE.setSubs(big);
        CORE.setActivePresetId('karaoke');

        dom.created.length = 0;
        const p = startSend();                         // 停在 await confirmHighVolume 上
        await sleep(20);
        const masks = dom.created.filter((e) => e.id === 'cf-audit-confirm');
        assert.equal(masks.length, 1, '应恰好建 1 个内联确认面板（不是浏览器 confirm）');
        const dlg = masks[0];
        const go = dlg.querySelector('[data-act=go]');
        const cancel = dlg.querySelector('[data-act=cancel]');
        assert.equal(go.disabled, true, '「仍要发送」先禁用（倒计时期间不可点）');
        assert.match(go.textContent, /仍要发送（\d+s）/, '按钮要显示倒计时：实际 ' + go.textContent);
        assert.equal(dlg.id, 'cf-audit-confirm', '面板 id（样式挂它上面）');
        assert.equal(CORE.sending, false, '确认期间还没进入发送流程');

        cancel.dispatch('click');
        await p;
        assert.match(statusEl.textContent, /已取消：8200 条弹幕超过二次确认阈值 1000/, '取消要给出原因与数字');
        assert.equal(CORE.sending, false, '取消后不得开始发送');
        assert.equal(dlg.removed, true, '面板要收掉');
        assert.ok(big.every((s) => s.st === ''), '取消后一条都不该发（没有任何 st 变化）');
    } finally {
        if (savedConfirm === undefined) delete globalThis.confirm; else globalThis.confirm = savedConfirm;
        if (savedPlayer === undefined) delete globalThis.player; else globalThis.player = savedPlayer;
        if (savedLocation === undefined) delete globalThis.location; else globalThis.location = savedLocation;
        CORE.setSubs(savedSubs);
        CORE.setActivePresetId('none');
    }
});
