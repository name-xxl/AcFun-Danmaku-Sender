// 高级字段「声明 ↔ 回读」交叉校验（node --test）
//
// 要守的东西：高级编辑区的 17 个控件自 6.12.0 起**不再出现在面板模板里**（80-ui 只留 <div id="cf-adv-body">），
// 由 35-adv-fields 的统一声明经 gdm-form.buildFieldForm 生成；而 85-danmaku.readAdvancedConfig 仍按 **id**
// 回读（那段代码一行未改）。id 是两侧唯一的契约，而它已经不在任何手写 HTML 里——生成器把 cf-adv-zindex
// 写成 cf-adv-zidx，构建照过、冒烟照绿，直到用户发现「层级改了不生效」。这条测试把契约钉在两处之间，
// 五个方向：
//   ① 回读侧读到的 id 集 与 声明产出的 id 集 **双向一致**（17 个：12 number + 2 color + 3 checkbox）
//   ② key ↔ id 逐条对齐（回读侧的 advancedConfig 路径 ↔ 声明的 effects.* key）——只比集合会漏掉
//      「两个字段的 id 互换」这类错位
//   ③ 门控绑定：回读侧三处 .checked 读到的 checkbox ↔ 声明的 ADV_GATES ↔ 受控控件（blur→blur-on，
//      shadow.*→sh-on，shine.*→sn-on），并与 90-preset-ui.syncAdvEnableUI 里按 id 写死的禁用清单逐条对齐
//      （本片没收编它，只保证生成出来的 DOM 仍兼容它）
//   ④ 值回退链：回读段里每个 g('#id') 的**兜底 token**（0 / DEFAULT_SHADOW_PLACEHOLDER.x …）必须等于
//      声明给出的 default —— 三条回退链的真源在声明里，回读侧是它的镜像
//   ⑤ 统一声明一致性：40-core.ADJUSTABLE_FIELDS（派生值）与 ADV_FIELDS 逐条对齐（顺序与字段全等），
//      且 85-danmaku 导出的 ADV_FORM_DECL 用的就是这两张表（没有第三份）
//
// 抽取方式：回读侧与 syncAdvEnableUI 的 id / 兜底 token **从源码里抽**（不在这里手抄，否则清单本身也会漂）；
// 生成侧取 ADV_FIELDS / ADV_GATES 这两条声明对象。本文件不构造控件，也不引 DOM 桩——本仓纪律是
// 「不为单测引 fake DOM」（见 form.test.mjs 头注），比的是「声明会产出什么 / 回读侧要求什么」，
// 不是真实渲染结果（无真浏览器，DOM 形状只能静态推断，见 RELEASE_NOTES 6.12.0 的未验证边界）。
//
// 用法：npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 85-danmaku 的 import 图在求值期会碰 window / document / localStorage（与冒烟测试同款最小桩）。
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
// 只留代码：理解卡里会提到别的名字（如「不再有 #cf-adv-* 选择器」），那不算引用——与 tools/check.mjs 同一手法
const codeOf = (src) => src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');

const DANMAKU = read('85-danmaku.js');
const UI = read('80-ui.js');
const PRESET_UI = read('90-preset-ui.js');
const EVENTS = read('95-events.js');

const { ADV_FIELDS, ADV_GATES, advFieldPath } = await import('../../src/35-adv-fields.js');
const { ADJUSTABLE_FIELDS } = await import('../../src/40-core.js');
const { ADV_FORM_DECL } = await import('../../src/85-danmaku.js');
const CONSTS = await import('../../src/10-constants.js');
const FORM = await import('../../src/gdm-form.js');

// ---------------- 回读侧：从 readAdvancedConfig 源码里抽（不手抄） ----------------

// 锚点：函数头 → 运动轨迹段（moves 段的抽取在 moves-schema.test.mjs 里，别越界）
function readerBlock() {
    const s = DANMAKU.indexOf('function readAdvancedConfig()');
    const e = DANMAKU.indexOf('const moves = [];', s);
    assert.ok(s > 0 && e > s, '定位不到 readAdvancedConfig 的高级字段段——抽取锚点失效（那段被改写或搬移？请同步本测试）');
    return DANMAKU.slice(s, e);
}
const BLOCK = readerBlock();

