// 闸④ 台账（gdm-ledger）与它接线的契约测试（node --test）
//
// 要守的东西：
//   ① **记录与分组查询**——字段全集固定（外来键不进账）、写入顺序、按视频分组的时间范围与链接；
//   ② **双闸轮转**——条数上限 LEDGER_MAX_ENTRIES 与字节上限 LEDGER_MAX_BYTES 各自 FIFO 丢最旧，
//      且**永不丢刚记下的那条**（单条自己就超闸时也留下）；
//   ③ **配额写失败降级不抛**——40-core 的 storeSet 把配额异常静默吞掉，故判成败靠读回比对；
//      本文件用「写入超过 writeLimit 就抛」的 localStorage 桩把这条链路端到端走一遍：
//      丢旧重试成功 / 怎么丢都写不下（返回失败标志 + 可查标记 + 内存留档）/ 恢复后一并补落盘 / 不影响发送；
//   ④ **danmakuId 空值 / 重复**——空 id 照记但不参与去重与验证匹配；重复 id 去重、保留首条时间与内容；
//   ⑤ **状态标签**——只有「待审核（未确认）」与「已确认可见」两态，**没有「失败」**：
//      verifySent 查不到 ≠ 失败（审核延迟/接口受限），未确认的记录一律停在 pending；
//   ⑥ **sendModel 返回值从 true 改成 { ok, id, videoId } 后没有消费者被破坏**——静态 grep（谁在用、
//      有没有人拿它当布尔）+ 行为（真跑一遍发送循环，看台账有没有拿到 id）；
//   ⑦ **台账视图的接线与硬约束**（本仓无真浏览器，UI 只能静态取证）：入口按钮 / 事件绑定 / 样式前缀 /
//      导出复用 downloadJson / 清空没新增 confirm( / 没有任何删除接口尝试 / 「速率限制未知」不抄无出处的数字。
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
globalThis.localStorage = {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) {
        const s = String(v);
        if (failWrites || s.length > writeLimit) throw new Error('QuotaExceededError（测试桩）');
        store.set(k, s);
    },
    removeItem(k) { store.delete(k); },
};
// 最小 DOM 桩（本仓零依赖，没有 jsdom）：节点支持事件/属性/childNodes，
// `querySelector` **自动补位**——没有 HTML 解析器，选择器一律返回一个固定的「位子」。
// 被验的是「代码能不能真跑起来」与两步清空的时序，不是 DOM 结构本身（结构靠静态取证那条测试）。
const dom = { els: {}, created: [] };
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
    return e;
}
globalThis.document = {
    readyState: 'loading',
    addEventListener() {},
    querySelector(sel) { return dom.els[sel] || null; },
    querySelectorAll() { return []; },
    createElement(tag) { const e = el(tag); if (tag !== 'canvas') dom.created.push(e); return e; },
    body: { appendChild(c) { if (c && c.id) dom.els['#' + c.id] = c; return c; } },
    documentElement: { appendChild() {} },
    head: { appendChild() {} },
};

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

const L = await import('../../src/gdm-ledger.js');
const NET = await import('../../src/60-network.js');
const CORE = await import('../../src/40-core.js');
const { setExpandSub } = await import('../../src/50-engine.js');

const KEY = L.LEDGER_STORE_KEY;
assert.equal(KEY, 'cf_sub_ledger', '台账存储键（storeSet 会补 cf_sub_ 前缀）');

// 造场景：清空存储 → 需要时预置账 → 重置内存缓存（否则读到的还是上一个用例的账）
function seed(entries) {
    store.clear();
    failWrites = false;
    writeLimit = Infinity;
    if (entries) store.set(KEY, JSON.stringify({ v: 1, entries }));
    L.resetLedgerState();
}

// ---------------- ① 记录与分组查询 ----------------

