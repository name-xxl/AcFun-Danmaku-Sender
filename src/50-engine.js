    // ============================================================
    //  预设引擎：把一条字幕按激活预设展开成多个弹幕 model
    // ============================================================

    function getAllPresets() { return BUILTIN_PRESETS.concat(customPresets); }
    function getActivePreset() {
        return getAllPresets().find((p) => p.id === activePresetId) || BUILTIN_PRESETS[0];
    }

    // 激活预设是否自带 effects（高级字段）。UI 据此禁用高级编辑区。
    function activePresetHasEffects() {
        const preset = getActivePreset();
        return !!(preset && preset.effects);
    }
    // 当前生效的 effects 值：激活预设带 effects 用预设的，否则回落编辑器高级字段 advancedConfig。
    // 替代原先的全局缓存 activePresetEffects，避免「预览临时改全局再恢复」的污染。
    function currentEffects() {
        const preset = getActivePreset();
        return (preset && preset.effects) ? preset.effects : advancedConfig;
    }

    // 初始化预设：只合并「已主动保存」的微调 options（自定义预设不持久化，刷新后需重新导入）
    function initPresets() {
        getAllPresets().forEach(applySavedOptions);
    }

    // 用 config 生成 model，但用伪字幕覆盖时间与文本
    function modelFrom(cfg, text, timeMs, durationMs, effects) {
        return buildModel({ time: timeMs, text: text }, cfg, durationMs, effects);
    }

    // ============================================================
    //  文本拆分（Unicode 属性正则，覆盖中英日韩 + emoji + 所有字母数字）
    //  字符分类：
    //    'space' 空白（跳过） | 'word' 字母/数字（按词）
    //    'char' 中日韩/假名/韩文/emoji（按字） | 'punct' 标点/符号（贴附）
    //  宽度模式 widthMode：'uniform' 等宽 w=1 | 'actual' canvas 实测宽度
    // ============================================================
    let _measureCtx = null;
    function measureTextPx(text, fontSize, fontFamily) {
        try {
            if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
            _measureCtx.font = fontSize + 'px ' + (fontFamily || 'SimHei');
            return _measureCtx.measureText(text).width;
        } catch (e) {
            return text.length * fontSize;   // 兜底：按字符数估
        }
    }

    function charKind(t) {
        if (/^\s+$/u.test(t)) return 'space';
        if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Emoji_Presentation}]$/u.test(t)) return 'char';
        if (/^[\p{L}\p{Nd}]+$/u.test(t)) return 'word';
        return 'punct';
    }

    function calcW(text, fs, ff, unit, widthMode) {
        return (widthMode === 'actual') ? Math.max(0.3, measureTextPx(text, fs, ff) / unit) : 1;
    }

    // 按字拆：每个字符一个片段（英文按字母），空白跳过，标点单独
    function splitChars(text, fontSize, fontFamily, widthMode) {
        const fs = fontSize || 24;
        const ff = fontFamily || 'SimHei';
        const unit = measureTextPx('国', fs, ff) || fs;
        return Array.from(text)
            .filter((ch) => !/^\s+$/u.test(ch))
            .map((ch) => ({ text: ch, w: calcW(ch, fs, ff, unit, widthMode) }));
    }

    // 按词拆：中日韩/假名/韩文/emoji 按字，字母数字按词，标点贴附到前一个片段，空白跳过
    function splitWords(text, fontSize, fontFamily, widthMode) {
        const fs = fontSize || 24;
        const ff = fontFamily || 'SimHei';
        const unit = measureTextPx('国', fs, ff) || fs;
        const re = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Emoji_Presentation}]|(?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Emoji_Presentation}])[\p{L}\p{Nd}])+|[\s\S]/gu;
        const raw = [];
        let m;
        while ((m = re.exec(text))) {
            const t = m[0];
            if (/^\s+$/u.test(t)) continue;
            raw.push({ text: t, kind: charKind(t) });
        }
        const out = [];
        for (const tok of raw) {
            if (tok.kind === 'punct' && out.length) {
                out[out.length - 1].text += tok.text;
            } else {
                out.push(tok);
            }
        }
        for (const t of out) {
            t.w = calcW(t.text, fs, ff, unit, widthMode);
        }
        return out;
    }

    // ============================================================
    //  效果引擎：5 阶段管道（拆分 → 布局 → 着色 → 时序 → 运动）
    //  每个阶段一个「引擎库」，预设通过「组合」自由搭配各阶段引擎。
    //  每个引擎自带 { label 中文名, desc 说明, params 参数声明, apply 处理函数 }，
    //  开发面板据此自动渲染下拉 + 参数表单；新增效果 = 往对应阶段注册一个新引擎。
    //
    //  参数 key 命名约定（防扁平 options 键冲突）：
    //    新引擎的参数尽量带自己的前缀（如 'vertical.gap'）；只有刻意跨阶段联动的
    //    共享参数才用裸名（如 step.x/step.y/step.time 由布局+时序共用、
    //    dualDir/dualX/dualY 由布局+跨句分栏共用）。导入侧会校验并提醒未声明 key。
    //
    //  片段 fragment：拆分 + 布局的产物 { text, w?, posX?, posY?, lang?, time? }
    //  层 layer：着色 + 时序的产物 = fragment + { color, kind?, time?, duration? }
    //    kind: 'base'（底层）/ 'main'（主层），供扫光类时序区分
    // ============================================================

    const STAGES = [
        { key: 'split', label: '拆分' },
        { key: 'layout', label: '布局' },
        { key: 'color', label: '着色' },
        { key: 'timing', label: '时序' },
        { key: 'motion', label: '运动' },
    ];

    // 参数声明辅助：type 支持 number | select | color | checkbox | text
    const pnum = (key, label, min, max, step, def) => ({ key, label, type: 'number', min, max, step, default: def });
    const psel = (key, label, choices, def) => ({ key, label, type: 'select', choices, default: def });
    const pcol = (key, label, def) => ({ key, label, type: 'color', default: def });
    const pchk = (key, label, def) => ({ key, label, type: 'checkbox', default: def });
    const ptext = (key, label, def, placeholder) => ({ key, label, type: 'text', default: def, placeholder });

    // 解析逗号分隔的数字列表（用于「列X列表 / 行Y列表」等），空返回 null
    function parseNumList(s) {
        if (s == null || String(s).trim() === '') return null;
        const arr = String(s).split(',').map((v) => parseFloat(v.trim())).filter((v) => isFinite(v));
        return arr.length ? arr : null;
    }

    // 按点路径读参数（统一「扁平/嵌套」读法）：缺失或 null 回落到 def。
    // 数字参数再经 num() 归一；选择/字符串/颜色参数直接取 def。
    function pv(params, path, def) {
        const v = getByPath(params, path);
        return (v === undefined || v === null) ? def : v;
    }

    // 跨句分栏参数声明（供各布局引擎复用）：
    //   dualDir: none 单排/单列 | vertical 上下分栏 | horizontal 左右分栏（是否分栏 + 方向提示）
    //   dualX / dualY: 第二句（偶数句）相对第一句的 X/Y 偏移，独立可调（可上下、左右、对角）
    const DUAL_DIR_PARAMS = [
        psel('dualDir', '跨句分栏', [{ value: 'none', label: '不分栏' }, { value: 'vertical', label: '上下分栏' }, { value: 'horizontal', label: '左右分栏' }], 'none'),
        pnum('dualX', '次句偏移X', -100, 100, 1, 0),
        pnum('dualY', '次句偏移Y', -100, 100, 1, 0),
    ];

    // 宽度模式参数（供拆分引擎复用）：actual 实际宽度（紧凑）| uniform 等宽（整齐）
    const WIDTH_MODE_PARAM = psel('widthMode', '宽度模式', [{ value: 'actual', label: '实际宽度' }, { value: 'uniform', label: '等宽' }], 'actual');

    // 跨句分栏：第 1、3、5…句在原点，第 2、4、6…句偏移 (dualX, dualY)。
    // 在布局完成后调用；同时标记 ctx.advanceable = 是否跨句分栏。
    function applySeqOffset(frags, params, ctx) {
        const dualDir = pv(params, 'dualDir', 'none');
        if (dualDir === 'none') { ctx.advanceable = false; return frags; }
        const isEven = (ctx.seq != null) ? (ctx.seq % 2 === 0) : false;
        if (isEven) {
            const dx = num(pv(params, 'dualX'), 0);
            const dy = num(pv(params, 'dualY'), 0);
            frags.forEach((f) => {
                if (f.posX != null) f.posX += dx;
                if (f.posY != null) f.posY += dy;
            });
        }
        ctx.advanceable = true;
        return frags;
    }

    // 跨句衔接（独立步骤）：统一给「底层 base 层」设置时间。
    // 若跨句分栏 + 有上一句，底层提前到上一句开始时间并延长覆盖；否则底层本句常驻。
    // 与「时序类型」无关——扫光/高亮产生底层后，任何时序都能正确跨句候场。
    // （params 参数为钩子统一签名保留，本步骤不读取）
    function applyBaseAdvance(layers, params, ctx) {
        let baseStart = ctx.sub.time;
        let baseDur = ctx.dur;
        if (ctx.advanceable && ctx.prevTime != null && ctx.prevTime < ctx.sub.time) {
            baseStart = ctx.prevTime;
            baseDur = Math.round(ctx.dur + (ctx.sub.time - ctx.prevTime));
        }
        layers.forEach((l) => {
            if (l.kind === 'base') { l.time = baseStart; l.duration = baseDur; }
        });
        return layers;
    }

    // 着色：把一个片段的「暗色底 + 亮色主」两层结构抽出来，供扫光/声明式高亮复用
    function makeTwoLayer(frags, baseColor, mainColor) {
        const layers = [];
        frags.forEach((f) => { layers.push({ ...f, color: baseColor, kind: 'base' }); });
        frags.forEach((f) => { layers.push({ ...f, color: mainColor, kind: 'main' }); });
        return layers;
    }

    // 时序：把主层按 idx*delay 依次延后；decreasing=true 时每层时长递减（扫光），否则固定 ctx.dur（逐字延迟）
    function staggerMain(layers, ctx, delay, decreasing) {
        let idx = 0;
        layers.forEach((l) => {
            if (l.kind === 'base') return;
            l.time = ctx.sub.time + Math.round(idx * delay);
            l.duration = decreasing ? Math.max(200, Math.round(ctx.dur - idx * delay)) : ctx.dur;
            idx++;
        });
        return layers;
    }

    const ENGINES = {
        // 拆分：字幕文本 → 片段[]
        split: {
            'none': { label: '不拆', desc: '整句一条弹幕', params: [], apply(ctx) { return [{ text: ctx.text }]; } },
            'chars': { label: '按字拆', desc: '每个字符一个片段（英文按字母、emoji/日文/韩文按字）', params: [WIDTH_MODE_PARAM], apply(ctx, params) {
                return splitChars(ctx.text, ctx.cfg.size, ctx.cfg.font, pv(params, 'widthMode', 'actual'));
            } },
            'words': { label: '按词拆', desc: '中日韩/emoji 按字，字母数字按词，标点贴附', params: [WIDTH_MODE_PARAM], apply(ctx, params) {
                return splitWords(ctx.text, ctx.cfg.size, ctx.cfg.font, pv(params, 'widthMode', 'actual'));
            } },
            'lines': { label: '按行拆', desc: '每行一个片段', params: [], apply(ctx) { return ctx.text.split(/\n/).filter(Boolean).map((l) => ({ text: l, w: 1 })); } },
            'bilingual': { label: '双语', desc: '主字幕 + 第二语言字幕', params: [], apply(ctx) {
                const frags = [{ text: ctx.text, lang: 'main' }];
                const m2 = nearestSub2(ctx.sub.time);
                if (m2) frags.push({ text: m2.text, lang: 'sub', time: m2.time });
                return frags;
            } },
            'declarative': { hidden: true, label: '可配置拆分', desc: '按参数决定拆分方式（兼容声明式）', params: [
                psel('split', '拆分方式', [{ value: 'chars', label: '按字' }, { value: 'words', label: '按词' }, { value: 'lines', label: '按行' }, { value: 'none', label: '不拆' }], 'chars'),
            ], apply(ctx, params) {
                const s = pv(params, 'split', 'chars');
                if (s === 'none') return [{ text: ctx.text }];
                if (s === 'lines') return ctx.text.split(/\n/).filter(Boolean).map((l) => ({ text: l }));
                if (s === 'chars') return splitChars(ctx.text, ctx.cfg.size, ctx.cfg.font, 'actual');
                return splitWords(ctx.text, ctx.cfg.size, ctx.cfg.font, 'actual');
            } },
        },

        // 布局：片段[] → 片段[]（写入 posX/posY）
        layout: {
            'none': { label: '跟随样式', desc: '位置由样式区/位置 X/Y 决定', params: [], apply(frags) { return frags; } },
            'vertical': { label: '竖排', desc: '单字纵向堆叠；可跨句左右分栏', params: [
                psel('direction', '方向', [{ value: 'down', label: '向下' }, { value: 'up', label: '向上' }], 'down'),
                pnum('gap', '字距', 0.5, 6, 0.1, 1.8),
                pnum('startX', '起点X', 0, 100, 1, 50),
                pnum('startY', '起点Y', 0, 100, 1, 72),
                ...DUAL_DIR_PARAMS,
            ], apply(frags, params) {
                const gap = num(pv(params, 'gap'), 1.8);
                const sx = num(pv(params, 'startX'), 50);
                const sy = num(pv(params, 'startY'), 72);
                const down = pv(params, 'direction', 'down') !== 'up';
                frags.forEach((f, i) => { f.posX = sx; f.posY = clamp(sy + (down ? i : -i) * gap, 1, 99); });
                return frags;
            } },
            'horizontal': { label: '横排', desc: '从左到右按宽度累加；可跨句上下分栏', params: [
                pnum('charWidth', '字宽', 1.5, 6, 0.1, 2.8),
                pnum('startX', '起点X', 0, 100, 1, 8),
                pnum('rowY', '行Y', 0, 100, 1, 78),
                ...DUAL_DIR_PARAMS,
            ], apply(frags, params) {
                const cw = num(pv(params, 'charWidth'), 2.8);
                const startX = num(pv(params, 'startX'), 8);
                const rowY = num(pv(params, 'rowY'), 78);
                let acc = 0;
                frags.forEach((f) => { f.posX = startX + acc; f.posY = rowY; acc += (f.w || 1) * cw; });
                return frags;
            } },
            'grid': { label: '网格', desc: '按字数自动分栏：竖排每列、横排每行，字数根据屏幕空间自动算（0=自动）', params: [
                psel('flow', '流向', [{ value: 'col-first', label: '先竖后横' }, { value: 'row-first', label: '先横后竖' }], 'col-first'),
                pnum('span', '每行/列字数(0=自动)', 0, 20, 1, 0),
                pnum('step.x', '列间距X', 0, 50, 0.5, 0),
                pnum('step.y', '行间距Y', 0, 20, 0.1, 0),
                pnum('base.x', '起点X', 0, 100, 1, 50),
                pnum('base.y', '起点Y', 0, 100, 1, 50),
                ptext('colsX', '列X列表', '', '留空等距，如 40,46,52'),
                ptext('rowsY', '行Y列表', '', '留空等距，如 70,71.8'),
                ...DUAL_DIR_PARAMS,
            ], apply(frags, params) {
                const flow = pv(params, 'flow', 'col-first');
                const sx = num(pv(params, 'step.x'), 0);
                const sy = num(pv(params, 'step.y'), 0);
                const bx = num(pv(params, 'base.x'), 50);
                const by = num(pv(params, 'base.y'), 50);
                // 每行/列字数：填正数用固定值；0=自动按屏幕可用空间算（竖排看高度，横排看宽度）
                let span = num(pv(params, 'span'), 0) | 0;
                if (span <= 0) {
                    span = (flow === 'col-first')
                        ? Math.max(1, Math.floor((99 - by) / Math.max(sy, 0.1)) + 1)
                        : Math.max(1, Math.floor((99 - bx) / Math.max(sx, 0.1)) + 1);
                }
                const colsX = parseNumList(pv(params, 'colsX'));
                const rowsY = parseNumList(pv(params, 'rowsY'));
                const hasWeight = frags.some((f) => f.w != null);
                // col-first + 有宽度（智能分词）时，按「每列最大宽度」累加列起点，避免英文词比列间距宽而重叠
                let colStartX = null;
                if (!colsX && hasWeight && flow === 'col-first') {
                    const colMax = [];
                    frags.forEach((f, i) => { const c = Math.floor(i / span); colMax[c] = Math.max(colMax[c] || 0, f.w || 1); });
                    colStartX = colMax.map((_, c) => {
                        let acc = 0;
                        for (let k = 0; k < c; k++) acc += (colMax[k] || 1);
                        return bx + acc * sx;
                    });
                }
                frags.forEach((f, i) => {
                    let r, c;
                    if (flow === 'col-first') { r = i % span; c = Math.floor(i / span); }
                    else { c = i % span; r = Math.floor(i / span); }
                    let x;
                    if (colsX && colsX[c] != null) {
                        x = colsX[c];
                    } else if (colStartX) {
                        x = colStartX[c];
                    } else if (hasWeight && flow === 'row-first') {
                        const rowStart = r * span;
                        let acc = 0;
                        for (let k = rowStart; k < i; k++) acc += (frags[k].w || 1);
                        x = bx + acc * sx;
                    } else {
                        x = bx + c * sx;
                    }
                    const y = (rowsY && rowsY[r] != null) ? rowsY[r] : (by + r * sy);
                    f.posX = clamp(x, 0, 100);
                    f.posY = clamp(y, 0, 100);
                });
                return frags;
            } },
            'bilingual': { label: '上下两行', desc: '主行在上、副行在下', params: [
                pnum('langGap', '行间距', 0, 20, 1, 5),
                pnum('mainY', '主行Y', 0, 100, 1, 72),
            ], apply(frags, params) {
                const gap = num(pv(params, 'langGap'), 5);
                const mainY = num(pv(params, 'mainY'), 72);
                const subY = num(pv(params, 'subY'), mainY + gap);
                frags.forEach((f) => { f.posY = (f.lang === 'sub') ? subY : mainY; });
                return frags;
            } },
        },

        // 着色：片段[] → 层[]（写入 color；扫光类 1 片段 → 2 层，先底层后主层）
        color: {
            'single': { label: '单色', desc: '使用样式区颜色', params: [], apply(frags, params, ctx) { return frags.map((f) => ({ ...f, color: ctx.cfg.color })); } },
            'karaoke': { label: '扫光', desc: '底层暗色 + 亮色扫光（两层）', params: [
                pcol('sungColor', '唱到色', '#ffd700'),
                pcol('unsungColor', '待唱色', '#9aa0a6'),
            ], apply(frags, params) {
                const sung = hexToRgb(pv(params, 'sungColor', KTV_SUNG_COLOR));
                const unsung = hexToRgb(pv(params, 'unsungColor', KTV_UNSUNG_COLOR));
                return makeTwoLayer(frags, unsung, sung);
            } },
            'bilingual': { label: '双语双色', desc: '主行/副行不同色', params: [
                pcol('mainColor', '主色', '#ffffff'),
                pcol('subColor', '副色', '#ffd700'),
            ], apply(frags, params, ctx) {
                const mc = pv(params, 'mainColor', '');
                const sc = pv(params, 'subColor', '');
                const mainColor = mc ? hexToRgb(mc) : ctx.cfg.color;
                const subColor = sc ? hexToRgb(sc) : 0xffd700;
                return frags.map((f) => ({ ...f, color: (f.lang === 'sub') ? subColor : mainColor }));
            } },
            'declarative': { hidden: true, label: '单色/高亮', desc: '普通单色，或逐字高亮（两层）', params: [
                pcol('color', '文字色', '#ffffff'),
                pchk('highlight.enabled', '逐字高亮', false),
                pcol('highlight.color', '高亮色', '#ffd700'),
                pcol('highlight.baseColor', '底色', '#9aa0a6'),
            ], apply(frags, params, ctx) {
                const hl = pv(params, 'highlight', {});
                if (hl.enabled) {
                    const baseColor = hl.baseColor ? hexToRgb(hl.baseColor) : 0x9aa0a6;
                    const mainColor = hl.color ? hexToRgb(hl.color) : 0xffd700;
                    return makeTwoLayer(frags, baseColor, mainColor);
                }
                const c = pv(params, 'color', '');
                return frags.map((f) => ({ ...f, color: c ? hexToRgb(c) : ctx.cfg.color }));
            } },
        },

        // 时序：层[] → 层[]（只处理 main 主层；base 底层的时间由 applyBaseAdvance 统一跨句候场）
        timing: {
            'uniform': { label: '统一', desc: '所有层同一时刻出现', params: [], apply(layers, params, ctx) {
                layers.forEach((l) => {
                    if (l.kind === 'base') return;
                    l.time = (l.time != null) ? l.time : ctx.sub.time;
                    l.duration = ctx.dur;
                });
                return layers;
            } },
            'stagger': { label: '逐字延迟', desc: '主层依次延后出现', params: [
                pnum('charDelay', '逐字延迟(ms)', 0, 500, 10, 60),
            ], apply(layers, params, ctx) {
                return staggerMain(layers, ctx, num(pv(params, 'charDelay'), 60), false);
            } },
            'sweep': { label: '扫光时序', desc: '主层逐字递减（唱到哪亮到哪）', params: [
                pnum('step.time', '逐字步长(ms)', 0, 2000, 10, 0),
            ], apply(layers, params, ctx) {
                const mainCount = layers.filter((l) => l.kind !== 'base').length;
                // step.time 缺失 / null / ≤0 都视为「自动按 dur/字数 算」，
                // 避免清空输入框被写回 0 后扫光被静默关掉
                const raw = pv(params, 'step.time', null);
                const stepTime = (raw == null || num(raw, 0) <= 0)
                    ? Math.max(120, ctx.dur / Math.max(1, mainCount))
                    : num(raw, 0);
                return staggerMain(layers, ctx, stepTime, true);
            } },
            'declarative': { hidden: true, label: '声明式时序', desc: '逐字延迟，或高亮扫光', params: [
                pnum('step.time', '逐字延迟(ms)', 0, 500, 10, 0),
            ], apply(layers, params, ctx) {
                const hl = pv(params, 'highlight', {});
                const st = num(pv(params, 'step.time'), 0);
                return staggerMain(layers, ctx, st, !!hl.enabled);
            } },
        },

        // 运动：层[] → 层[]（写入运动参数；当前仅 none，未来扩展缩放/跳跳等）
        motion: {
            'none': { label: '静止', desc: '无额外运动', params: [], apply(layers) { return layers; } },
        },
    };

    // 组合：transform 名 → 各阶段引擎名（向后兼容旧的 transform 字段）
    const COMPOSITIONS = {
        'chars-vertical': { split: 'chars', layout: 'vertical', color: 'single', timing: 'stagger', motion: 'none' },
        'chars-karaoke': { split: 'words', layout: 'horizontal', color: 'karaoke', timing: 'sweep', motion: 'none' },
        'multi-lang': { split: 'bilingual', layout: 'bilingual', color: 'bilingual', timing: 'uniform', motion: 'none' },
        'declarative': { split: 'declarative', layout: 'grid', color: 'declarative', timing: 'declarative', motion: 'none' },
    };

    // 管道钩子：标准 5 阶段之间的跨句/后处理步骤。
    // 默认注册「跨句分栏」（布局后）与「跨句衔接」（时序后）两步；
    // 新增跨阶段处理只需向 PIPELINE_HOOKS 追加 { after, apply }，不必改 runPipeline 主体。
    const PIPELINE_HOOKS = [
        { after: 'layout', apply: applySeqOffset },
        { after: 'timing', apply: applyBaseAdvance },
    ];
    function runHooks(after, data, params, ctx) {
        for (const h of PIPELINE_HOOKS) {
            if (h.after === after) data = h.apply(data, params, ctx);
        }
        return data;
    }

    // 管道执行器：按组合依次跑 5 个阶段，产出 model[]
    // yOffset：给所有片段 posY 统一加一个偏移（双语 LRC 副语言下移用），0 表示不偏移
    function runPipeline(sub, cfg, durationMs, comp, params, seq, prevTime, yOffset, effects) {
        const ctx = { sub, cfg, dur: durationMs, seq, prevTime, text: (sub.text || '').trim(), advanceable: false };
        let frags = ENGINES.split[comp.split].apply(ctx, params);
        frags = ENGINES.layout[comp.layout].apply(frags, params, ctx);
        frags = runHooks('layout', frags, params, ctx);   // 跨句分栏等布局后钩子
        if (yOffset) {
            frags.forEach((f) => { if (f.posY != null) f.posY = clamp(f.posY + yOffset, 1, 99); });
        }
        let layers = ENGINES.color[comp.color].apply(frags, params, ctx);
        layers = ENGINES.timing[comp.timing].apply(layers, params, ctx);
        layers = runHooks('timing', layers, params, ctx);   // 跨句衔接等时序后钩子
        layers = ENGINES.motion[comp.motion].apply(layers, params, ctx);
        return layers.map((l) => {
            const c = Object.assign({}, cfg);
            if (l.posX != null) c.posX = l.posX;
            if (l.posY != null) c.posY = l.posY;
            if (l.color != null) c.color = l.color;
            return modelFrom(c, l.text, l.time, l.duration, effects);
        });
    }

    // 在第二语言字幕里找时间最接近的一条（阈值内）
    function nearestSub2(timeMs) {
        if (!subs2.length) return null;
        let best = null, bestDiff = Infinity;
        for (const s of subs2) {
            const d = Math.abs(s.time - timeMs);
            if (d < bestDiff) { bestDiff = d; best = s; }
        }
        return (best && bestDiff <= 1500) ? best : null;
    }

    // 跑管道并做安全回退：展开为空或抛错时回退为单条原样 model
    function safeRun(sub, cfg, durationMs, comp, options, seq, prevTime, yOffset, effects) {
        try {
            const models = runPipeline(sub, cfg, durationMs, comp, options || {}, seq, prevTime, yOffset, effects);
            return models.length ? models : [buildModel(sub, cfg, durationMs, effects)];
        } catch (e) {
            log('预设展开失败，回退原样', e);
            return [buildModel(sub, cfg, durationMs, effects)];
        }
    }

    // 把一条字幕展开成多个 model
    // seq 为该字幕在选中序列里的序号（从 1 起，供双排等跨句布局使用）
    // prevTime 为上一句的开始时间（ms），供双排 KTV 让下一句暗色层提前出现
    function expandSub(sub, cfg, durationMs, seq, prevTime) {
        const effects = currentEffects();
        // 双语 LRC：根据 bilingualMode 先归一化文本
        if (sub && sub.main != null && sub.sub != null) {
            if (bilingualMode === 'main' || bilingualMode === 'sub') {
                const text = bilingualMode === 'sub' ? sub.sub : sub.main;
                sub = Object.assign({}, sub, { text, main: null, sub: null });
            } else { // auto：上下两行，主/副语言都走当前预设管线
                return expandBilingual(sub, cfg, durationMs, seq, prevTime, effects);
            }
        }

        const preset = getActivePreset();
        const comp = preset ? (preset.composition || COMPOSITIONS[preset.transform]) : null;
        if (!preset || !comp) {
            return [buildModel(sub, cfg, durationMs, effects)];
        }
        return safeRun(sub, cfg, durationMs, comp, preset.options, seq, prevTime, 0, effects);
    }

    // 双语 LRC（auto）：主语言在上、副语言在下，副语言整体下移 LANG_GAP 并着金色。
    // 有激活预设时，主/副语言各自走一遍当前预设管线（竖排/KTV/声明式等都对双语生效）；
    // 无预设（组合为空）时回退为简单上下两行。
    function expandBilingual(sub, cfg, durationMs, seq, prevTime, effects) {
        const preset = getActivePreset();
        const comp = preset ? (preset.composition || COMPOSITIONS[preset.transform]) : null;
        if (!comp) {
            const baseY = num(cfg.posY, 72);
            const mainCfg = Object.assign({}, cfg);
            mainCfg.posY = clamp(baseY, 1, 94);
            const subCfg = Object.assign({}, cfg);
            subCfg.posY = clamp(baseY + 5, 1, 99);
            subCfg.color = 0xffd700;
            return [
                buildModel({ time: sub.time, text: sub.main }, mainCfg, durationMs, effects),
                buildModel({ time: sub.time, text: sub.sub }, subCfg, durationMs, effects),
            ];
        }
        const LANG_GAP = 5;
        const mainModels = safeRun({ time: sub.time, text: sub.main }, cfg, durationMs, comp, preset.options, seq, prevTime, 0, effects);
        const subModels = safeRun({ time: sub.time, text: sub.sub }, cfg, durationMs, comp, preset.options, seq, prevTime, LANG_GAP, effects);
        // 副语言整体着色为金色，与主语言区分
        subModels.forEach((m) => { m.wordStyle.color = rgbToHex(0xffd700); });
        return mainModels.concat(subModels);
    }

    function calcDurationMs(idx) {
        const s = subs[idx];
        if (!s) return DEFAULT_DURATION;
        // 优先用 SRT 里的真实结束时间（end - start），避免短句被最小 1000ms 拉长导致重叠
        if (s.endTime != null && s.endTime > s.time) {
            const dur = Math.round(s.endTime - s.time);
            return Math.max(200, Math.min(dur, 15000));
        }
        // 无 endTime 时：用下一句开始时间反推
        if (idx >= subs.length - 1) return DEFAULT_DURATION;
        const diff = subs[idx + 1].time - s.time;
        return Math.max(200, Math.min(Math.round(diff), 15000));
    }

    // 合并 ASS 单条样式到全局配置
    function cfgFor(sub) {
        const cfg = Object.assign({}, currentStyleConfig);
        // 编辑器样式模式：忽略 ASS 自带样式，全部使用编辑器设置
        if (styleSource !== 'ass') return cfg;
        // ASS 自带样式模式：单条样式覆盖编辑器默认值
        if (sub && sub.style) {
            const s = sub.style;
            if (s.font !== undefined && s.font) cfg.font = s.font;
            if (s.size !== undefined) cfg.size = s.size;
            if (s.color !== undefined) cfg.color = s.color;          // 黑色 0 也是合法值，不能用 truthy 判断
            if (s.bold !== undefined) cfg.bold = s.bold;
            if (s.stroke !== undefined) cfg.stroke = s.stroke;
            if (s.anchor !== undefined) cfg.anchor = s.anchor;
            if (s.shadow) cfg.shadow = true;
        }
        return cfg;
    }

