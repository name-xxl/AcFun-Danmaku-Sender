// 壳观察策略单测（node --test）
//
// 覆盖 src/15-shell-watch.js —— 入口注入从 400ms 轮询改成事件驱动后，「等壳出现」这件事的全部判据：
//   ① 注入幂等（重复触发只注入一次）② 壳出现得晚也能注入 ③ 壳被移除后重新出现要再注入一次
//   ④ 稳态回调早退（已注入 → 不再查找；唯一的复核是「本批有节点被移除」时查一次入口还在不在）
//   ⑤ 壳不在时也要读展开态（否则「关掉再打开」会丢展开边沿）
//
// 这里不需要 fake DOM：15-shell-watch 是纯策略，只认 findShell/isInjected/inject/isLauncherOpen
// 四个注入进来的依赖，以及 mutation 记录的形状（type / target.classList）。桩对象就是几行字面量。
// DOM 侧的真实性（#danmaku 里壳的出现/重建、wrapper 的 class 变动）本仓没有真浏览器——见 RELEASE_NOTES 6.18.0。
//
// 用法：npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShellWatch } from '../../src/15-shell-watch.js';

const WRAPPER = 'advanced-danmaku-wrapper';

// —— 桩：一个壳 + 一套记录调用次数的依赖 ——
// 壳就是 { isConnected, injected } 两个字面量字段：isConnected 是浏览器里真实存在的属性（判活用它），
// injected 模拟「标题栏下已经有 #cf-entry-group」这个事实。
// stuck:true = 「注入不生效」（壳在、但没有标题栏可挂 → 真实实现里 injectNativeEntry 直接返回）
function makeWorld({ stuck = false } = {}) {
    const calls = { find: 0, inject: 0, onOpen: 0, launcher: 0 };
    const state = { shell: null, open: false };

    const watch = createShellWatch({
        findShell: () => { calls.find++; return state.shell; },
        isInjected: (n) => !!n.injected,
        inject: (n) => { calls.inject++; if (!stuck) n.injected = true; },   // 注入动作本身幂等（真实实现同此）
        isLauncherOpen: () => { calls.launcher++; return state.open; },
        launcherWrapperClass: WRAPPER,
        onLauncherOpen: () => { calls.onOpen++; },
    });

    return { watch, calls, state };
}

const mkShell = () => ({ isConnected: true, injected: false });
const child = () => ({ type: 'childList', addedNodes: [], removedNodes: [] });
const removal = () => ({ type: 'childList', addedNodes: [], removedNodes: [{ nodeType: 1 }] });   // 有节点被移除的批次
const wrapperClass = () => ({ type: 'attributes', attributeName: 'class', target: { classList: { contains: (c) => c === WRAPPER } } });
const otherClass = () => ({ type: 'attributes', attributeName: 'class', target: { classList: { contains: (c) => c === 'danmaku-item' } } });

// ---------------- ① 注入幂等 ----------------

test('幂等：壳一直在，反复触发也只注入一次', () => {
    const { watch, calls, state } = makeWorld();
    state.shell = mkShell();
    watch.sweep([]);
    for (let i = 0; i < 5; i++) watch.sweep([child()]);
    assert.equal(calls.inject, 1, '同一份壳上只应注入一次入口');
    assert.equal(state.shell.injected, true);
});

test('幂等：壳上已经有我们的入口 → 一次注入都不做（只认事实）', () => {
    const { watch, calls, state } = makeWorld();
    state.shell = { isConnected: true, injected: true };     // 例如上一次注入的那份还在
    watch.sweep([]);
    watch.sweep([child()]);
    assert.equal(calls.inject, 0);
});

// ---------------- ② 壳出现得晚 ----------------

test('壳后出现：一开始没有壳，后来出现 → 注入一次', () => {
    const { watch, calls, state } = makeWorld();
    watch.sweep([]);
    assert.equal(calls.inject, 0, '没有壳时不该注入');
    assert.equal(calls.find, 1, '找过一次（巡检）');

    state.shell = mkShell();                                 // 页面加载后很久才出现
    watch.sweep([child()]);
    assert.equal(calls.inject, 1);
    assert.equal(state.shell.injected, true);
});

test('壳在但没有标题栏（注入没成功）→ 不记「已注入」，下次变动再试', () => {
    const { watch, calls, state } = makeWorld({ stuck: true });
    state.shell = mkShell();
    watch.sweep([]);
    watch.sweep([child()]);
    assert.equal(calls.inject, 2, '注入没成功就不该早退，下一次 DOM 变动要再试一次');
    assert.equal(calls.find, 2);
});

// ---------------- ③ 壳被移除后重新出现（最容易写坏的一条）----------------

test('壳重建：被移除后重新出现 → 再次注入（不是「找到一次就永久锁死」）', () => {
    const { watch, calls, state } = makeWorld();
    const first = mkShell();
    state.shell = first;
    watch.sweep([]);
    assert.equal(calls.inject, 1);

    // 壳被移除：旧节点脱离文档，查询也查不到了
    first.isConnected = false;
    state.shell = null;
    watch.sweep([child()]);
    assert.equal(calls.inject, 1, '壳不在时不该重复注入');

    // 壳重建：一份全新的节点
    const second = mkShell();
    state.shell = second;
    watch.sweep([child()]);
    assert.equal(calls.inject, 2, '重建出来的壳必须再注入一次');
    assert.equal(second.injected, true);
});