test('记录与分组查询：字段全集固定、写入顺序、按视频分组（条数/时间范围/链接）', () => {
    seed();
    const t0 = Date.now();
    const a = L.ledgerRecord({ danmakuId: '101', content: '你好世界', vid: 123, startTime: 1974, presetId: 'vertical', presetName: '竖排字幕', sentAt: t0 });
    assert.equal(a.ok, true, '正常写入应成功');
    assert.equal(a.deduped, false);
    assert.equal(a.dropped, 0, '没超闸就不该丢东西');
    L.ledgerRecord({ danmakuId: '102', content: '第二句', vid: 123, startTime: 5000, sentAt: t0 + 1000 });
    L.ledgerRecord({ danmakuId: '201', content: '别的视频（番剧）', vid: 999, bangumi: true, sentAt: t0 + 2000 });
    L.ledgerRecord({ danmakuId: '301', content: '带外来键', vid: 1, sentAt: t0 + 3000, evil: '不该进账' });

    const list = L.ledgerList();
    assert.equal(list.length, 4);
    assert.deepEqual(list.map((e) => e.danmakuId), ['101', '102', '201', '301'], 'ledgerList 按写入顺序（旧→新）');
    assert.deepEqual(Object.keys(list[0]).sort(),
        ['bangumi', 'content', 'danmakuId', 'presetId', 'presetName', 'sentAt', 'startTime', 'verified', 'verifiedAt', 'vid'].sort(),
        '字段全集固定（normalize 是唯一入口）');
    assert.equal(list[0].content, '你好世界');
    assert.equal(list[0].vid, 123);
    assert.equal(list[0].startTime, 1974);
    assert.equal(list[0].presetId, 'vertical');
    assert.equal(list[0].presetName, '竖排字幕');
    assert.equal(list[0].sentAt, t0);
    assert.equal(list[0].verified, false, '新记录默认未确认');
    assert.equal(list[0].verifiedAt, null);
    assert.equal('evil' in list[3], false, '外来键不得进账');
    assert.ok(L.ledgerList() !== list, 'ledgerList 返回新数组（改它不影响台账；元素是共享引用）');
    L.ledgerList().push({ 假的: true });
    assert.equal(L.ledgerList().length, 4, 'push 到副本上不该改到台账');

    const groups = L.ledgerByVideo();
    assert.equal(groups.length, 3);
    assert.deepEqual(groups.map((g) => String(g.vid)), ['1', '999', '123'], '组间按最近有活动排前');
    const g123 = groups[2];
    assert.equal(g123.count, 2);
    assert.equal(g123.verifiedCount, 0);
    assert.equal(g123.url, 'https://www.acfun.cn/v/ac123');
    assert.equal(g123.firstAt, t0);
    assert.equal(g123.lastAt, t0 + 1000);
    assert.deepEqual(g123.entries.map((e) => e.danmakuId), ['101', '102']);
    assert.equal(groups[1].url, 'https://www.acfun.cn/bangumi/aa999', '番剧用 bangumi 链接');
    assert.equal(L.ledgerVideoUrl({ vid: '' }), '', '没有视频 id 时不给链接');
});

// ---------------- ② 双闸轮转（FIFO） ----------------

test('条数上限：FIFO 轮转——丢最旧、留最新（LEDGER_MAX_ENTRIES=1000）', () => {
    const n = L.LEDGER_MAX_ENTRIES;
    const seeded = [];
    for (let i = 0; i < n; i++) seeded.push({ danmakuId: 'old-' + i, content: 'x', vid: 1, sentAt: 1000 + i });
    seed(seeded);
    const r = L.ledgerRecord({ danmakuId: 'newest', content: 'y', vid: 1, sentAt: 999999 });
    assert.equal(r.ok, true);
    assert.equal(r.dropped, 1, '超出 1 条 → 只丢最旧 1 条');
    const list = L.ledgerList();
    assert.equal(list.length, n, '条数稳定在上限');
    assert.equal(list[0].danmakuId, 'old-1', '最旧的 old-0 被丢');
    assert.equal(list[list.length - 1].danmakuId, 'newest', '最新的始终在');
    assert.equal(JSON.parse(store.get(KEY)).entries.length, n, '落盘也是 n 条');
});

test('字节上限：超限按 FIFO 丢到限内；单条自己超闸也留下（丢最新 = 没记）', () => {
    const big = '长'.repeat(4000);
    const seeded = [];
    for (let i = 0; i < 70; i++) seeded.push({ danmakuId: 'b-' + i, content: big, vid: 7, sentAt: i });
    seed(seeded);
    assert.ok(JSON.stringify({ v: 1, entries: seeded }).length > L.LEDGER_MAX_BYTES, '夹具本身就该超字节闸');
    const r = L.ledgerRecord({ danmakuId: 'newest', content: big, vid: 7 });
    assert.equal(r.ok, true);
    assert.ok(r.dropped > 0, '字节闸要丢旧条目，实际丢 ' + r.dropped);
    const st = L.ledgerStats();
    assert.ok(st.bytes <= L.LEDGER_MAX_BYTES, '落盘体积必须在闸内：' + st.bytes + ' > ' + L.LEDGER_MAX_BYTES);
    const list = L.ledgerList();
    assert.equal(list[list.length - 1].danmakuId, 'newest');
    assert.ok(!list.some((e) => e.danmakuId === 'b-0'), '最旧的被丢');

    // 单条就超闸：仍然保留这一条（宁超体积也不丢最新）
    seed();
    const huge = '巨'.repeat(L.LEDGER_MAX_BYTES + 10);
    const r2 = L.ledgerRecord({ danmakuId: 'huge2', content: huge, vid: 1 });
    assert.equal(r2.ok, true);
    const l2 = L.ledgerList();
    assert.equal(l2.length, 1, '留下刚记的那条，而不是把它裁掉');
    assert.equal(l2[0].danmakuId, 'huge2');
});

