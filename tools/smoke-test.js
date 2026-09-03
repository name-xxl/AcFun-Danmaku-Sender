// 冒烟测试：把 src 拼接后在 IIFE 作用域内注入测试代码，验证引擎/预设相关纯逻辑
// 用法：node tools/smoke-test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FILES = [
    '00-header.js', '10-constants.js', '20-utils.js', '30-parser.js', '40-core.js',
    '50-engine.js', '60-network.js', '70-preview.js', '80-ui.js', '85-danmaku.js',
    '90-preset-ui.js', '95-events.js', '99-main.js',
];

let out = '';
for (const f of FILES) out += fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');

const TEST = `
    const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; } };

    // 1) 内置预设全部应零警告、零剔除
    BUILTIN_PRESETS.forEach((p) => {
        const r = sanitizePresetParams(p);
        assert(r.warnings.length === 0, p.id + ' 内置预设不应有警告: ' + r.warnings.join(';'));
        assert(r.params.length === p.params.length, p.id + ' 参数不应被剔除');
    });

    // 2) 手写坏预设应产生对应提醒并剔除无效项
    const bad = { id: 'x', name: 'x', transform: 'chars-vertical', options: {}, params: [
        { key: 'gapp', label: '拼错', type: 'number' },
        { key: 'gap', label: '正常', type: 'number' },
        { key: 'gap', label: '重复', type: 'number' },
        { label: '缺key', type: 'number' },
        { key: 'typo', label: 'type拼错', type: 'nmber' },
    ]};
    const rb = sanitizePresetParams(bad);
    // 只剔除「缺 key」和「重复」项；未声明/type 拼错的参数提醒但保留（只提醒不阻断）
    assert(rb.params.length === 3, '坏预设应保留 3 个参数，实际 ' + rb.params.length);
    assert(rb.warnings.length === 5, '坏预设应产生 5 条提醒，实际 ' + rb.warnings.length + ': ' + rb.warnings.join(';'));
    assert(rb.warnings.some((w) => w.indexOf('未被当前引擎组合声明') >= 0), '应有未声明提醒');
    assert(rb.warnings.some((w) => w.indexOf('重复') >= 0), '应有重复提醒');
    assert(rb.warnings.some((w) => w.indexOf('缺少 key') >= 0), '应有缺key提醒');
    assert(rb.warnings.some((w) => w.indexOf('无法识别') >= 0), '应有type提醒');

    // 3) 父路径命中：声明 step.x 时参数 key 'step' 应视为有效
    const parent = { id: 'y', name: 'y', transform: 'declarative', options: {}, params: [{ key: 'step', label: '嵌套', type: 'text' }] };
    assert(sanitizePresetParams(parent).warnings.length === 0, '父路径 key 不应报未声明');

    // 4) effects. 前缀参数不参与引擎声明校验；无 composition 的预设跳过该检查
    const ef = { id: 'z', name: 'z', transform: 'none', options: {}, params: [{ key: 'effects.rotate.z', label: 'e', type: 'number' }] };
    assert(sanitizePresetParams(ef).warnings.length === 0, 'effects. 前缀不应报未声明');

    // 5) filterOptionsByKeys：父路径保留、未声明丢弃
    const fo = filterOptionsByKeys({ step: { x: 1, y: 2 }, foo: 3, color: '#fff' }, ['step.x', 'step.y', 'color']);
    assert(fo.step && fo.step.x === 1 && fo.color === '#fff' && fo.foo === undefined, 'filterOptionsByKeys 行为不对: ' + JSON.stringify(fo));

    // 6) activeEngineParamKeys 覆盖跨阶段共享参数
    const ak = activeEngineParamKeys(COMPOSITIONS['declarative']);
    assert(ak.indexOf('step.time') >= 0 && ak.indexOf('step.x') >= 0 && ak.indexOf('highlight.enabled') >= 0, 'declarative 组合参数声明不全: ' + ak.join(','));

    // 6.5) ownsForComposition 与 TRANSFORM_OWNS 一致性：内置预设的 composition 推导应等于 transform 默认
    Object.keys(TRANSFORM_OWNS).forEach((tf) => {
        const comp = COMPOSITIONS[tf];
        if (!comp) return;   // 'none' 无 composition
        const derived = ownsForComposition(comp).sort().join(',');
        const expected = TRANSFORM_OWNS[tf].sort().join(',');
        assert(derived === expected, tf + ' 接管推导不一致：composition=' + derived + ' vs transform=' + expected);
    });

    // 7) 草稿还原：合法草稿还原、坏引擎名重置
    const draft = loadSavedDevDraft();
    assert(draft === null, '无存档时应返回 null');
    try { localStorage.setItem('cf_sub_devDraft', JSON.stringify({ split: 'words', layout: 'vertical', options: { widthMode: 'uniform' }, previewText: 'hi' })); } catch (e) {}
    const d2 = loadSavedDevDraft();
    assert(d2 && d2.split === 'words' && d2.layout === 'vertical' && d2.previewText === 'hi', '草稿应正确还原');
    assert(d2.options.widthMode === 'uniform', '草稿 options 应保留激活引擎声明过的值');
    try { localStorage.setItem('cf_sub_devDraft', JSON.stringify({ split: 'not-exist', layout: 'nope' })); } catch (e) {}
    assert(loadSavedDevDraft() === null, '引擎名全部无效时应返回 null');

    // 8) 导出元信息：presetsToExport 保留 author、空值不写入；内部字段（_origOptions 等）不外泄
    const withAuthor = { id: 'a1', name: 'A', transform: 'none', options: {}, params: [], author: '测试君(123)', _origOptions: { secret: 1 } };
    const exp1 = presetsToExport([withAuthor])[0];
    assert(exp1.author === '测试君(123)', 'presetsToExport 应保留 author');
    assert(!('_origOptions' in exp1), '内部字段不应导出');
    const noAuthor = { id: 'a2', name: 'B', transform: 'none', options: {}, params: [], author: '' };
    assert(!('author' in presetsToExport([noAuthor])[0]), 'author 为空时导出不带该字段');

    // 9) 署名兜底：无 cookie 环境下 getAcfunAuthor 不抛错、返回字符串（真实昵称+uid 靠浏览器验证）
    assert(typeof getAcfunAuthor() === 'string', 'getAcfunAuthor 应返回字符串');

    console.log('冒烟测试完成：全部通过');
`;

out = out.replace(/\}\)\(\);\s*$/, TEST + '\n})();');

const sandbox = {
    console,
    process,
    document: {
        readyState: 'loading',
        addEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        createElement() { return { style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, setAttribute() {}, remove() {} }; },
    },
    localStorage: { _m: {}, getItem(k) { return this._m[k] == null ? null : this._m[k]; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } },
    setTimeout, clearTimeout, setInterval, clearInterval,
};
sandbox.window = sandbox;
sandbox.unsafeWindow = sandbox;
vm.createContext(sandbox);
vm.runInContext(out, sandbox, { filename: 'bundle.js' });
