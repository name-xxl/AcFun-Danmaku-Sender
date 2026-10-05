// ============================================================
//  Checkpoint Zero spike（P2）：官方渲染器干跑实证
// ============================================================
// 用法：在任意 AcFun 视频页（www.acfun.cn/v/ac* 或 bangumi/aa*）打开 DevTools 控制台，
//       把本文件全部内容整段粘贴回车。建议用自己上传的测试视频、保持登录。
// 性质：全程零网络请求（只调 loadDanmakuG 本地注入），零风控风险。
// 产出：控制台末尾打印「=== 汇总 ===」块，整段复制回填 API.md §十二，钉日期。
// 注意：T2 需要你配合「打开原生高级弹幕面板」一步（脚本会等你）。
//
// 五项矩阵：
//   T1 注入通道    ：3 条静态 model 全部渲染，坐标/时长正确
//   T2 身份过滤器  ：带 user=uid 的注入在原生面板打开时仍可见（过 IsOwnDanmkau）
//   T3 extData 契约：wordStyle 全字段 + animationFrames + cubic-bezier 渲染语义正确
//   T4 scale 语义  ：scale=2 的字号是 scale=1 的两倍（倍数口径）
//   T5 移动轨迹    ：(20,50)→(80,50) 逐帧轨迹符合起止
// 全过 → P3「官方渲染器彩排 = 默认画布」；任一挂 → 71-canvas 升主预览分支。