// 回读段里出现的全部 #cf-adv-* 字面量；走 .value 的（g('#id')）与走 .checked 的（门的开关）分开
const ALL_IDS = [...new Set([...BLOCK.matchAll(/'#(cf-adv-[\w-]+)'/g)].map((m) => m[1]))];
const VALUE_IDS = [...BLOCK.matchAll(/g\('#(cf-adv-[\w-]+)'\)/g)].map((m) => m[1]);
const GATE_IDS = ALL_IDS.filter((id) => !VALUE_IDS.includes(id));

// advancedConfig.<prop> = 的分段（段内再按 id 切窗口取兜底 token；门 id 落在别的段里，故先排除）
const MARKS = [...BLOCK.matchAll(/advancedConfig\.(\w+)\s*=/g)].map((m) => ({ prop: m[1], at: m.index }));
const SEGMENTS = MARKS.map((mk, i) => ({ prop: mk.prop, text: BLOCK.slice(mk.at, i + 1 < MARKS.length ? MARKS[i + 1].at : BLOCK.length) }));

// 兜底 token：投影/发光/颜色走 `… || TOKEN`；数值走 `num(parseFloat(g('#id')), TOKEN)`
const RE_OR_TOKEN = /\|\|\s*([A-Za-z_$][\w$.:]*|\d+(?:\.\d+)?)/;
const RE_ARG_TOKEN = /,\s*([A-Za-z_$][\w$.:]*|\d+(?:\.\d+)?)\s*\)/;

// 回读侧 → { 路径: { id, token } }：路径由所在段的属性名 + 段内最近的 `字母:` 拼出
function readerFields() {
    const out = {};
    SEGMENTS.forEach((seg) => {
        const ids = VALUE_IDS.filter((id) => seg.text.indexOf("'#" + id + "'") >= 0);
        ids.forEach((id, i) => {
            const at = seg.text.indexOf("'#" + id + "'") + id.length + 2;
            const next = (i + 1 < ids.length) ? seg.text.indexOf("'#" + ids[i + 1] + "'") : seg.text.length;
            const win = seg.text.slice(at, next);
            const m = win.match(RE_OR_TOKEN) || win.match(RE_ARG_TOKEN);
            assert.ok(m, '抽不到 ' + id + ' 的兜底 token（窗口：' + JSON.stringify(win) + '）——回读段的写法变了');
            // 段内最近的 `x:` / `blur:` / `color:` 就是这条路径的叶子名（顶层 zIndex / blur 没有叶子）
            const before = seg.text.slice(0, at);
            const keys = [...before.matchAll(/(\w+)\s*:/g)].map((x) => x[1]);
            const leaf = keys.length ? keys[keys.length - 1] : null;
            const p = (seg.prop === 'zIndex' || seg.prop === 'blur') ? seg.prop : seg.prop + '.' + leaf;
            assert.equal(out[p], undefined, '回读段里路径「' + p + '」出现两次——抽取逻辑或源码有问题');
            out[p] = { id, token: m[1] };
        });
    });
    return out;
}
const READER = readerFields();

// 常量 token → 值（如 'DEFAULT_SHADOW_PLACEHOLDER.x' → 1；'0' → 0）
function resolveToken(tok) {
    if (/^\d+(\.\d+)?$/.test(tok)) return +tok;
    return tok.split('.').reduce((o, k) => (o == null ? undefined : o[k]), CONSTS);
}

// ---------------- 生成侧：声明的契约视图 ----------------

const DECL_IDS = ADV_FIELDS.map((f) => f.ui.id).concat(ADV_GATES.map((g) => g.id));
const DECL_BY_PATH = {};
ADV_FIELDS.forEach((f) => { DECL_BY_PATH[advFieldPath(f.key)] = f; });
const GATED_IDS = (gateKey) => ADV_FIELDS.filter((f) => f.ui.gate === gateKey).map((f) => f.ui.id);

