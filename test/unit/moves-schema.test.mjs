// 运动轨迹「声明 ↔ 回读」的类名交叉校验（node --test）
//
// 要守的东西：渲染侧（gdm-form 的 list 控件按 85-danmaku 的 MOVES_DECL 生成 DOM）与回读侧
// （85-danmaku.readAdvancedConfig 用 querySelector 逐字段取值）之间**只靠类名耦合**。
// ESM 与 esbuild 都给不出编译期保护：生成器把 .cf-mv-fx 写成 .cf-mv-x，构建照过、冒烟照绿，
// 直到用户发现「坐标填了不生效」。这条测试把这份契约钉在两处之间，三个方向：
//   ① 回读侧用到的选择器 ⊆ 声明产出的类名 —— 生成器改了类名而回读侧没改 → 红
//   ② 声明产出的类名 ⊆ 冻结清单 —— 自造类名（boot.js 没有样式、也没人回读）→ 红
//   ③ 字段 key ↔ 类名逐条对齐 —— 只比集合会漏掉「两个字段的类名互换」这类错位
//
// 抽取方式：回读侧的选择器**从 85-danmaku.js 源码里抽**（不在这里手抄一份，否则清单本身也会漂），
// 生成侧取 MOVES_DECL 这条声明对象。不引 DOM 桩——本仓的既定纪律是「不为单测引 fake DOM」
// （见 form.test.mjs 头注），这里比的是「声明产出的类名」，不是渲染结果。
//
// 用法：npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 85-danmaku 的 import 图在求值期会碰 window / document / localStorage（与冒烟测试同款最小桩）。
// 本文件全程不构造控件，不是 DOM 桩：只在模块求值期兜住这几个浏览器全局。
globalThis.window = globalThis;
globalThis.unsafeWindow = globalThis;
globalThis.document = {
    readyState: 'loading',
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() {
        return {
            style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
            appendChild() {}, insertBefore() {}, setAttribute() {}, remove() {},
        };
    },
};
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');

const { MOVES_DECL, TIMING_FUNCS } = await import('../../src/85-danmaku.js');

// ---------------- 回读侧：从源码抽取（唯一真源，不手抄） ----------------

const DANMAKU = read('85-danmaku.js');

// readAdvancedConfig 的 moves 段：锚点是「声明空数组」到「写回 advancedConfig.moves」
function readerBlock() {
    const s = DANMAKU.indexOf('const moves = [];');
    const e = DANMAKU.indexOf('advancedConfig.moves = moves.length');
    assert.ok(s > 0 && e > s, '定位不到 readAdvancedConfig 的 moves 段——抽取锚点失效（回读段被改写或搬移？请同步本测试）');
    return DANMAKU.slice(s, e);
}
const BLOCK = readerBlock();

// 条目作用域：$$('#cf-moves .cf-move-item') → ['#cf-moves', '.cf-move-item']
const scopeMatch = BLOCK.match(/\$\$\('([^']+)'\)/);
assert.ok(scopeMatch, '抽取不到条目作用域选择器（$$("… .cf-move-item")）——回读段的取法变了');
const SCOPE = scopeMatch[1].split(/\s+/);

// 字段 → { fn, sel }：`fromX: coord('.cf-mv-fx'),` / `timingFunction: raw('.cf-mv-tf') || 'linear',`
const READER_FIELDS = {};
for (const m of BLOCK.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(coord|raw)\('(\.[\w-]+)'\)/g)) {
    assert.equal(READER_FIELDS[m[1]], undefined, '回读段里字段「' + m[1] + '」出现两次——抽取逻辑或源码有问题');
    READER_FIELDS[m[1]] = { fn: m[2], sel: m[3] };
}

// ---------------- 生成侧：从 MOVES_DECL 收集类名 ----------------

function subFields(decl) {
    return (decl.item || []).concat(decl.advanced ? (decl.advanced.fields || []) : []);
}
function classesOf(field) {
    const out = String(field.className || '').split(/\s+/).filter(Boolean);
    if (field.hint && field.hint.className) out.push(field.hint.className);
    return out;
}
function declaredClasses(decl) {
    const set = new Set();
    ['containerClass', 'itemClass', 'addClass', 'removeClass'].forEach((k) => { if (decl[k]) set.add(decl[k]); });
    if (decl.advanced) ['className', 'toggleClass'].forEach((k) => { if (decl.advanced[k]) set.add(decl.advanced[k]); });
    subFields(decl).forEach((f) => classesOf(f).forEach((c) => set.add(c)));
    return set;
}

