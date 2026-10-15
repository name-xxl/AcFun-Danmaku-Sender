// 作品文件（gdm-work）与它接线的契约测试（node --test）
//
// 要守的东西（验收 4 的七条，逐条对应下面的分节）：
//   ① **存取往返**——源逐字段还原：字幕列表（time/text/style/selected）、subs2、样式来源、样式 10 字段、
//      时间偏移、激活预设与它当时的 options/effects；`st`（发送状态）**不进作品**、载入后一律清空；
//   ② **双闸轮转**——条数上限 WORK_MAX_WORKS 与字节上限 WORK_MAX_BYTES 各自 FIFO 丢最旧，
//      且**永不丢刚保存的这件**（单件自己就超闸时也留下）；
//   ③ **配额写失败降级不抛**——storeSet 会吞掉配额异常，故判成败靠读回比对；本文件用「写入超过 writeLimit
//      就抛」的 localStorage 桩把这条链路走一遍：丢旧重试成功 / 怎么丢都写不下（返回失败标志 + 可查标记 +
//      内存留档）/ 配额恢复后一并补落盘；
//   ④ **版本位与损坏信封**——乱 JSON / 缺字段 / 错版本位 / 抛异常的 getter → 拒绝并**如实报病灶**，
//      且**不留半套状态的中间态**（校验在动任何状态之前；applyWork 另有快照 + 回滚，本文件真跑一次回滚）；
//   ⑤ **导入时区分作品文件与预设 JSON**——两个方向各一例，断言提示**不同**（拿预设导作品 / 拿作品导预设）；
//   ⑥ **删除（两步）与重命名**——存储层行为 + 视图的两步内联确认（第一步只是上膛，不真删）；
//   ⑦ **列表排序与空态**——按更新时间倒序、空态有文案、行里能看到名称/视频/条数/更新时间/彩排标志。
//
// 另外两条静态守卫（本仓无真浏览器，UI 只能靠静态 + 最小 DOM 桩）：
//   · 入口 / 绑定 / 样式单点 / 复用 downloadJson / 没新增 confirm( ——与台账视图同款取证；
//   · **不缓存 models**：gdm-work 与 gdm-work-ui 里不得出现 buildModel / expandSub / animationFrames
//     （本片偏离计划书 P3.5 的「两份都存」，这条断言就是那次取舍的守门人）。
//
// 用法：npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------- 浏览器 API 桩（必须在任何模块求值之前挂上） ----------------
// localStorage 是**可控的**：writeLimit 以下的写入成功、其余按 QuotaExceededError 抛
// （storeSet 会把这个异常吞掉——这正是「读回比对」要对付的场景）；failWrites 一票否决。
const store = new Map();
let failWrites = false;
let writeLimit = Infinity;
globalThis.window = globalThis;
globalThis.unsafeWindow = globalThis;
globalThis.location = { pathname: '/v/ac123456' };   // getVideoInfo → urlIds() 会读 location（作品 vid 的来源）
globalThis.localStorage = {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) {
        const s = String(v);
        if (failWrites || s.length > writeLimit) throw new Error('QuotaExceededError（测试桩）');
        store.set(k, s);
    },
    removeItem(k) { store.delete(k); },
};
// FileReader 桩：读文件时同步交给 onload（生产代码在 readAsText 之前就挂了 onload）
globalThis.FileReader = class {
    readAsText(file) { this.result = file.__text; if (this.onload) this.onload(); }
};
// 最小 DOM 桩（本仓零依赖，没有 jsdom）：节点支持事件/属性/childNodes；`querySelector` **自动补位**。
// 与台账测试的桩只有一处不同：**innerHTML 是访问器，赋值即清空 children**——本视图靠
// `body.innerHTML=''` 后重新 appendChild 来重画列表，桩必须照这个语义走，否则重画后 children 会累加、
// 「第 N 行」这类断言就指错行。观感与真浏览器仍未覆盖。
function el(tag) {
    const e = {
        tagName: tag, id: '', className: '', textContent: '', title: '', value: '', checked: false,
        disabled: false, removed: false, dataset: {}, style: {}, children: [], handlers: {}, parts: {},
        addEventListener(t, fn) { (e.handlers[t] = e.handlers[t] || []).push(fn); },
        dispatch(t) { (e.handlers[t] || []).forEach((fn) => fn({ target: e })); },
        appendChild(c) { e.children.push(c); return c; },
        remove() { e.removed = true; },
        setAttribute() {}, removeAttribute() {}, focus() {}, select() {}, click() {},
        querySelector(sel) { return (e.parts[sel] = e.parts[sel] || el('stub')); },
        querySelectorAll() { return []; },
        classList: {
            add(c) { if (e.className.indexOf(c) < 0) e.className = (e.className + ' ' + c).trim(); },
            remove(c) { e.className = e.className.split(' ').filter((x) => x && x !== c).join(' '); },
            toggle() {}, contains(c) { return e.className.indexOf(c) >= 0; },
        },
    };
    let html = '';
    Object.defineProperty(e, 'innerHTML', {
        get() { return html; },
        set(v) { html = String(v); e.children.length = 0; },
        enumerable: true,
        configurable: true,
    });
    return e;
}
const dom = { els: {} };
globalThis.document = {
    readyState: 'loading',
    addEventListener() {},
    querySelector(sel) { return dom.els[sel] || null; },
    querySelectorAll() { return []; },
    createElement(tag) { return el(tag); },
    body: { appendChild(c) { if (c && c.id) dom.els['#' + c.id] = c; return c; } },
    documentElement: { appendChild() {} },
    head: { appendChild() {} },
};

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const noComment = (s) => s.replace(/\/\/[^\n]*/g, '');

const W = await import('../../src/gdm-work.js');
const WUI = await import('../../src/gdm-work-ui.js');
const CORE = await import('../../src/40-core.js');
const ENG = await import('../../src/50-engine.js');
const PRESET_UI = await import('../../src/90-preset-ui.js');

const KEY = W.WORK_STORE_KEY;
assert.equal(KEY, 'cf_sub_works', '作品存储键（storeSet 会补 cf_sub_ 前缀）');
const statusEl = el('div');
dom.els['#cf-status'] = statusEl;

