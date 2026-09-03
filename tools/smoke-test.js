// 冒烟测试：把 src 拼接后在 IIFE 作用域内注入测试代码，验证引擎/预设相关纯逻辑
// 用法：node tools/smoke-test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FILES = [
    '00-header.js', '10-constants.js', '20-utils.js', '30-parser.js', '40-core.js',
    '50-engine.js', '60-network.js', '70-preview.js', '71-canvas-preview.js', '80-ui.js', '85-danmaku.js',
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

    // 10) parseColor：尾随 & 是 libass 合法写法，不应静默变白
    assert(parseColor('&H000000FF') === 0xff0000, 'parseColor 红: ' + parseColor('&H000000FF'));
    assert(parseColor('&H000000FF&') === 0xff0000, 'parseColor 尾随& 应仍为红: ' + parseColor('&H000000FF&'));
    assert(parseColor('&H00FF00&') === 0x00ff00, 'parseColor 尾随& 绿');
    assert(parseColor('&HZZZZZZ') === 0xffffff, 'parseColor 非法回落白');
    assert(parseColor('') === 0xffffff && parseColor(null) === 0xffffff, 'parseColor 空/null 回落白');

    // 11) parseSub：SRT 多行保留、ASS 多行 \N 保留全部行、LRC 双语
    const NL = String.fromCharCode(10);
    const BS = String.fromCharCode(92);
    const srt = ['1', '00:00:01,000 --> 00:00:03,000', '第一行', '第二行'].join(NL);
    const sr = parseSub(srt, 'a.srt');
    assert(sr.length === 1 && sr[0].text === '第一行' + NL + '第二行', 'SRT 多行应保留');

    const ass = ['[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,' + '第一行' + BS + 'N' + '第二行'
    ].join(NL);
    const ar = parseSub(ass, 'a.ass');
    assert(ar.length === 1 && ar[0].text === '第一行' + NL + '第二行', 'ASS 多行 \\N 应保留全部行: ' + JSON.stringify(ar[0] && ar[0].text));

    const lr = parseSub('[00:01.00]中文 / English', 'a.lrc');
    assert(lr.length === 1 && lr[0].main === '中文' && lr[0].sub === 'English', 'LRC 双语拆分');

    // 12) expandSub：KTV 20 字展开 40 条（底层+主层）
    const savedPreset = activePresetId;
    activePresetId = 'karaoke';
    const ksub = { time: 1000, text: '一二三四五六七八九十一二三四五六七八九十' };
    const kcfg = Object.assign({}, currentStyleConfig);
    const kmodels = expandSub(ksub, kcfg, 3000, 1, null);
    assert(kmodels.length === 40, 'KTV 20 字应展开 40 条，实际 ' + kmodels.length);
    activePresetId = savedPreset;

    // 12.5) 内置预设描述与行为相符性：
    //   竖排字幕 desc「每句拆成单字纵向堆叠」—— 单字、同一 X 纵向递增
    activePresetId = 'vertical';
    const vModels = expandSub({ time: 1000, text: '竖排测试' }, currentStyleConfig, 3000, 1, null);
    assert(vModels.length === 4, '竖排 4 字应展开 4 条，实际 ' + vModels.length);
    const vXs = new Set(vModels.map((m) => m.animationFrames[0].from.pos.x));
    const vYs = vModels.map((m) => m.animationFrames[0].from.pos.y);
    assert(vXs.size === 1, '竖排应同一 X（纵向），实际 ' + [...vXs].join(','));
    assert(vYs[0] < vYs[1] && vYs[1] < vYs[2] && vYs[2] < vYs[3], '竖排应 Y 递增（自上而下）: ' + vYs.join(','));
    //   KTV 唱词 desc「逐字扫光，唱到的字变亮」—— 底层 + 主层两层（扫光）
    activePresetId = 'karaoke';
    const k2 = expandSub({ time: 1000, text: '一二' }, currentStyleConfig, 3000, 1, null);
    assert(k2.length === 4, 'KTV 2 字应展开 4 条（每字两层），实际 ' + k2.length);
    assert(k2.every((m) => m.wordStyle.color), 'KTV 各层应有颜色');
    activePresetId = savedPreset;

    // 13) calcDurationMs：endTime 优先、相邻反推、末尾默认
    subs = [
        { time: 0, endTime: 2000, text: 'a' },
        { time: 3000, text: 'b' },
        { time: 4000, text: 'c' },
    ];
    assert(calcDurationMs(0) === 2000, 'calcDurationMs endTime 优先');
    assert(calcDurationMs(1) === 1000, 'calcDurationMs 相邻反推');
    assert(calcDurationMs(2) === DEFAULT_DURATION, 'calcDurationMs 末尾默认');
    subs = [];

    // 14) interpolateModel：线性/缓动/多段插值
    const frm = (fx, fy, tx, ty, fn, mt) => ({ from: { pos: { x: fx, y: fy, z: 1 }, scale: { x: 1, y: 1, z: 1 }, rotate: { x: 0, y: 0, z: 0 } }, to: { pos: { x: tx, y: ty, z: 1 }, scale: { x: 2, y: 2, z: 1 }, rotate: { x: 0, y: 0, z: 90 } }, timingFunction: fn, moveTime: mt });
    const im = interpolateModel({ animationFrames: [frm(0, 0, 100, 50, 'linear', 1000)] }, 500);
    assert(im.x === 50 && im.y === 25 && im.scaleX === 1.5 && im.rotateZ === 45, '线性插值中点: ' + JSON.stringify(im));
    assert(interpolateModel({ animationFrames: [frm(0, 0, 100, 0, 'linear', 1000)] }, 0).x === 0, '起点');
    assert(interpolateModel({ animationFrames: [frm(0, 0, 100, 0, 'linear', 1000)] }, 1000) === null, '终点后不可见');
    assert(interpolateModel({ animationFrames: [frm(0, 0, 100, 0, 'linear', 1000)] }, -1) === null, '负时间不可见');
    const imEase = interpolateModel({ animationFrames: [frm(0, 0, 100, 0, 'ease-in', 1000)] }, 500);
    assert(imEase.x === 25, 'ease-in 0.5→0.25: ' + imEase.x);
    const imMulti = interpolateModel({ animationFrames: [frm(0, 0, 50, 0, 'linear', 1000), frm(50, 0, 100, 0, 'linear', 1000)] }, 1500);
    assert(imMulti.x === 75, '多段第二段插值: ' + imMulti.x);

    // 14.5) easeProgress cubic-bezier：TIMING_FUNCS 里 24 个 cubic-bezier 字符串需正确求解
    assert(easeProgress(0.5, 'cubic-bezier(0.5,0,0.5,1)') === 0.5, 'cubic-bezier 中点应为 0.5: ' + easeProgress(0.5, 'cubic-bezier(0.5,0,0.5,1)'));
    assert(easeProgress(0, 'cubic-bezier(0.6,0.04,0.98,0.335)') === 0, 'cubic-bezier 起点 0');
    assert(easeProgress(1, 'cubic-bezier(0.6,0.04,0.98,0.335)') === 1, 'cubic-bezier 终点 1');
    assert(easeProgress(0.5, 'cubic-bezier(0.55,0.085,0.68,0.53)') < 0.5, '二次缓入中点应 < 0.5');
    const backEase = easeProgress(0.5, 'cubic-bezier(0.175,0.885,0.32,1.275)');
    assert(typeof backEase === 'number' && !isNaN(backEase), '回退缓动应返回数值');

    // 14.55) bezier 平缓区回归：cubic-bezier(1,0,0,1) 导数在 u=0.5 处为 0，牛顿一步出界发散，需二分兜底
    // 对独立二分参考逐点对比（含 t=0.49/0.51 两个平缓区触发点）
    const refSolve = (t, x1, x2) => {
        let lo = 0, hi = 1;
        for (let i = 0; i < 60; i++) {
            const mid = (lo + hi) / 2;
            if (cubicBezierXY(mid, x1, x2) < t) lo = mid; else hi = mid;
        }
        return (lo + hi) / 2;
    };
    // 容差 1e-4：牛顿收敛判据是 x 域 1e-6，映射到 y 域可达 ~3e-6；
    // 平坦曲线 (1,0,0,1) 在 u=0.5 处三重平坦，会把 t 的浮点噪声放大到同量级。
    // 回归目标是挡住修复前 ~0.3 级的发散，1e-4 仍有 3000 倍余量。
    for (const t of [0.2, 0.49, 0.5, 0.51, 0.8]) {
        const expect = cubicBezierXY(refSolve(t, 1, 0), 0, 1);
        const got = easeProgress(t, 'cubic-bezier(1,0,0,1)');
        assert(Math.abs(got - expect) < 1e-4, '14.55 平缓区 t=' + t + ' 应精确: got=' + got + ' expect=' + expect);
    }
    // 全部 TIMING_FUNCS 曲线 vs 独立二分参考的精度扫描
    const cbFns = [];
    const collectCb = (o) => { for (const k in o) { const v = o[k]; if (typeof v === 'string' && v.indexOf('cubic-bezier') === 0) cbFns.push(v); else if (v && typeof v === 'object') collectCb(v); } };
    collectCb(TIMING_FUNCS);
    for (const fn of cbFns) {
        const inner = fn.slice(fn.indexOf('(') + 1, fn.lastIndexOf(')'));
        const nums = inner.split(',').map(Number);
        for (let t = 0.05; t <= 0.95; t += 0.05) {
            const expect = cubicBezierXY(refSolve(t, nums[0], nums[2]), nums[1], nums[3]);
            const got = easeProgress(t, fn);
            assert(Math.abs(got - expect) < 1e-4, '14.55 ' + fn + ' t=' + t.toFixed(2) + ' 偏差过大: got=' + got + ' expect=' + expect);
        }
    }

    // 14.6) PIPELINE_HOOKS：默认注册跨句分栏（layout 后）+ 跨句衔接（timing 后）
    assert(PIPELINE_HOOKS.length === 2, '默认应注册 2 个钩子，实际 ' + PIPELINE_HOOKS.length);
    assert(PIPELINE_HOOKS.some((h) => h.after === 'layout' && h.apply === applySeqOffset), '应注册 layout 后跨句分栏钩子');
    assert(PIPELINE_HOOKS.some((h) => h.after === 'timing' && h.apply === applyBaseAdvance), '应注册 timing 后跨句衔接钩子');

    // 14.7) buildModel 显式收 effects：传 effects 生效，不传回落 advancedConfig
    const mEff = buildModel({ time: 1000, text: '测试' }, currentStyleConfig, 3000, { zIndex: 99, rotate: { x: 10, y: 20, z: 30 } });
    assert(mEff.zIndex === 99 && mEff.rotate.z === 30, 'buildModel 应使用显式传入的 effects');
    const mDef = buildModel({ time: 1000, text: '测试' }, currentStyleConfig, 3000, null);
    assert(mDef.zIndex === DEFAULT_ZINDEX, 'buildModel 无 effects 时回落 advancedConfig 默认层级');

    // 14.8) buildAnimationFrames 纯函数 + motion 'advanced' 引擎透传
    const advB = { scale: { x: 1, y: 1, z: 1 }, rotate: { x: 0, y: 0, z: 0 } };
    const cfgB = { posX: 50, posY: 85, moveTime: 3000 };
    const afDef = buildAnimationFrames(null, cfgB, advB, 3000);
    assert(afDef.length === 1 && afDef[0].from.pos.x === 50 && afDef[0].from.pos.y === 85 && afDef[0].moveTime === 3000, '默认单段 + 坐标/moveTime 回落');
    const afExp = buildAnimationFrames([{ fromX: 10, fromY: 20, toX: 90, toY: 80, moveTime: 500, timingFunction: 'ease-in' }], cfgB, advB, 3000);
    assert(afExp[0].from.pos.x === 10 && afExp[0].to.pos.y === 80 && afExp[0].moveTime === 500 && afExp[0].timingFunction === 'ease-in', '显式坐标/moveTime/缓动');
    const mvAdv = [{ fromX: 5, fromY: 6, toX: 7, toY: 8, moveTime: 500 }];
    const ly = ENGINES.motion['advanced'].apply([{ text: '甲' }], { moves: mvAdv });
    assert(ly[0].moves === mvAdv, 'motion advanced 应写 l.moves');
    const mMv = buildModel({ time: 1000, text: '测试' }, currentStyleConfig, 3000, null, mvAdv);
    assert(mMv.animationFrames[0].from.pos.x === 5 && mMv.animationFrames[0].to.pos.x === 7, 'buildModel 应用显式 moves');

    // 14.9) motion 效果引擎：bounce/pop/spin/slide 生成正确 moves
    const mctx = { cfg: { posX: 50, posY: 80 }, dur: 1000 };
    const bounce = ENGINES.motion['bounce'].apply([{ text: '甲' }], { bounce: { height: 10, times: 2 } }, mctx);
    assert(bounce[0].moves.length === 4, 'bounce 2 次应 4 段');
    assert(bounce[0].moves[0].toY === 70 && bounce[0].moves[0].fromY === 80, 'bounce 第一段向上');
    assert(bounce[0].moves[2].toY === 75, 'bounce 幅度逐次衰减（第2跳峰值 75 > 第1跳 70）');
    const pop = ENGINES.motion['pop'].apply([{ text: '甲' }], { pop: { overshoot: 0.2 } }, mctx);
    assert(pop[0].moves.length === 2 && pop[0].moves[0].toScaleX === 1.2 && pop[0].moves[1].toScaleX === 1, 'pop 过冲回弹');
    const spin = ENGINES.motion['spin'].apply([{ text: '甲' }], { spin: { turns: 2, direction: 'cw' } }, mctx);
    assert(spin[0].moves.length === 1 && spin[0].moves[0].toRotateZ === 720, 'spin 2 圈 = 720°');
    const slide = ENGINES.motion['slide'].apply([{ text: '甲' }], { slide: { from: 'right' } }, mctx);
    assert(slide[0].moves.length === 1 && slide[0].moves[0].fromX === 110 && slide[0].moves[0].toX === 50, 'slide 从右滑入');

    // 14.10) 布局 + 效果组合：效果引擎用每层布局位置，不覆盖布局（vertical/grid 逐字位置不被收拢）
    const layered = [{ text: '甲', posX: 10, posY: 30 }, { text: '乙', posX: 90, posY: 30 }];
    const bL = ENGINES.motion['bounce'].apply(layered, { bounce: { height: 10, times: 1 } }, { cfg: { posX: 50, posY: 80 }, dur: 1000 });
    assert(bL[0].moves[0].fromX === 10 && bL[0].moves[0].fromY === 30, 'bounce 用第1层布局位置');
    assert(bL[1].moves[0].fromX === 90 && bL[1].moves[0].fromY === 30, 'bounce 用第2层布局位置');
    const sL = ENGINES.motion['slide'].apply(layered, { slide: { from: 'left' } }, { cfg: { posX: 50, posY: 80 }, dur: 1000 });
    assert(sL[0].moves[0].toX === 10 && sL[1].moves[0].toX === 90, 'slide 终点用每层布局位置');
    const pL = ENGINES.motion['pop'].apply(layered, { pop: { overshoot: 0.1 } }, { cfg: { posX: 50, posY: 80 }, dur: 1000 });
    assert(pL[0].moves[0].fromX === undefined && pL[0].moves[0].fromY === undefined, 'pop 坐标应为空（回落每层位置）');

    // 14.11) 时长溢出：bounce 自动减次数、pop 短时长单段；slide 起点按锚点列
    const bShort = ENGINES.motion['bounce'].apply([{ text: '甲' }], { bounce: { height: 10, times: 3 } }, { cfg: { posX: 50, posY: 80 }, dur: 200 });
    assert(bShort[0].moves.length === 2, 'bounce dur=200 应减到 1 次（2 段）');
    const pShort = ENGINES.motion['pop'].apply([{ text: '甲' }], { pop: { overshoot: 0.1 } }, { cfg: { posX: 50, posY: 80 }, dur: 150 });
    assert(pShort[0].moves.length === 1, 'pop dur<200 应单段');
    const sA0 = ENGINES.motion['slide'].apply([{ text: '甲' }], { slide: { from: 'left' } }, { cfg: { posX: 50, posY: 80, anchor: 0 }, dur: 1000 });
    assert(sA0[0].moves[0].fromX === -15, 'slide anchor=0(col=0) left 起点 = -(w+m): ' + sA0[0].moves[0].fromX);
    const sA2 = ENGINES.motion['slide'].apply([{ text: '甲' }], { slide: { from: 'left' } }, { cfg: { posX: 50, posY: 80, anchor: 2 }, dur: 1000 });
    assert(sA2[0].moves[0].fromX === -5, 'slide anchor=2(col=2) left 起点 = -m: ' + sA2[0].moves[0].fromX);

    // 14.12) isCharSplitComposition：拆字 + 逐字延迟/扫光才判拆发（供弹幕规范提示用）
    assert(isCharSplitComposition({ split: 'chars', timing: 'stagger' }) === true, 'chars+stagger 应判拆发');
    assert(isCharSplitComposition({ split: 'words', timing: 'sweep' }) === true, 'words+sweep 应判拆发');
    assert(isCharSplitComposition({ split: 'none', timing: 'stagger' }) === false, 'none 不拆发');
    assert(isCharSplitComposition({ split: 'chars', timing: 'uniform' }) === false, 'uniform 不拆发');
    assert(isCharSplitComposition(null) === false, 'null 不拆发');

    // 14.13) applySeqOffset：dualDir 决定默认偏移方向（上下分栏下移、左右分栏右移）
    const mkFrag = () => [{ posX: 50, posY: 50 }];
    const rV = applySeqOffset(mkFrag(), { dualDir: 'vertical' }, { seq: 2, advanceable: false });
    assert(rV[0].posY === 58 && rV[0].posX === 50, 'vertical 默认下移 8: ' + JSON.stringify(rV[0]));
    const rH = applySeqOffset(mkFrag(), { dualDir: 'horizontal' }, { seq: 2, advanceable: false });
    assert(rH[0].posX === 58 && rH[0].posY === 50, 'horizontal 默认右移 8: ' + JSON.stringify(rH[0]));
    const rO = applySeqOffset(mkFrag(), { dualDir: 'vertical', dualX: 5 }, { seq: 2, advanceable: false });
    assert(rO[0].posX === 55 && rO[0].posY === 50, '手填 dualX 覆盖默认方向: ' + JSON.stringify(rO[0]));

    // 15) sendDanmaku 取消路径：中途取消返回部分发送（sent<total），不再误报整句完成
    (async () => {
        try {
            const origSendModel = sendModel;
            const origExpandSub = expandSub;
            const savedSubs = subs;
            const fakeModels = [{ content: 'a' }, { content: 'b' }, { content: 'c' }, { content: 'd' }, { content: 'e' }];
            expandSub = function () { return fakeModels.slice(); };
            subs = [{ time: 1000, text: '甲' }];

            // 15a) 第 3 条发送后取消：应返回 {sent:3, total:5}
            let cancelAt = 3, calls = 0;
            sendModel = async function () { calls++; if (cancelAt && calls >= cancelAt) cancelled = true; return true; };
            cancelled = false;
            const r1 = await sendDanmaku(subs[0], {}, 1, null);
            assert(r1 && r1.sent === 3 && r1.total === 5, '15a 中途取消应返回 {sent:3,total:5}，实际 ' + JSON.stringify(r1));

            // 15b) 不取消：全部发送
            cancelAt = 0; calls = 0;
            cancelled = false;
            const r2 = await sendDanmaku(subs[0], {}, 1, null);
            assert(r2 && r2.sent === 5 && r2.sent === r2.total, '15b 不取消应全部发送，实际 ' + JSON.stringify(r2));

            // 15c) 开头即取消：sent=0
            cancelAt = 0; calls = 0;
            cancelled = true;
            const r3 = await sendDanmaku(subs[0], {}, 1, null);
            assert(r3 && r3.sent === 0 && r3.total === 5, '15c 开头即取消应 sent=0，实际 ' + JSON.stringify(r3));

            // 15d) sendModel 抛错应向上抛出（维持原有失败路径）
            cancelAt = 0; calls = 0;
            cancelled = false;
            sendModel = async function () { throw new Error('boom'); };
            let threw = false;
            try { await sendDanmaku(subs[0], {}, 1, null); } catch (e) { threw = true; }
            assert(threw, '15d sendModel 抛错应向上抛');

            sendModel = origSendModel;
            expandSub = origExpandSub;
            cancelled = false;
            subs = savedSubs;
            console.log('冒烟测试完成：全部通过');
        } catch (e) {
            console.error('FAIL: 15) sendDanmaku 探针异常 ' + e.message);
            process.exitCode = 1;
        }
    })();
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