// ---------------- 冻结清单（**独立复述**，不从 ADV_FIELDS 推导） ----------------
// 本片的目标表，逐条来自「高级编辑区现有 DOM」的盘点：8 个显式单元格 + 6 个裸控件 + 3 个开关。
// [key, id, read, gate, cellClass, prefix]
const FROZEN_FIELDS = [
    ['effects.zIndex', 'cf-adv-zindex', 'value', null, null, null],
    ['effects.rotate.x', 'cf-adv-rx', 'value', null, 'cf-adv-3', 'X'],
    ['effects.rotate.y', 'cf-adv-ry', 'value', null, 'cf-adv-3', 'Y'],
    ['effects.rotate.z', 'cf-adv-rz', 'value', null, 'cf-adv-3', 'Z'],
    ['effects.scale.x', 'cf-adv-sx', 'value', null, 'cf-adv-3', 'X'],
    ['effects.scale.y', 'cf-adv-sy', 'value', null, 'cf-adv-3', 'Y'],
    ['effects.blur', 'cf-adv-blur', 'value', 'blur', null, null],
    ['effects.shadow.x', 'cf-adv-shx', 'gate', 'shadow', 'cf-adv-3', 'X'],
    ['effects.shadow.y', 'cf-adv-shy', 'gate', 'shadow', 'cf-adv-3', 'Y'],
    ['effects.shadow.blur', 'cf-adv-shb', 'gate', 'shadow', 'cf-adv-3', '模糊'],
    ['effects.shadow.color', 'cf-adv-shc', 'gate', 'shadow', null, null],
    ['effects.shine.blur', 'cf-adv-snb', 'gate', 'shine', 'cf-adv-3', '模糊'],
    ['effects.shine.size', 'cf-adv-sns', 'gate', 'shine', 'cf-adv-3', '大小'],
    ['effects.shine.color', 'cf-adv-snc', 'gate', 'shine', null, null],
];
// [key, id, checked, group]
const FROZEN_GATES = [
    ['blur', 'cf-adv-blur-on', 'positive', '模糊'],
    ['shadow', 'cf-adv-sh-on', 'truthy', '投影'],
    ['shine', 'cf-adv-sn-on', 'truthy', '外发光'],
];
// 勾选层 / 导出 params 的外部契约（openAdjustablePicker 的分组与文案、exportAdvancedPreset 的 key）
// [key, label, group, type]
const FROZEN_PICKER_ROWS = [
    ['effects.zIndex', '层级', '层级', 'number'],
    ['effects.rotate.x', '旋转 X°', '旋转', 'number'],
    ['effects.rotate.y', '旋转 Y°', '旋转', 'number'],
    ['effects.rotate.z', '旋转 Z°', '旋转', 'number'],
    ['effects.scale.x', '缩放 X', '缩放', 'number'],
    ['effects.scale.y', '缩放 Y', '缩放', 'number'],
    ['effects.blur', '模糊(px)', '模糊', 'number'],
    ['effects.shadow.x', '投影 X', '投影', 'number'],
    ['effects.shadow.y', '投影 Y', '投影', 'number'],
    ['effects.shadow.blur', '投影模糊', '投影', 'number'],
    ['effects.shadow.color', '投影色', '投影', 'color'],
    ['effects.shine.blur', '发光模糊', '外发光', 'number'],
    ['effects.shine.size', '发光大小', '外发光', 'number'],
    ['effects.shine.color', '发光色', '外发光', 'color'],
];

// ---------------- ① 回读 id 集 ↔ 声明 id 集 双向一致 ----------------