// 造场景：清空存储 → 需要时预置作品 → 重置内存缓存（否则读到的还是上一个用例的作品集）
function seed(works) {
    store.clear();
    failWrites = false;
    writeLimit = Infinity;
    if (works) store.set(KEY, JSON.stringify({ v: 1, works }));
    W.resetWorkState();
    statusEl.textContent = '';
    statusEl.className = '';
}

// 一件合法的作品（测试夹具；字段全集与 normal 一致）
function fixture(name, over) {
    const base = {
        v: 1, type: 'adl-work', id: 'w-' + name, name, vid: 123,
        createdAt: 1000, updatedAt: 1000,
        source: {
            subs: [{ time: 1000, text: '你好', style: { font: 'SimHei', size: 24, color: 0xffffff, bold: false, stroke: true, anchor: 4 }, selected: true }],
            subs2: [],
            styleSource: 'ass',
            currentStyleConfig: {
                font: 'SimHei', size: 24, color: 0xffffff, bold: false, stroke: true,
                anchor: 4, posX: 50, posY: 85, moveTime: 3000, shadow: false,
            },
            timeOffset: 0, presetId: 'none', presetOptions: null,
        },
        rehearsed: false, rehearsedAt: null,
    };
    return Object.assign(base, over || {});
}

// 把编辑器状态摆成一份「有内容」的作品（往返用例的起点）
function seedEditor() {
    globalThis.player = { vid: 123456 };
    CORE.setSubs([
        { time: 1974, text: '第一句', style: { font: 'SimSun', size: 30, color: 0xff0000, bold: true, italic: false, underline: false, shadow: false, stroke: true, anchor: 4 }, selected: true, st: 'ok' },
        { time: 5000, text: '第二句', selected: false, st: '' },
    ]);
    CORE.setSubs2([{ time: 1974, text: 'line two', selected: true }]);
    CORE.setStyleSource('editor');
    Object.assign(CORE.currentStyleConfig, {
        font: 'Microsoft YaHei', size: 36, color: 0x00ff00, bold: true, stroke: false,
        anchor: 7, posX: 20, posY: 70, moveTime: 1500, shadow: true,
    });
    CORE.setTimeOffset(-1500);
    CORE.setActivePresetId('karaoke');
    const k = ENG.getAllPresets().find((p) => p.id === 'karaoke');
    k.options = Object.assign({}, k.options, { charWidth: 3.5, dualDir: 'vertical' });
    k.effects = { zIndex: 7 };
    return k;
}

// ---------------- ① 存取往返 ----------------

test('① 存取往返：源逐字段还原（字幕 / subs2 / 样式 / 偏移 / 预设 options）+ st 不进作品', () => {
    seed();
    const k = seedEditor();
    const r = W.workSave('我的作品');
    assert.equal(r.ok, true, '正常保存应成功');
    assert.equal(r.overwritten, false);
    assert.equal(r.dropped, 0, '没超闸就不该丢东西');
    assert.equal(r.work.name, '我的作品');
    assert.equal(r.work.vid, 123456, 'vid 取 getVideoInfo().videoId');
    assert.equal(r.work.type, 'adl-work');
    assert.equal(r.work.v, 1);
    assert.equal(r.work.rehearsed, false, '本片只存不用：恒未彩排');
    assert.equal(r.work.rehearsedAt, null);

    // 字段全集固定（workPrepare 是唯一入口；外来键不进作品）
    assert.deepEqual(Object.keys(r.work).sort(),
        ['createdAt', 'id', 'name', 'rehearsed', 'rehearsedAt', 'source', 'type', 'updatedAt', 'v', 'vid'].sort(),
        '作品字段全集');
    assert.deepEqual(Object.keys(r.work.source).sort(),
        ['currentStyleConfig', 'presetId', 'presetOptions', 'styleSource', 'subs', 'subs2', 'timeOffset'].sort(),
        '源字段全集');

    // 落盘：带版本位的信封
    const raw = JSON.parse(store.get(KEY));
    assert.equal(raw.v, 1, '信封带版本位');
    assert.equal(raw.works.length, 1);
    assert.equal(raw.works[0].type, 'adl-work');
    assert.equal(raw.works[0].source.subs[0].st, undefined, 'st（发送状态）不进作品');

    // 把编辑器改乱，再载入作品
    CORE.setSubs([]);
    CORE.setSubs2([]);
    CORE.setStyleSource('ass');
    Object.assign(CORE.currentStyleConfig, { font: 'SimHei', size: 12, color: 0x000000, bold: false, stroke: true, anchor: 0, posX: 1, posY: 1, moveTime: 100, shadow: false });
    CORE.setTimeOffset(9999);
    CORE.setActivePresetId('none');
    k.options = { charWidth: 1 };
    k.effects = null;

    const l = W.workLoad(r.work.id);
    assert.equal(l.ok, true, '载入前校验应通过：' + W.problemsText(l.problems));
    const a = W.applyWork(l.work);
    assert.equal(a.ok, true, '应用应成功');
    assert.deepEqual(a.warnings, [], '预设在本机，不该有打折提示');

    assert.equal(CORE.subs.length, 2);
    assert.equal(CORE.subs[0].time, 1974);
    assert.equal(CORE.subs[0].text, '第一句');
    assert.deepEqual(CORE.subs[0].style,
        { font: 'SimSun', size: 30, color: 0xff0000, bold: true, italic: false, underline: false, shadow: false, stroke: true, anchor: 4 },
        '字幕 style 逐字段还原');
    assert.equal(CORE.subs[0].selected, true);
    assert.equal(CORE.subs[1].selected, false, 'selected 是编辑意图，要还原');
    assert.equal(CORE.subs[0].st, '', 'st 载入后一律清空（作品不是发送日志）');
    assert.equal(CORE.subs2.length, 1);
    assert.equal(CORE.subs2[0].text, 'line two');
    assert.equal(CORE.styleSource, 'editor');
    assert.deepEqual(Object.assign({}, CORE.currentStyleConfig), {
        font: 'Microsoft YaHei', size: 36, color: 0x00ff00, bold: true, stroke: false,
        anchor: 7, posX: 20, posY: 70, moveTime: 1500, shadow: true,
    }, '样式 10 字段逐字段还原');
    assert.equal(CORE.timeOffset, -1500, '时间偏移（可为负）还原');
    assert.equal(CORE.activePresetId, 'karaoke', '激活预设还原');
    assert.equal(k.options.charWidth, 3.5, '预设当时的 options 还原');
    assert.equal(k.options.dualDir, 'vertical');
    assert.deepEqual(k.effects, { zIndex: 7 }, '预设当时的 effects 还原');
    // 全局设置跟着落盘（刷新后仍保持）
    assert.equal(store.get('cf_sub_timeOffset'), '-1500');
    assert.equal(store.get('cf_sub_styleSource'), 'editor');
    // 载入作品**不动**用户为预设主动保存过的参数
    assert.equal(store.has('cf_sub_presetOpt_karaoke'), false, '载入作品不得改 cf_sub_presetOpt_*');

    // JSON 往返（导出 → 导入）后逐字段一致
    const exp = W.workExportPayload(r.work.id);
    assert.equal(exp.ok, true);
    assert.equal(exp.payload.type, 'adl-work', '导出的文件自描述：类型标识');
    assert.equal(exp.payload.v, 1, '导出的文件自描述：版本位');
    assert.equal(typeof exp.payload.exportedAt, 'number');
    const back = W.workImportText(JSON.stringify(exp.payload));
    assert.equal(back.ok, true, '自己导出的文件必须能自己导回：' + W.problemsText(back.problems));
    assert.deepEqual(back.work, r.work, 'JSON 往返后作品逐字段一致（exportedAt/exportedBy 不属于字段全集）');
});