// ---------------- ③ 配额写失败：降级不抛 ----------------

test('配额写失败降级：丢最旧重试 → 成功；怎么丢都写不下 → 失败标志 + 可查标记 + 内存留档（全程不抛）', () => {
    const big = 'x'.repeat(3000);
    const seeded = [];
    for (let i = 0; i < 40; i++) seeded.push({ danmakuId: 'q-' + i, content: big, vid: 1 });
    seed(seeded);
    const rawLen = JSON.stringify({ v: 1, entries: seeded }).length;

    // A) 只有丢掉大半旧账才写得下 → 重试一次就成
    writeLimit = Math.floor(rawLen * 0.6);
    let r;
    assert.doesNotThrow(() => { r = L.ledgerRecord({ danmakuId: 'n1', content: big, vid: 1 }); }, '写失败绝不抛');
    assert.equal(r.ok, true, '丢旧重试后应成功');
    assert.ok(r.dropped > 0, '得丢掉一些旧的，实际 ' + r.dropped);
    const storedA = JSON.parse(store.get(KEY));
    assert.ok(storedA.entries.some((e) => e.danmakuId === 'n1'), '新条目在存储里');
    assert.ok(store.get(KEY).length <= writeLimit, '落盘的串必须缩到配额以内');

    // B) 怎么丢都写不下 → 降级：ok:false + 可查标记 + 内存里留着，且不抛
    seed([{ danmakuId: 'm1', content: big, vid: 1 }]);
    writeLimit = 10;
    let r2;
    assert.doesNotThrow(() => { r2 = L.ledgerRecord({ danmakuId: 'm2', content: 'y', vid: 1 }); }, '写不进也绝不抛');
    assert.equal(r2.ok, false, '写不下要如实返回失败标志');
    assert.ok(r2.reason && r2.reason.indexOf('配额') >= 0, '失败原因要能读：' + r2.reason);
    const w = L.ledgerWriteState();
    assert.equal(w.ok, false);
    assert.ok(w.lastError, '内存里的写状态可查（localStorage 那份配额真满时也写不进去）');
    assert.deepEqual(L.ledgerList().map((e) => e.danmakuId), ['m1', 'm2'],
        '内存里仍留着完整两条（为腾地方丢的旧条目全失败时复原）');

    // C) 恢复可写 → 之前只在内存里的条目一并补落盘
    writeLimit = Infinity;
    const r3 = L.ledgerRecord({ danmakuId: 'm3', content: 'z', vid: 1 });
    assert.equal(r3.ok, true);
    assert.deepEqual(JSON.parse(store.get(KEY)).entries.map((e) => e.danmakuId), ['m1', 'm2', 'm3'],
        '内存里未落盘的条目在下次成功写入时一并补上');
    assert.equal(L.ledgerWriteState().ok, true, '成功写入后写状态复位');

    // D) 清空也走同一条判成败的路
    writeLimit = 10;
    const rc = L.ledgerClear();
    assert.equal(rc.ok, false, '清空写不进要如实返回失败');
    assert.equal(rc.cleared, 3, '但仍如实报告清掉了几条（内存已清）');
    assert.equal(L.ledgerList().length, 0);
    writeLimit = Infinity;
});

// ---------------- ④ danmakuId 空值 / 重复 ----------------

