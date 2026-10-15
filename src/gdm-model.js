    // ============================================================
    //  弹幕模型层：构造（normalizeEffects / buildAnimationFrames / buildModel）+ 输出 lint（lintModel）
    // ============================================================
    // 理解卡｜我拥有：模型构造链——effects 规范化 → 运动帧 → model（与 A 站原生 getData 完全一致）；
    //   以及 lintModel（「闸② 输出 lint」的纯函数落点）。
    // 我承诺：四个导出全是纯函数——只读传入参数 + 40-core 的活绑定（timeOffset / advancedConfig），
    //   不写任何状态；lintModel 只报告不修改、坏输入也返回结果不抛错；判据逐条取自 API.md（出处写在规则旁）。
    // 我永不：碰 DOM（不 import 20-utils 的 $/document 一族）；不发网络请求；
    //   buildModel 不补 hack 字段（__seq/user 是 70-preview 的预览期补丁，正式发送的 model 不带）。
    // 改我前读：timeOffset / advancedConfig 必须【import 活绑定读取】——buildModel 读的是 40-core 的模块级
    //   状态，改成传参会波及所有调用点（行为风险）；40-core 不 re-export 本文件的任何名字（re-export 会成环，
    //   tools/check-deps.mjs 立即红）；坐标是 0–100 屏幕百分比（API.md §五 + §十二 T3/T5 实测），
    //   别按「0–1 相对坐标」改——那个口径是错的；lint 的缓动白名单不等于 85-danmaku 的 TIMING_FUNCS
    //   （28 项是子集），别把手写表单的选项表当完整白名单。