test('① 回读侧 id 集 与 声明产出的 id 集 双向一致（17 个）', () => {
    assert.equal(VALUE_IDS.length, 14, '回读段应读 14 个值控件（12 number + 2 color），实际 ' + VALUE_IDS.length);
    assert.equal(GATE_IDS.length, 3, '回读段应读 3 个开关（.checked），实际 ' + GATE_IDS.length);
    assert.equal(ALL_IDS.length, 17, '回读段 id 总数应为 17，实际 ' + ALL_IDS.length);
    assert.deepEqual([...ALL_IDS].sort(), [...DECL_IDS].sort(),
        '回读侧读到的 id 与声明产出的 id 不一致——生成器改了 id？回读会永远拿到空串/undefined');
    // 声明自己也不能重复：同一个 id 产两次会让 $(id) 命中先出现的那一个
    assert.equal(new Set(DECL_IDS).size, DECL_IDS.length, '声明里出现重复 id：' + DECL_IDS.join(','));
});

test('控件类型计数：12 number + 2 color + 3 checkbox', () => {
    const typed = ADV_FIELDS.concat(ADV_GATES).map((f) => f.type);
    assert.equal(typed.filter((t) => t === 'number').length, 12, 'number 控件应为 12 个');
    assert.equal(typed.filter((t) => t === 'color').length, 2, 'color 控件应为 2 个');
    assert.equal(typed.filter((t) => t === 'checkbox').length, 3, 'checkbox 控件应为 3 个');
    assert.equal(ADV_FIELDS.length, 14, '可调字段应为 14 条（17 − 3 个开关）');
    assert.equal(ADV_GATES.length, 3, '开关应为 3 个');
    // 回读侧按 g()（取 .value）读的 14 个，必须正好是 12 number + 2 color
    const valueTyped = ADV_FIELDS.filter((f) => VALUE_IDS.includes(f.ui.id)).map((f) => f.type);
    assert.equal(valueTyped.length, 14, '14 条字段都应被回读段用 g() 读到');
    assert.ok(valueTyped.every((t) => t === 'number' || t === 'color'), '回读按 .value 取的控件只能是 number/color');
});

// ---------------- ② key ↔ id 逐条对齐 ----------------

test('② key ↔ id 逐条对齐：回读侧的 advancedConfig 路径 ↔ 声明的 effects 路径', () => {
    const readerMap = {};
    Object.keys(READER).forEach((p) => { readerMap[p] = READER[p].id; });
    const declMap = {};
    Object.keys(DECL_BY_PATH).forEach((p) => { declMap[p] = DECL_BY_PATH[p].ui.id; });
    assert.equal(Object.keys(readerMap).length, 14, '抽到的回读路径应为 14 条，实际 ' + Object.keys(readerMap).length);
    assert.deepEqual(Object.keys(readerMap).sort(), Object.keys(declMap).sort(),
        '回读段的路径集与声明的路径集不一致（key 与 id 的对应关系断了）');
    Object.keys(readerMap).forEach((p) => {
        assert.equal(declMap[p], readerMap[p], '路径 ' + p + '：回读侧读 ' + readerMap[p] + '，声明给的 id 是 ' + declMap[p]);
    });
    // effects 前缀是约定：去掉即 advancedConfig 路径（35-adv-fields 的 advFieldPath）
    ADV_FIELDS.forEach((f) => {
        assert.match(f.key, /^effects\./, '字段 ' + f.key + ' 的 key 必须以 effects. 开头（勾选层与导出 effects 靠它对应）');
        assert.equal(advFieldPath(f.key), String(f.key).slice('effects.'.length), 'advFieldPath 与 effects. 前缀约定不一致');
    });
});

// ---------------- ③ 门控绑定 ----------------