test('① 载入时预设不在本机 → 源照常回放 + 如实给一条打折提示（不是失败）', () => {
    seed();
    seedEditor();
    const r = W.workSave('引用自定义预设的作品');
    // 手改存储：把 presetId 换成一个本机没有的（模拟「对方导入了自定义预设而你没导入」）
    const env = JSON.parse(store.get(KEY));
    env.works[0].source.presetId = 'custom-aaa';
    env.works[0].source.presetOptions = { options: { gap: 3 }, effects: null };
    store.set(KEY, JSON.stringify(env));
    W.resetWorkState();

    const l = W.workLoad(r.work.id);
    assert.equal(l.ok, true, '预设缺失不是校验失败');
    const a = W.applyWork(l.work);
    assert.equal(a.ok, true, '源照常恢复');
    assert.equal(a.warnings.length, 1, '要给一条打折提示');
    assert.match(a.warnings[0], /custom-aaa[\s\S]*不在本机/, '提示要指名道姓：' + a.warnings[0]);
    assert.equal(CORE.activePresetId, 'none', '回落「无预设」');
    assert.equal(CORE.subs.length, 2, '字幕照常恢复');
    assert.equal(CORE.timeOffset, -1500, '偏移照常恢复');
});

// ---------------- ② 双闸轮转（FIFO） ----------------

test('② 条数上限：FIFO 轮转——丢最旧、留最新（WORK_MAX_WORKS=20）', () => {
    const n = W.WORK_MAX_WORKS;
    assert.equal(n, 20);
    seed();
    for (let i = 0; i < n; i++) {
        store.set(KEY, JSON.stringify({ v: 1, works: JSON.parse(store.get(KEY) || '{"v":1,"works":[]}').works.concat([fixture('old-' + i, { id: 'old-' + i, updatedAt: 1000 + i })]) }));
    }
    W.resetWorkState();
    assert.equal(W.workList().length, n);
    const r = W.workSave('最新一件');
    assert.equal(r.ok, true);
    assert.equal(r.dropped, 1, '超出 1 件 → 只丢最旧 1 件');
    const list = W.workList();
    assert.equal(list.length, n, '条数稳定在上限');
    assert.ok(!list.some((w) => w.id === 'old-0'), '最旧的 old-0 被丢');
    assert.ok(list.some((w) => w.id === r.work.id), '刚保存的这件在');
    assert.equal(JSON.parse(store.get(KEY)).works.length, n, '落盘也是 n 件');
});

test('② 字节上限：超限按 FIFO 丢到限内；单件自己超闸也留下（丢最新 = 没保存）', () => {
    seed();
    CORE.setSubs(Array.from({ length: 200 }, (_, i) => ({ time: i * 1000, text: '长'.repeat(1000) })));
    let last = null;
    for (let i = 0; i < 14; i++) last = W.workSave('大件-' + i);
    assert.equal(last.ok, true);
    assert.ok(last.dropped > 0, '字节闸要丢旧作品，实际丢 ' + last.dropped);
    const st = W.workStats();
    assert.ok(st.bytes <= W.WORK_MAX_BYTES, '落盘体积必须在闸内：' + st.bytes + ' > ' + W.WORK_MAX_BYTES);
    assert.ok(st.count < 14, '条数也被压下来了：' + st.count);
    assert.ok(W.workList().some((w) => w.id === last.work.id), '刚保存的这件永远在');

    // 单件就超闸：仍然保留这一件（宁超体积也不丢最新）
    seed();
    CORE.setSubs([{ time: 0, text: '巨'.repeat(W.WORK_MAX_BYTES + 10) }]);
    const r2 = W.workSave('巨件');
    assert.equal(r2.ok, true);
    assert.equal(W.workList().length, 1, '单件超闸也留着');
    assert.equal(W.workList()[0].id, r2.work.id);
    CORE.setSubs([]);
});

// ---------------- ③ 配额写失败降级不抛 ----------------