test('danmakuId 空值照记但不参与去重与验证；重复 id 去重并保留首条', () => {
    seed();
    L.ledgerRecord({ danmakuId: '', content: '无 id 的一条', vid: 5, startTime: 100 });
    L.ledgerRecord({ danmakuId: null, content: '又一条无 id 的', vid: 5, startTime: 200 });
    assert.deepEqual(L.ledgerList().map((e) => e.danmakuId), ['', ''],
        '空 id 照记（发送确已成功，内容/位置/视频仍是可核对的清理线索）');
    assert.equal(L.ledgerList().length, 2, '空 id 之间不去重（没有 id 就没法判定是同一条）');
    assert.equal(L.ledgerMarkVerified(['']), 0, '空 id 永不参与验证匹配');
    assert.equal(L.ledgerMarkVerified([null, undefined]), 0, '脏输入返回 0');
    assert.equal(L.ledgerList()[0].verified, false);
    assert.ok(L.ledgerChecklistText([L.ledgerList()[0]]).indexOf('id=(未返回)') > 0, '清单里标出「未返回」');

    const r1 = L.ledgerRecord({ danmakuId: 'dup', content: '第一次', vid: 5, sentAt: 111 });
    const r2 = L.ledgerRecord({ danmakuId: 'dup', content: '第二次（同一条被记两次）', vid: 5, sentAt: 222, presetName: 'KTV 唱词' });
    assert.equal(r1.deduped, false);
    assert.equal(r2.deduped, true, '重复 id 要判出来');
    assert.equal(r2.entry.sentAt, 111, '保留首条的时间');
    assert.equal(r2.entry.content, '第一次', '保留首条的内容');
    assert.equal(r2.entry.presetName, 'KTV 唱词', '后到的预设名补得上');
    assert.equal(L.ledgerList().length, 3, '重复 id 不追加');
    assert.equal(L.ledgerList().filter((e) => e.danmakuId === 'dup').length, 1);
});

// ---------------- ⑤ 状态标签：两态，没有「失败」 ----------------

test('状态标签：只有「待审核（未确认）」与「已确认可见」；未确认绝不显示为失败', () => {
    seed();
    L.ledgerRecord({ danmakuId: 'v1', content: 'a', vid: 1 });
    L.ledgerRecord({ danmakuId: 'v2', content: 'b', vid: 1, presetName: '竖排' });
    assert.deepEqual(Object.keys(L.LEDGER_STATUS_LABELS).sort(), ['pending', 'verified'], '只有两态');
    Object.keys(L.LEDGER_STATUS_LABELS).forEach((k) => {
        const l = L.LEDGER_STATUS_LABELS[k];
        assert.ok(l.indexOf('失败') < 0 && l.toLowerCase().indexOf('fail') < 0, '标签里不得出现失败：' + l);
    });
    assert.equal(L.ledgerStatusOf({}), 'pending', '没有 verified 字段 = 未确认');
    assert.equal(L.ledgerStatusLabel({ verified: false }), '待审核（未确认）');
    assert.equal(L.ledgerStatusLabel({ verified: true }), '已确认可见');
    assert.equal(L.ledgerStatusLabel(L.ledgerList()[0]), '待审核（未确认）', '刚发出去的是「待审核」，不是「失败」');
    assert.ok(L.ledgerStatusLabel(L.ledgerList()[0]).indexOf('失败') < 0);

    // verifySent 确认到 → 翻 verified（带确认时刻）
    const before = Date.now();
    assert.equal(L.ledgerMarkVerified(['v1']), 1);
    assert.equal(L.ledgerMarkVerified(['v1']), 0, '已确认的不重复计数');
    assert.equal(L.ledgerMarkVerified(new Set(['v2'])), 1, 'Set 也收');
    const list = L.ledgerList();
    const e1 = list.find((e) => e.danmakuId === 'v1');
    assert.equal(e1.verified, true);
    assert.ok(e1.verifiedAt >= before && e1.verifiedAt <= Date.now(), 'verifiedAt 记确认时刻');
    assert.equal(L.ledgerStatusLabel(e1), '已确认可见');
    assert.equal(L.ledgerStatusLabel(list.find((e) => e.danmakuId === 'v2')), '已确认可见');
    assert.equal(L.ledgerStatusOf(list[1]), 'verified');
    const storedE1 = JSON.parse(store.get(KEY)).entries.find((e) => e.danmakuId === 'v1');
    assert.equal(storedE1.verified, true, '确认状态要落盘（刷新后还在）');

    // 没被确认到的仍是 pending——「全片没查到」不翻成任何失败态
    seed([{ danmakuId: 'x1', content: '没人确认过', vid: 1 }, { danmakuId: 'x2', content: 'b', vid: 1 }]);
    assert.equal(L.ledgerMarkVerified(['x1', '不存在']), 1, '匹配不到的不算');
    assert.equal(L.ledgerStatusLabel(L.ledgerList()[1]), '待审核（未确认）');
});

// ---------------- ⑥ 接线：sendModel 返回值 + 发送循环落账 ----------------

