// 表单渲染层单测（node --test）
//
// 覆盖 src/gdm-form.js 的纯函数面：引擎参数声明的三个查询（activeCompositionOf / validateComposition /
// activeEngineParamKeys）、残留值过滤（filterOptionsByKeys），以及两条声明纪律：
//   ① 引擎与内置预设的所有 param.type 都必须在 buildParamControl 的实现集内（见下方 IMPLEMENTED_TYPES）；
//   ② activeEngineParamKeys 的返回必须与 ENGINES 声明逐字一致。
//
// 为什么这里不测 buildParamControl 本身：它要真 DOM（document.createElement + 事件），
// 而本仓不为单测引 fake DOM（控件以外的路径由 tools/smoke-test.js 15 组覆盖）。
// 控件层的等价性（旧实现 vs 搬迁后的 {node,sync}）是迁移期用一次性脚本对照 git HEAD 的旧函数核验的，不进仓。
// 订阅注册表同理：本片它只有登记/退订两个写入口（谁触发 sync 属后续分片的 store），无可断言的外部行为。
//
// 用法：npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 40-core 在模块求值期要取沙箱全局（pageWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window），
// Node 里没有 window —— 这里只补两个别名让模块能被求值；本文件全程不碰 document，不是 DOM 桩。
// 静态 import 会先于上面的赋值求值，故对 50-engine / gdm-form 用动态 import。
globalThis.window = globalThis;
globalThis.unsafeWindow = globalThis;

const { COMPOSITIONS, ENGINES, STAGES } = await import('../../src/50-engine.js');
const { BUILTIN_PRESETS } = await import('../../src/10-constants.js');
const {
    activeCompositionOf, activeEngineParamKeys, filterOptionsByKeys, validateComposition,
} = await import('../../src/gdm-form.js');

// ---------------- filterOptionsByKeys（残留值过滤） ----------------

test('filterOptionsByKeys：声明过的 key 保留，未声明丢弃', () => {
    const out = filterOptionsByKeys({ gap: 8, foo: 3, startX: 10 }, ['gap', 'startX']);
    assert.deepEqual(out, { gap: 8, startX: 10 });
});

test('filterOptionsByKeys：声明 step.x 时父路径 step 整体保留', () => {
    // 嵌套参数（对象）以父 key 出现在 options 里，只要子路径被声明就整块保留
    const out = filterOptionsByKeys({ step: { x: 1, y: 2, z: 9 }, foo: 3, color: '#fff' }, ['step.x', 'step.y', 'color']);
    assert.deepEqual(out, { step: { x: 1, y: 2, z: 9 }, color: '#fff' });
    assert.equal(out.foo, undefined);
});

test('filterOptionsByKeys：父路径命中只认点边界，不做前缀匹配', () => {
    // 'stepx' 不是 'step.x' 的父路径，不能被留下（否则切换引擎会带进无关残留）
    assert.deepEqual(filterOptionsByKeys({ stepx: 1 }, ['step.x']), {});
    assert.deepEqual(filterOptionsByKeys({ step: 1 }, ['step']), { step: 1 });
});

test('filterOptionsByKeys：空输入与空声明都产出空对象', () => {
    assert.deepEqual(filterOptionsByKeys({}, ['gap']), {});
    assert.deepEqual(filterOptionsByKeys({ gap: 1 }, []), {});
    assert.deepEqual(filterOptionsByKeys(null, ['gap']), {});
    assert.deepEqual(filterOptionsByKeys(undefined, []), {});
});

test('filterOptionsByKeys：返回新对象，不动入参', () => {
    const src = { gap: 8, foo: 3 };
    const out = filterOptionsByKeys(src, ['gap']);
    assert.notEqual(out, src);
    assert.deepEqual(src, { gap: 8, foo: 3 });
});

// ---------------- activeEngineParamKeys（引擎声明） ----------------

test('activeEngineParamKeys：与 ENGINES 声明逐字一致（全部 composition）', () => {
    Object.keys(COMPOSITIONS).forEach((tf) => {
        const comp = COMPOSITIONS[tf];
        const expected = [];
        STAGES.forEach((s) => {
            (ENGINES[s.key][comp[s.key]].params || []).forEach((p) => expected.push(p.key));
        });
        assert.deepEqual(activeEngineParamKeys(comp), expected, tf + ' 组合的声明 key 列表与 ENGINES 不一致');
    });
});

test('activeEngineParamKeys：逐阶段按 STAGES 顺序拼接（夹具）', () => {
    // 夹具写死，引擎声明被误删/改序时这里先红
    assert.deepEqual(activeEngineParamKeys(COMPOSITIONS['chars-vertical']), [
        'widthMode',                              // split.chars
        'direction', 'gap', 'startX', 'startY', 'dualDir', 'dualX', 'dualY',   // layout.vertical
        'charDelay',                              // timing.stagger
    ]);
    assert.deepEqual(activeEngineParamKeys(COMPOSITIONS['multi-lang']), ['langGap', 'mainY', 'mainColor', 'subColor']);
});

test('activeEngineParamKeys：跨阶段共享参数全在（declarative 组合）', () => {
    const keys = activeEngineParamKeys(COMPOSITIONS['declarative']);
    // 同一 key 由不同阶段的引擎各自声明（step.time / step.x / highlight.enabled）——去重会漏读
    ['split', 'flow', 'step.x', 'step.y', 'base.x', 'step.time', 'color', 'highlight.enabled'].forEach((k) => {
        assert.ok(keys.includes(k), 'declarative 组合缺声明：' + k);
    });
    assert.equal(keys.length, 17, '声明条数变了，检查引擎 params：' + keys.join(','));
});