import {
    DEFAULT_MOVE_TIME, DEFAULT_POS_X, DEFAULT_POS_Y, DEFAULT_SHADOW_PLACEHOLDER, DEFAULT_ZINDEX,
} from './10-constants.js';
import { genId, rgbToHex } from './20-utils.js';
import { advancedConfig, clamp, normalizeFont, num, timeOffset } from './40-core.js';

    // 规范化 effects：补齐缺失字段，保证 buildModel 访问安全。
    // （moves 已收编进 motion 阶段引擎，不再作为 effects 字段）
    function normalizeEffects(ef) {
        const src = ef || {};
        return {
            zIndex: (src.zIndex != null) ? src.zIndex : DEFAULT_ZINDEX,
            rotate: { x: num(src.rotate && src.rotate.x, 0), y: num(src.rotate && src.rotate.y, 0), z: num(src.rotate && src.rotate.z, 0) },
            scale: { x: num(src.scale && src.scale.x, 1), y: num(src.scale && src.scale.y, 1), z: 1 },
            blur: num(src.blur, 0),
            shine: src.shine || null,
            shadow: src.shadow || null,
        };
    }

    // ============================================================
    //  模型构造（与 A 站原生 getData 完全一致）
    // ============================================================

    // 把 moves（多段运动轨迹）转成 animationFrames（A 站动画帧）。纯函数。
    // 坐标 null → 回落 cfg.posX/posY（跟随样式区/预设定位）；
    // 帧级 scale/rotate null → 回落 adv.scale/adv.rotate（顶层拉伸旋转）；
    // moveTime 空 → 回落 durationMs。
    function buildAnimationFrames(moves, cfg, adv, durationMs) {
        const baseMoveTime = Math.max(100, Math.round(durationMs || cfg.moveTime || DEFAULT_MOVE_TIME));
        const list = (moves && moves.length) ? moves : [{ fromX: null, fromY: null, toX: null, toY: null, moveTime: null, timingFunction: 'linear' }];
        return list.map((mv) => {
            const frame = (sx, sy, rx, ry, rz, px, py) => ({
                pos: { x: px, y: py, z: 1 },
                scale: { x: num(sx, adv.scale.x), y: num(sy, adv.scale.y), z: 1 },
                rotate: { x: num(rx, adv.rotate.x), y: num(ry, adv.rotate.y), z: num(rz, adv.rotate.z) },
            });
            return {
                from: frame(mv.fromScaleX, mv.fromScaleY, mv.fromRotateX, mv.fromRotateY, mv.fromRotateZ,
                    num(mv.fromX, num(cfg.posX, DEFAULT_POS_X)), num(mv.fromY, num(cfg.posY, DEFAULT_POS_Y))),
                to: frame(mv.toScaleX, mv.toScaleY, mv.toRotateX, mv.toRotateY, mv.toRotateZ,
                    num(mv.toX, num(cfg.posX, DEFAULT_POS_X)), num(mv.toY, num(cfg.posY, DEFAULT_POS_Y))),
                timingFunction: mv.timingFunction || 'linear',
                staticTime: 0,
                moveTime: Math.max(100, Math.round(num(mv.moveTime, baseMoveTime))),
            };
        });
    }

    function buildModel(sub, cfg, durationMs, effects, moves) {
        const text = Array.from((sub.text || '').trim()).slice(0, 255).join('');
        // 起始时间 = 字幕时间 + 全局时间偏移（ms，可为负，用于微调同步）
        const startTime = Math.max(0, Math.round(sub.time + timeOffset));
        // 运动耗时由相邻字幕间隔自动计算，durationMs 兜底
        const moveTime = Math.max(100, Math.round(durationMs || cfg.moveTime || DEFAULT_MOVE_TIME));

        const wordStyle = {
            font: normalizeFont(cfg.font),
            size: clamp(cfg.size, 12, 150),
            bold: !!cfg.bold,
            stroke: cfg.stroke !== false,
            color: rgbToHex(cfg.color),
        };
        const adv = normalizeEffects(effects || advancedConfig);

        // 简单投影（旧字段，向后兼容）：未在高级字段里配置投影时才启用
        if (cfg.shadow && !adv.shadow) {
            wordStyle.shadow = {
                x: DEFAULT_SHADOW_PLACEHOLDER.x,
                y: DEFAULT_SHADOW_PLACEHOLDER.y,
                color: DEFAULT_SHADOW_PLACEHOLDER.color,
                blur: DEFAULT_SHADOW_PLACEHOLDER.blur,
            };
        }

        // 高级字段：模糊 / 外发光 / 投影（覆盖简单投影）
        if (adv.blur > 0) wordStyle.blur = adv.blur;
        if (adv.shine) wordStyle.shine = { color: adv.shine.color, blur: adv.shine.blur, size: adv.shine.size };
        if (adv.shadow) wordStyle.shadow = { x: adv.shadow.x, y: adv.shadow.y, color: adv.shadow.color, blur: adv.shadow.blur };

        // 多段运动：坐标 null 时回落到 cfg.posX/posY（跟随样式区/预设定位），
        // 显式数字才用固定坐标。这样竖排/KTV/声明式等 transform 通过 cfg 传递的
        // 位置才能真正生效，而不是被默认 50,85 固定运动钉死在同一点。
        // moves 来源：motion 引擎写入的 l.moves（null=静止）；仅当「未传 moves」（无预设直发路径）
        // 才回落弹幕模式手动运动 advancedConfig.moves，避免字幕模式预设与弹幕模式共享运动状态。
        const ms = (moves === undefined) ? advancedConfig.moves : moves;
        const animationFrames = buildAnimationFrames(ms, cfg, adv, durationMs);
        // 总时长 = 所有段 moveTime 之和
        const totalDur = animationFrames.reduce((a, f) => a + f.moveTime, 0);

        return {
            id: genId(),
            content: text,
            contentType: 0,                    // Text
            startTime: startTime,
            startTimeNow: false,
            zIndex: clamp(adv.zIndex, 1, 99),
            anchor: clamp(cfg.anchor, 0, 8),
            wordStyle: wordStyle,
            animationFrames: animationFrames,
            durationTime: totalDur || moveTime,
            rotate: { x: num(adv.rotate.x, 0), y: num(adv.rotate.y, 0), z: num(adv.rotate.z, 0) },
            scale: { x: num(adv.scale.x, 1), y: num(adv.scale.y, 1), z: num(adv.scale.z, 1) },
        };
    }

    // ============================================================
    //  输出 lint（闸② 的落点）：纯函数，不引 DOM，不改 model
    //  目的：把「静默不渲染」变成导出前的明确报错。要拦的病灶就在 API.md §十二 补记里：
    //   model 缺 contentType / startTimeNow 时，渲染器**照建 DOM 节点、照生成 @keyframes、不报错**，
    //   弹幕却永远停在缓冲、画面上什么都没有（spike 工具当年就是这么被蒙住的）。
    //  立场：判据全部取自 API.md（每条规则旁写出处）；API.md 没写后果的一律放行——误杀比漏放更伤。
    //  保守放行清单（有疑但无据，只不拦）：帧 staticTime 缺失或为负、帧里 pos.z / scale.z 非 1、
    //   wordStyle.font 不在 §六 那 5 种、wordStyle.color 不是 #rrggbb 写法、startTime 为负。
    //  坐标判据是【量级检查】（±1000），不是「必须在 0–100 内」——屏幕外坐标是合法技法，
    //  实测依据见下面 LINT_POS_MIN/MAX 的注释（6.13.1 修正，R10）。
    // ============================================================

    // API.md §五「顶层结构」+ 字段表：渲染端只读的 12 个字段，缺一即拦。
    // 这条不是形式主义——contentType / startTimeNow 的来历见本节头注（§十二 补记）。
    const LINT_REQUIRED_FIELDS = [
        ['id', 'string'], ['content', 'string'], ['contentType', 'number'], ['startTime', 'number'],
        ['startTimeNow', 'boolean'], ['zIndex', 'number'], ['anchor', 'number'], ['wordStyle', 'object'],
        ['animationFrames', 'array'], ['durationTime', 'number'], ['rotate', 'object'], ['scale', 'object'],
    ];
    // §二 body「弹幕文本内容，trim() 后截断到 255 字符」；buildModel 也按【码点】截断
    // （Array.from(…).slice(0, 255)）——两边同口径，故这里数码点，不数 UTF-16 长度。
    const LINT_CONTENT_MAX = 255;
    // moveTime 下限取代码口径：buildAnimationFrames 的两处 Math.max(100, …)
    // （API.md §五 只记「运动耗时（ms）」，未规定下限——这条的依据是代码不是文档）。
    const LINT_MOVE_TIME_MIN = 100;
    // 坐标判据：**量级检查**（±1000），不是「必须落在 0–100」。
    //   一、屏幕外坐标是合法技法，不是病灶：motion.slide 就是拿屏幕外起点滑入/滑出（50-engine 的
    //     slide 引擎：w = min(90, max(10, 文本长×4))、出屏余量 M = 5、按锚点列取 off[col]）：
    //       从右：col=2 → 100 + w + M = 195（上限）；col=0 → 105
    //       从左：col=0 → -(w + M) = -95（下限）；col=2 → -5
    //     即引擎合法产出的量级是 [-95, 195]，用「必须 0–100」去判会**误杀所有 slide 弹幕**（R10，6.13.1 修）。
    //   二、±1000（≈ 屏幕宽度的 10 倍）留了约 5 倍余量，足以容纳上面那类技法性越界；
    //     而用户手填的坐标本来也出不去——运动轨迹列表的控件是 min="0" max="100"（MOVES_DECL）。
    //   三、这条要抓的是**量级错误**：把像素当百分比传、100 写成 10000——那会算出屏幕外几百倍的位置，
    //     弹幕永远看不见（静默不渲染那一类）；把判据写成区间检查则会把引擎的正常产出一起扫进去。
    //   四、API.md 的口径（§五「x/y 为屏幕百分比」+ §十二 T3/T5 实测 0–100 精确吻合）说的是**坐标系**，
    //     不是「合法取值必须落在 0–100」——文档没有这条断言，越界不构成「有据可依的病灶」。
    const LINT_POS_MIN = -1000, LINT_POS_MAX = 1000;
    // §六「缓动函数」：默认 DOM_CSS 渲染器把 timingFunction 原样拼进 CSS animation 简写，只有 CSS 合法值生效；
    // 非法值 = 弹幕停在 (0,0)（§六 警告）。关键字表以 §六 列出的四种为准，另收 CSS 合法但 §六 未列的
    // （ease / step-start / step-end / steps(...)）——放行侧：CSS 认它，简写就不会非法。
    const LINT_TIMING_KEYWORDS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'ease', 'step-start', 'step-end'];
    const LINT_NUM_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

    function lintNum(v) { return typeof v === 'number' && isFinite(v); }
    // 值的「类型名」，供问题描述用（NaN 单列，便于看出「是数字但不是有限数」）
    function lintKind(v) {
        if (Array.isArray(v)) return 'array';
        if (v === null) return 'null';
        if (typeof v === 'number' && !isFinite(v)) return 'NaN';
        return typeof v;
    }
    function lintBrief(v) { try { return JSON.stringify(v); } catch (e) { return String(v); } }

    // cubic-bezier(a,b,c,d)：四个数有限，x 分量 ∈ [0,1]（CSS 规范），y 分量不限
    // ——回退缓动 cubic-bezier(0.175,0.885,0.32,1.275) 的 1.275 就是合法超调（§六 表内即有此值）。
    function lintTimingFunction(fn) {
        if (typeof fn !== 'string') return false;
        const v = fn.trim();
        if (LINT_TIMING_KEYWORDS.indexOf(v) >= 0) return true;
        if (/^steps\([^()]*\)$/i.test(v)) return true;
        const m = /^cubic-bezier\(\s*([^()]*)\s*\)$/i.exec(v);
        if (!m) return false;
        const parts = m[1].split(',').map((s) => s.trim());
        if (parts.length !== 4 || !parts.every((s) => LINT_NUM_RE.test(s))) return false;
        const n = parts.map(Number);
        return n[0] >= 0 && n[0] <= 1 && n[2] >= 0 && n[2] <= 1;
    }

    // 单帧判据（§五「animationFrames（运动帧）」表）：两端 pos/scale/rotate 三组各三轴 + moveTime + timingFunction
    function lintFrame(f, i, add) {
        const at = 'model.animationFrames[' + i + ']';
        if (!f || typeof f !== 'object' || Array.isArray(f)) { add('frame-shape', '帧不是对象（' + lintKind(f) + '）', at); return; }
        // from / to 两端都要在（§五 帧表：两端各有 pos/scale/rotate）
        ['from', 'to'].forEach((end) => {
            const e = f[end];
            if (!e || typeof e !== 'object') { add('frame-shape', '缺 ' + end + ' 端点（§五 帧表）', at + '.' + end); return; }
            ['pos', 'scale', 'rotate'].forEach((grp) => {
                const g = e[grp];
                if (!g || typeof g !== 'object') { add('frame-shape', '缺 ' + end + '.' + grp + '（§五 帧表）', at + '.' + end + '.' + grp); return; }
                ['x', 'y', 'z'].forEach((axis) => {
                    if (!lintNum(g[axis])) add('frame-number', end + '.' + grp + '.' + axis + ' 不是有限数字（' + lintBrief(g[axis]) + '）（§五 帧表）', at + '.' + end + '.' + grp + '.' + axis);
                });
            });
            // 坐标只查 x/y 的量级（±1000，见 LINT_POS_MIN/MAX）；帧里 pos.z 按 §五 固定 1，
            // 非 1 的后果无据可查（保守放行）。
            if (e.pos && typeof e.pos === 'object') {
                ['x', 'y'].forEach((axis) => {
                    const v = e.pos[axis];
                    if (lintNum(v) && (v < LINT_POS_MIN || v > LINT_POS_MAX)) {
                        add('frame-pos-range', end + '.pos.' + axis + '=' + v + ' 量级不对（超出 ±' + LINT_POS_MAX + '：屏幕外坐标合法，但这是像素当百分比那类错的量级）', at + '.' + end + '.pos.' + axis);
                    }
                });
            }
        });
        // 运动耗时：§五 帧表「moveTime 运动耗时（ms）」，下限取 buildAnimationFrames 的 Math.max(100, …)
        const mt = f.moveTime;
        if (mt === undefined || mt === null) add('frame-move-time', '缺 moveTime（§五 帧表）', at + '.moveTime');
        else if (!lintNum(mt)) add('frame-move-time', 'moveTime 不是有限数字（' + lintBrief(mt) + '）', at + '.moveTime');
        else if (mt < LINT_MOVE_TIME_MIN) add('frame-move-time', 'moveTime=' + mt + ' 低于下限 ' + LINT_MOVE_TIME_MIN + 'ms（buildAnimationFrames 的 Math.max(100, …)）', at + '.moveTime');
        // 缓动：§六，非法值 = 弹幕停在 (0,0)
        if (!lintTimingFunction(f.timingFunction)) {
            add('timing-function', 'timingFunction=' + lintBrief(f.timingFunction) + ' 不是 CSS 合法缓动（§六：只有标准关键字与 cubic-bezier 生效；非法值 = 弹幕停在 (0,0)）', at + '.timingFunction');
        }
    }

    // lintModel(model) → { ok, problems: [{ rule, detail, path }] }
    //   ok = 无任何问题；problems 的 rule 是稳定标识（可被 UI 按类归并），detail 是人读的病灶描述，
    //   path 是出问题的位置（如 model.animationFrames[2].to.pos.x）。纯函数：不写 model、不抛错。
    function lintModel(model) {
        const problems = [];
        const add = (rule, detail, path) => { problems.push({ rule, detail, path }); };

        if (!model || typeof model !== 'object' || Array.isArray(model)) {
            add('model-shape', 'model 不是对象（' + lintKind(model) + '）', 'model');
            return { ok: false, problems };
        }

        // ① 必填 12 字段齐备 + 类型（§五 顶层结构 / 字段表「类型」列）
        LINT_REQUIRED_FIELDS.forEach(([key, type]) => {
            const v = model[key];
            if (v === undefined || v === null) { add('field-missing', '缺必填字段 ' + key + '（§五 顶层结构）', 'model.' + key); return; }
            if (lintKind(v) !== type) add('field-type', key + ' 类型应为 ' + type + '，实际 ' + lintKind(v) + '（§五 字段表）', 'model.' + key);
        });

        // ② id：§五 字段表「弹幕唯一 id（40 位 hex）」
        if (typeof model.id === 'string' && !/^[0-9a-f]{40}$/i.test(model.id)) {
            add('id-format', 'id 不是 40 位 hex：' + lintBrief(model.id) + '（§五）', 'model.id');
        }

        // ③ content：非空 + 码点 ≤ 255（§二 body；口径与 buildModel 的 Array.from(…).slice(0,255) 一致）
        if (typeof model.content === 'string') {
            const cps = Array.from(model.content.trim()).length;
            if (!cps) add('content-empty', 'content 为空（trim 后无字符）：没有可渲染文本（§二 body）', 'model.content');
            else if (cps > LINT_CONTENT_MAX) add('content-too-long', 'content 有 ' + cps + ' 个码点，超过 ' + LINT_CONTENT_MAX + ' 上限（§二 body「截断到 255 字符」）', 'model.content');
        }

        // ④ contentType ∈ {0,1}（§五 字段表 + §六「内容类型 contentType」）
        if (lintNum(model.contentType) && model.contentType !== 0 && model.contentType !== 1) {
            add('content-type-value', 'contentType=' + model.contentType + ' 不在 {0,1}（0=文本 Text，1=Base64 图片，§五 / §六）', 'model.contentType');
        }

        // ⑤ zIndex ∈ [1,99]（§五 字段表「层级，1~99」）
        if (lintNum(model.zIndex) && (model.zIndex < 1 || model.zIndex > 99)) {
            add('z-index-range', 'zIndex=' + model.zIndex + ' 超出 [1,99]（§五 字段表）', 'model.zIndex');
        }

        // ⑥ anchor ∈ [0,8] 整数（§五 字段表 + §六「锚点 anchor」九宫格）
        if (lintNum(model.anchor) && !(Number.isInteger(model.anchor) && model.anchor >= 0 && model.anchor <= 8)) {
            add('anchor-range', 'anchor=' + model.anchor + ' 不是 0~8 的整数（§五 / §六 九宫格）', 'model.anchor');
        }

        // ⑦ durationTime > 0（§五「总存活时长（毫秒）」；§十二 附录 #2 记的入池窗口是
        //   n > startTime && n <= startTime + durationTime —— 非正值窗口恒空，弹幕永不入池，静默不渲染）
        if (lintNum(model.durationTime) && !(model.durationTime > 0)) {
            add('duration-time', 'durationTime=' + model.durationTime + ' 非正数：入池窗口 startTime < n ≤ startTime+durationTime 恒空（§五 / §十二 附录 #2）', 'model.durationTime');
        }

        // startTime 只查「有限数字」（①的 field-type 已覆盖），不查 ≥ 0：buildModel 已 clamp 到 ≥ 0，
        // 而 API.md 未记「负值不渲染」的依据（保守放行）。

        // ⑧ 帧列表非空（§五 animationFrames「运动帧列表」；§十二 T1 记渲染器只为带 animationFrames 的 model 建节点）
        const frames = model.animationFrames;
        if (Array.isArray(frames)) {
            if (!frames.length) add('frames-empty', 'animationFrames 为空数组：没有任何运动帧可渲染（§五 / §十二 T1）', 'model.animationFrames');
            frames.forEach((f, i) => lintFrame(f, i, add));
        }

        return { ok: problems.length === 0, problems };
    }

// —— ESM 导出（6.13.0 从 40-core 抽出；40-core 不再 re-export 这三个名字，否则成环）——
// 三个构造函数 + lintModel。读：他文件 import { x }（ESM 活绑定）。本文件不导出可变状态，无 setter。
export {
    buildAnimationFrames, buildModel, lintModel, normalizeEffects,
};