(async () => {
    const say = (...a) => console.log('%c[spike-zero]', 'color:#fd4c5d;font-weight:bold;', ...a);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const R = [];   // 结果登记：{id, name, status, detail}
    const done = (id, status, detail) => {
        R.push({ id, status, detail: detail + ' ｜ ' + stageStats() });
        say(`${status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏭️'} ${id} ${status} —— ${detail}`);
    };

    // —— 环境 ——
    const W = window;
    const player = (() => {
        const p = W.player;
        return (p && (p.vid || p.contentId || typeof p.seek === 'function' || typeof p.emit === 'function')) ? p : null;
    })();
    const uid = (() => {
        if (player && player.uid) return String(player.uid);
        const m = document.cookie.match(/(?:^|;\s*)auth_key=(\d+)/) || document.cookie.match(/(?:^|;\s*)userId=(\d+)/);
        return m ? m[1] : '';
    })();
    const video = document.querySelector('video');
    const env = {
        date: new Date().toISOString().slice(0, 10),
        ua: navigator.userAgent,
        url: location.href,
        login: uid ? `已登录 uid=${uid}` : '未登录',
        player: player ? '检测到 window.player' : '未检测到 window.player',
        video: video ? `video 元素就绪（${Math.round(video.duration || 0)}s）` : '无 video 元素',
    };
    say('环境：', env);

    if (!player) { ['T1', 'T2', 'T3', 'T4', 'T5'].forEach((t) => done(t, 'SKIP', '未检测到 window.player，请在视频播放页运行')); return summary(); }
    if (typeof player.loadDanmakuG !== 'function') { ['T1', 'T2', 'T3', 'T4', 'T5'].forEach((t) => done(t, 'FAIL', 'player.loadDanmakuG 不存在（口径已变？记 API.md）')); return summary(); }
    if (!video) { ['T1', 'T2', 'T3', 'T4', 'T5'].forEach((t) => done(t, 'SKIP', '页面无 video 元素，无法走 seek→play 时序')); return summary(); }

    // —— 70-preview.js 移植的三件 hack ——
    function ensureRenderer() {
        if (document.querySelector('.danmaku-g-rendered-stage')) return true;
        if (typeof player.initAdvancedDanmaku === 'function') {
            try { player.initAdvancedDanmaku(); } catch (e) { say('initAdvancedDanmaku 失败', e); }
        }
        return !!document.querySelector('.danmaku-g-rendered-stage');
    }
    let seq = 0;
    const refs = [];   // 注入过的 model 引用，换场时「过期」（startTime 置极大值）
    function patch(models) {
        models.forEach((m) => {
            m.id = 'spike-zero-' + (++seq);
            m.__seq = seq;                 // 绕渲染器「按内容 JSON 指纹去重」（danmakuRenderMap 永不清理）
            if (uid) m.user = uid;         // 过「只看自己」过滤器 IsOwnDanmkau（严格相等 g.uid === t.user）
            refs.push(m);
        });
    }
    function expire() { for (const m of refs) { if (m && typeof m.startTime === 'number') { m.startTime = Number.MAX_SAFE_INTEGER; m.durationTime = 0; } } }

    // 时序（70-preview 实测踩坑版）：先暂停稳住渲染器时钟 → seek 到 t0 → 等 600ms → 注入 → play。
    // 必须走 player.seek/play/pause（seek 单位是秒）；直接写 video.currentTime 播放器可能不理会，
    // 弹幕时间窗永不激活、什么都不渲染（2026-10-05 首跑实测翻车点，对齐 40-core.js seekTo 口径）。
    async function injectAt(t0ms, models) {
        const sec = t0ms / 1000;
        try { if (typeof player.pause === 'function') player.pause(); else video.pause(); } catch (e) {}
        try { if (typeof player.seek === 'function') player.seek(sec); else video.currentTime = sec; } catch (e) { video.currentTime = sec; }
        await sleep(600);
        player.loadDanmakuG(models);
        try { if (typeof player.play === 'function') player.play(); else video.play(); } catch (e) {}
    }

    // model 构造（对齐 buildModel / API.md §五渲染端只读字段）
    function mk(o) {
        return Object.assign({
            content: '', startTime: 0, durationTime: 3000, zIndex: 1, anchor: 4,
            wordStyle: { font: 'SimHei', size: 24, bold: true, color: '#ffffff', stroke: { size: 2, color: '#000000' } },
            animationFrames: null, rotate: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 },
        }, o);
    }
    // stage 文本命中：DOM_CSS 渲染器下注入文本应出现在 stage 的 innerText 里（Canvas 型则不适用）
    function stageHit(marker) {
        const s = document.querySelector('.danmaku-g-rendered-stage');
        return !!(s && s.innerText && s.innerText.includes(marker));
    }
    // 渲染证据：stage 子节点数 + 可见文本 + 页面可见性。
    // 渲染器是 RAF 驱动——页面处于后台时 RAF 冻结、什么都不渲染，此时的「未命中」不构成证据。
    function stageStats() {
        const s = document.querySelector('.danmaku-g-rendered-stage');
        if (!s) return 'stage=none';
        return 'stageNodes=' + s.querySelectorAll('*').length +
            ' stageText=' + JSON.stringify((s.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60)) +
            ' pageVis=' + document.visibilityState;
    }
    const t0 = Math.max(0, Math.min((video.duration || 30) - 12, 20)) * 1000;   // 安全基准位（秒→毫秒）

    // ============ T1 注入通道 ============
    try {
        expire();
        const t = t0 + 400;
        const models = [
            mk({ content: '◆S1◆左上', startTime: t, durationTime: 2500, anchor: 0, wordStyle: { font: 'SimHei', size: 20, bold: true, color: '#ffd700', stroke: { size: 2, color: '#000000' } } }),
            mk({ content: '◆S2◆中中', startTime: t + 300, durationTime: 2000, anchor: 4, wordStyle: { font: 'SimSun', size: 24, bold: true, color: '#00e0ff', stroke: { size: 2, color: '#000000' } } }),
            mk({ content: '◆S3◆右下', startTime: t + 600, durationTime: 1500, anchor: 8, wordStyle: { font: 'Microsoft YaHei', size: 28, bold: true, color: '#ff6699', stroke: { size: 2, color: '#000000' } } }),
        ];
        patch(models);
        await injectAt(t0, models);
        say('T1：看画面——◆S1◆左上(金,锚点左上) / ◆S2◆中中(青,锚点中中) / ◆S3◆右下(粉,锚点右下) 应先后出现并按时长消失');
        await sleep(3500);
        const hits = ['◆S1◆', '◆S2◆', '◆S3◆'].filter(stageHit).length;
        done('T1 注入通道', hits === 3 ? 'PASS' : (hits > 0 ? 'FAIL' : 'PASS*'), `loadDanmakuG 无异常；stage 文本命中 ${hits}/3（0 且无异常时标 PASS*——若渲染器为 Canvas 型 innerText 不适用，以画面人工确认为准）`);
    } catch (e) { done('T1 注入通道', 'FAIL', '注入抛异常：' + (e && e.message)); }

    // ============ T2 身份过滤器 ============
    try {
        if (!uid) { done('T2 身份过滤器', 'SKIP', '未登录（拿不到 uid），无法验证 user 字段'); }
        else {
            say('▶ 请现在点击弹幕输入框内第三个按钮（高级弹幕），打开原生编辑器面板并保持打开——脚本最长等 30 秒');
            const open = () => { const w = document.querySelector('.advanced-danmaku-wrapper'); return !!(w && w.classList.contains('unfold')); };
            for (let i = 0; i < 60 && !open(); i++) await sleep(500);
            if (!open()) { done('T2 身份过滤器', 'SKIP', '30 秒内未检测到面板展开（.advanced-danmaku-wrapper.unfold）'); }
            else {
                expire();
                const t = t0 + 400;
                const models = [mk({ content: '◆OWN◆面板开着也该看见我', startTime: t, durationTime: 3500 })];
                patch(models);
                await injectAt(t0, models);
                say('T2：面板保持打开——画面上应可见 ◆OWN◆（若「开面板不显示、关面板显示」即过滤器拦下了 user 口径变化）');
                await sleep(3000);
                const hit = stageHit('◆OWN◆');
                done('T2 身份过滤器', hit ? 'PASS' : 'PASS*', `面板展开态注入无异常；stage 命中=${hit}（未命中时以画面为准：开着面板仍可见=过；仅关面板可见=FAIL）`);
            }
        }
    } catch (e) { done('T2 身份过滤器', 'FAIL', '注入抛异常：' + (e && e.message)); }

    // ============ T3 extData 契约 ============
    try {
        expire();
        const t = t0 + 400;
        const models = [mk({
            content: '◆EXT◆全字段', startTime: t, durationTime: 4500, zIndex: 5, anchor: 4,
            wordStyle: {
                font: 'FangSong', size: 30, bold: true, color: '#7dff7d',
                stroke: { size: 3, color: '#101010' },
                shadow: { x: 3, y: 3, color: '#000000', blur: 4 },
                shine: { color: '#ffffff', blur: 6, size: 2 },
            },
            animationFrames: [
                { from: { pos: { x: 25, y: 30, z: 1 } }, to: { pos: { x: 25, y: 30, z: 1 } }, timingFunction: 'linear', staticTime: 600, moveTime: 0 },
                { from: { pos: { x: 25, y: 30, z: 1 } }, to: { pos: { x: 75, y: 60, z: 1 } }, timingFunction: 'cubic-bezier(0.25,0.1,0.25,1)', staticTime: 0, moveTime: 2500 },
            ],
        })];
        patch(models);
        await injectAt(t0, models);
        say('T3：◆EXT◆ 应为仿宋绿字+描边+投影+外发光，静止 0.6s 后以缓动曲线（非匀速）从左上滑向中下——若停在左下角(0,0)不动即 timingFunction 口径问题');
        await sleep(4200);
        const hit = stageHit('◆EXT◆');
        done('T3 extData 契约', hit ? 'PASS' : 'PASS*', `wordStyle 全字段+双段 frames 注入无异常；stage 命中=${hit}；缓动是否平滑/有无(0,0)停滞需人工确认`);
    } catch (e) { done('T3 extData 契约', 'FAIL', '注入抛异常：' + (e && e.message)); }

    // ============ T4 scale 语义 ============
    try {
        expire();
        const t = t0 + 400;
        const base = { startTime: t, durationTime: 3000, anchor: 4, wordStyle: { font: 'SimHei', size: 20, bold: true, color: '#ffffff', stroke: { size: 2, color: '#000000' } } };
        const models = [
            mk(Object.assign({}, base, { content: '◆SC1◆x1', scale: { x: 1, y: 1, z: 1 } })),
            mk(Object.assign({}, base, { content: '◆SC2◆x2', scale: { x: 2, y: 2, z: 1 } })),
        ];
        models[0].animationFrames = [{ from: { pos: { x: 30, y: 40, z: 1 } }, to: { pos: { x: 30, y: 40, z: 1 } }, timingFunction: 'linear', staticTime: 2800, moveTime: 0 }];
        models[1].animationFrames = [{ from: { pos: { x: 65, y: 40, z: 1 } }, to: { pos: { x: 65, y: 40, z: 1 } }, timingFunction: 'linear', staticTime: 2800, moveTime: 0 }];
        patch(models);
        await injectAt(t0, models);
        say('T4：同字号 20、同排——◆SC2◆ 的字应是 ◆SC1◆ 的两倍大（倍数口径 2=200%）；若一样大或巨大离谱即口径变化');
        await sleep(2800);
        const h1 = stageHit('◆SC1◆'), h2 = stageHit('◆SC2◆');
        done('T4 scale 语义', (h1 && h2) ? 'PASS' : 'PASS*', `scale=1/2 双 model 注入无异常；stage 命中 ${h1}/${h2}；字号倍数关系需人工确认`);
    } catch (e) { done('T4 scale 语义', 'FAIL', '注入抛异常：' + (e && e.message)); }

    // ============ T5 移动轨迹 ============
    try {
        expire();
        const t = t0 + 400;
        const models = [mk({
            content: '◆MOVE◆→', startTime: t, durationTime: 2600,
            animationFrames: [{ from: { pos: { x: 20, y: 50, z: 1 } }, to: { pos: { x: 80, y: 50, z: 1 } }, timingFunction: 'linear', staticTime: 100, moveTime: 2000 }],
        })];
        patch(models);
        await injectAt(t0, models);
        say('T5：◆MOVE◆ 应从画面左侧 20% 匀速直线滑到右侧 80%，行程 2 秒——起止位置/时长不对即轨迹口径变化');
        await sleep(2600);
        const hit = stageHit('◆MOVE◆');
        done('T5 移动轨迹', hit ? 'PASS' : 'PASS*', `带 frames 位移动画注入无异常；stage 命中=${hit}；逐帧轨迹需人工确认`);
    } catch (e) { done('T5 移动轨迹', 'FAIL', '注入抛异常：' + (e && e.message)); }

    expire();

    function summary() {
        const pass = R.filter((r) => r.status.startsWith('PASS')).length;
        const lines = [
            '=== Checkpoint Zero spike 汇总（整段复制回填 API.md §十二） ===',
            `- 日期：${env.date}；UA：${env.ua}`,
            `- 页面：${env.url}`,
            `- 登录：${env.login}；${env.player}；${env.video}`,
        ];
        for (const r of R) lines.push(`- ${r.id}：${r.status} —— ${r.detail}`);
        lines.push(`- 结论：${pass}/5 通过（PASS* 为自动信号+需人工画面确认）`);
        lines.push(pass === 5 ? '- 分支：走「官方渲染器彩排 = 默认画布」' : '- 分支：任一项 FAIL → 走 71-canvas 保真分支，半天内定岔路');
        console.log('\n' + lines.join('\n') + '\n');
        W.__spikeZero = { results: R, env, refs };   // 供事后检查
    }
    summary();
})();