// 冻结清单：**独立复述**（不从 MOVES_DECL 推导），学自 form.test.mjs 的 IMPLEMENTED_TYPES。
// 这些名字被三方依赖：回读侧（readAdvancedConfig）、交互侧（折叠/删除/圈数提示）、
// 以及 #cf-moves 的既有 DOM 与 boot.js 既有样式。生成器漏掉或自造，都在这里红灯。
const EXPECTED_CLASSES = [
    'cf-move-item', 'cf-move-adv', 'cf-move-toggle', 'cf-move-del', 'cf-rot-inp', 'cf-rot-hint',
    'cf-mv-fx', 'cf-mv-fy', 'cf-mv-tx', 'cf-mv-ty',
    'cf-mv-fsx', 'cf-mv-fsy', 'cf-mv-tsx', 'cf-mv-tsy',
    'cf-mv-frx', 'cf-mv-fry', 'cf-mv-frz', 'cf-mv-trx', 'cf-mv-try', 'cf-mv-trz',
    'cf-mv-mt', 'cf-mv-tf',
];

// list 控件认识这几种子字段（number 是兜底分支）；与 gdm-form.buildListControl 的实现集对齐
const IMPLEMENTED_SUB_TYPES = ['number', 'select'];

// ---------------- ① 类名冻结 ----------------

test('类名冻结：MOVES_DECL 产出的类名与冻结清单完全一致（不许多、不许少）', () => {
    const got = [...declaredClasses(MOVES_DECL)].sort();
    assert.deepEqual(got, [...EXPECTED_CLASSES].sort(),
        '声明产出的类名与冻结清单不一致——要么漏了回读/样式依赖的类名，要么自造了没人认识的新类名');
});

// ---------------- ② 回读选择器 ⊆ 声明类名 ----------------

test('回读选择器全部落在声明产出的类名里', () => {
    const declared = declaredClasses(MOVES_DECL);
    const keys = Object.keys(READER_FIELDS);
    assert.ok(keys.length >= 15, '抽到的回读字段太少（' + keys.length + '）——抽取逻辑可能失效');
    keys.forEach((k) => {
        assert.ok(declared.has(READER_FIELDS[k].sel.slice(1)),
            'readAdvancedConfig 读 ' + READER_FIELDS[k].sel + '（字段 ' + k + '），但 MOVES_DECL 产出的类名里没有它——'
            + '生成器改了类名？回读会永远拿到 undefined');
    });
    // 条目作用域：$$('#cf-moves .cf-move-item') 的类名与 id 同样来自声明 / 面板 DOM
    assert.equal(SCOPE[0], '#cf-moves', '回读段的容器 id 不是 #cf-moves：' + SCOPE[0]);
    assert.equal(SCOPE[1], '.' + MOVES_DECL.itemClass, '回读段的条目类名与声明的 itemClass 不一致：' + SCOPE[1]);
});

test('挂载点 #cf-moves 三处一致（面板 DOM / 回读段 / renderMoves）', () => {
    assert.match(read('80-ui.js'), /id="cf-moves"/, '80-ui 的面板 HTML 里没有 id="cf-moves"');
    assert.match(DANMAKU, /renderMoves[\s\S]*?\$\('#cf-moves'\)/, 'renderMoves 没有挂到 #cf-moves');
});

// ---------------- ③ 字段 key ↔ 类名逐条对齐 ----------------

test('字段 key ↔ 类名两侧逐条一致（字段互换类名也必须红灯）', () => {
    const fields = subFields(MOVES_DECL);
    const declMap = {};
    fields.forEach((f) => { declMap[f.key] = classesOf(f); });
    assert.equal(fields.length, 16, '运动轨迹条目应为 16 个字段（4 坐标 + 4 拉伸 + 6 旋转 + 耗时 + 缓动），实际 ' + fields.length);
    assert.deepEqual(Object.keys(READER_FIELDS).sort(), Object.keys(declMap).sort(),
        '回读段的字段集与 MOVES_DECL 的字段集不一致');
    Object.keys(READER_FIELDS).forEach((k) => {
        assert.ok(declMap[k].includes(READER_FIELDS[k].sel.slice(1)),
            '字段 ' + k + ' 回读 ' + READER_FIELDS[k].sel + '，但声明给它的类名是「' + declMap[k].join(' ') + '」');
    });
});

// ---------------- 空值语义：nullable ↔ 回读的 coord() ----------------

test('nullable 字段集 == 回读走 coord() 的字段集（空串 ⇒ null，不是默认值）', () => {
    // 回读侧 coord() 是 (v === '' || v == null) ? null : num(parseFloat(v), 50)——空 ⇒ null；
    // raw() 不走这条（缓动回落 'linear'）。声明里标了 nullable 的字段，才允许在 UI 上留空表示「跟随」。
    const coordFields = Object.keys(READER_FIELDS).filter((k) => READER_FIELDS[k].fn === 'coord').sort();
    const nullableFields = subFields(MOVES_DECL).filter((f) => f.nullable).map((f) => f.key).sort();
    assert.equal(nullableFields.length, 15, 'nullable 字段数应为 15，实际 ' + nullableFields.length);
    assert.deepEqual(nullableFields, coordFields, 'nullable 声明与回读走 coord() 的字段必须一一对应');
    assert.equal(READER_FIELDS.timingFunction.fn, 'raw', '缓动应从 raw() 读（回落 linear），不该走 coord()');
});

