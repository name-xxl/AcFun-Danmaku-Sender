    // ============================================================
    //  常量
    // ============================================================

    // A 站高级弹幕支持的字体（原生下拉框只有这 5 种）
    const FONTS = ['SimHei', 'SimSun', 'FangSong', 'NSimSun', 'Microsoft YaHei'];
    const FONT_LABELS = { 'SimHei': '黑体', 'SimSun': '宋体', 'FangSong': '仿宋', 'NSimSun': '新宋体', 'Microsoft YaHei': '微软雅黑' };

    // 锚点枚举（与 A 站原生一致）
    const ANCHORS = [
        { v: 0, label: '左上' }, { v: 1, label: '中上' }, { v: 2, label: '右上' },
        { v: 3, label: '左中' }, { v: 4, label: '中中' }, { v: 5, label: '右中' },
        { v: 6, label: '左下' }, { v: 7, label: '中下' }, { v: 8, label: '右下' },
    ];

    // —— 默认值（集中管理，消除魔法值散落；改一处全项目生效）——
    const DEFAULT_ANCHOR = 4;                        // 中中
    const DEFAULT_POS_X = 50;                        // 屏幕 X（%）
    const DEFAULT_POS_Y = 85;                        // 屏幕 Y（%）
    const DEFAULT_ZINDEX = 50;                       // 层级
    const DEFAULT_MOVE_TIME = 3000;                  // 运动耗时 ms
    const DEFAULT_DURATION = 5000;                   // 默认存活 ms
    const MAX_DURATION = 30000;                      // 弹幕模式持续上限 ms
    const MODEL_SEND_INTERVAL = 80;                  // 一句字幕展开出的多条弹幕之间的发送间隔 ms（防限流）
    const KTV_SUNG_COLOR = '#ffd700';                // KTV 唱到色
    const KTV_UNSUNG_COLOR = '#9aa0a6';              // KTV 待唱色
    const DEFAULT_SHADOW_PLACEHOLDER = { x: 1, y: 1, blur: 3, color: '#000000' };   // 投影开启时的占位默认
    const DEFAULT_SHINE_PLACEHOLDER = { blur: 5, size: 2, color: '#ffd700' };       // 外发光开启时的占位默认

    // ============================================================
    //  预设（内置 + 可导入 JSON 模板）
    //  预设 JSON 格式：{ id, name, desc, transform, options, params }
    //    options：transform 运行时读取的参数默认值
    //    params ：声明「允许在编辑面板微调的参数」，每项：
    //      { key, label, type: number|select|color|checkbox, min?, max?, step?, default?, choices? }
    //  transform 类型：
    //    none            —— 原样发送（一条字幕一条弹幕）
    //    chars-vertical  —— 竖排：拆单字纵向堆叠
    //    chars-karaoke   —— KTV 唱词：拆单字，底层暗色铺开 + 亮色逐字扫光
    //    multi-lang      —— 多语：主字幕 + 第二语言字幕同屏上下两行
    // ============================================================

    const BUILTIN_PRESETS = [
        { id: 'none', name: '无预设', desc: '原样发送，一条字幕一条弹幕', transform: 'none', options: {}, params: [] },
        {
            id: 'vertical', name: '竖排字幕', desc: '每句拆成单字纵向堆叠', author: 'AC在爱一直在',
            composition: { split: 'chars', layout: 'vertical', color: 'single', timing: 'stagger', motion: 'none' },
            options: { direction: 'down', gap: 1.8, charDelay: 60, startX: 50, startY: 72 },
            params: [
                { key: 'direction', label: '方向', type: 'select', choices: [{ value: 'down', label: '向下' }, { value: 'up', label: '向上' }] },
                { key: 'gap', label: '字距', type: 'number', min: 0.5, max: 6, step: 0.1 },
                { key: 'charDelay', label: '逐字延迟(ms)', type: 'number', min: 0, max: 500, step: 10 },
                { key: 'startX', label: '起点X', type: 'number', min: 0, max: 100, step: 1 },
                { key: 'startY', label: '起点Y', type: 'number', min: 0, max: 100, step: 1 },
            ],
        },
        {
            id: 'karaoke', name: 'KTV 唱词', desc: '逐字扫光，唱到的字变亮', author: 'AC在爱一直在',
            composition: { split: 'chars', layout: 'horizontal', color: 'karaoke', timing: 'sweep', motion: 'none' },
            options: { dualDir: 'none', dualX: 0, dualY: 8, charWidth: 2.8, rowY: 78, startX: 8, sungColor: KTV_SUNG_COLOR, unsungColor: KTV_UNSUNG_COLOR },
            params: [
                { key: 'dualDir', label: '跨句分栏', type: 'select', group: '布局', choices: [
                    { value: 'none', label: '不分栏' },
                    { value: 'vertical', label: '上下分栏（双排）' },
                    { value: 'horizontal', label: '左右分栏' },
                ]},
                { key: 'dualX', label: '次句偏移X', type: 'number', min: -100, max: 100, step: 1, group: '布局' },
                { key: 'dualY', label: '次句偏移Y', type: 'number', min: -100, max: 100, step: 1, group: '布局' },
                { key: 'charWidth', label: '字宽', type: 'number', min: 1.5, max: 6, step: 0.1 },
                { key: 'startX', label: '起点X', type: 'number', min: 0, max: 100, step: 1 },
                { key: 'rowY', label: '行Y', type: 'number', min: 0, max: 100, step: 1 },
                { key: 'sungColor', label: '唱到色', type: 'color' },
                { key: 'unsungColor', label: '待唱色', type: 'color' },
            ],
        },
    ];

    // 内置预设的默认 options 快照（用于「恢复默认」时还原 JSON 原值）
    const DEFAULT_PRESET_OPTIONS = {};
    BUILTIN_PRESETS.forEach((p) => { DEFAULT_PRESET_OPTIONS[p.id] = Object.assign({}, p.options); });