test('activeEngineParamKeys：引擎名不存在时按缺省跳过（不抛错）', () => {
    assert.deepEqual(activeEngineParamKeys({}), []);
    assert.deepEqual(activeEngineParamKeys({ split: 'not-exist', layout: 'none' }), []);
});

// ---------------- validateComposition ----------------

test('validateComposition：内置 COMPOSITIONS 全部合法', () => {
    Object.keys(COMPOSITIONS).forEach((tf) => {
        assert.equal(validateComposition(COMPOSITIONS[tf]), true, tf + ' 应合法');
    });
});

test('validateComposition：手写组合的合法与非法判定', () => {
    // 合法：五阶段各自命中 ENGINES 里的引擎（hidden 的 declarative 也算存在）
    assert.equal(validateComposition({ split: 'declarative', layout: 'grid', color: 'declarative', timing: 'declarative', motion: 'none' }), true);
    assert.equal(validateComposition({ split: 'chars', layout: 'vertical', color: 'single', timing: 'stagger', motion: 'spin' }), true);
    // 非法：引擎名不存在 / 阶段缺失（null、undefined、空串）/ 根本不是对象
    assert.equal(validateComposition({ split: 'chars', layout: 'vertical', color: 'single', timing: 'stagger', motion: 'nope' }), false);
    assert.equal(validateComposition({ split: 'chars', layout: 'vertical', color: 'single', timing: 'stagger' }), false);
    assert.equal(validateComposition({ split: 'chars', layout: null, color: 'single', timing: 'stagger', motion: 'none' }), false);
    assert.equal(validateComposition({ split: 'chars', layout: '', color: 'single', timing: 'stagger', motion: 'none' }), false);
    assert.equal(validateComposition({}), false);
    assert.equal(validateComposition(null), false);
    assert.equal(validateComposition(undefined), false);
    assert.equal(validateComposition('chars'), false);
});

// ---------------- activeCompositionOf ----------------

test('activeCompositionOf：composition 优先于 transform', () => {
    const comp = { split: 'chars', layout: 'vertical', color: 'single', timing: 'stagger', motion: 'none' };
    assert.deepEqual(activeCompositionOf({ composition: comp, transform: 'multi-lang' }), comp);
    assert.deepEqual(activeCompositionOf({ transform: 'multi-lang' }), COMPOSITIONS['multi-lang']);
});

test('activeCompositionOf：none / 未知 transform / 空预设都返回 null', () => {
    assert.equal(activeCompositionOf({ transform: 'none' }), null);
    assert.equal(activeCompositionOf({ transform: '不存在的类型' }), null);
    assert.equal(activeCompositionOf({}), null);
});

// ---------------- 类型覆盖（本片最重要的守卫） ----------------

// buildParamControl 只认识这五种控件：number 是兜底分支（未知 type 静默按 number 渲染），
// 其余四种各有分支。这张表【独立复述】实现，不从 gdm-form 导出常量——新增控件类型时必须同时改
// buildParamControl 与本表，只改一处即红灯；反过来，声明里出现未实现的 type 也必须在这里红灯，
// 而不是等运行时静默不渲染（用户只看到「参数没出来」）。
// 来源：svfeed 项目 settingspanel 的 schema 纪律（参数声明集与渲染器实现集必须对得上）。
const IMPLEMENTED_TYPES = ['number', 'select', 'color', 'checkbox', 'text'];

// 仓内全部参数声明：引擎表 + 内置预设表（自定义预设来自用户 JSON，走 sanitizePresetParams 的提醒，不在此列）
function allParamDeclarations() {
    const out = [];
    STAGES.forEach((s) => {
        Object.keys(ENGINES[s.key]).forEach((name) => {
            (ENGINES[s.key][name].params || []).forEach((param) => out.push(['ENGINES.' + s.key + '.' + name, param]));
        });
    });
    BUILTIN_PRESETS.forEach((p) => {
        (p.params || []).forEach((param) => out.push(['BUILTIN_PRESETS.' + p.id, param]));
    });
    return out;
}

test('类型覆盖：所有参数声明的 type 都在 buildParamControl 的实现集内', () => {
    const decls = allParamDeclarations();
    assert.ok(decls.length >= 50, '扫到的参数声明太少（' + decls.length + '），扫描逻辑可能失效');
    const seen = new Set();
    decls.forEach(([where, param]) => {
        seen.add(param.type);
        assert.ok(typeof param.type === 'string' && param.type,
            where + ' 的参数「' + param.key + '」缺 type（会静默按 number 渲染）');
        assert.ok(IMPLEMENTED_TYPES.includes(param.type),
            where + ' 的参数「' + param.key + '」用了未实现的 type "' + param.type
            + '"（实现集：' + IMPLEMENTED_TYPES.join(' / ') + '）——先补 buildParamControl 分支并更新本表');
    });
    // 实现集的每一种都真的被声明用过（否则是没人用的死分支或已漂移的表）
    IMPLEMENTED_TYPES.forEach((t) => {
        assert.ok(seen.has(t), '实现集里的 ' + t + ' 没有任何声明在用——表与实现已漂移');
    });
});

test('类型覆盖：引擎参数声明的 key 与 label 齐备（控件无 key 就不会渲染）', () => {
    allParamDeclarations().forEach(([where, param]) => {
        assert.ok(typeof param.key === 'string' && param.key, where + ' 有参数缺 key');
        assert.ok(param.label, where + ' 的参数「' + param.key + '」缺 label（控件标题会退回 key 字面）');
    });
});