// ---------------- 空条目：与 40-core 的默认动作同形 ----------------

test('空条目语义：声明的 nullable / default 与 40-core 默认动作逐字段对齐', async () => {
    // addMove 旧实现写的是 16 字段字面量（全 null + linear），现在空条目由声明推出（blankListItem）；
    // 40-core 的 DEFAULT_ADVANCED_CONFIG.moves[0] 正是那份字面量的存档——两边同形才算「空条目没变味」。
    const { DEFAULT_ADVANCED_CONFIG } = await import('../../src/40-core.js');
    const def = DEFAULT_ADVANCED_CONFIG.moves[0];
    const fields = subFields(MOVES_DECL);
    assert.deepEqual(Object.keys(def).sort(), fields.map((f) => f.key).sort(), '默认动作的字段集与声明不一致');
    fields.forEach((f) => {
        if (f.key === 'timingFunction') {
            assert.equal(def[f.key], 'linear', '默认缓动 linear');
            assert.equal(f.default, 'linear', '声明应显式给出 default: linear（空条目靠它推出 linear）');
            return;
        }
        assert.equal(def[f.key], null, '字段 ' + f.key + ' 的默认动作应为 null（留空 = 跟随样式/本体/时长）');
        assert.equal(f.nullable, true, '字段 ' + f.key + ' 必须标 nullable: true，否则空条目推不出 null');
    });
});

// ---------------- 交互侧：折叠 / 删除保底 / 圈数提示 ----------------

test('交互侧类名与文案齐备（折叠、删除保底、旋转圈数提示）', () => {
    assert.equal(MOVES_DECL.advanced.className, 'cf-move-adv', '高级子区类名');
    assert.equal(MOVES_DECL.advanced.toggleClass, 'cf-move-toggle', '折叠按钮类名');
    assert.equal(MOVES_DECL.advanced.label, '⚙ 高级', '折叠按钮初始文案');
    assert.equal(MOVES_DECL.advanced.expandedLabel, '▲ 收起', '展开后的按钮文案');
    assert.equal(MOVES_DECL.removeClass, 'cf-move-del', '删除按钮类名');
    assert.equal(MOVES_DECL.removeLabel, '删除', '删除按钮文案');
    assert.equal(MOVES_DECL.min, 1, '删除保底靠 min（至少留一条动作）');
    assert.equal(MOVES_DECL.minMessage, '至少保留一个动作', '删除保底的提示文案（旧实现逐字保留）');

    const rot = subFields(MOVES_DECL).filter((f) => classesOf(f).includes('cf-rot-inp'));
    assert.equal(rot.length, 6, '6 个旋转输入框都应带 cf-rot-inp，实际 ' + rot.length);
    rot.forEach((f) => {
        assert.equal(f.hint && f.hint.className, 'cf-rot-hint', '字段 ' + f.key + ' 缺少 cf-rot-hint 提示 span（它必须是输入框的紧后兄弟）');
        assert.equal(typeof (f.hint && f.hint.format), 'function', '字段 ' + f.key + ' 的圈数提示缺 format');
    });
});

// ---------------- 类型覆盖（子字段实现集） ----------------

test('子字段类型覆盖：MOVES_DECL 用到的 type 都在 list 控件的实现集内，且实现集无死分支', () => {
    const seen = new Set();
    subFields(MOVES_DECL).forEach((f) => {
        seen.add(f.type);
        assert.ok(IMPLEMENTED_SUB_TYPES.includes(f.type),
            '字段「' + f.key + '」用了未实现的子字段 type "' + f.type + '"（实现集：' + IMPLEMENTED_SUB_TYPES.join(' / ') + '）');
    });
    IMPLEMENTED_SUB_TYPES.forEach((t) => {
        assert.ok(seen.has(t), '实现集里的 ' + t + ' 没有任何子字段在用——表与实现已漂移');
    });
});

// ---------------- 缓动表：唯一真源 ----------------

test('缓动选项表只有一份真源（TIMING_FUNCS）', () => {
    const tf = subFields(MOVES_DECL).filter((f) => f.key === 'timingFunction')[0];
    assert.equal(tf.choices, TIMING_FUNCS, 'timingFunction 的 choices 必须直接引用 TIMING_FUNCS（28 项缓动表唯一真源）');
    assert.equal(TIMING_FUNCS.length, 28, '缓动表应为 28 项，实际 ' + TIMING_FUNCS.length);
    assert.equal(tf.default, 'linear', '默认缓动 linear（与回读侧 raw(...) || "linear" 一致）');
});
