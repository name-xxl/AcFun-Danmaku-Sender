// 身份感知（6.16.0）：自己的视频 / 他人的视频 / unknown 的判定、按身份收紧的阈值、提示与台账接线（node --test）
//
// 要守的东西：
//   ① **三态判定**——ownerUid 取到且等于自己的 uid → self；取到且不等 → other；取不到（或未登录）→ unknown。
//      **类型归一**是重点：实测作者 id 是字符串 `"25380695"`，而 getUid() 可能来自 player.uid（数字）或
//      cookie 正则（字符串）——`===` 直接比会把「自己的视频」判成他人的。本文件两个方向都钉住。
//   ② **unknown 绝不被当成 self**（本片的诚实底线）：不知道就不声称是自己的视频。
//   ③ **阈值按身份取**——other 收紧（= POOL_IMPACT_BANDS[0].max，见 55-audit 的推导），self / unknown 仍是
//      常值 1000；unknown **不收紧也不放宽**（它是不确定，不是「自己人」）。行为侧由 startSend 真跑一遍验证。
//   ④ **取数失败不抛错 + 自诊断**——形状不对的 videoInfo（含取值就抛的 getter）只该得到 unknown 与几行
//      脱敏诊断（只打键名与类型），不该炸穿调用方，也不该静默。
//   ⑤ **接线**（静态取证 + 最小 DOM 桩）：身份行 #cf-identity 在面板模板里、面板一开就有首绘、他人视频的
//      提示不点任何东西就可见、内联二次确认面板写明「为什么这次更严」、台账条目带上身份。
//
// 本仓无真浏览器：window.videoInfo 的真实形状**没有在真机核实过**（来源是 svfeed 的实测文档，见 API.md §十三），
// 故这里用桩喂「按已实测形状构造」的数据 + 「形状不对」的数据各走一遍——验的是**代码对形状的假设**，不是真页面。
//
// 用法：npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------- 浏览器 API 桩（必须在任何模块求值之前挂上） ----------------
// localStorage 用真 Map（台账那条要能落盘、读回）；DOM 是最小桩：querySelector 按注册表返回假节点。
const store = new Map();
globalThis.window = globalThis;
globalThis.unsafeWindow = globalThis;
globalThis.localStorage = {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
};
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
globalThis.document = {
    readyState: 'loading',
    cookie: '',
    addEventListener() {},
    createElement(tag) {
        const el = fakeEl(tag);
        // 二次确认面板的两个按钮（80-ui/confirmHighVolume 按 data-act 取）
        el.parts = { '[data-act=go]': fakeEl('button'), '[data-act=cancel]': fakeEl('button') };
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

const CONST = await import('../../src/10-constants.js');
const CORE = await import('../../src/40-core.js');
const NET = await import('../../src/60-network.js');
const AUDIT = await import('../../src/55-audit.js');
const LEDGER = await import('../../src/gdm-ledger.js');
const UI = await import('../../src/80-ui.js');
const { parseSub } = await import('../../src/30-parser.js');

const { IDENTITY_OTHER, IDENTITY_SELF, IDENTITY_UNKNOWN } = CONST;
const { SEND_CONFIRM_MODEL_THRESHOLD, SEND_CONFIRM_MODEL_THRESHOLD_OTHER, POOL_IMPACT_BANDS, confirmThresholdFor } = AUDIT;

// ---------------- 夹具：身份三件套（页面全局 + 自己的 uid） ----------------
const ME = 51737407;              // getUid() 的两种来源（player.uid 数字 / cookie 字符串）都用它
const OTHER_UP = '25380695';      // 实测的作者 id 形状：**字符串**
const OTHER_NAME = '某UP';

// 自己的 uid 一律走 player.uid（数字）；要测 cookie（字符串）来源时单独覆盖 document.cookie
function asPlayer(uid) { globalThis.player = (uid === undefined) ? { vid: 123 } : { vid: 123, uid }; }
function asOtherVideo() {
    asPlayer(ME);
    globalThis.videoInfo = { user: { id: OTHER_UP, name: OTHER_NAME } };
}
function asSelfVideo() {
    asPlayer(ME);
    globalThis.videoInfo = { user: { id: String(ME), name: '我自己' } };
}
function resetPage() {
    delete globalThis.videoInfo;
    delete globalThis.player;
    globalThis.document.cookie = '';
    NET.resetIdentityDiagnostic();
}
resetPage();

// 夹具字幕：30 条（KTV 展开 820 条 model —— 落在 400 与 1000 之间，正好用来分辨两个阈值）
const NL = String.fromCharCode(10);
const SAMPLES = ['短', '你好世界', '今天天气不错呀', '这是一句长度中等的中文字幕', 'Hello world 中英混排的一句',
    '这一句故意写得长一些，用来把拆字预设的展开量推到典型值以上，看看一集字幕的下界在哪里'];
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
const SUBS = parseSub(makeSrt(30), 'identity.srt');
SUBS.forEach((s) => { s.selected = true; s.st = ''; });
const BIG = parseSub(makeSrt(300), 'identity-big.srt');
BIG.forEach((s) => { s.selected = true; s.st = ''; });

function withPreset(id, fn) {
    const saved = CORE.activePresetId;
    CORE.setActivePresetId(id);
    try { return fn(); } finally { CORE.setActivePresetId(saved); }
}

// ---------------- ① 三态判定：self（含类型归一两方向）/ other / unknown ----------------

test('三态：作者 id 是字符串、自己的 uid 是数字 → 归一后判成 self（不是 other）', () => {
    resetPage();
    asSelfVideo();
    const id = NET.videoIdentity();
    assert.equal(id.state, IDENTITY_SELF, '字符串 "51737407" 与数字 51737407 必须判成同一个人的视频');
    assert.equal(id.ownerUid, String(ME), 'ownerUid 一律是字符串');
    assert.equal(id.ownerName, '我自己');
    assert.equal(id.source, 'user', '命中的是第一条路径 videoInfo.user');
});

test('三态：作者 id 是数字、自己的 uid 来自 cookie 字符串 → 同样判成 self（反向归一）', () => {
    resetPage();
    asPlayer(undefined);                              // player 没有 uid → 回落 cookie
    globalThis.document.cookie = 'auth_key=' + ME;
    globalThis.videoInfo = { user: { id: ME, name: '我自己' } };   // 作者 id 是**数字**
    const id = NET.videoIdentity();
    assert.equal(id.state, IDENTITY_SELF, '数字作者 id 与 cookie 里的字符串 uid 也必须判成 self');
});

test('三态：作者不是自己 → other（带出作者 id 与昵称）', () => {
    resetPage();
    asOtherVideo();
    const id = NET.videoIdentity();
    assert.equal(id.state, IDENTITY_OTHER);
    assert.equal(id.ownerUid, OTHER_UP);
    assert.equal(id.ownerName, OTHER_NAME);
});

test('三态：取不到作者 → unknown；**未登录（拿不到自己的 uid）也是 unknown，绝不是 other/self**', () => {
    resetPage();
    asPlayer(ME);
    delete globalThis.videoInfo;                      // 没有 videoInfo
    assert.equal(NET.videoIdentity().state, IDENTITY_UNKNOWN, '读不到作者 → unknown');

    resetPage();
    asPlayer(undefined);                              // 未登录：player.uid 没有、cookie 也没有
    globalThis.videoInfo = { user: { id: OTHER_UP, name: OTHER_NAME } };
    const id = NET.videoIdentity();
    assert.equal(id.state, IDENTITY_UNKNOWN, '未登录时连「自己是谁」都不确定 → unknown（不收紧、不声称）');
    assert.equal(id.ownerUid, OTHER_UP, '作者读到了就照带出来（供提示语显示），但判定仍是不确定');
});

test('unknown 绝不被当成 self：无论怎么失败，state 都不是 self', () => {
    resetPage();
    // 五组「取不到」：没有 videoInfo / 不是对象 / user 不是对象 / user 是空对象 / user 有 id 但为空串
    const cases = [
        { label: '无 videoInfo', vi: undefined },
        { label: 'videoInfo 是数字', vi: 42 },
        { label: 'user 是字符串', vi: { user: 'nope' } },
        { label: 'user 是空对象', vi: { user: {} } },
        { label: 'user.id 是空串', vi: { user: { id: '', name: 'x' } } },
    ];
    asPlayer(ME);
    const seen = [];
    cases.forEach((c) => {
        resetPage();
        asPlayer(ME);
        if (c.vi !== undefined) globalThis.videoInfo = c.vi;
        const id = NET.videoIdentity();
        seen.push(c.label + ' → ' + id.state);
        assert.equal(id.state, IDENTITY_UNKNOWN, c.label + '：应判 unknown');
        assert.notEqual(id.state, IDENTITY_SELF, c.label + '：**unknown 绝不能被当成 self**');
        assert.equal(id.ownerUid, '', c.label + '：取不到作者时 ownerUid 是空串（不是 undefined）');
    });
    console.log('[三态] ' + seen.join(' | '));
});

test('三态：路径按 user → detail.user → userInfo 依次试（前一米不中才往下）', () => {
    resetPage();
    asPlayer(ME);
    globalThis.videoInfo = { detail: { user: { id: OTHER_UP, name: OTHER_NAME } } };
    assert.equal(NET.videoIdentity().source, 'detail.user', '顶层没有 user 时落到 detail.user');

    resetPage();
    asPlayer(ME);
    globalThis.videoInfo = { userInfo: { id: OTHER_UP, name: OTHER_NAME } };
    assert.equal(NET.videoIdentity().source, 'userInfo', '再落到 userInfo');

    resetPage();
    asPlayer(ME);
    // user 存在但没有 id（真实世界里最可能的失手形状）→ 不能停在它上面，要继续往下试
    globalThis.videoInfo = { user: { name: '没 id 的 user' }, detail: { user: { id: OTHER_UP } } };
    const id = NET.videoIdentity();
    assert.equal(id.source, 'detail.user', '「对象存在但 id 取不到」不算命中，必须继续往下试');
    assert.equal(id.ownerUid, OTHER_UP);
});

// ---------------- ② 取数失败不抛错 + 自诊断（只打键名与类型） ----------------

test('取数失败不抛错，并打出脱敏诊断（顶层键名 + 像作者的子对象形状，不打值）', () => {
    resetPage();
    asPlayer(ME);
    globalThis.videoInfo = {
        title: '这是一个不该出现在日志里的标题',
        user: { id: '', name: '这是不该被打印的昵称', fanCount: '6337' },
        currentVideoInfo: { playInfos: [] },
        dougaId: '48888095',
    };
    const logs = [];
    const saved = console.log;
    console.log = (...a) => logs.push(a.join(' '));
    let id;
    try {
        assert.doesNotThrow(() => { id = NET.videoIdentity(); }, '取数失败绝不能抛给调用方');
    } finally {
        console.log = saved;
    }
    assert.equal(id.state, IDENTITY_UNKNOWN);
    const text = logs.join('\n');
    assert.ok(text.indexOf('身份感知') >= 0, '要有明确的身份诊断行：' + text);
    assert.ok(text.indexOf('unknown') >= 0, '诊断要写清结论是 unknown');
    assert.ok(text.indexOf('顶层键') >= 0 && text.indexOf('currentVideoInfo') >= 0, '要打出顶层键名供回贴定位');
    assert.ok(/user\.\{[^}]*id: string/.test(text), '要打出像作者的子对象形状（键名 + 类型）：' + text);
    assert.ok(text.indexOf('已尝试的路径') >= 0, '要说明试过哪些路径');
    // 脱敏：只打键名与类型，值本身一个都不能进日志
    assert.ok(text.indexOf('不该被打印的昵称') < 0, '昵称这类值不能被打印');
    assert.ok(text.indexOf('不该出现在日志里的标题') < 0, '内容值不能被打印');
    assert.ok(text.indexOf('6337') < 0, '数值字段的值也不能被打印');
    console.log('[诊断] 逐字如下（下面这行是测试自己打印的，便于人工核对）：\n' + text.replace(/^/gm, '  '));
});

test('取值就抛的 getter 不会炸穿：unknown + 诊断（抛错也写进诊断行）', () => {
    resetPage();
    asPlayer(ME);
    const vi = { dougaId: '48888095' };
    Object.defineProperty(vi, 'user', { get() { throw new Error('boom-读 user 抛错'); }, enumerable: true });
    globalThis.videoInfo = vi;
    const logs = [];
    const saved = console.log;
    console.log = (...a) => logs.push(a.join(' '));
    let id;
    try {
        assert.doesNotThrow(() => { id = NET.videoIdentity(); }, '页面全局的 getter 抛错不能炸穿判定');
    } finally {
        console.log = saved;
    }
    assert.equal(id.state, IDENTITY_UNKNOWN);
    assert.ok(logs.join('\n').indexOf('boom-读 user 抛错') >= 0, '抛错要如实记进诊断行');
});

test('诊断去重：同一页面同一种失败只打一次，resetIdentityDiagnostic 后可以再打', () => {
    resetPage();
    asPlayer(ME);
    delete globalThis.videoInfo;
    const logs = [];
    const saved = console.log;
    console.log = (...a) => logs.push(a.join(' '));
    try {
        NET.videoIdentity();
        NET.videoIdentity();
        NET.videoIdentity();
        assert.equal(logs.length, 1, '同一种失败连打三次只该有 1 行日志（否则每次重算都刷屏），实际 ' + logs.length);
        NET.resetIdentityDiagnostic();
        NET.videoIdentity();
        assert.equal(logs.length, 2, 'reset 之后应能再打（测试钩子）');
    } finally {
        console.log = saved;
    }
});

// ---------------- ③ 阈值：other 收紧，self / unknown 不变 ----------------

test('阈值：他人视频收紧（= 池影响「低」档上界），self / unknown 一律常值；unknown 不收紧也不放宽', () => {
    assert.equal(SEND_CONFIRM_MODEL_THRESHOLD_OTHER, POOL_IMPACT_BANDS[0].max,
        '他人视频阈值必须**从池影响分档推出来**（低档上界），不是另拍的数');
    assert.ok(SEND_CONFIRM_MODEL_THRESHOLD_OTHER < SEND_CONFIRM_MODEL_THRESHOLD, '他人视频阈值必须更严');
    assert.equal(confirmThresholdFor(IDENTITY_OTHER), SEND_CONFIRM_MODEL_THRESHOLD_OTHER, 'other → 收紧值');
    assert.equal(confirmThresholdFor(IDENTITY_SELF), SEND_CONFIRM_MODEL_THRESHOLD, 'self → 常值');
    assert.equal(confirmThresholdFor(IDENTITY_UNKNOWN), SEND_CONFIRM_MODEL_THRESHOLD, 'unknown → 常值（不确定不收紧）');
    ['', null, undefined, 'SELF', 'whatever'].forEach((bad) => {
        assert.equal(confirmThresholdFor(bad), SEND_CONFIRM_MODEL_THRESHOLD, '脏输入（' + String(bad) + '）回常值');
    });
    // 口径：两个阈值都在同一把尺子（modelCount × 80ms）上，且都落在「中」段内——与「池影响」标签不打架
    assert.ok(SEND_CONFIRM_MODEL_THRESHOLD_OTHER <= POOL_IMPACT_BANDS[1].max);
    console.log('[阈值] 常值 ' + SEND_CONFIRM_MODEL_THRESHOLD + ' 条（下界 '
        + Math.round(SEND_CONFIRM_MODEL_THRESHOLD * CONST.MODEL_SEND_INTERVAL / 1000) + ' 秒）· 他人视频 '
        + SEND_CONFIRM_MODEL_THRESHOLD_OTHER + ' 条（下界 '
        + Math.round(SEND_CONFIRM_MODEL_THRESHOLD_OTHER * CONST.MODEL_SEND_INTERVAL / 1000) + ' 秒 = 池影响「低」档上界）');
});

// ---------------- ④ 身份行（最小 DOM 桩）：三态文案 + 他人视频的常驻提示 ----------------

test('身份行 #cf-identity：三态文案与配色，他人视频的提示不点任何东西就可见', async () => {
    const auditEl = fakeEl('div');
    const idEl = fakeEl('div');
    dom.els['#cf-audit'] = auditEl;
    dom.els['#cf-identity'] = idEl;
    CORE.setSubs(SUBS);
    await sleep(300);

    // 态一：他人的视频——必须带「这是他人的视频」+ 建议先沟通 + 收紧后的阈值
    resetPage();
    asOtherVideo();
    withPreset('none', () => UI.updateSendAudit());
    assert.match(idEl.textContent, /他人的视频/, '他人视频的文案：' + idEl.textContent);
    assert.match(idEl.textContent, /建议先与 UP 主沟通/, '要给行动建议，别只贴标签');
    assert.match(idEl.textContent, /收紧到 400 条/, '要把收紧后的阈值写在常驻提示里');
    assert.match(idEl.textContent, /某UP/, '带上 UP 昵称（读得到就打）');
    assert.match(idEl.className, /\bother\b/, '他人视频用警示配色');
    assert.match(auditEl.textContent, /⚠ 他人的视频（阈值 400）/, '计数行里也要能看出身份与阈值：' + auditEl.textContent);
    assert.match(idEl.title, /取数路径：user/, 'title 说明身份是怎么判出来的');

    // 态二：自己的视频（类型归一：字符串作者 id vs 数字 uid）
    await sleep(300);
    resetPage();
    asSelfVideo();
    withPreset('none', () => UI.updateSendAudit());
    assert.match(idEl.textContent, /自己的视频/);
    assert.match(idEl.textContent, /二次确认阈值 1000 条（常值）/, '自己的视频不收紧：' + idEl.textContent);
    assert.match(idEl.className, /\bself\b/);
    assert.match(auditEl.textContent, /· 自己的视频$/, '计数行尾是身份段：' + auditEl.textContent);

    // 态三：身份未知（读不到作者）——中性、不吓人，并指向控制台诊断
    await sleep(300);
    resetPage();
    asPlayer(ME);
    delete globalThis.videoInfo;
    withPreset('none', () => UI.updateSendAudit());
    assert.match(idEl.textContent, /身份未知/);
    assert.match(idEl.textContent, /不收紧/, 'unknown 不收紧：' + idEl.textContent);
    assert.match(idEl.textContent, /取数诊断已打到控制台/, 'unknown 要指向可回贴的诊断');
    assert.match(idEl.className, /\bunknown\b/);
    assert.match(auditEl.textContent, /· 身份未知$/, '计数行尾是身份段：' + auditEl.textContent);

    // 态四：身份未知（未登录：作者读到了、自己的 uid 拿不到）——提示语不同（指向登录态，而不是诊断）
    await sleep(300);
    resetPage();
    asPlayer(undefined);
    globalThis.videoInfo = { user: { id: OTHER_UP, name: OTHER_NAME } };
    withPreset('none', () => UI.updateSendAudit());
    assert.match(idEl.textContent, /未登录/, '未登录与「读不到作者」要给不同的话：' + idEl.textContent);
    assert.ok(idEl.textContent.indexOf('取数诊断') < 0, '未登录不是取数失败，不该让用户去贴诊断');
    resetPage();
    CORE.setSubs([]);
    dom.els['#cf-identity'] = idEl;
});

// ---------------- ⑤ 行为：startSend 用按身份取的阈值（真跑一遍门控，取消在面板上） ----------------

test('startSend：他人视频上 820 条（介于 400 与 1000 之间）就要二次确认；self / unknown 不放行也不收紧', async () => {
    const statusEl = fakeEl('div');
    dom.els['#cf-status'] = statusEl;
    const savedConfirm = globalThis.confirm;
    const savedLocation = globalThis.location;
    globalThis.confirm = () => true;                       // 首次 confirm（既有那处）直接过
    globalThis.location = { pathname: '/v/ac123' };
    try {
        // —— 他人的视频：KTV × 30 条字幕 = 820 条 model（> 400）→ 应弹内联二次确认，面板要写明收紧 ——
        resetPage();
        asOtherVideo();
        CORE.setSubs(SUBS);
        CORE.setActivePresetId('karaoke');
        dom.created.length = 0;
        let p = UI.startSend();
        await sleep(20);
        let masks = dom.created.filter((e) => e.id === 'cf-audit-confirm');
        assert.equal(masks.length, 1, '他人的视频上 820 条就该拦（常值 1000 下这一批本该放行）');
        assert.match(masks[0].innerHTML, /他人的视频：阈值已从 1000 收紧到 400/,
            '面板要写明「为什么这次更严」：' + masks[0].innerHTML);
        masks[0].querySelector('[data-act=cancel]').dispatch('click');
        await p;
        assert.match(statusEl.textContent, /已取消：820 条弹幕超过二次确认阈值 400/, '取消要给出按身份取的阈值');
        assert.equal(CORE.sending, false, '取消后不得开始发送');
        assert.ok(SUBS.every((s) => s.st === ''), '取消后一条都不该发');

        // —— 自己的视频：同样的 820 条**不该拦**（常值 1000）；这里用 300 条 KTV = 8200 条去撞常值阈值 ——
        await sleep(20);
        resetPage();
        asSelfVideo();
        CORE.setSubs(BIG);
        CORE.setActivePresetId('karaoke');
        dom.created.length = 0;
        p = UI.startSend();
        await sleep(20);
        masks = dom.created.filter((e) => e.id === 'cf-audit-confirm');
        assert.equal(masks.length, 1, '8200 条 > 1000：自己的视频上仍要二次确认');
        assert.match(masks[0].innerHTML, /超过二次确认阈值 <b>1000<\/b> 条<\/p>|超过二次确认阈值 <b>1000<\/b> 条 ·/,
            '自己的视频按常值 1000 把关，面板不得写「收紧」：' + masks[0].innerHTML);
        assert.ok(masks[0].innerHTML.indexOf('收紧') < 0, '自己的视频的面板里不该出现「收紧」');
        masks[0].querySelector('[data-act=cancel]').dispatch('click');
        await p;
        assert.match(statusEl.textContent, /已取消：8200 条弹幕超过二次确认阈值 1000/);
        assert.ok(BIG.every((s) => s.st === ''), '取消后一条都不该发');

        // —— 身份未知：阈值与 self 一致（常值），面板写明「身份未知：按常值把关，不收紧也不放宽」——
        await sleep(20);
        resetPage();
        asPlayer(ME);
        delete globalThis.videoInfo;
        CORE.setSubs(BIG);
        CORE.setActivePresetId('karaoke');
        dom.created.length = 0;
        p = UI.startSend();
        await sleep(20);
        masks = dom.created.filter((e) => e.id === 'cf-audit-confirm');
        assert.equal(masks.length, 1, '身份未知按常值 1000 把关：8200 条要拦');
        assert.match(masks[0].innerHTML, /超过二次确认阈值 <b>1000<\/b> 条（身份未知：按常值把关，不收紧也不放宽）/,
            'unknown 必须说清是常值、不收紧：' + masks[0].innerHTML);
        masks[0].querySelector('[data-act=cancel]').dispatch('click');
        await p;
        assert.match(statusEl.textContent, /已取消：8200 条弹幕超过二次确认阈值 1000/);
        assert.ok(BIG.every((s) => s.st === ''), '取消后一条都不该发');
    } finally {
        if (savedConfirm === undefined) delete globalThis.confirm; else globalThis.confirm = savedConfirm;
        if (savedLocation === undefined) delete globalThis.location; else globalThis.location = savedLocation;
        CORE.setActivePresetId('none');
        CORE.setSubs([]);
        resetPage();
    }
});

// ---------------- ⑥ 台账带上身份（闸④）：落账那一刻的身份记进条目 ----------------

test('台账：发送成功落账时把当时的身份记进条目；旧条目（无该键）回落 unknown', () => {
    // getVideoInfo（40-core）会读 location.pathname 取 ac 号——node 里没有 location，桩上
    const savedLocation = globalThis.location;
    globalThis.location = { pathname: '/v/ac123' };
    resetPage();
    LEDGER.resetLedgerState();
    store.clear();                                   // 从空台账开始，避免与上面的用例互相干扰
    asOtherVideo();
    const r1 = NET.ledgerRecordSentModel({ content: '他人视频上的一条', startTime: 1000 }, { ok: true, id: 'dm-other' });
    assert.equal(r1.ok, true, '记账要成功');
    assert.equal(r1.entry.identity, IDENTITY_OTHER, '他人视频的条目要带 other');

    resetPage();
    asSelfVideo();
    const r2 = NET.ledgerRecordSentModel({ content: '自己视频上的一条', startTime: 2000 }, { ok: true, id: 'dm-self' });
    assert.equal(r2.entry.identity, IDENTITY_SELF, '自己的视频的条目要带 self');

    resetPage();
    asPlayer(ME);
    delete globalThis.videoInfo;
    const r3 = NET.ledgerRecordSentModel({ content: '取不到身份的一条', startTime: 3000 }, { ok: true, id: 'dm-unknown' });
    assert.equal(r3.entry.identity, IDENTITY_UNKNOWN, '取不到身份时如实记 unknown');

    // 6.16.0 之前的旧条目没有 identity 键 → 归一时回落 unknown（诚实：那时确实没取过），而不是空串/undefined
    const legacy = LEDGER.ledgerRecord({ danmakuId: 'dm-legacy', content: '旧版记的', vid: 123 });
    assert.equal(legacy.entry.identity, IDENTITY_UNKNOWN, '旧条目回落 unknown');

    const list = LEDGER.ledgerList();
    assert.deepEqual(list.map((e) => e.identity), [IDENTITY_OTHER, IDENTITY_SELF, IDENTITY_UNKNOWN, IDENTITY_UNKNOWN],
        '台账里逐条带着当时的身份');
    resetPage();
    if (savedLocation === undefined) delete globalThis.location; else globalThis.location = savedLocation;
});

// ---------------- ⑦ 接线：静态取证（本仓无真浏览器：结构在源码里钉住，行为由上面的 DOM 桩覆盖） ----------------

test('接线：身份行在面板模板里且有首绘；内联面板念出阈值来源；台账视图给他人视频打标', () => {
    const ui = read('80-ui.js');
    const boot = read('boot.js');
    const ledger = read('gdm-ledger.js');
    const ledgerUi = read('gdm-ledger-ui.js');
    const net = read('60-network.js');

    // 身份行：模板里有元素、在 .cf-panel-actions 内（与计数行并排），一开面板就画（不等事件）
    assert.match(ui, /class="cf-identity" id="cf-identity"/, '面板模板里要有身份行元素');
    const iActions = ui.indexOf('id="cf-subtitle-actions"');
    const iIdentity = ui.indexOf('id="cf-identity"');
    const iDanmakuActions = ui.indexOf('id="cf-danmaku-actions"');
    assert.ok(iActions > 0 && iIdentity > iActions && iIdentity < iDanmakuActions,
        '身份行必须在字幕模式的 .cf-panel-actions 里（不点任何东西就可见）');
    assert.match(ui, /paintIdentity\(identityNow\(\)\)/, '创建面板时要首绘身份行（不必等任何事件）');
    assert.match(boot, /#cf-sub-panel \.cf-identity/, '身份行要有样式（三态配色）');

    // 常驻行与内联面板都要体现阈值收紧
    assert.match(ui, /identitySegment/, '计数行要带身份片段');
    assert.match(ui, /info\.thresholdNote/, '二次确认面板要念出「为什么是这个阈值」');
    assert.match(ui, /confirmThresholdFor\(identity\.state\)/, 'startSend 的阈值要按身份取（发送前那一刻）');
    assert.match(ui, /SEND_CONFIRM_MODEL_THRESHOLD[\s\S]{0,120}收紧到/, '面板要写清常值 → 收紧值的来路');

    // 身份判定与取数的唯一出处：60-network 里读 window.videoInfo（经 unsafeWindow 桥），且**不发请求**
    assert.match(net, /getPageWindow\(\)/, '页面全局必须经 40-core 的 unsafeWindow 桥取（API.md §七 ⚠️）');
    assert.match(net, /VIDEO_OWNER_PATHS = \['user', 'detail\.user', 'userInfo'\]/, '取数路径表固定这三条');
    assert.match(net, /selfUid = String\(getUid\(\) \|\| ''\)/, '自己的 uid 要归一成字符串再比（作者 id 是字符串）');
    assert.ok(net.indexOf('GM_xmlhttpRequest') >= 0 && net.indexOf('api-new') < 0,
        '本片不加 douga/info 兜底（那要新增 @connect）：60-network 里不得出现 api-new');
    assert.match(ledger, /identity: String\(e\.identity == null \? '' : e\.identity\) \|\| IDENTITY_UNKNOWN/,
        '台账归一只认 identity 这一键，缺省回落 unknown');
    assert.match(ledgerUi, /cf-lg-other/, '台账视图要给「他人视频」的分组打标（更该被看见）');
    assert.match(ledgerUi, /发在<b>他人的视频<\/b>上[\s\S]{0,200}先与 UP 主说明/,
        '清理引导里要说清这批记录发在他人视频上');

    // 硬约束：confirm( 全仓仍是 3 处（身份提示一律走常驻行/内联面板，不新增原生确认框）
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