test('sendModel 的返回值改动没有消费者被破坏（全仓静态取证）', () => {
    const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js'));
    const hits = [];
    files.forEach((f) => {
        // 先剥行注释：理解卡里提到 sendModel 的名字不算消费者（与 tools/check.mjs 同一条纪律）
        read(f).replace(/\/\/[^\n]*/g, '').split('\n').forEach((line, i) => {
            if (line.indexOf('sendModel') >= 0) hits.push(f + ':' + (i + 1) + ': ' + line.trim());
        });
    });
    const consumers = [...new Set(hits.map((h) => h.split(':')[0]))].sort();
    assert.deepEqual(consumers, ['60-network.js', '85-danmaku.js'],
        'sendModel 只应被这两个文件引用（声明方 + 单发消费方）：\n  ' + hits.join('\n  '));
    hits.forEach((h) => {
        assert.ok(!/sendModel\([^)]*\)\s*(===|!==|==|!=)\s*true/.test(h), '不得把返回值与 true 比较：' + h);
        assert.ok(!/sendModel\([^)]*\)\s*[?&|]/.test(h), '不得把返回值当布尔用：' + h);
        assert.ok(!/if\s*\(\s*(?:await\s+)?sendModel\(/.test(h), '不得把返回值当布尔判断：' + h);
        assert.ok(!/!\s*(?:await\s+)?sendModel\(/.test(h), '不得对返回值取反：' + h);
    });
    const net = read('60-network.js');
    assert.match(net, /return \{ ok: true, id: id, videoId: v\.videoId \};/, 'sendModel 现在把 id 带出来');
    assert.ok(!/if \(id\) lastSentIds\.push\(id\);\s*\n\s*return true;/.test(net), '旧的 return true 必须已移除');
    assert.match(net, /const ret = await sendModel\(models\[i\]\);/, 'sendDanmaku 取用返回值');
    assert.match(net, /ledgerRecordSentModel\(models\[i\], ret\);/, '取到就落台账');
    assert.match(read('85-danmaku.js'), /const ret = await sendModel\(m\);/, '单发同样取用返回值');
});

test('接线行为：发送循环逐条落账（含取消时已发出的照记）、单发同路径、台账失败不影响发送', async () => {
    const savedPlayer = globalThis.player;
    const savedLoc = globalThis.location;
    globalThis.player = { vid: 123 };
    globalThis.location = { pathname: '/v/ac123' };
    const models = [{ content: 'a', startTime: 100 }, { content: 'b', startTime: 200 }, { content: 'c', startTime: 300 }];
    try {
        setExpandSub(() => models.slice());
        const sub = { time: 1000, text: '甲' };

        // 正常路径：每条成功 → 台账一条，字段来自真正发出去的那个 model 与当前视频
        seed();
        let calls = 0;
        NET.setSendModel(async function () { calls++; return { ok: true, id: 'ID' + calls, videoId: 123 }; });
        const r = await NET.sendDanmaku(sub, {}, 1, null);
        assert.deepEqual({ sent: r.sent, total: r.total }, { sent: 3, total: 3 });
        const list = L.ledgerList();
        assert.equal(list.length, 3, '三条成功 → 三条账');
        assert.deepEqual(list.map((e) => e.danmakuId), ['ID1', 'ID2', 'ID3']);
        assert.deepEqual(list.map((e) => e.content), ['a', 'b', 'c'], '内容取真正发出去的 model');
        assert.deepEqual(list.map((e) => e.startTime), [100, 200, 300]);
        assert.ok(list.every((e) => e.vid === 123 && e.bangumi === false), '视频取当前视频（含番剧标记）');
        assert.ok(list.every((e) => e.verified === false), '刚发出去的是「待审核（未确认）」');
        assert.ok(L.ledgerByVideo()[0].url === 'https://www.acfun.cn/v/ac123');

        // 取消：第 2 条发完就置 cancelled → 已发出的两条照记，第 3 条不发
        seed();
        calls = 0;
        CORE.setCancelled(false);
        NET.setSendModel(async function () {
            calls++;
            if (calls === 2) CORE.setCancelled(true);
            return { ok: true, id: 'C' + calls };
        });
        const r2 = await NET.sendDanmaku(sub, {}, 1, null);
        assert.deepEqual({ sent: r2.sent, total: r2.total }, { sent: 2, total: 3 }, '取消后停在中间');
        assert.deepEqual(L.ledgerList().map((e) => e.danmakuId), ['C1', 'C2'],
            '取消时**已发出的照记**（它们真的进池了）');
        CORE.setCancelled(false);

        // 旧形态 stub（冒烟 #15 的探针就 return true）：不炸，只是记成无 id
        seed();
        NET.setSendModel(async function () { return true; });
        const r3 = await NET.sendDanmaku(sub, {}, 1, null);
        assert.equal(r3.sent, 3);
        assert.deepEqual(L.ledgerList().map((e) => e.danmakuId), ['', '', ''], '拿不到 id 也照记');

        // 台账写不进去（配额满）绝不影响发送结果
        seed();
        writeLimit = 0;
        NET.setSendModel(async function () { return { ok: true, id: 'F1' }; });
        const r4 = await NET.sendDanmaku(sub, {}, 1, null);
        assert.deepEqual({ sent: r4.sent, total: r4.total }, { sent: 3, total: 3 }, '台账失败不能拖累发送');
        assert.equal(L.ledgerWriteState().ok, false);
        writeLimit = Infinity;

        // sendModel 抛错仍是抛错（失败路径语义没被记账改掉）
        NET.setSendModel(async function () { throw new Error('boom'); });
        let threw = false;
        try { await NET.sendDanmaku(sub, {}, 1, null); } catch (e) { threw = true; }
        assert.equal(threw, true, '发送失败照旧向上抛');
    } finally {
        // expandSub 的替身留在本进程里即可（原实现没对外导出，本文件是最后一个用它的用例）
        CORE.setCancelled(false);
        if (savedPlayer === undefined) delete globalThis.player; else globalThis.player = savedPlayer;
        if (savedLoc === undefined) delete globalThis.location; else globalThis.location = savedLoc;
    }
});

// ---------------- ⑦ 台账视图接线（静态取证；本仓无真浏览器） ----------------

test('台账视图接线：入口/绑定/样式/导出复用/两步清空/无新增 confirm(/无删除接口尝试', () => {
    const ui = read('80-ui.js');
    const events = read('95-events.js');
    const boot = read('boot.js');
    const lgUi = read('gdm-ledger-ui.js');
    const presetUi = read('90-preset-ui.js');
    const noComment = (s) => s.replace(/\/\/[^\n]*/g, '');

    assert.match(ui, /id="cf-ledger-btn"/, '面板要有台账入口按钮');
    assert.match(events, /#cf-ledger-btn'\)\.addEventListener\('click', openLedgerPanel\)/, '入口要绑到 openLedgerPanel');
    assert.match(events, /from '\.\/gdm-ledger-ui\.js'/, '跨文件引用必须走 import 收口');

    // 浮层挂在 body 上，拿不到 #cf-sub-panel 的那套样式 → 全部选择器必须带 #cf-ledger-panel 前缀
    assert.match(boot, /#cf-ledger-panel \.cf-lg-badge\.pending/, '要有「待审核」标签样式');
    assert.match(boot, /#cf-ledger-panel \.cf-lg-badge\.verified/, '要有「已确认可见」标签样式');
    assert.match(boot, /#cf-ledger-panel \.cf-lg-guide/, '要有清理引导样式');
    assert.ok(boot.indexOf('#cf-ledger-panel') > boot.indexOf('#cf-sub-panel'), '新样式只进 injectStyle 单点');
    assert.match(lgUi, /cf-dev-panel-mask/, '浮层外壳沿用既有 mask 范式（与 openExportDialog 一致）');

    // 导出复用既有的 downloadJson（JSON 下载只有一份实现）
    assert.match(lgUi, /downloadJson\(/, '导出台账要复用 downloadJson');
    assert.match(noComment(presetUi), /export \{[^}]*downloadJson/s, 'downloadJson 必须对外导出，否则 gdm-ledger-ui 拿不到');

    // 状态文案只有一份出处（改口径只改 gdm-ledger 那一处）
    assert.match(lgUi, /const label = ledgerStatusLabel\(e\)/, '状态文案取自 gdm-ledger（不在视图里另写第二份）');
    assert.ok(!/LEDGER_STATUS_LABELS/.test(noComment(lgUi)), '视图不得自己翻状态文案表');

    // 清空：两步内联按钮（不新增 confirm(）
    assert.match(lgUi, /再点一次确认清空/, '清空要走两步内联按钮');
    assert.match(lgUi, /CLEAR_ARM_MS/, '上膛态要能自动解除（防手滑）');

    // 诚实版清理引导
    assert.match(lgUi, /无法删除已发送的弹幕/, '要明说本工具删不掉');
    assert.match(lgUi, /API\.md §十一/, '要给出依据（A 站没有删除接口）');
    assert.match(lgUi, /手动/, '清理只能手动');
    assert.match(lgUi, /速率限制未知/, '速率限制未知（不抄无出处的「2 条/分钟」）');
    assert.ok(noComment(lgUi).indexOf('条/分') < 0, '不得编造速率数字（「2 条/分钟」在 API.md / RISKS.md 里没有出处）');

    // 不做任何自动删除的尝试：没有删除接口调用、没有网络出口
    const lgCode = noComment(lgUi);
    assert.ok(!/\bdelete\s*\(/.test(lgCode), '视图不得出现 delete 调用');
    assert.ok(!/new-danmaku\/delete/.test(lgCode), '不得尝试不存在的删除接口');
    assert.ok(!/GM_xmlhttpRequest|fetch\(|XMLHttpRequest/.test(lgCode), '台账视图不发网络请求');
    assert.match(lgCode, /noopener/, '外链要带 rel="noopener"');

    // 空态
    assert.match(lgUi, /台账为空/, '空台账要有明确空态文案');

    // 硬约束：confirm(/alert( 全仓总数仍是 3（与 tools/check.mjs 同一条纪律）
    let n = 0;
    const where = [];
    fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).forEach((f) => {
        const c = (noComment(read(f)).match(/confirm\(|alert\(/g) || []).length;
        if (c) { n += c; where.push(f + '×' + c); }
    });
    assert.equal(n, 3, 'confirm(/alert( 总数必须仍是 3（只减不增）：实际 ' + where.join(', '));
});

test('verifySent 的「全片未查到」不再归 err（查不到 ≠ 失败）；清空/统计/坏存储容错', () => {
    const net = read('60-network.js');
    assert.match(net, /全片未查到高级弹幕[\s\S]{0,120}这不等于发送失败/, '文案要明说不是失败');
    assert.match(net, /这不等于发送失败[\s\S]{0,80}'busy'\)/, '从 err 改为 busy（红 error 会让人以为发送失败了）');
    assert.match(net, /ledgerMarkVerified\(mine\.map/, '确认到的 id 才回写台账');
    // 口径要写在台账头注里（读到这条注释的人不该以为「没查到 = 失败」）
    assert.ok(read('gdm-ledger.js').indexOf('查不到 ≠ 失败') > 0, '台账头注要写明「查不到 ≠ 失败」');

    // 清空 / 统计
    seed([{ danmakuId: 'c1', content: 'x', vid: 1 }, { danmakuId: 'c2', content: 'y', vid: 2 }]);
    const st = L.ledgerStats();
    assert.equal(st.count, 2);
    assert.equal(st.maxEntries, L.LEDGER_MAX_ENTRIES);
    assert.equal(st.maxBytes, L.LEDGER_MAX_BYTES);
    assert.ok(st.bytes > 0 && st.bytes <= L.LEDGER_MAX_BYTES);
    assert.equal(st.verified, 0);
    assert.equal(L.ledgerStats().write.ok, true);
    const rc = L.ledgerClear();
    assert.equal(rc.ok, true);
    assert.equal(rc.cleared, 2);
    assert.equal(L.ledgerList().length, 0);
    assert.equal(JSON.parse(store.get(KEY)).entries.length, 0, '存储里是空信封（不删键，走 storeSet 单点）');
    assert.equal(L.ledgerStats().count, 0);

    // 坏存储容错：坏 JSON / 裸数组 / 混杂条目都不炸
    seed();
    store.set(KEY, '{不是 JSON');
    L.resetLedgerState();
    assert.equal(L.ledgerList().length, 0, '坏 JSON 当空账');
    const rb = L.ledgerRecord({ danmakuId: 'after-bad', content: 'x', vid: 1 });
    assert.equal(rb.ok, true, '坏账之后还能记（写回合法信封）');
    assert.equal(JSON.parse(store.get(KEY)).v, 1, '信封带版本位');

    seed();
    store.set(KEY, JSON.stringify([{ danmakuId: 'bare', content: 'x', vid: 1 }]));
    L.resetLedgerState();
    assert.equal(L.ledgerList().length, 1, '裸数组（手改过 / 早期格式）也读得出来');

    seed();
    store.set(KEY, JSON.stringify({ v: 1, entries: [{ danmakuId: 'ok', content: 'x', vid: 1 }, null, '字符串'] }));
    L.resetLedgerState();
    assert.equal(L.ledgerList().length, 1, '非对象条目剔除，账不塌');

    // 清单文本：一行一条，含时间/状态/位置/内容/id
    seed([{ danmakuId: 'zz', content: '核对清单', vid: 3, startTime: 1500, sentAt: Date.now() }]);
    const text = L.ledgerChecklistText();
    assert.match(text, /待审核（未确认） \| pos 1\.500s \| 核对清单 \| id=zz/, '清单格式：' + text);
});

// ---------------- ⑧ 台账视图真的跑得起来（最小 DOM 桩；观感与真浏览器仍未覆盖） ----------------

test('台账视图能真的跑起来：渲染 / 清理引导 / 两步清空 / 空态（最小 DOM 桩）', async () => {
    const { openLedgerPanel } = await import('../../src/gdm-ledger-ui.js');
    const statusEl = el('div');
    dom.els['#cf-status'] = statusEl;
    seed([{ danmakuId: 'D1', content: '核对内容', vid: 123, startTime: 1500, sentAt: Date.now() }]);

    openLedgerPanel();
    const mask = dom.els['#cf-ledger-panel'];
    assert.ok(mask, '浮层要挂到 body 上（#cf-ledger-panel）');
    assert.match(mask.innerHTML, /发送台账（闸④）/, '标题');
    assert.match(mask.innerHTML, /本工具不能删除已发送的弹幕/, '副标题就要说清删不掉');

    const stats = mask.querySelector('#cf-lg-stats');
    assert.match(stats.textContent, /共 1 条（已确认可见 0 · 待审核 1）/, '统计行：' + stats.textContent);
    assert.match(stats.textContent, /上限 1000 条 · 256KB/, '上限要露出来：' + stats.textContent);
    assert.equal(stats.className, 'cf-lg-stats', '写入正常时不带警示配色');

    const body = mask.querySelector('#cf-lg-body');
    assert.equal(body.children.length, 1, '一个视频一个分组块');
    const block = body.children[0];
    assert.match(block.innerHTML, /href="https:\/\/www\.acfun\.cn\/v\/ac123"/, '视频链接（可点回视频页）');
    assert.match(block.innerHTML, /1 条 · 已确认 0/, '分组统计');
    assert.match(block.innerHTML, /待审核（未确认）/, '状态标签');
    assert.match(block.innerHTML, /#D1/, 'danmakuId');
    assert.match(block.innerHTML, /核对内容/, '内容');

    // 清理引导：默认收起（写在模板里），点开给手动路径 + 可复制的核对清单
    assert.match(block.innerHTML, /class="cf-lg-guide" style="display:none"/, '默认收起写在标记里');
    const guideBtn = block.querySelector('[data-act=guide]');
    const guide = block.querySelector('.cf-lg-guide');
    guideBtn.dispatch('click');
    assert.equal(guide.style.display, '', '点开');
    assert.equal(guideBtn.textContent, '▲ 收起引导', '按钮文案跟着换：' + guideBtn.textContent);
    assert.match(guide.innerHTML, /无法删除已发送的弹幕/);
    assert.match(guide.innerHTML, /API\.md §十一/);
    assert.match(guide.innerHTML, /手动/);
    assert.match(guide.innerHTML, /速率限制未知/);
    const checklist = guide.querySelector('.cf-lg-checklist').value;
    assert.ok(checklist.indexOf('核对内容') > 0, '清单里要有内容：' + checklist);
    assert.ok(checklist.indexOf('id=D1') > 0, '清单里要有 danmakuId：' + checklist);
    assert.ok(checklist.indexOf('pos 1.500s') > 0, '清单里要有起始位置：' + checklist);
    guideBtn.dispatch('click');
    assert.equal(guide.style.display, 'none', '再点收起');
    assert.equal(guideBtn.textContent, '🧹 清理引导', '文案回到原样');

    // 导出 / 关闭按钮都接好了（导出的真正下载动作在 node 里不验）
    assert.equal(mask.querySelector('[data-act=export]').handlers.click.length, 1, '导出按钮要有处理函数');
    assert.equal(mask.querySelector('[data-act=close]').handlers.click.length, 1, '关闭按钮要有处理函数');

    // 两步清空：第一次只是上膛（不新增 confirm(，也不真清）
    const clearBtn = mask.querySelector('[data-act=clear]');
    clearBtn.dispatch('click');
    assert.match(clearBtn.textContent, /再点一次确认清空（1 条）/, '第一步只是上膛：' + clearBtn.textContent);
    assert.ok(clearBtn.className.indexOf('armed') >= 0, '上膛要换配色');
    assert.equal(L.ledgerList().length, 1, '上膛阶段一条都不该清');
    clearBtn.dispatch('click');
    assert.equal(L.ledgerList().length, 0, '第二步才真清');
    assert.match(statusEl.textContent, /已清空台账（1 条）/, '状态栏如实报告：' + statusEl.textContent);
    assert.match(mask.querySelector('#cf-lg-body').innerHTML, /台账为空/, '清空后回到空态');

    mask.querySelector('[data-act=close]').dispatch('click');
    assert.equal(mask.removed, true, '关闭即收掉浮层');
});