test('③ 配额写失败：丢旧重试成功 → 报出丢弃数 / 怎么都写不下 → 降级不抛 + 内存留档 + 可查标记', () => {
    seed();
    CORE.setSubs([{ time: 0, text: '第一件' }]);
    const r1 = W.workSave('第一件');
    assert.equal(r1.ok, true);
    const rawOne = JSON.parse(store.get(KEY)).works.length;
    assert.equal(rawOne, 1);

    // 把配额压到「只装得下一件多一点」：第二件写不下 → 丢最旧的再试 → 成功，且报出丢弃数
    const oneLen = store.get(KEY).length;
    writeLimit = oneLen + 40;
    const r2 = W.workSave('第二件');
    assert.equal(r2.ok, true, '丢最旧腾地方后应写成功');
    assert.equal(r2.dropped, 1, '为腾地方丢了 1 件旧的');
    const left = W.workList();
    assert.equal(left.length, 1);
    assert.equal(left[0].id, r2.work.id, '留下的是刚保存的这件');
    assert.equal(W.workStats().write.ok, true, '这次写入的生成功状态');
    assert.equal(store.get('cf_sub_workWriteError') || '', '', '上回失败过的话要清掉标记');

    // 一票否决：怎么丢都写不下 → 降级（不抛）。配额压到「装不下一件作品（约 700 码元）、装得下失败标记」
    assert.ok(oneLen > 300, '夹具本身要够大：' + oneLen);
    writeLimit = 300;
    let threw = false;
    let r3;
    try { r3 = W.workSave('第三件'); } catch (e) { threw = true; }
    assert.equal(threw, false, '写失败**绝不抛**');
    assert.equal(r3.ok, false);
    assert.match(r3.reason, /配额/, '失败原因要能看懂：' + r3.reason);
    assert.equal(W.workStats().write.ok, false);
    assert.match(W.workStats().write.lastError, /刷新后会丢/, '要如实说清后果');
    assert.equal(W.workList().some((w) => w.id === r3.work.id), true, '作品留在内存（本页还看得到）');
    assert.ok(store.get('cf_sub_workWriteError'), '写失败标记可查');
    assert.equal(JSON.parse(store.get('cf_sub_workWriteError')).reason, r3.reason);

    // 配额恢复：下一次写成功要把内存里那份一并补落盘
    writeLimit = Infinity;
    const r4 = W.workSave('第四件');
    assert.equal(r4.ok, true);
    const ids = JSON.parse(store.get(KEY)).works.map((w) => w.id);
    assert.ok(ids.indexOf(r3.work.id) >= 0, '降级期写失败的那件要补进存储');
    assert.ok(ids.indexOf(r4.work.id) >= 0);
    assert.equal(W.workStats().write.ok, true);
});

// ---------------- ④ 版本位与损坏信封 ----------------

test('④ 坏存储：乱 JSON / 缺字段 / 混杂条目 → 不塌、不抛、坏掉的跳过并计数', () => {
    seed();
    store.set(KEY, '{不是 JSON');
    W.resetWorkState();
    assert.deepEqual(W.workList(), [], '坏 JSON 当空作品集');
    assert.equal(W.workStats().broken, 0, '整个信封都读不出来，没有「逐条坏」');
    const okAfter = W.workSave('坏账之后');
    assert.equal(okAfter.ok, true, '坏账之后还能保存（写回合法信封）');
    assert.equal(JSON.parse(store.get(KEY)).v, 1);

    seed();
    store.set(KEY, JSON.stringify([fixture('裸数组', { id: 'bare' })]));
    W.resetWorkState();
    assert.equal(W.workList().length, 1, '裸数组（手改过）也读得出来');

    seed();
    store.set(KEY, JSON.stringify({ v: 1, works: [fixture('好的', { id: 'good' }), null, '字符串',
        { v: 1, type: 'adl-work', id: 'half' }, { v: 1, type: 'adl-work', id: 'half2', name: 'x' },
        { v: 1, type: 'adl-work', id: 'half3', name: 'y', source: {} }] }));
    W.resetWorkState();
    assert.equal(W.workList().length, 1, '坏条目剔除，作品集不塌');
    // null / '字符串' 连对象都不是（与 gdm-ledger 的容错同款：直接剔掉、不计数）；
    // 能读成对象但过不了校验的 3 条才计进 broken，并在统计行上露出来。
    assert.equal(W.workStats().broken, 3, '坏掉 3 条（缺字段/缺 source/缺 subs）要计数并露出');
    assert.match(WUI.statsText(), /3 件校验不过已跳过/, '统计行要如实报：' + WUI.statsText());
});

test('④ 校验：类型标识 / 版本位 / 缺字段 / 抛异常的 getter → 拒绝并列出病灶（一次列全）', () => {
    seed();
    seedEditor();
    const good = W.workSave('基准').work;

    // 拿别的东西冒充（类型标识不对）
    const p1 = W.workPrepare(Object.assign({}, good, { type: 'preset' }));
    assert.equal(p1.ok, false);
    assert.equal(p1.work, null, '拒绝时不得返回半成品');
    assert.ok(p1.problems.some((x) => x.path === 'type'), '要指名 type：' + W.problemsText(p1.problems));

    // 版本位不对
    const p2 = W.workPrepare(Object.assign({}, good, { v: 99 }));
    assert.equal(p2.ok, false);
    assert.ok(p2.problems.some((x) => x.path === 'v'), '要指名 v：' + W.problemsText(p2.problems));

    // 缺字段：一次列全（不是只报第一条）
    const broken = JSON.parse(JSON.stringify(good));
    delete broken.source.subs;
    delete broken.source.styleSource;
    delete broken.source.currentStyleConfig.posX;
    delete broken.rehearsed;
    delete broken.name;
    const p3 = W.workPrepare(broken);
    assert.equal(p3.ok, false);
    const paths = p3.problems.map((x) => x.path);
    ['name', 'rehearsed', 'source.subs', 'source.styleSource', 'source.currentStyleConfig.posX'].forEach((k) => {
        assert.ok(paths.indexOf(k) >= 0, '病灶要列出 ' + k + '：' + paths.join(', '));
    });

    // 字幕条目坏掉（time/text/style 各自报出来）
    const badSubs = JSON.parse(JSON.stringify(good));
    badSubs.source.subs = [{ time: '不是数字', text: 'x' }, { time: 1, text: 2, style: { size: '大' } }];
    const p4 = W.workPrepare(badSubs);
    assert.equal(p4.ok, false);
    const p4paths = p4.problems.map((x) => x.path);
    assert.ok(p4paths.indexOf('source.subs[0].time') >= 0, p4paths.join(','));
    assert.ok(p4paths.indexOf('source.subs[1].text') >= 0, p4paths.join(','));
    assert.ok(p4paths.indexOf('source.subs[1].style.size') >= 0, p4paths.join(','));

    // 病灶条数有上限（不刷屏），超了给一条汇总
    const many = JSON.parse(JSON.stringify(good));
    many.source.subs = Array.from({ length: 30 }, () => ({ time: 'x', text: 1 }));
    const p5 = W.workPrepare(many);
    assert.equal(p5.problems[p5.problems.length - 1].path, '…', '要有一条汇总');
    assert.match(p5.problems[p5.problems.length - 1].reason, /还有 \d+ 处/);

    // 读数就抛的 getter（形状异常到读不动）→ 收成病灶而不是把异常甩给调用方
    const throwy = JSON.parse(JSON.stringify(good));
    Object.defineProperty(throwy.source, 'subs', { get() { throw new Error('boom'); }, enumerable: true, configurable: true });
    let threw = false;
    let p6;
    try { p6 = W.workPrepare(throwy); } catch (e) { threw = true; }
    assert.equal(threw, false, '校验绝不抛');
    assert.equal(p6.ok, false);
    assert.match(W.problemsText(p6.problems), /boom/);
});