test('③ 门控绑定：开关 ↔ 受控控件（blur→blur-on，shadow.*→sh-on，shine.*→sn-on）', () => {
    // 门：回读侧 .checked 读到的三个 checkbox 就是声明里的 ADV_GATES
    assert.deepEqual([...GATE_IDS].sort(), ADV_GATES.map((g) => g.id).sort(), '回读侧按 .checked 读的开关与声明的门不一致');
    assert.deepEqual(ADV_GATES.map((g) => g.key), FROZEN_GATES.map((g) => g[0]), '门 key 或顺序变了');
    ADV_GATES.forEach((g, i) => {
        const [key, id, checked, group] = FROZEN_GATES[i];
        assert.equal(g.key, key, '第 ' + i + ' 个门的 key');
        assert.equal(g.id, id, '第 ' + i + ' 个门的 id');
        assert.equal(g.checked, checked, '门 ' + key + ' 的勾选判据（positive = raw > 0，truthy = !!raw）');
        assert.equal(g.group, group, '门 ' + key + ' 所在的行');
        assert.equal(g.type, 'checkbox', '门必须是 checkbox');
    });
    // 归属：受门控的字段只能是同名前缀那批，未受控的字段不得挂门
    ADV_FIELDS.forEach((f) => {
        const top = advFieldPath(f.key).split('.')[0];
        const gated = ['shadow', 'shine'].indexOf(top) >= 0 || top === 'blur';
        assert.equal(f.ui.gate, gated ? top : undefined,
            '字段 ' + f.key + ' 的门控归属不对（应归属 ' + (gated ? top : '无门') + '）');
    });
    // 双向：每个门都有受控控件，且集合与解析出来的 id 一致
    assert.deepEqual(GATED_IDS('blur'), ['cf-adv-blur'], '模糊门只管模糊数值框');
    assert.equal(GATED_IDS('shadow').length, 4, '投影门应管 4 个控件（X/Y/模糊/颜色）');
    assert.equal(GATED_IDS('shine').length, 3, '外发光门应管 3 个控件（模糊/大小/颜色）');
});

