    // ============================================================
    //  预设引擎：把一条字幕按激活预设展开成多个弹幕 model
    // ============================================================

    function getAllPresets() { return BUILTIN_PRESETS.concat(customPresets); }
    function getActivePreset() {
        return getAllPresets().find((p) => p.id === activePresetId) || BUILTIN_PRESETS[0];
    }

    // 初始化预设：只合并「已主动保存」的微调 options（自定义预设不持久化，刷新后需重新导入）
    function initPresets() {
        getAllPresets().forEach(applySavedOptions);
    }

    // 用 config 生成 model，但用伪字幕覆盖时间与文本
    function modelFrom(cfg, text, timeMs, durationMs) {
        return buildModel({ time: timeMs, text: text }, cfg, durationMs);
    }

    // 智能分词：
    //   - 中文、日文假名、韩文、全角符号 → 按单字拆
    //   - 字母/数字连续串 → 按整词拆（覆盖英/法/德/西/葡/越南/俄/希腊）
    //   - 半角标点（, . ! ? ' " 等）→ 贴附到前一个 token，不单独占宽
    // 宽度用 canvas 实测（传入 fontSize/fontFamily），中文单字为基准 1。
    // 返回 [{ text, w }]，w 为相对宽度（相对于一个中文全角字）。
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

    function tokenize(text, fontSize, fontFamily) {
        const fs = fontSize || 24;
        const ff = fontFamily || 'SimHei';
        // 单字（全宽字符）：中日韩 + 日文假名 + 韩文 + 全角标点/符号
        const CJK_RE = /^[一-鿿぀-ヿ가-힣　-〿＀-￯]$/;
        const WORD_RE = /^[A-Za-z0-9À-ɏḀ-ỿЀ-ӿͰ-Ͽ]+$/;
        const raw = [];
        const re = /[一-鿿぀-ヿ가-힣　-〿＀-￯]|[A-Za-z0-9À-ɏḀ-ỿЀ-ӿͰ-Ͽ]+|[^\s]/g;
        let m;
        while ((m = re.exec(text))) {
            const t = m[0];
            raw.push({ text: t, isWord: WORD_RE.test(t), isCJK: CJK_RE.test(t) });
        }
        // 后处理：半角标点贴到前一个 token
        const out = [];
        for (const tok of raw) {
            if (!tok.isWord && !tok.isCJK && out.length) {
                out[out.length - 1].text += tok.text;
            } else {
                out.push({ text: tok.text, w: 1 });
            }
        }
        // 以单个全角字（"国"）为基准，计算每个 token 的相对宽度
        const unit = measureTextPx('国', fs, ff) || fs;
        for (const t of out) {
            t.w = Math.max(0.3, measureTextPx(t.text, fs, ff) / unit);
        }
        return out;
    }

    const TRANSFORMS = {
        // 竖排：拆单字纵向堆叠
        'chars-vertical'(sub, cfg, dur, o) {
            const chars = Array.from((sub.text || '').trim());
            if (!chars.length) return [];
            const gap = num(o.gap, 1.8);
            const delay = num(o.charDelay, 60);
            const sx = num(o.startX, 50);
            const sy = num(o.startY, 72);
            const down = o.direction !== 'up';
            const out = [];
            chars.forEach((ch, i) => {
                const c = Object.assign({}, cfg);
                c.posX = sx;
                c.posY = clamp(sy + (down ? i : -i) * gap, 1, 99);
                out.push(modelFrom(c, ch, sub.time + i * delay, dur));
            });
            return out;
        },

        // KTV：底层暗色铺开 + 亮色逐字扫光覆盖
        // layout: 'single' 单排 | 'dual' 双排（奇数句上行、偶数句下行，交替滚动）
        // 双排时：本句暗色层提前到「上一句开始时间」出现（覆盖上一句+本句），
        // 亮色层从本句开始扫光——形成“上一句在唱、下一句在下面等着”的卡拉OK效果。
        'chars-karaoke'(sub, cfg, dur, o, seq, prevTime) {
            const tokens = tokenize((sub.text || '').trim(), cfg.size, cfg.font);
            if (!tokens.length) return [];
            const cw = num(o.charWidth, 2.8);
            const sung = o.sungColor || KTV_SUNG_COLOR;
            const unsung = o.unsungColor || KTV_UNSUNG_COLOR;
            const perToken = Math.max(120, dur / tokens.length);

            const layout = o.layout || 'single';
            const isDual = layout === 'dual';
            let startX = num(o.startX, 8);
            let rowY = num(o.rowY, 78);
            if (isDual) {
                const topY = num(o.topY, 74);
                const bottomY = num(o.bottomY, 82);
                const startXTop = num(o.startXTop, num(o.startX, 8));
                const startXBottom = num(o.startXBottom, num(o.startX, 8));
                const isOdd = (seq != null) ? (seq % 2 === 1) : true;
                rowY = isOdd ? topY : bottomY;
                startX = isOdd ? startXTop : startXBottom;
            }

            let baseStart = sub.time;
            let baseDur = dur;
            if (isDual && prevTime != null && prevTime < sub.time) {
                baseStart = prevTime;
                baseDur = Math.round(dur + (sub.time - prevTime));
            }

            // 按实际宽度累加 X（英文词按字符数加权），避免中英间距不均
            const xs = [];
            let acc = 0;
            for (const t of tokens) { xs.push(startX + acc); acc += t.w * cw; }

            const out = [];
            tokens.forEach((tk, i) => {
                const c = Object.assign({}, cfg);
                c.posX = xs[i];
                c.posY = rowY;
                c.color = hexToRgb(unsung);
                out.push(modelFrom(c, tk.text, baseStart, baseDur));
            });
            tokens.forEach((tk, i) => {
                const c = Object.assign({}, cfg);
                c.posX = xs[i];
                c.posY = rowY;
                c.color = hexToRgb(sung);
                const t = sub.time + Math.round(i * perToken);
                const remain = Math.max(200, Math.round(dur - i * perToken));
                out.push(modelFrom(c, tk.text, t, remain));
            });
            return out;
        },

        // 多语：主字幕 + 第二语言字幕同屏两行
        'multi-lang'(sub, cfg, dur, o) {
            const out = [];
            const gap = num(o.langGap, 5);
            const mainColor = o.mainColor ? hexToRgb(o.mainColor) : cfg.color;
            const subColor = o.subColor ? hexToRgb(o.subColor) : 0xffd700;
            const mainY = num(o.mainY, 72);
            const subY = num(o.subY, mainY + gap);

            const c1 = Object.assign({}, cfg); c1.posY = mainY; c1.color = mainColor;
            out.push(modelFrom(c1, sub.text, sub.time, dur));

            // 找时间轴最近匹配的第二语言字幕
            const m2 = nearestSub2(sub.time);
            if (m2) {
                const c2 = Object.assign({}, cfg); c2.posY = subY; c2.color = subColor;
                out.push(modelFrom(c2, m2.text, m2.time, dur));
            }
            return out;
        },

        // ============================================================
        // 声明式 transform：由 JSON 的 rules 描述「如何把一句字幕拆成多个弹幕」
        // rules 结构：
        //   split    : chars | words | lines | none   —— 拆分方式
        //   flow     : row-first | col-first          —— 网格填充方向（先横后竖 / 先竖后横）
        //   columns  : 每行列数（默认 1）
        //   rows     : 每列行数（默认 1）
        //   step     : { x, y, time }                  —— 相邻片段的 X/Y 增量（屏幕 %）与时间增量（ms）
        //   base     : { x, y }                        —— 第一个片段的起点（屏幕 %）
        //   color    : 片段颜色（#rrggbb）
        //   highlight: { enabled, color, baseColor }   —— 逐字高亮（底层 baseColor 铺开 + 亮色 color 扫光）
        // ============================================================
        'declarative'(sub, cfg, dur, o, seq, prevTime) {
            const rules = o || {};
            const text = (sub.text || '').trim();
            let pieces = [];
            let weights = null;
            switch (rules.split) {
                case 'none': pieces = [text]; break;
                case 'lines': pieces = text.split(/\n/).filter(Boolean); break;
                case 'chars': case 'words': default: {
                    // chars / words 都走智能分词：中文按字、英文按词，带宽度权重
                    const toks = tokenize(text, cfg.size, cfg.font);
                    pieces = toks.map((t) => t.text);
                    weights = toks.map((t) => t.w);
                    break;
                }
            }
            if (!pieces.length) return [];

            const flow = rules.flow || 'row-first';
            const columns = Math.max(1, num(rules.columns, 1) | 0);
            const rows = Math.max(1, num(rules.rows, 1) | 0);
            const sx = num(rules.step && rules.step.x, 0);
            const sy = num(rules.step && rules.step.y, 0);
            const st = num(rules.step && rules.step.time, 0);
            const bx = num(rules.base && rules.base.x, 50);
            const by = num(rules.base && rules.base.y, 50);
            const color = rules.color ? hexToRgb(rules.color) : cfg.color;
            const hl = rules.highlight || {};
            const hlOn = !!hl.enabled;

            // 计算每个片段在网格中的行列与位置；智能分词时横向按宽度权重累加
            const place = (i) => {
                let r, c;
                if (flow === 'col-first') { r = i % rows; c = Math.floor(i / rows); }
                else { c = i % columns; r = Math.floor(i / columns); }
                let x;
                if (weights && flow === 'row-first') {
                    // row-first：该行内前 c 个 token 的宽度累计 × 间距
                    const rowStart = r * columns;
                    let acc = 0;
                    for (let k = rowStart; k < i; k++) acc += weights[k];
                    x = bx + acc * sx;
                } else {
                    x = bx + c * sx;
                }
                return {
                    x: clamp(x, 0, 100),
                    y: clamp(by + r * sy, 0, 100),
                    t: sub.time + Math.round(i * st),
                };
            };

            const out = [];
            // 底层（仅高亮模式）：全部片段用 baseColor，整句存活（双排可提前候场）
            if (hlOn) {
                const baseColor = hl.baseColor ? hexToRgb(hl.baseColor) : 0x9aa0a6;
                let baseStart = sub.time;
                let baseDur = dur;
                if (prevTime != null && prevTime < sub.time) { baseStart = prevTime; baseDur = Math.round(dur + (sub.time - prevTime)); }
                pieces.forEach((p, i) => {
                    const pos = place(i);
                    const c = Object.assign({}, cfg);
                    c.posX = pos.x; c.posY = pos.y; c.color = baseColor;
                    out.push(modelFrom(c, p, baseStart, baseDur));
                });
            }

            // 主体层：每个片段（高亮模式下为亮色扫光）
            const mainColor = hlOn ? (hl.color ? hexToRgb(hl.color) : 0xffd700) : color;
            pieces.forEach((p, i) => {
                const pos = place(i);
                const c = Object.assign({}, cfg);
                c.posX = pos.x; c.posY = pos.y; c.color = mainColor;
                if (hlOn) {
                    const remain = Math.max(200, Math.round(dur - i * st));
                    out.push(modelFrom(c, p, pos.t, remain));
                } else {
                    out.push(modelFrom(c, p, pos.t, dur));
                }
            });
            return out;
        },
    };

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

    // 把一条字幕展开成多个 model
    // seq 为该字幕在选中序列里的序号（从 1 起，供双排等跨句布局使用）
    // prevTime 为上一句的开始时间（ms），供双排 KTV 让下一句暗色层提前出现
    function expandSub(sub, cfg, durationMs, seq, prevTime) {
        // 双语 LRC：根据 bilingualMode 先归一化文本
        if (sub && sub.main != null && sub.sub != null) {
            if (bilingualMode === 'main' || bilingualMode === 'sub') {
                const text = bilingualMode === 'sub' ? sub.sub : sub.main;
                sub = Object.assign({}, sub, { text, main: null, sub: null });
            } else { // auto：上下两行
                return expandBilingual(sub, cfg, durationMs);
            }
        }

        const preset = getActivePreset();
        if (!preset || preset.transform === 'none' || !TRANSFORMS[preset.transform]) {
            return [buildModel(sub, cfg, durationMs)];
        }
        try {
            const models = TRANSFORMS[preset.transform](sub, cfg, durationMs, preset.options || {}, seq, prevTime);
            return models.length ? models : [buildModel(sub, cfg, durationMs)];
        } catch (e) {
            log('预设展开失败，回退原样', e);
            return [buildModel(sub, cfg, durationMs)];
        }
    }

    // 双语 LRC：主语言在上、副语言在下，副语言用金色区分
    function expandBilingual(sub, cfg, durationMs) {
        const baseY = num(cfg.posY, 72);
        const mainCfg = Object.assign({}, cfg);
        mainCfg.posY = clamp(baseY, 1, 94);
        const subCfg = Object.assign({}, cfg);
        subCfg.posY = clamp(baseY + 5, 1, 99);
        subCfg.color = 0xffd700;
        const m1 = buildModel({ time: sub.time, text: sub.main }, mainCfg, durationMs);
        const m2 = buildModel({ time: sub.time, text: sub.sub }, subCfg, durationMs);
        return [m1, m2];
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