test('壳重建：同一批里换节点（移除 + 新节点）也能认出来', () => {
    const { watch, calls, state } = makeWorld();
    const first = mkShell();
    state.shell = first;
    watch.sweep([]);

    first.isConnected = false;                               // 旧壳在上一批里就没了
    state.shell = mkShell();                                 // 新壳已经在树上
    watch.sweep([child()]);
    assert.equal(calls.inject, 2);
});

test('入口被带走（壳还在，本批有节点被移除）→ 复核后补插', () => {
    const { watch, calls, state } = makeWorld();
    state.shell = mkShell();
    watch.sweep([]);
    assert.equal(calls.inject, 1);

    state.shell.injected = false;                            // 重渲染把标题栏里的入口带走了，壳本身还在
    watch.sweep([removal()]);
    assert.equal(calls.inject, 2, '壳还在、入口没了 → 必须补插（旧轮询每 400ms 会自己补上）');
    assert.equal(state.shell.injected, true);
});

test('复核只认「有节点被移除」的批次：只增不减的批次不查入口', () => {
    const { watch, calls, state } = makeWorld();
    state.shell = mkShell();
    watch.sweep([]);
    const launcherAfterInject = calls.launcher;

    state.shell.injected = false;                            // 即便入口已不在，纯新增的批次也不触发复核
    for (let i = 0; i < 10; i++) watch.sweep([child()]);
    assert.equal(calls.inject, 1, '没有移除记录的批次不该引出补插（O(1) 早退）');
    assert.equal(calls.launcher, launcherAfterInject);
});

// ---------------- ④ 稳态早退 ----------------

test('早退：已注入且壳还在树上 → 不再查找、不再读展开态', () => {
    const { watch, calls, state } = makeWorld();
    state.shell = mkShell();
    watch.sweep([]);
    const findsAfterInject = calls.find;
    const launcherAfterInject = calls.launcher;

    for (let i = 0; i < 20; i++) watch.sweep([child()]);     // 弹幕列表一直有节点增删
    assert.equal(calls.find, findsAfterInject, '早退时不该再调 findShell');
    assert.equal(calls.launcher, launcherAfterInject, '早退时不该再读展开态');
    assert.equal(calls.inject, 1);
});

test('早退：与本片无关的 class 变动（别的节点）一次查询都不做', () => {
    const { watch, calls, state } = makeWorld();
    state.shell = mkShell();
    watch.sweep([]);
    const findsAfterInject = calls.find;
    const launcherAfterInject = calls.launcher;

    for (let i = 0; i < 20; i++) watch.sweep([otherClass()]); // 弹幕列表行高亮之类
    assert.equal(calls.find, findsAfterInject);
    assert.equal(calls.launcher, launcherAfterInject, '不相关批次的 class 变动不该带上展开态查询');
});

// ---------------- ⑤ 展开边沿 ----------------

test('展开边沿：只有宿主 wrapper 的 class 变动才读展开态，同一开只处理一次', () => {
    const { watch, calls, state } = makeWorld();
    state.shell = mkShell();
    watch.sweep([]);
    assert.equal(calls.onOpen, 0);

    state.open = true;
    watch.sweep([wrapperClass()]);
    assert.equal(calls.onOpen, 1, '折叠 → 展开应处理一次');

    watch.sweep([wrapperClass()]);
    assert.equal(calls.onOpen, 1, '还开着 → 不重复处理');

    state.open = false;
    watch.sweep([wrapperClass()]);                           // 收起：清记忆（不调 onOpen）
    assert.equal(calls.onOpen, 1);

    state.open = true;
    watch.sweep([wrapperClass()]);
    assert.equal(calls.onOpen, 2, '再展开 = 又一次边沿');
    assert.equal(calls.inject, 1, '边沿不该引出第二次注入');
});

test('展开边沿：玩家事件与观察器共用一份记忆，同一次展开不重复处理', () => {
    const { watch, calls, state } = makeWorld();
    state.shell = mkShell();
    state.open = true;

    watch.opened();                                          // 玩家事件先到
    assert.equal(calls.onOpen, 1);
    watch.sweep([wrapperClass()]);                           // 随后的 class 变动不该再来一次
    assert.equal(calls.onOpen, 1);

    watch.closed();
    watch.sweep([wrapperClass()]);                            // closed 后 class 仍带 unfold → 算新边沿
    assert.equal(calls.onOpen, 2);
});

test('展开边沿不丢：wrapper 连节点一起消失（没有 class 变动记录）后再出现，仍能触发', () => {
    const { watch, calls, state } = makeWorld();
    const first = mkShell();
    state.shell = first;
    state.open = true;
    watch.sweep([]);
    assert.equal(calls.onOpen, 1);

    // 关掉面板：wrapper 与壳一起被移除——这一路上不会有 wrapper 的 class 变动记录
    first.isConnected = false;
    state.shell = null;
    state.open = false;
    watch.sweep([child()]);                                  // 壳不在时也要读展开态 → 清掉记忆
    assert.equal(calls.onOpen, 1);

    // 再打开：新壳一出场就带着 unfold（同样没有 class 变动记录）
    state.shell = mkShell();
    state.open = true;
    watch.sweep([child()]);
    assert.equal(calls.onOpen, 2, '记忆没清干净的话这里会静默失灵');
});