test('③ 兼容 90-preset-ui.syncAdvEnableUI：它按 id 写死的禁用清单与声明一致', () => {
    // syncAdvEnableUI 本片未收编（外部调用点不变），它按 id 逐个置 disabled——故它认的 id 必须在声明里
    const s = PRESET_UI.indexOf('function syncAdvEnableUI()');
    const e = PRESET_UI.indexOf('function syncEditorOwnedUI', s);
    assert.ok(s > 0 && e > s, '定位不到 syncAdvEnableUI —— 抽取锚点失效');
    const block = PRESET_UI.slice(s, e);
    // 两组数组清单（投影 4 个 / 外发光 3 个）+ 模糊那行单独取节点
    const lists = [...block.matchAll(/\[([^\]]*'#cf-adv[\s\S]*?)\]/g)]
        .map((m) => [...m[1].matchAll(/'#(cf-adv-[\w-]+)'/g)].map((x) => x[1]));
    assert.equal(lists.length, 2, 'syncAdvEnableUI 里应有 2 组数组清单，实际 ' + lists.length);
    assert.deepEqual(lists[0], GATED_IDS('shadow'), 'syncAdvEnableUI 的投影禁用清单与声明的受控控件不一致');
    assert.deepEqual(lists[1], GATED_IDS('shine'), 'syncAdvEnableUI 的外发光禁用清单与声明的受控控件不一致');
    assert.equal(/const b = \$\('#cf-adv-blur'\)/.test(block), true, 'syncAdvEnableUI 应仍按 id 取模糊数值框');
    // 它读的三个开关 id 也必须是声明的门
    const readGates = [...block.matchAll(/'#(cf-adv-[\w-]+)'\)\s*\|\|\s*\{\}\)\.checked/g)].map((m) => m[1]);
    assert.deepEqual([...readGates].sort(), ADV_GATES.map((g) => g.id).sort(), 'syncAdvEnableUI 读的开关与声明的门不一致');
});

test('③ 门控放行不得顶掉预设接管的禁用态（gateEnabled 钩子）', () => {
    // 90-preset-ui.syncEditorOwnedUI 在预设带 effects 时整区禁用；syncAdvEnableUI 靠 activePresetHasEffects()
    // 提前返回。生成侧必须同样了解「预设接管」——renderAdvancedForm 传的 gateEnabled 就是这条约束。
    assert.match(DANMAKU, /gateEnabled:\s*\(\)\s*=>\s*!activePresetHasEffects\(\)/,
        'renderAdvancedForm 必须把「预设接管高级字段时门不得放开」交给控件（gateEnabled）');
    assert.match(read('90-preset-ui.js'), /if \(activePresetHasEffects\(\)\) return;/,
        'syncAdvEnableUI 的预设接管提前返回是本片依赖的前置行为，别改');
});

// ---------------- ④ 值回退链：回读侧的兜底 token 必须等于声明的 default ----------------

test('④ 值回退链：回读侧每个 g(#id) 的兜底 token == 声明的 default', () => {
    Object.keys(READER).forEach((p) => {
        const f = DECL_BY_PATH[p];
        assert.ok(f, '回读段读了路径 ' + p + '，声明里没有对应字段');
        assert.equal(resolveToken(READER[p].token), f.default,
            '路径 ' + p + '：回读侧兜底 ' + READER[p].token + '（= ' + resolveToken(READER[p].token)
            + '），声明的 default 是 ' + f.default + ' —— 两条回退链分叉了');
    });
    // 三处回退链，别统一：直接值 7 条 + 门控值 7 条，门控的 read 必须是 'gate'
    const gateRead = ADV_FIELDS.filter((f) => f.ui.read === 'gate').map((f) => advFieldPath(f.key));
    const valueRead = ADV_FIELDS.filter((f) => f.ui.read === 'value').map((f) => advFieldPath(f.key));
    assert.deepEqual(gateRead.slice().sort(), ['shadow.blur', 'shadow.color', 'shadow.x', 'shadow.y', 'shine.blur', 'shine.color', 'shine.size']);
    assert.deepEqual(valueRead.slice().sort(), ['blur', 'rotate.x', 'rotate.y', 'rotate.z', 'scale.x', 'scale.y', 'zIndex']);
    // 占位兜底（门关时显示的值）必须就是回读侧的 DEFAULT_*_PLACEHOLDER.*
    assert.equal(DECL_BY_PATH['shadow.x'].default, CONSTS.DEFAULT_SHADOW_PLACEHOLDER.x, '投影兜底值');
    assert.equal(DECL_BY_PATH['shine.size'].default, CONSTS.DEFAULT_SHINE_PLACEHOLDER.size, '外发光兜底值');
    assert.equal(DECL_BY_PATH['zIndex'].default, CONSTS.DEFAULT_ZINDEX, '层级默认值');
});

test('④ 显示形态逐条冻结：id / read / 门控 / 包裹类名 / 前缀 / px 小字', () => {
    assert.equal(ADV_FIELDS.length, FROZEN_FIELDS.length, '字段条数变了');
    ADV_FIELDS.forEach((f, i) => {
        const [key, id, readMode, gate, cellClass, prefix] = FROZEN_FIELDS[i];
        assert.equal(f.key, key, '第 ' + i + ' 条字段的 key');
        assert.equal(f.ui.id, id, key + ' 的控件 id');
        assert.equal(f.ui.read, readMode, key + ' 的值回退链形态');
        assert.equal(f.ui.gate, gate || undefined, key + ' 的门控');
        assert.equal(f.ui.cellClass, cellClass || undefined, key + ' 的行内单元包裹类名');
        assert.equal(f.ui.prefix, prefix || undefined, key + ' 的单元前缀文字');
    });
    // 「px」小字：模糊数值框紧后的说明 span（沿用旧模板的行内小字样式）
    assert.deepEqual(DECL_BY_PATH.blur.ui.after, { text: 'px', style: 'font-size:11px;color:#999' }, '模糊的 px 说明 span');
});

// ---------------- ⑤ 统一声明一致性（防两份表再次漂移） ----------------

test('⑤ ADJUSTABLE_FIELDS 是 ADV_FIELDS 的逐条投影（顺序与字段全等）', () => {
    const PICKER_KEYS = ['key', 'label', 'group', 'type', 'min', 'max', 'step', 'default'];
    const project = (f) => {
        const out = {};
        PICKER_KEYS.forEach((k) => { if (f[k] !== undefined) out[k] = f[k]; });
        return out;
    };
    assert.equal(ADJUSTABLE_FIELDS.length, 14, 'ADJUSTABLE_FIELDS 应为 14 条');
    assert.deepEqual(ADJUSTABLE_FIELDS, ADV_FIELDS.map(project),
        'ADJUSTABLE_FIELDS 与统一声明不一致——它只是派生值，真源在 35-adv-fields，别在 40-core 另写一份');
    // 编辑区槽位（id / 门控 / 前缀）不得漏进勾选层与导出 params
    ADJUSTABLE_FIELDS.forEach((f) => {
        assert.equal(f.ui, undefined, '勾选层条目不该带编辑区的 ui 槽：' + f.key);
    });
});

test('⑤ 勾选层与导出 params 的外部契约冻结（14 行的 key/label/group/type 逐字不变）', () => {
    const got = ADJUSTABLE_FIELDS.map((f) => [f.key, f.label, f.group, f.type]);
    assert.deepEqual(got, FROZEN_PICKER_ROWS, 'openAdjustablePicker 的勾选项/分组/文案或 exportAdvancedPreset 的字段集变了');
    // 生成侧读的就是这张表（85 的勾选层与导出直接 iterate ADV_FIELDS，不再读派生值）
    const code = codeOf(DANMAKU);
    assert.match(code, /ADV_FIELDS\.forEach/, '85 的勾选层应直接 iterate 统一声明');
    assert.match(code, /ADV_FIELDS\s*\n?\s*\.filter/, '85 的导出应直接 iterate 统一声明');
    assert.equal(/ADJUSTABLE_FIELDS\s*[.[]/.test(code), false, '85 不该再消费派生值 ADJUSTABLE_FIELDS（会多出一条真源路径）');
});

test('⑤ ADV_FORM_DECL 就是统一声明的两张表（没有第三份）', () => {
    assert.equal(ADV_FORM_DECL.fields, ADV_FIELDS, '编辑区表单声明的字段表必须是 35-adv-fields 的 ADV_FIELDS 本体');
    assert.equal(ADV_FORM_DECL.gates, ADV_GATES, '编辑区表单声明的门表必须是 35-adv-fields 的 ADV_GATES 本体');
    assert.equal(typeof FORM.buildFieldForm, 'function', 'gdm-form 应导出 buildFieldForm');
    assert.match(DANMAKU, /buildFieldForm\(ADV_FORM_DECL/, 'renderAdvancedForm 应把声明交给 gdm-form.buildFieldForm');
});

// ---------------- 旧手写模板：零残留 + 唯一挂载点 ----------------

test('旧手写模板零残留：#cf-adv-* 只由声明产出，80-ui 里没有第二个来源', () => {
    ALL_IDS.forEach((id) => {
        assert.equal(UI.indexOf(id) < 0, true, '80-ui 里仍有 ' + id + ' —— 面板模板里残留了手写控件');
    });
    assert.match(UI, /<div id="cf-adv-body"><\/div>/, '#cf-adv-body 应是空容器（控件由声明生成）');
    assert.equal((UI.match(/id="cf-adv-body"/g) || []).length, 1, '#cf-adv-body 只能有一个');
    assert.match(DANMAKU, /renderAdvancedForm[\s\S]{0,600}\$\('#cf-adv-body'\)/, 'renderAdvancedForm 应挂到 #cf-adv-body');
    // 95-events 不再按 id 绑高级字段（事件随控件生成），但仍必须在取节点前渲染
    // （#cf-adv-reset 是区块标题上的「恢复默认」按钮，不在这 17 个控件里，仍归 95-events 绑）
    const evCode = codeOf(EVENTS);
    ALL_IDS.forEach((id) => {
        assert.equal(evCode.indexOf("'#" + id + "'") < 0, true, '95-events 仍在按 id 绑 ' + id + '（事件应随控件生成）');
    });
    assert.match(evCode, /renderAdvancedForm\(\);/, '95-events 必须在按 id 取节点前渲染高级编辑区');
    // 三个门 id 也必须是回读侧读到的那些（.checked 那三处）
    GATE_IDS.forEach((id) => {
        assert.ok(ADV_GATES.some((g) => g.id === id), '回读侧 .checked 读的 ' + id + ' 不在声明的门表里');
    });
});