test('④ 不留中间态：校验不过 → 一个字段都不落；apply 中途抛错 → 整体回滚', () => {
    seed();
    const k = seedEditor();
    const before = {
        subs: CORE.subs.map((s) => Object.assign({}, s)),
        styleSource: CORE.styleSource,
        offset: CORE.timeOffset,
        preset: CORE.activePresetId,
        cfg: Object.assign({}, CORE.currentStyleConfig),
    };
    const good = W.workSave('基准').work;

    // —— 校验不过：编辑器纹丝不动 ——
    const broken = JSON.parse(JSON.stringify(good));
    delete broken.source.subs;
    const a = W.applyWork(broken);
    assert.equal(a.ok, false);
    assert.deepEqual(CORE.subs, before.subs, '校验不过时字幕不变');
    assert.equal(CORE.styleSource, before.styleSource);
    assert.equal(CORE.timeOffset, before.offset);
    assert.equal(CORE.activePresetId, before.preset);
    assert.deepEqual(Object.assign({}, CORE.currentStyleConfig), before.cfg);

    // 存储里的作品坏了：workLoad 也拒绝（且不改状态）
    const env = JSON.parse(store.get(KEY));
    delete env.works[0].source;
    store.set(KEY, JSON.stringify(env));
    W.resetWorkState();
    const l = W.workLoad(good.id);
    assert.equal(l.ok, false, '存储里的坏作品载入要拒绝');
    assert.ok(l.problems.some((x) => x.path === 'source'));
    assert.deepEqual(CORE.subs, before.subs, '拒绝载入时字幕不变');

    // 作品 id 不存在
    const l2 = W.workLoad('不存在');
    assert.equal(l2.ok, false);
    assert.match(W.problemsText(l2.problems), /没有这件作品/);

    // 把存储恢复成合法的那份（上面为了验「坏作品被拒绝」故意写坏过）
    store.set(KEY, JSON.stringify({ v: 1, works: [good] }));
    W.resetWorkState();

    // —— apply 中途抛错 → 快照回滚（真的让 apply 里那一步抛：预设 options 的第二次读取）——
    let reads = 0;
    const orig = k.options;
    Object.defineProperty(k, 'options', {
        configurable: true, enumerable: true,
        get() { reads++; if (reads === 2) throw new Error('boom-apply'); return orig; },
        set(v) { Object.defineProperty(k, 'options', { value: v, writable: true, configurable: true, enumerable: true }); },
    });
    const a2 = W.applyWork(good);
    assert.equal(a2.ok, false, '中途抛错要收成失败结果');
    assert.equal(a2.problems[0].path, 'apply');
    assert.match(a2.problems[0].reason, /已回滚/, '要说清已回滚：' + a2.problems[0].reason);
    assert.deepEqual(CORE.subs, before.subs, '回滚后字幕回到载入前（apply 已经 setSubs 过了，这是真的回滚）');
    assert.equal(CORE.timeOffset, before.offset, '回滚后偏移回到载入前');
    assert.equal(CORE.styleSource, before.styleSource);
    assert.equal(CORE.activePresetId, before.preset);
    assert.equal(k.options, orig, '预设对象也回滚');
    // 抛异常的工作副本没被留在任何地方：存储里那份仍合法
    assert.equal(W.workLoad(good.id).ok, true);
});

// ---------------- ⑤ 导入时区分作品文件与预设 JSON ----------------

