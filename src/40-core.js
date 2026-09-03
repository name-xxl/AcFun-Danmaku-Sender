    // ============================================================
    //  播放器封装
    //  关键：脚本带 @grant 时运行在 Tampermonkey 沙箱，window 是沙箱 window，
    //  页面对象（player / H5Player）必须通过 unsafeWindow 访问，否则
    //  `instanceof window.H5Player` 会因 H5Player 为 undefined 而抛 TypeError。
    // ============================================================

    const pageWin = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

    function getPlayer() {
        try {
            const p = pageWin.player;
            // 宽松判断，避免跨 realm instanceof 崩溃
            return (p && (p.vid || p.contentId || typeof p.emit === 'function' || typeof p.seek === 'function')) ? p : null;
        } catch (e) {
            return null;
        }
    }

    function getVideoInfo() {
        const p = getPlayer();
        if (!p) return null;
        const ids = urlIds();
        return {
            videoId: +p.vid || (ids ? ids.id : 0),
            contentId: p.contentId || (ids ? ids.id : 0),
            contentType: p.contentType || 'douga',
            subChannelId: p.subChannelId || '',
            subChannelName: p.subChannelName || '',
            bangumi: p.contentType === 'bangumi',
        };
    }

    function urlIds() {
        let m = location.pathname.match(/\/v\/ac(\d+)/);
        if (m) return { id: +m[1] };
        m = location.pathname.match(/\/bangumi\/aa(\d+)/);
        if (m) return { id: +m[1] };
        return null;
    }

    function seekTo(ms) {
        const p = getPlayer();
        if (p && typeof p.seek === 'function') { try { p.seek(ms / 1000); } catch (e) {} }
    }
    function playVideo() {
        const p = getPlayer();
        if (p && typeof p.play === 'function') { try { p.play(); } catch (e) {} }
    }
    function pauseVideo() {
        const p = getPlayer();
        if (p && typeof p.pause === 'function') { try { p.pause(); } catch (e) {} }
    }

    // ============================================================
    //  状态
    // ============================================================

    // —— 设置持久化（刷新不丢）——
    function storeGet(k, d) { try { const v = localStorage.getItem('cf_sub_' + k); return v === null ? d : v; } catch (e) { return d; } }
    function storeSet(k, v) { try { localStorage.setItem('cf_sub_' + k, v); } catch (e) {} }

    let subs = [];                 // [{time, text, style?, st?}]
    let sending = false, cancelled = false;
    // 样式来源：'ass' = 应用 ASS 自带样式（缺省回退编辑器样式）；'editor' = 全部使用编辑器样式
    let styleSource = storeGet('styleSource', 'ass');
    // 全局时间偏移（ms，可为负）：所有字幕起始时间的整体偏移，用于微调字幕与视频同步
    let timeOffset = parseInt(storeGet('timeOffset', '0'), 10) || 0;
    // 切片模式：勾选后偏移自动设为「首条选中字幕开始时间的负值」，让切片视频里首条从 0 开始
    let sliceMode = false;
    let timeOffsetBackup = 0;   // 进入切片模式前的手动偏移值，退出时恢复
    // 预设相关
    let customPresets = [];      // 导入的自定义预设
    // 预设选择不记忆：每次刷新/打开默认回到「无预设」，避免误用上次的效果
    let activePresetId = 'none';
    let subs2 = [];              // 第二语言字幕（多语预设用）

    // —— 预设参数持久化（主动保存：点「保存参数」才写，不自动存）——
    function savePresetOptions(id, opts) {
        try { storeSet('presetOpt_' + id, JSON.stringify(opts)); } catch (e) {}
    }
    function loadPresetOptions(id) {
        try {
            const raw = storeGet('presetOpt_' + id, null);
            return raw === null ? null : JSON.parse(raw);
        } catch (e) { return null; }
    }
    // 仅把「已主动保存」的微调值合并回预设（内置 + 自定义都适用）
    // 存储格式：{ options, effects }（旧版直接存 options 对象，向后兼容）
    function applySavedOptions(preset) {
        if (!preset) return;
        const saved = loadPresetOptions(preset.id);
        if (!saved || typeof saved !== 'object') return;
        if (saved.options && typeof saved.options === 'object') {
            // 新格式：options + effects 分别合并
            preset.options = Object.assign({}, preset.options || {}, saved.options);
            if (saved.effects != null) preset.effects = saved.effects;
        } else {
            // 旧格式：整个 saved 就是 options
            preset.options = Object.assign({}, preset.options || {}, saved);
        }
    }
    // 双语 LRC 处理方式：'auto' 自动上下两行 | 'main' 仅主语言 | 'sub' 仅副语言
    let bilingualMode = storeGet('bilingualMode', 'auto');
    // 发送间隔（ms）：两条弹幕发送之间的等待时间，可自定义
    let sendInterval = parseInt(storeGet('sendInterval', '400'), 10) || 0;
    // 字幕列表是否折叠
    let listFolded = false;
    // 预设区是否折叠
    let presetFolded = false;
    // 样式区是否折叠
    let styleFolded = false;
    // 预览（全部）是否已暂停
    let previewPaused = false;
    let currentStyleConfig = {
        font: 'SimHei',
        size: 24,
        color: 0xffffff,
        bold: false,
        stroke: true,
        anchor: DEFAULT_ANCHOR,
        posX: DEFAULT_POS_X,
        posY: DEFAULT_POS_Y,
        moveTime: DEFAULT_MOVE_TIME,           // 运动耗时 ms
        shadow: false,
    };

    // 高级字段（A 站原生高级弹幕的完整可定义字段，弹幕模式可调、可导出预设）
    let advancedConfig = {
        zIndex: DEFAULT_ZINDEX,
        rotate: { x: 0, y: 0, z: 0 },          // 旋转角度（度）
        scale: { x: 1, y: 1, z: 1 },           // 缩放比例（1=100%）
        blur: 0,                                // 高斯模糊 px
        shine: null,                            // 外发光 { color, blur, size } 或 null
        shadow: null,                           // 投影 { x, y, color, blur } 或 null
        // 多段运动：每段 { fromX/fromY/toX/toY, fromScaleX/.../toRotateZ, moveTime, timingFunction }
        // 坐标/缩放/旋转/耗时默认全 null，含义：
        //   坐标 null   → 跟随样式区/预设位置（cfg.posX/posY）
        //   缩放/旋转 null → 跟随顶层 scale/rotate（弹幕本体级拉伸旋转）
        //   moveTime null → 跟随该弹幕 durationMs（transform 可为每段算时长，如 KTV 逐字递减）
        // 显式数字才固定。默认全 null，让竖排/KTV/声明式等 transform 的定位、时长、变换都正常生效。
        moves: [
            {
                fromX: null, fromY: null, toX: null, toY: null,
                fromScaleX: null, fromScaleY: null, toScaleX: null, toScaleY: null,
                fromRotateX: null, fromRotateY: null, fromRotateZ: null,
                toRotateX: null, toRotateY: null, toRotateZ: null,
                moveTime: null, timingFunction: 'linear',
            },
        ],
    };
    // 高级编辑默认快照（「恢复默认」用）
    const DEFAULT_ADVANCED_CONFIG = JSON.parse(JSON.stringify(advancedConfig));

    // ============================================================
    //  可调字段定义表：导出「高级弹幕预设」时勾选哪些字段进入 params 声明。
    //  key 用点路径指向 effects 的叶子字段（导入后 renderPresetParams 据此读写）。
    //  default 兜底：effects 里某子对象为 null 时，控件显示默认值。
    // ============================================================
    const ADJUSTABLE_FIELDS = [
        { key: 'effects.zIndex', label: '层级', group: '层级', type: 'number', min: 1, max: 99, step: 1, default: DEFAULT_ZINDEX },
        { key: 'effects.rotate.x', label: '旋转 X°', group: '旋转', type: 'number', min: -360, max: 360, step: 1, default: 0 },
        { key: 'effects.rotate.y', label: '旋转 Y°', group: '旋转', type: 'number', min: -360, max: 360, step: 1, default: 0 },
        { key: 'effects.rotate.z', label: '旋转 Z°', group: '旋转', type: 'number', min: -360, max: 360, step: 1, default: 0 },
        { key: 'effects.scale.x', label: '缩放 X', group: '缩放', type: 'number', min: 0.1, max: 5, step: 0.1, default: 1 },
        { key: 'effects.scale.y', label: '缩放 Y', group: '缩放', type: 'number', min: 0.1, max: 5, step: 0.1, default: 1 },
        { key: 'effects.blur', label: '模糊(px)', group: '模糊', type: 'number', min: 0, max: 50, step: 0.5, default: 0 },
        { key: 'effects.shadow.x', label: '投影 X', group: '投影', type: 'number', min: -100, max: 100, step: 1, default: DEFAULT_SHADOW_PLACEHOLDER.x },
        { key: 'effects.shadow.y', label: '投影 Y', group: '投影', type: 'number', min: -100, max: 100, step: 1, default: DEFAULT_SHADOW_PLACEHOLDER.y },
        { key: 'effects.shadow.blur', label: '投影模糊', group: '投影', type: 'number', min: 0, max: 50, step: 0.5, default: DEFAULT_SHADOW_PLACEHOLDER.blur },
        { key: 'effects.shadow.color', label: '投影色', group: '投影', type: 'color', default: DEFAULT_SHADOW_PLACEHOLDER.color },
        { key: 'effects.shine.blur', label: '发光模糊', group: '外发光', type: 'number', min: 0, max: 50, step: 0.5, default: DEFAULT_SHINE_PLACEHOLDER.blur },
        { key: 'effects.shine.size', label: '发光大小', group: '外发光', type: 'number', min: 0, max: 20, step: 0.5, default: DEFAULT_SHINE_PLACEHOLDER.size },
        { key: 'effects.shine.color', label: '发光色', group: '外发光', type: 'color', default: DEFAULT_SHINE_PLACEHOLDER.color },
    ];

    // 规范化 effects：补齐缺失字段，保证 buildModel 访问安全
    function normalizeEffects(ef) {
        const src = ef || {};
        return {
            zIndex: (src.zIndex != null) ? src.zIndex : DEFAULT_ZINDEX,
            rotate: { x: num(src.rotate && src.rotate.x, 0), y: num(src.rotate && src.rotate.y, 0), z: num(src.rotate && src.rotate.z, 0) },
            scale: { x: num(src.scale && src.scale.x, 1), y: num(src.scale && src.scale.y, 1), z: 1 },
            blur: num(src.blur, 0),
            shine: src.shine || null,
            shadow: src.shadow || null,
            moves: (src.moves && src.moves.length) ? src.moves : advancedConfig.moves,
        };
    }

    // ============================================================
    //  模型构造（与 A 站原生 getData 完全一致）
    // ============================================================

    function buildModel(sub, cfg, durationMs, effects) {
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
        const moves = (adv.moves && adv.moves.length) ? adv.moves : [{ fromX: null, fromY: null, toX: null, toY: null, moveTime: null, timingFunction: 'linear' }];
        const animationFrames = moves.map((mv) => {
            // 动画帧级 scale/rotate：空(null/undefined/'') → 回落顶层 adv.scale/adv.rotate，
            // 显式数字才用该段自己的拉伸/旋转（与 A 站渲染器 drawDanmakuFrame 语义一致）
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
                // moveTime 空(null/undefined/''）→ 跟随 durationMs；显式数字才固定耗时
                moveTime: Math.max(100, Math.round(num(mv.moveTime, moveTime))),
            };
        });
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

    function normalizeFont(f) {
        return FONTS.includes(f) ? f : (f === 'KaiTi' || f === 'FangSong' ? 'FangSong' : 'SimHei');
    }
    function clamp(n, lo, hi) { n = +n || 0; return n < lo ? lo : n > hi ? hi : n; }
    // num：把 n 归一成数值，null/undefined/空串/NaN 等无效值回落到默认 d。
    // 注意 null/'' 必须在 +n 之前判断（+null=0、+''=0 都会误判成合法值）。
    function num(n, d) { if (n === null || n === undefined || n === '') return d; n = +n; return isFinite(n) ? n : d; }

