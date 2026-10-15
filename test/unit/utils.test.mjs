// 工具层单测（node --test）
//
// 覆盖 src/20-utils.js 里无 DOM 依赖的纯函数（$ / $$ / status 需要 DOM，不在这里覆盖）。
//
// 用法：npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ass2ms, escapeHtml, fmt, getByPath, hexToRgb, paramTarget, rgbToHex, setByPath, t2ms,
} from '../../src/20-utils.js';

// ---------------- 时间换算 ----------------

test('t2ms：SRT 逗号毫秒被接受', () => {
    assert.equal(t2ms('00:00:01,000'), 1000);
    assert.equal(t2ms('00:00:03,500'), 3500);
});

test('t2ms：点号毫秒与小时位', () => {
    assert.equal(t2ms('01:02:03.400'), 3723400);
    assert.equal(t2ms('00:00:00.000'), 0);
});

test('t2ms：毫秒位不足 3 位右补零', () => {
    assert.equal(t2ms('00:00:01.5'), 1500);     // .5 → 500
    assert.equal(t2ms('00:00:01.05'), 1050);    // .05 → 050
});

test('t2ms：无法解析返回 null', () => {
    assert.equal(t2ms('垃圾'), null);
    assert.equal(t2ms(''), null);
    assert.equal(t2ms(undefined), null);
});

test('ass2ms：ASS 的 1/100 秒', () => {
    assert.equal(ass2ms('0:00:01.00'), 1000);
    assert.equal(ass2ms('0:00:01.50'), 1500);
    assert.equal(ass2ms('0:00:00.05'), 50);
    assert.equal(ass2ms('1:00:00.00'), 3600000);
});

test('ass2ms：无法解析返回 null', () => {
    assert.equal(ass2ms('垃圾'), null);
    assert.equal(ass2ms(''), null);
});

test('fmt：毫秒 → hh:mm:ss.mmm', () => {
    assert.equal(fmt(1000), '00:00:01.000');
    assert.equal(fmt(3723400), '01:02:03.400');
    assert.equal(fmt(0), '00:00:00.000');
});

// ---------------- 颜色 ----------------

test('hexToRgb：带不带 # 都接受', () => {
    assert.equal(hexToRgb('#ff0000'), 0xff0000);
    assert.equal(hexToRgb('00ff00'), 0x00ff00);
    assert.equal(hexToRgb('#0000FF'), 0x0000ff);
});

test('hexToRgb：非法输入回退白色', () => {
    assert.equal(hexToRgb('xyz'), 0xffffff);
    assert.equal(hexToRgb(''), 0xffffff);
    assert.equal(hexToRgb(undefined), 0xffffff);
});

test('rgbToHex：与 hexToRgb 互逆', () => {
    assert.equal(rgbToHex(0xff0000), '#ff0000');
    assert.equal(rgbToHex(0x00ff00), '#00ff00');
    assert.equal(rgbToHex(0), '#000000');
    assert.equal(rgbToHex(0xffffff), '#ffffff');
    for (const n of [0x123456, 0xabcdef, 0x000001]) {
        assert.equal(hexToRgb(rgbToHex(n)), n);
    }
});

// ---------------- 点路径读写 ----------------

test('getByPath：单层与多层', () => {
    const o = { a: 1, step: { x: 5, y: 6 } };
    assert.equal(getByPath(o, 'a'), 1);
    assert.equal(getByPath(o, 'step.x'), 5);
    assert.equal(getByPath(o, 'step.y'), 6);
});

test('getByPath：路径不存在或入参为空返回 undefined', () => {
    assert.equal(getByPath({ a: 1 }, 'b.c'), undefined);
    assert.equal(getByPath(null, 'a'), undefined);
    assert.equal(getByPath({ a: 1 }, ''), undefined);
});

test('setByPath：自动建中间层级', () => {
    const o = {};
    setByPath(o, 'step.x', 5);
    setByPath(o, 'a.b.c', 1);
    assert.deepEqual(o, { step: { x: 5 }, a: { b: { c: 1 } } });
});

test('setByPath：单层直接写', () => {
    const o = { a: 1 };
    setByPath(o, 'a', 2);
    assert.equal(o.a, 2);
});

test('setByPath：非对象中间层被替换为对象', () => {
    const o = { step: 3 };
    setByPath(o, 'step.x', 1);
    assert.deepEqual(o.step, { x: 1 });
});

// ---------------- paramTarget ----------------

test('paramTarget：effects. 前缀指向 preset.effects', () => {
    const p = {};
    const t = paramTarget(p, 'effects.rotate.z');
    assert.equal(t.root, p.effects);
    assert.equal(t.path, 'rotate.z');
});

test('paramTarget：其余 key 指向 preset.options', () => {
    const p = {};
    const t = paramTarget(p, 'gap');
    assert.equal(t.root, p.options);
    assert.equal(t.path, 'gap');
});

test('paramTarget：返回的是本体引用（改动落到 preset 上）', () => {
    const p = {};
    setByPath(paramTarget(p, 'gap').root, paramTarget(p, 'gap').path, 42);
    assert.equal(p.options.gap, 42);
});

// ---------------- escapeHtml ----------------

test('escapeHtml：五个危险字符全部转义', () => {
    assert.equal(
        escapeHtml('<img src=x onerror="alert(1)">'),
        '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
    );
    assert.equal(escapeHtml("a'b&c"), 'a&#39;b&amp;c');
});

test('escapeHtml：null/undefined 变空串', () => {
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
    assert.equal(escapeHtml(0), '0');
});