test('⑤ 视图：真读一个文件走完导入（作品文件落库 / 预设文件走预设提示且不落库）+ 保存表单', () => {
    seed();
    seedEditor();
    const payload = W.workExportPayload(W.workSave('要导出的原作').work.id).payload;

    WUI.openWorkPanel();
    const mask = dom.els['#cf-work-panel'];
    const fileInput = mask.querySelector('#cf-wk-file');

    // 方向一：拿预设文件来导作品 → 预设那条提示，且作品集一件不增
    fileInput.files = [{ __text: JSON.stringify([{ id: 'custom-x', name: '预设', transform: 'none', options: {} }]) }];
    fileInput.dispatch('change');
    assert.match(statusEl.textContent, /这是预设 JSON，不是作品文件/, statusEl.textContent);
    assert.match(statusEl.textContent, /导入预设/, '要指路');
    assert.equal(W.workList().length, 1, '误用的文件不得落库');
    assert.equal(statusEl.className, 'cf-status err');

    // 方向二：真作品文件 → 落库（新建一件，名字加序号）
    fileInput.files = [{ __text: JSON.stringify(payload) }];
    fileInput.dispatch('change');
    assert.match(statusEl.textContent, /已导入作品「要导出的原作 #2」/, statusEl.textContent);
    assert.equal(W.workList().length, 2);
    assert.equal(statusEl.className, 'cf-status ok');

    // 保存表单：点「保存当前」展开 → 填名 → 保存 → 落库
    const saveRow = mask.querySelector('#cf-wk-saverow');
    assert.equal(saveRow.style.display, 'none', '默认不展开保存表单');
    mask.querySelector('[data-act=save]').dispatch('click');
    assert.equal(saveRow.style.display, '', '点「保存当前」展开表单');
    mask.querySelector('#cf-wk-name').value = '从面板存的作品';
    mask.querySelector('[data-act=save-ok]').dispatch('click');
    assert.equal(saveRow.style.display, 'none', '存完收起表单');
    assert.match(statusEl.textContent, /已保存作品「从面板存的作品」（2 条字幕）/, statusEl.textContent);
    assert.ok(W.workList().some((w) => w.name === '从面板存的作品'));
    assert.equal(W.workList().length, 3);

    // 关掉浮层
    mask.querySelector('[data-act=close]').dispatch('click');
    assert.equal(mask.removed, true);
});

test('⑤ 导入分类：作品文件 / 预设 JSON（两种误用的提示必须不同）/ 坏 JSON / 认不出', () => {
    seed();
    seedEditor();
    const saved = W.workSave('可导出的作品');
    const payload = W.workExportPayload(saved.work.id).payload;
    const text = JSON.stringify(payload);

    const asWork = W.workImportText(text);
    assert.equal(asWork.ok, true);
    assert.equal(asWork.kind, 'work');
    assert.equal(asWork.work.name, '可导出的作品');

    // 方向一：拿预设文件来导作品
    const presetArr = JSON.stringify([{ id: 'custom-x', name: '某个预设', transform: 'none', options: { a: 1 }, params: [] }]);
    const asPreset = W.workImportText(presetArr);
    assert.equal(asPreset.ok, false);
    assert.equal(asPreset.kind, 'preset', '要认出这是预设 JSON，而不是「认不出」');
    const presetMsg = WUI.importErrorText(asPreset);
    assert.match(presetMsg, /预设 JSON/, '要直说是预设 JSON：' + presetMsg);
    assert.match(presetMsg, /导入预设/, '要指路（预设面板的导入预设）');
    assert.equal(W.workImportText(JSON.stringify({ id: 'p', name: '单个预设', transform: 'none', options: {} })).kind, 'preset', '单个预设对象也算预设形状');
    assert.equal(W.workImportText(JSON.stringify([])).kind, 'preset', '空数组按预设文件处理（预设导入接受空数组）');

    // 方向二：坏 JSON 与认不出的 JSON —— 提示与上面那句**各不相同**
    const asBad = W.workImportText('{不是 JSON');
    assert.equal(asBad.kind, 'json');
    const badMsg = WUI.importErrorText(asBad);
    assert.match(badMsg, /解析失败/);
    const asUnknown = W.workImportText(JSON.stringify({ hello: 1 }));
    assert.equal(asUnknown.kind, 'unknown');
    const unknownMsg = WUI.importErrorText(asUnknown);
    assert.match(unknownMsg, /认不出/, unknownMsg);
    assert.notEqual(presetMsg, badMsg, '两种误用的话必须不一样');
    assert.notEqual(presetMsg, unknownMsg, '两种误用的话必须不一样');
    assert.notEqual(badMsg, unknownMsg);

    // 真·作品文件但缺字段：走「校验未通过」那一路，提示又与上面三种不同
    const half = JSON.parse(text);
    delete half.source.styleSource;
    const asHalf = W.workImportText(JSON.stringify(half));
    assert.equal(asHalf.ok, false);
    assert.equal(asHalf.kind, 'work');
    const halfMsg = WUI.importErrorText(asHalf);
    assert.match(halfMsg, /校验未通过/);
    assert.match(halfMsg, /styleSource/, '病灶要落到具体字段：' + halfMsg);
    [presetMsg, badMsg, unknownMsg].forEach((m) => assert.notEqual(halfMsg, m));

    // 导入即新建一件（同 id 不覆盖已有作品；同名加序号）
    const add1 = W.workImportAdd(asWork.work);
    assert.equal(add1.ok, true);
    assert.notEqual(add1.work.id, saved.work.id, '本机已有同 id → 换新 id（不静默覆盖已有作品）');
    assert.equal(add1.renamed, true, '同名要加序号');
    assert.match(add1.work.name, /可导出的作品 #2/);
    const add2 = W.workImportAdd(asWork.work);
    assert.equal(add2.ok, true);
    assert.notEqual(add2.work.id, add1.work.id);
    assert.match(add2.work.name, /可导出的作品 #3/);
    assert.equal(W.workList().length, 3);
    assert.equal(W.workList().filter((w) => w.original !== undefined).length, 0, '导入进来的也是字段全集');
});

test('⑤ 反方向：拿作品文件去导预设 → 明确拒绝（不静默「已导入 0 个预设」）', () => {
    seed();
    seedEditor();
    const payload = W.workExportPayload(W.workSave('作品甲').work.id).payload;
    const beforeCount = CORE.customPresets.length;

    PRESET_UI.loadPresetFile({ __text: JSON.stringify(payload) });
    assert.match(statusEl.textContent, /作品文件/, '要直说是作品文件：' + statusEl.textContent);
    assert.match(statusEl.textContent, /导入作品/, '要指路到作品面板的导入作品');
    assert.match(statusEl.textContent, /不是预设 JSON/);
    assert.equal(statusEl.className, 'cf-status err');
    assert.equal(CORE.customPresets.length, beforeCount, '一件预设都不该被写进去');
    assert.ok(!store.has('cf_sub_customPresets'), '不该动自定义预设的存储');

    // 对照：真预设文件照旧导入成功（本片没把预设导入弄坏）
    PRESET_UI.loadPresetFile({ __text: JSON.stringify([{ id: 'custom-ok', name: '真预设', transform: 'none', options: {}, params: [] }]) });
    assert.match(statusEl.textContent, /已导入 1 个预设/, statusEl.textContent);
    assert.equal(CORE.customPresets.length, beforeCount + 1);
});

// ---------------- ⑥ 删除（两步）与重命名 ----------------

test('⑥ 重命名与删除（存储层）：改名字 / 空名拒绝 / 删掉 / 删不存在的', () => {
    seed();
    const a = fixture('甲', { id: 'a', updatedAt: 1000 });
    const b = fixture('乙', { id: 'b', updatedAt: 2000 });
    seed([a, b]);

    const r = W.workRename('a', '  新名字  ');
    assert.equal(r.ok, true);
    assert.equal(W.workList().find((w) => w.id === 'a').name, '新名字', '名字要 trim 后落盘');
    assert.ok(W.workList().find((w) => w.id === 'a').updatedAt > 1000, '重命名会刷更新时间');

    const rEmpty = W.workRename('a', '   ');
    assert.equal(rEmpty.ok, false);
    assert.match(rEmpty.reason, /不能为空/);
    assert.equal(W.workList().find((w) => w.id === 'a').name, '新名字', '拒绝时名字不变');

    const rNo = W.workRename('不存在', 'x');
    assert.equal(rNo.ok, false);
    assert.match(rNo.reason, /没有这件作品/);

    const d = W.workDelete('a');
    assert.equal(d.ok, true);
    assert.equal(d.deleted, true);
    assert.equal(W.workList().length, 1);
    assert.deepEqual(JSON.parse(store.get(KEY)).works.map((w) => w.id), ['b'], '落盘也删掉了');

    const dNo = W.workDelete('不存在');
    assert.equal(dNo.ok, false);
    assert.equal(dNo.deleted, false);
});

test('⑥ 视图：两步删除（第一步只是上膛）/ 行内重命名 / 载入 / 导出按钮都接好了', () => {
    seed();
    seedEditor();
    W.workSave('待操作的作品');

    WUI.openWorkPanel();
    const mask = dom.els['#cf-work-panel'];
    assert.ok(mask, '浮层要挂到 body 上（#cf-work-panel）');
    const body = mask.querySelector('#cf-wk-body');
    assert.equal(body.children.length, 1, '一件作品一行');

    const row = body.children[0];
    assert.match(row.innerHTML, /待操作的作品/);
    assert.match(row.innerHTML, /ac123456/, '行里要能看到视频');
    assert.match(row.innerHTML, /2 条字幕/, '行里要能看到条数');
    assert.match(row.innerHTML, /更新 \d+-\d+ \d+:\d+/, '行里要能看到更新时间');
    assert.match(row.innerHTML, /未彩排/, '行里要能看到彩排标志（本片恒为未彩排）');
    assert.equal(row.querySelector('[data-act=use]').handlers.click.length, 1, '载入按钮要有处理函数');
    assert.equal(row.querySelector('[data-act=export]').handlers.click.length, 1, '导出按钮要有处理函数');

    // 两步删除：第一步只是上膛（不新增 confirm(，也不真删）
    const delBtn = row.querySelector('[data-act=del]');
    delBtn.dispatch('click');
    assert.match(delBtn.textContent, /再点一次确认删除/, '第一步只是上膛：' + delBtn.textContent);
    assert.ok(delBtn.className.indexOf('armed') >= 0, '上膛要换配色');
    assert.equal(W.workList().length, 1, '上膛阶段一件都不该删');
    delBtn.dispatch('click');
    assert.equal(W.workList().length, 0, '第二步才真删');
    assert.match(statusEl.textContent, /已删除作品「待操作的作品」/, statusEl.textContent);
    assert.match(mask.querySelector('#cf-wk-body').innerHTML, /还没有作品/, '删空后回到空态');

    // 行内重命名：行变成输入框 → 确定后改名
    W.workSave('原名');
    WUI.openWorkPanel();                       // 重开一次，拿到新列表
    const mask2 = dom.els['#cf-work-panel'];
    const row2 = mask2.querySelector('#cf-wk-body').children[0];
    row2.querySelector('[data-act=rename]').dispatch('click');
    assert.match(row2.innerHTML, /cf-wk-nameinput/, '重命名要把行换成输入框');
    const input = row2.querySelector('.cf-wk-nameinput');
    assert.equal(input.value, '原名', '输入框预填当前名字');
    input.value = '改过的名字';
    row2.querySelector('[data-act=rename-ok]').dispatch('click');
    assert.equal(W.workList()[0].name, '改过的名字');
    assert.match(statusEl.textContent, /已重命名为「改过的名字」/, statusEl.textContent);
});

// ---------------- ⑦ 列表排序与空态 ----------------

test('⑦ 列表：按更新时间倒序 / 默认名可重复保存不撞名 / 空态有文案且统计行露上限', () => {
    seed([
        fixture('第三个', { id: 'c', updatedAt: 3000 }),
        fixture('第一个', { id: 'a', updatedAt: 1000, source: Object.assign({}, fixture('x').source, { subs: [{ time: 0, text: 'x' }] }) }),
        fixture('第二个', { id: 'b', updatedAt: 2000 }),
    ]);
    assert.deepEqual(W.workList().map((w) => w.name), ['第三个', '第二个', '第一个'], '按更新时间倒序（最近保存最前）');
    assert.deepEqual(JSON.parse(store.get(KEY)).works.map((w) => w.id), ['c', 'a', 'b'], '存储里仍是 FIFO 顺序（旧→新），排序只发生在读出来的副本上');

    // 默认名：反复保存不撞名（同名自动加序号）
    seed();
    CORE.setSubs([{ time: 0, text: '一' }]);
    const names = [W.workSave(''), W.workSave(''), W.workSave('')].map((r) => r.work.name);
    assert.equal(new Set(names).size, 3, '三次默认名不得撞名：' + names.join(' / '));
    assert.match(names[0], /^作品 \d+-\d\d \d\d:\d\d:\d\d$/, names[0]);
    assert.ok(names.indexOf(W.defaultWorkName()) < 0, 'defaultWorkName 会自动避开已用名：' + W.defaultWorkName());
    assert.ok(names.indexOf(W.defaultWorkName()) < 0);
    CORE.setSubs([]);

    // 覆盖保存：同 id 不新增，且落到了队尾（于是不会被 FIFO 当场裁掉）
    seed([fixture('老作品', { id: 'old', updatedAt: 1 }), fixture('另一件', { id: 'other', updatedAt: 2 })]);
    CORE.setSubs([{ time: 0, text: '覆盖后的内容' }]);
    const ov = W.workSave('老作品 v2', { id: 'old' });
    assert.equal(ov.ok, true);
    assert.equal(ov.overwritten, true);
    assert.equal(W.workList().length, 2, '覆盖不新增一件');
    assert.deepEqual(JSON.parse(store.get(KEY)).works.map((w) => w.id), ['other', 'old'], '覆盖后落到队尾（成了最新）');
    assert.equal(W.workList().find((w) => w.id === 'old').name, '老作品 v2');
    const ovNo = W.workSave('x', { id: '不存在' });
    assert.equal(ovNo.ok, false);
    assert.match(ovNo.reason, /已不存在/);
    CORE.setSubs([]);

    // 空态 + 统计行
    seed();
    assert.deepEqual(W.workList(), []);
    WUI.openWorkPanel();
    const mask = dom.els['#cf-work-panel'];
    assert.match(mask.querySelector('#cf-wk-body').innerHTML, /还没有作品/, '空态要有文案');
    assert.match(mask.querySelector('#cf-wk-body').innerHTML, /保存当前/, '空态要告诉人怎么开始');
    const stats = mask.querySelector('#cf-wk-stats').textContent;
    assert.match(stats, /共 0 件作品/, stats);
    assert.match(stats, /上限 20 件 · 2048KB/, '上限要露出来：' + stats);
    assert.match(stats, /FIFO/, '超出怎么办要写在明面上：' + stats);
    assert.equal(mask.querySelector('[data-act=close]').handlers.click.length, 1);
    assert.equal(mask.querySelector('[data-act=save]').handlers.click.length, 1);
    assert.equal(mask.querySelector('[data-act=import]').handlers.click.length, 1);
    mask.querySelector('[data-act=close]').dispatch('click');
    assert.equal(mask.removed, true, '关闭即收掉浮层');
});

// ---------------- 静态守卫（本仓无真浏览器；入口/样式/硬约束与「不缓存 models」） ----------------

test('接线与硬约束：入口 / 绑定 / 样式单点 / 复用 downloadJson / 没新增 confirm( / 不缓存 models', () => {
    const ui = read('80-ui.js');
    const events = read('95-events.js');
    const boot = read('boot.js');
    const wkUi = read('gdm-work-ui.js');
    const wk = read('gdm-work.js');
    const presetUi = read('90-preset-ui.js');

    assert.match(ui, /id="cf-work-btn"/, '面板要有作品入口按钮');
    assert.match(events, /#cf-work-btn'\)\.addEventListener\('click', openWorkPanel\)/, '入口要绑到 openWorkPanel');
    assert.match(events, /from '\.\/gdm-work-ui\.js'/, '跨文件引用必须走 import 收口');

    // 浮层挂在 body 上 → 全部选择器必须带 #cf-work-panel 前缀，且样式只进 injectStyle 单点
    assert.match(boot, /#cf-work-panel \.cf-wk-item/, '要有作品行样式');
    assert.match(boot, /#cf-work-panel \.cf-wk-badge/, '要有彩排标志样式');
    assert.ok(boot.indexOf('#cf-work-panel') > boot.indexOf('#cf-sub-panel'), '新样式只进 injectStyle 单点');
    assert.equal(/\.cf-wk-/.test(noComment(ui)), false, '作品样式不得写进 80-ui');
    assert.match(wkUi, /cf-dev-panel-mask/, '浮层外壳沿用既有 mask 范式');

    // 导出复用既有的 downloadJson（JSON 下载只有一份实现）
    assert.match(wkUi, /downloadJson\(/, '导出作品要复用 downloadJson');
    assert.match(noComment(presetUi), /export \{[^}]*downloadJson/s, 'downloadJson 必须对外导出');
    assert.match(noComment(presetUi), /export \{[^}]*refreshPresetSelect/s, 'refreshPresetSelect 必须对外导出（载入作品要回写预设控件）');
    assert.match(ui, /export \{[^}]*refreshEditorFromState/s, 'refreshEditorFromState 必须对外导出（载入作品要回写样式控件）');

    // 删除：两步内联（不新增 confirm(）
    assert.match(wkUi, /再点一次确认删除/, '删除要走两步内联按钮');
    assert.match(wkUi, /DEL_ARM_MS/, '上膛态要能自动解除（防手滑）');
    assert.equal(/confirm\(|alert\(|prompt\(/.test(noComment(wkUi)), false, '作品视图不得出现 confirm(/alert(/prompt(');
    assert.equal(/confirm\(|alert\(|prompt\(/.test(noComment(wk)), false, '作品数据层不得出现 confirm(/alert(/prompt(');

    // confirm(/alert( 全仓总数仍是 3（与 tools/check.mjs 同一条纪律）
    let n = 0;
    const where = [];
    fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).forEach((f) => {
        const c = (noComment(read(f)).match(/confirm\(|alert\(/g) || []).length;
        if (c) { n += c; where.push(f + '×' + c); }
    });
    assert.equal(n, 3, 'confirm(/alert( 总数必须仍是 3（只减不增）：实际 ' + where.join(', '));

    // **不缓存 models**（本片偏离计划书 P3.5 的「两份都存」）：作品层不得碰模型/展开
    [['gdm-work.js', wk], ['gdm-work-ui.js', wkUi]].forEach(([f, src]) => {
        const code = noComment(src);
        assert.equal(/buildModel|expandSub|animationFrames|gdm-model/.test(code), false, f + ' 不得碰模型/展开（作品只存源）');
    });
    assert.match(wk, /不缓存 models/, '头注要写明这条取舍');
    assert.match(wk, /实测展开成本|185ms|0\.2 秒/, '头注要带上依据（实测展开成本）');
    assert.match(wk, /rehearsed[\s\S]{0,80}只存不用|只存不用[\s\S]{0,80}rehearsed/, '头注要写明 rehearsed 本片只存不用');
    assert.match(wk, /闸①/, '头注要写明「未彩排不许发送」是闸①（下一片）的事');

    // 作品视图不得发网络请求
    assert.equal(/GM_xmlhttpRequest|fetch\(|XMLHttpRequest/.test(noComment(wkUi)), false, '作品视图不发网络请求');
    assert.match(wkUi, /noopener/, '视频外链要带 rel="noopener"');
});
