    // ============================================================
    //  预览（复用原生高级弹幕渲染器）
    // ============================================================

    // 预览弹幕走 loadDanmakuG → addDanmaku，会进入正式弹幕池且无法按 id 删除。
    // 因此记录每次预览的 model 引用，预览前把旧预览“过期”（startTime 设为极大值），
    // 让它不再落在任何播放时间窗口内，避免残留/重复渲染。
    let previewRefs = [];
    let previewSeq = 0;
    // 预览方式：默认走 Canvas 自绘（离线预览），可切回 A 站渲染器（在线预览）
    let useOfflinePreview = true;

    function expirePreviews() {
        for (const m of previewRefs) {
            if (m && typeof m.startTime === 'number') {
                m.startTime = Number.MAX_SAFE_INTEGER;
                m.durationTime = 0;
            }
        }
        previewRefs = [];
    }

    // 确保高级弹幕渲染器已初始化。
    // loadDanmakuG 方法在插件挂载时就绑定到 player 上、永远存在，但它内部是
    // `r.renderer.addDanmaku(t)`，而 r.renderer 要等 initAdvancedDanmaku 触发
    // `new DanmakuGRenderer(...)` 后才存在。刷新页面 / 未展开过原生编辑器时，
    // 直接调 loadDanmakuG 会因 r.renderer 为 undefined 抛 TypeError → “预览失败”。
    // 这里检测渲染器 stage DOM（.danmaku-g-rendered-stage）是否存在，不存在则
    // 调 player.initAdvancedDanmaku() 无参初始化（只建渲染器，不弹原生面板）。
    function ensureRenderer(p) {
        if (!p) return false;
        if (document.querySelector('.danmaku-g-rendered-stage')) return true;
        if (typeof p.initAdvancedDanmaku === 'function') {
            try { p.initAdvancedDanmaku(); } catch (e) { log('initAdvancedDanmaku 失败', e); }
        }
        return !!document.querySelector('.danmaku-g-rendered-stage');
    }

    async function previewSub(sub) {
        const cfg = cfgFor(sub);
        const idx = subs.indexOf(sub);
        // 手动弹幕（带 duration 字段且不在列表里）直接用其时长
        let baseDur;
        if (idx < 0 && sub && sub.duration) baseDur = sub.duration;
        else baseDur = Math.min(calcDurationMs(idx), 3000);
        // 时长每次略不同，绕过渲染器“按内容去重”导致同条字幕连续预览无反应的问题
        const dur = Math.max(500, baseDur - (previewSeq % 3));
        // 按激活预设展开成多个 model（seq 从 1 起，保证与预览全部/发送的奇偶一致）
        const models = expandSub(sub, cfg, dur, 1);
        log('👁 previewSub：', sub && sub.text, '→ ' + models.length + ' 个 model，离线=' + useOfflinePreview);

        // 离线预览：Canvas 自绘，无需渲染器 / 去重 hack，seek 到字幕前让 currentTime 落进窗口
        if (useOfflinePreview) {
            startOfflinePreview(models);
            const p = getPlayer();
            if (p) { seekTo(Math.max(0, models[0].startTime - 400)); playVideo(); }
            status(`👁 预览：${sub.text}`, 'busy');
            return;
        }

        // —— 在线预览（复用 A 站渲染器），保留原有时序 hack ——
        stopOfflinePreview();   // 切到在线预览时清掉离线画布，避免双重画面
        const p = getPlayer();
        if (!p) { status('❌ 未检测到播放器', 'err'); return; }
        if (typeof p.loadDanmakuG !== 'function') {
            status('⚠️ 高级弹幕渲染器未就绪，请先点弹幕输入框内第三个按钮展开一次', 'err');
            return;
        }
        if (!ensureRenderer(p)) {
            status('⚠️ 高级弹幕渲染器初始化失败，请展开一次原生高级弹幕编辑器', 'err');
            return;
        }
        expirePreviews();   // 让上一条预览弹幕过期，不再播放时重现
        models.forEach((m) => {
            m.id = 'cf-prev-' + (++previewSeq);
            // 关键：渲染器按「去 id 后的完整 JSON」做内容去重且永不清理，
            // 同一条字幕再预览会因内容相同被拦截。加一个递增字段让每次内容必不同。
            m.__seq = previewSeq;
            // 打开原生面板时，A 站会开启「只看自己」过滤器（IsOwnDanmkau），
            // 判定条件为 g.uid === t.user（严格相等）。model 缺 user 字段会被拦下，
            // 表现就是“打开面板不显示、关闭面板显示”。补上当前 uid 即可通过过滤器。
            m.user = String(getUid() || '');
            previewRefs.push(m);
        });

        // 时序修复：先暂停稳住渲染器时钟，再 seek 到 startTime 之前留余量，
        // 等 seek 生效后注入弹幕，最后 play 让时钟自然推进、穿越弹幕窗口。
        // 旧时序 seek→play→sleep→注入 会让短视频（时长<注入延迟，如 KTV 句尾字）因
        // 时钟已越过窗口而被渲染器 timeFrame 过滤掉，表现就是“少数几条不画”。
        pauseVideo();
        const t0 = Math.max(0, models[0].startTime - 400);
        seekTo(t0);
        await sleep(600);
        try {
            p.loadDanmakuG(models);
            log('👁 loadDanmakuG 调用完成，无异常');
            status(`👁 预览：${sub.text}`, 'busy');
        } catch (e) {
            log('预览渲染失败', e);
            status('⚠️ 预览失败，请确认已展开高级弹幕编辑器', 'err');
            return;
        }
        playVideo();
    }

    // 预览全部：把全部字幕一次性铺到视频上，从头过一遍
    function previewAll() {
        if (!subs.length) { status('请先上传字幕文件', 'err'); return; }
        const selected = subs.filter((s) => s.selected);
        if (!selected.length) { status('没有选中的字幕，请先勾选', 'err'); return; }

        const models = [];
        selected.forEach((s, k) => {
            const i = subs.indexOf(s);
            const cfg = cfgFor(s);
            // k = 选中序列里的序号（从 0 开始），双排 KTV 用它决定上下行
            const prevTime = k > 0 ? selected[k - 1].time : null;
            const expanded = expandSub(s, cfg, calcDurationMs(i), k + 1, prevTime);
            expanded.forEach((m) => { models.push(m); });
        });

        // 离线预览：Canvas 自绘，seek 到首条之前留余量再 play
        if (useOfflinePreview) {
            startOfflinePreview(models);
            const p = getPlayer();
            if (p) { seekTo(Math.max(0, selected[0].time + timeOffset - 400)); playVideo(); }
            previewPaused = false;
            status(`▶ 预览全部：${selected.length} 条字幕 → ${models.length} 条弹幕`, 'busy');
            return;
        }

        // —— 在线预览（复用 A 站渲染器）——
        stopOfflinePreview();   // 切到在线预览时清掉离线画布，避免双重画面
        const p = getPlayer();
        if (!p) { status('❌ 未检测到播放器', 'err'); return; }
        if (typeof p.loadDanmakuG !== 'function') {
            status('⚠️ 高级弹幕渲染器未就绪，请先点弹幕输入框内第三个按钮展开一次', 'err');
            return;
        }
        if (!ensureRenderer(p)) {
            status('⚠️ 高级弹幕渲染器初始化失败，请展开一次原生高级弹幕编辑器', 'err');
            return;
        }
        expirePreviews();
        models.forEach((m, idx) => {
            m.id = 'cf-prevall-' + (++previewSeq) + '-' + idx;
            m.__seq = previewSeq;   // 绕过渲染器内容去重
            m.user = String(getUid() || '');   // 通过「只看自己」过滤器（同 previewSub）
            previewRefs.push(m);
        });

        // 时序修复（同 previewSub）：先暂停 → seek 到首条之前留余量 → 注入全部 → play。
        pauseVideo();
        seekTo(Math.max(0, selected[0].time + timeOffset - 400));
        previewPaused = false;
        // 等渲染器时间同步（同 previewSub 的时序修复）
        setTimeout(() => {
            try {
                p.loadDanmakuG(models);
                log('▶ previewAll：' + selected.length + ' 条字幕 → ' + models.length + ' 个 model，loadDanmakuG 调用完成');
                status(`▶ 预览全部：${selected.length} 条字幕 → ${models.length} 条弹幕`, 'busy');
                playVideo();
            } catch (e) {
                log('预览全部失败', e);
                status('⚠️ 预览失败，请确认已展开高级弹幕编辑器', 'err');
            }
        }, 600);
    }

    // 多句预览：把一组字幕（每句独立）按顺序衔接、一次注入视频。
    // 供开发面板预览「两句同时出现」的跨句效果（如 KTV 双排、竖排 KTV）使用。
    // subList: [{ time, text, duration? }]，每句用 seq（k+1）与 prevTime（前一句时间）衔接。
    function previewMulti(subList, durMs) {
        if (!subList || !subList.length) { status('没有可预览的内容', 'err'); return Promise.resolve(); }

        const models = [];
        subList.forEach((s, k) => {
            const cfg = cfgFor(s);
            const prevTime = k > 0 ? subList[k - 1].time : null;
            const dur = (s.duration != null) ? s.duration : durMs;
            const expanded = expandSub(s, cfg, dur, k + 1, prevTime);
            expanded.forEach((m) => { models.push(m); });
        });
        if (!models.length) { status('预览展开为空', 'err'); return Promise.resolve(); }

        // 离线预览：Canvas 自绘
        if (useOfflinePreview) {
            startOfflinePreview(models);
            const p = getPlayer();
            if (p) { seekTo(Math.max(0, subList[0].time + timeOffset - 400)); playVideo(); }
            status(`▶ 预览：${subList.length} 句 → ${models.length} 条弹幕`, 'busy');
            return Promise.resolve();
        }

        // —— 在线预览（复用 A 站渲染器）——
        stopOfflinePreview();   // 切到在线预览时清掉离线画布，避免双重画面
        const p = getPlayer();
        if (!p || typeof p.loadDanmakuG !== 'function') {
            status('⚠️ 高级弹幕渲染器未就绪，请先点弹幕输入框内第三个按钮展开一次', 'err');
            return Promise.resolve();
        }
        if (!ensureRenderer(p)) {
            status('⚠️ 高级弹幕渲染器初始化失败，请展开一次原生高级弹幕编辑器', 'err');
            return Promise.resolve();
        }
        expirePreviews();
        models.forEach((m, idx) => {
            m.id = 'cf-prevm-' + (++previewSeq) + '-' + idx;
            m.__seq = previewSeq;
            m.user = String(getUid() || '');
            previewRefs.push(m);
        });

        pauseVideo();
        seekTo(Math.max(0, subList[0].time + timeOffset - 400));
        return new Promise((resolve) => {
            setTimeout(() => {
                try {
                    p.loadDanmakuG(models);
                    status(`▶ 预览：${subList.length} 句 → ${models.length} 条弹幕`, 'busy');
                } catch (e) {
                    log('多句预览失败', e);
                    status('⚠️ 预览失败，请确认已展开高级弹幕编辑器', 'err');
                }
                playVideo();
                resolve();
            }, 600);
        });
    }

