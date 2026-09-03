    // ============================================================
    //  弹幕模式（手动单条输入）
    // ============================================================

    // 切换 字幕模式 / 弹幕模式（预设、样式区在两种模式间复用）
    function switchPanelMode(mode) {
        panelMode = mode || (panelMode === 'subtitle' ? 'danmaku' : 'subtitle');
        const subBody = $('#cf-subtitle-body');
        const subAct = $('#cf-subtitle-actions');
        const dmBody = $('#cf-danmaku-body');
        const dmAct = $('#cf-danmaku-actions');
        const btn = $('#cf-toggle-danmaku');
        const hint = $('#cf-mode-hint');
        const presetSec = $('#cf-preset-sec');
        const styleSec = $('#cf-style-sec');
        const styleSourceRow = $('#cf-style-source-row');
        if (panelMode === 'danmaku') {
            if (subBody) subBody.style.display = 'none';
            if (subAct) subAct.style.display = 'none';
            if (dmBody) dmBody.style.display = '';
            if (dmAct) dmAct.style.display = '';
            // 预设/样式区移动到弹幕 body 末尾（DOM 移动保留事件）
            if (dmBody && presetSec) dmBody.appendChild(presetSec);
            if (dmBody && styleSec) dmBody.appendChild(styleSec);
            // 手动弹幕无 ASS，样式来源下拉无意义，隐藏
            if (styleSourceRow) styleSourceRow.style.display = 'none';
            if (btn) btn.textContent = '📂 字幕模式';
            if (hint) hint.textContent = '弹幕模式';
            status('📝 弹幕模式：预设与样式可复用');
        } else {
            if (subBody) subBody.style.display = '';
            if (subAct) subAct.style.display = '';
            if (dmBody) dmBody.style.display = 'none';
            if (dmAct) dmAct.style.display = 'none';
            if (subBody && presetSec) subBody.appendChild(presetSec);
            if (subBody && styleSec) subBody.appendChild(styleSec);
            if (styleSourceRow) styleSourceRow.style.display = '';
            if (btn) btn.textContent = '📝 弹幕模式';
            if (hint) hint.textContent = '字幕模式';
            status('📂 字幕模式');
        }
    }

    // 解析用户输入的时间：支持 mm:ss.xx / mm:ss / 纯秒数，返回毫秒；无效返回 null
    function parseManualTime(s) {
        if (!s || !s.trim()) return null;
        const t = s.trim();
        let ms = null;
        // 支持：
        //   mm:ss.xxx / mm:ss.xx / mm:ss       （分:秒.毫秒，两位小数按厘秒）
        //   hh:mm:ss.mmm / hh:mm:ss:mmm        （A 站原生编辑器格式：时:分:秒.毫秒）
        //   纯秒数 30.512
        const hms = t.match(/^(\d{1,3}):(\d{1,2}):(\d{1,2})[.:](\d{1,3})$/);   // 时:分:秒.毫秒
        if (hms) {
            const hh = parseInt(hms[1], 10);
            const mm = parseInt(hms[2], 10);
            const ss = parseInt(hms[3], 10);
            let frac = hms[4];
            if (frac.length === 1) frac += '00';
            else if (frac.length === 2) frac += '0';
            ms = hh * 3600000 + mm * 60000 + ss * 1000 + parseInt(frac.slice(0, 3), 10);
            return ms;
        }
        const ms1 = t.match(/^(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?$/);   // 分:秒.毫秒
        if (ms1) {
            const mm = parseInt(ms1[1], 10);
            const ss = parseInt(ms1[2], 10);
            let frac = ms1[3] || '0';
            if (frac.length === 1) frac += '00';
            else if (frac.length === 2) frac += '0';
            return mm * 60000 + ss * 1000 + parseInt(frac.slice(0, 3), 10);
        }
        if (/^\d+(\.\d+)?$/.test(t)) {   // 纯秒数
            return Math.round(parseFloat(t) * 1000);
        }
        return null;
    }

    // 把毫秒格式化成 A 站原生样式 HH:MM:SS:mmm
    function fmtManualTime(ms) {
        const t = Math.max(0, Math.round(ms));
        const h = Math.floor(t / 3600000);
        const m = Math.floor((t % 3600000) / 60000);
        const s = Math.floor((t % 60000) / 1000);
        const mm = t % 1000;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(mm).padStart(3, '0');
    }

    // 拾取当前播放位置填入「起始」输入框（格式同 A 站原生 HH:MM:SS:mmm）
    function pickManualTime() {
        const p = getPlayer();
        const curMs = (p && typeof p.currentTime === 'number') ? Math.round(p.currentTime * 1000) : 0;
        const inp = $('#cf-danmaku-time');
        if (inp) inp.value = fmtManualTime(curMs);
        status('⌚ 已拾取当前时间：' + fmtManualTime(curMs), 'ok');
    }

    // 从弹幕输入框构造一条虚拟字幕
    // 起始：输入框优先，留空则用当前播放位置
    // 持续：独立 ms 输入框
    function makeManualSub(text) {
        const p = getPlayer();
        const curMs = (p && typeof p.currentTime === 'number') ? Math.round(p.currentTime * 1000) : 0;
        const timeVal = ($('#cf-danmaku-time') || {}).value;
        const startCustom = parseManualTime(timeVal);
        // 填了但格式无效 → 报错拦下，不静默回退到当前播放位置
        if (timeVal && timeVal.trim() && startCustom == null) {
            return { error: '⚠️ 时间格式不对，用 00:00:01.974 或秒数' };
        }
        const start = startCustom != null ? startCustom : curMs;
        const durVal = parseInt(($('#cf-danmaku-duration') || {}).value, 10);
        const duration = (isNaN(durVal) || durVal < 100) ? DEFAULT_DURATION : Math.min(durVal, MAX_DURATION);
        return { time: start, duration, text: text.trim(), selected: true };
    }

    // 弹幕模式：预览
    async function previewManual() {
        const text = ($('#cf-danmaku-text') || {}).value;
        if (!text || !text.trim()) { status('请输入弹幕内容', 'err'); return; }
        readAdvancedConfig();
        const sub = makeManualSub(text);
        if (sub.error) { status(sub.error, 'err'); return; }
        await previewSub(sub);
    }

    // 弹幕模式：发送
    async function sendManual() {
        const text = ($('#cf-danmaku-text') || {}).value;
        if (!text || !text.trim()) { status('请输入弹幕内容', 'err'); return; }
        const v = getVideoInfo();
        if (!v || !v.videoId) { status('❌ 未获取到视频信息，请确认已登录', 'err'); return; }
        readAdvancedConfig();
        const sub = makeManualSub(text);
        if (sub.error) { status(sub.error, 'err'); return; }
        const cfg = cfgFor(sub);
        try {
            const models = expandSub(sub, cfg, sub.duration || DEFAULT_DURATION, 1);
            for (const m of models) await sendModel(m);
            status(`✅ 已发送：${text.trim()} @ ${fmt(Math.max(0, sub.time + timeOffset))}（${Math.round((sub.duration || DEFAULT_DURATION) / 1000)}s）`, 'ok');
            const inp = $('#cf-danmaku-text');
            if (inp) inp.value = '';
            const timeInp = $('#cf-danmaku-time');
            if (timeInp) timeInp.value = '';
            updateManualCount();
        } catch (e) {
            status('✗ 发送失败: ' + e.message, 'err');
        }
    }

    function updateManualCount() {
        const inp = $('#cf-danmaku-text');
        const cnt = $('#cf-danmaku-count');
        if (inp && cnt) cnt.textContent = (inp.value.length || 0) + '/255';
    }

    // ============================================================
    //  高级编辑（全字段）：读取 UI → advancedConfig
    // ============================================================

    // 缓动函数（CSS 合法值）。
    // 关键坑：A 站默认走 DOM_CSS 渲染器，把 timingFunction 原样塞进 CSS `animation` 简写，
    // 只有 CSS 原生关键字（linear/ease*/cubic-bezier）才合法。A 站编辑器那 30 种自定义
    // key（quadEaseIn 等）塞进去会导致整条 animation 失效、弹幕停在 0,0 不动。
    // 因此这里 value 一律用 CSS 合法值：标准关键字 + cubic-bezier 近似；label 汉化给用户看。
    const TIMING_FUNCS = [
        { value: 'linear', label: '匀速' },
        { value: 'ease-in', label: '缓入（标准）' },
        { value: 'ease-out', label: '缓出（标准）' },
        { value: 'ease-in-out', label: '缓入缓出（标准）' },
        { value: 'cubic-bezier(0.55,0.085,0.68,0.53)', label: '二次·缓入' },
        { value: 'cubic-bezier(0.25,0.46,0.45,0.94)', label: '二次·缓出' },
        { value: 'cubic-bezier(0.455,0.03,0.515,0.955)', label: '二次·缓入缓出' },
        { value: 'cubic-bezier(0.55,0.055,0.675,0.19)', label: '三次·缓入' },
        { value: 'cubic-bezier(0.215,0.61,0.355,1)', label: '三次·缓出' },
        { value: 'cubic-bezier(0.645,0.045,0.355,1)', label: '三次·缓入缓出' },
        { value: 'cubic-bezier(0.895,0.03,0.685,0.22)', label: '四次·缓入' },
        { value: 'cubic-bezier(0.165,0.84,0.44,1)', label: '四次·缓出' },
        { value: 'cubic-bezier(0.77,0,0.175,1)', label: '四次·缓入缓出' },
        { value: 'cubic-bezier(0.755,0.05,0.855,0.06)', label: '五次·缓入' },
        { value: 'cubic-bezier(0.23,1,0.32,1)', label: '五次·缓出' },
        { value: 'cubic-bezier(0.86,0,0.07,1)', label: '五次·缓入缓出' },
        { value: 'cubic-bezier(0.47,0,0.745,0.715)', label: '正弦·缓入' },
        { value: 'cubic-bezier(0.39,0.575,0.565,1)', label: '正弦·缓出' },
        { value: 'cubic-bezier(0.445,0.05,0.55,0.95)', label: '正弦·缓入缓出' },
        { value: 'cubic-bezier(0.95,0.05,0.795,0.035)', label: '指数·缓入' },
        { value: 'cubic-bezier(0.19,1,0.22,1)', label: '指数·缓出' },
        { value: 'cubic-bezier(1,0,0,1)', label: '指数·缓入缓出' },
        { value: 'cubic-bezier(0.6,0.04,0.98,0.335)', label: '圆形·缓入' },
        { value: 'cubic-bezier(0.075,0.82,0.165,1)', label: '圆形·缓出' },
        { value: 'cubic-bezier(0.785,0.135,0.15,0.86)', label: '圆形·缓入缓出' },
        { value: 'cubic-bezier(0.6,-0.28,0.735,0.045)', label: '回退·缓入' },
        { value: 'cubic-bezier(0.175,0.885,0.32,1.275)', label: '回退·缓出' },
        { value: 'cubic-bezier(0.68,-0.55,0.265,1.55)', label: '回退·缓入缓出' },
    ];

    // 从高级编辑 UI 读取值写回 advancedConfig
    function readAdvancedConfig() {
        const g = (id) => { const e = $(id); return e ? e.value : ''; };
        advancedConfig.zIndex = clamp(parseInt(g('#cf-adv-zindex'), 10), 1, 99) || DEFAULT_ZINDEX;
        advancedConfig.rotate = {
            x: num(parseFloat(g('#cf-adv-rx')), 0),
            y: num(parseFloat(g('#cf-adv-ry')), 0),
            z: num(parseFloat(g('#cf-adv-rz')), 0),
        };
        advancedConfig.scale = {
            x: num(parseFloat(g('#cf-adv-sx')), 1),
            y: num(parseFloat(g('#cf-adv-sy')), 1),
            z: 1,
        };
        const blurOn = (($('#cf-adv-blur-on') || {}).checked) === true;
        advancedConfig.blur = blurOn ? num(parseFloat(g('#cf-adv-blur')), 0) : 0;
        const shadowOn = (($('#cf-adv-sh-on') || {}).checked) === true;
        advancedConfig.shadow = shadowOn ? {
            x: num(parseFloat(g('#cf-adv-shx')), DEFAULT_SHADOW_PLACEHOLDER.x),
            y: num(parseFloat(g('#cf-adv-shy')), DEFAULT_SHADOW_PLACEHOLDER.y),
            blur: num(parseFloat(g('#cf-adv-shb')), DEFAULT_SHADOW_PLACEHOLDER.blur),
            color: g('#cf-adv-shc') || DEFAULT_SHADOW_PLACEHOLDER.color,
        } : null;
        const shineOn = (($('#cf-adv-sn-on') || {}).checked) === true;
        advancedConfig.shine = shineOn ? {
            blur: num(parseFloat(g('#cf-adv-snb')), DEFAULT_SHINE_PLACEHOLDER.blur),
            size: num(parseFloat(g('#cf-adv-sns')), DEFAULT_SHINE_PLACEHOLDER.size),
            color: g('#cf-adv-snc') || DEFAULT_SHINE_PLACEHOLDER.color,
        } : null;
        // 运动轨迹从动态列表读取：留空 → null（跟随样式/预设/顶层变换），
        // 显式填了数字才当固定值（区别于旧的 num(...,50) 会把空值硬兜成 50）。
        const moves = [];
        $$('#cf-moves .cf-move-item').forEach((item) => {
            const raw = (sel) => { const e = item.querySelector(sel); return e ? e.value : ''; };
            const coord = (sel) => { const v = raw(sel); return (v === '' || v == null) ? null : num(parseFloat(v), 50); };
            moves.push({
                fromX: coord('.cf-mv-fx'),
                fromY: coord('.cf-mv-fy'),
                toX: coord('.cf-mv-tx'),
                toY: coord('.cf-mv-ty'),
                fromScaleX: coord('.cf-mv-fsx'),
                fromScaleY: coord('.cf-mv-fsy'),
                toScaleX: coord('.cf-mv-tsx'),
                toScaleY: coord('.cf-mv-tsy'),
                fromRotateX: coord('.cf-mv-frx'),
                fromRotateY: coord('.cf-mv-fry'),
                fromRotateZ: coord('.cf-mv-frz'),
                toRotateX: coord('.cf-mv-trx'),
                toRotateY: coord('.cf-mv-try'),
                toRotateZ: coord('.cf-mv-trz'),
                moveTime: coord('.cf-mv-mt'),   // 空 → null（跟随 durationMs），显式数字才固定
                timingFunction: raw('.cf-mv-tf') || 'linear',
            });
        });
        advancedConfig.moves = moves.length ? moves : advancedConfig.moves;
    }

    // 高级字段开关联动：投影/外发光/模糊，勾选启用时放开子输入，否则禁用并置空
    // （对齐 A 站原生 isShadow/isShine/isBlur 语义）
    function syncAdvEnableUI() {
        // 激活预设带 effects 时，高级编辑整区由预设接管（syncEditorOwnedUI 已禁用），此处不覆盖
        if (activePresetEffects) return;
        const shOn = (($('#cf-adv-sh-on') || {}).checked) === true;
        const snOn = (($('#cf-adv-sn-on') || {}).checked) === true;
        const blurOn = (($('#cf-adv-blur-on') || {}).checked) === true;
        ['#cf-adv-shx', '#cf-adv-shy', '#cf-adv-shb', '#cf-adv-shc'].forEach((s) => { const e = $(s); if (e) e.disabled = !shOn; });
        ['#cf-adv-snb', '#cf-adv-sns', '#cf-adv-snc'].forEach((s) => { const e = $(s); if (e) e.disabled = !snOn; });
        const b = $('#cf-adv-blur'); if (b) b.disabled = !blurOn;
    }

    // 旋转角度 → 圈数展示：|度|≤360 返回空（直接看度数），超过一圈显示「N圈M°」便于判断圈数
    function rotateLabel(deg) {
        const d = +deg;
        if (!isFinite(d) || Math.abs(d) <= 360) return '';
        const sign = d < 0 ? '-' : '';
        const abs = Math.abs(d);
        const turns = Math.floor(abs / 360);
        const rest = Math.round(abs % 360);
        return rest === 0 ? `${sign}${turns}圈` : `${sign}${turns}圈${rest}°`;
    }

    // 渲染运动轨迹列表
    function renderMoves() {
        const box = $('#cf-moves');
        if (!box) return;
        box.innerHTML = advancedConfig.moves.map((mv, i) => {
            // null 坐标显示为空输入框（占位提示「跟随样式」），显式数字才显示数值
            const v = (n) => (n == null ? '' : n);
            return `
            <div class="cf-move-item" data-i="${i}">
                <button type="button" class="cf-move-toggle">⚙ 高级</button>
                <button type="button" class="cf-move-del">删除</button>
                <div class="cf-row"><label>起点</label>X<input type="number" class="cf-mv-fx" min="0" max="100" placeholder="跟随样式" value="${v(mv.fromX)}">Y<input type="number" class="cf-mv-fy" min="0" max="100" placeholder="跟随样式" value="${v(mv.fromY)}"></div>
                <div class="cf-row"><label>终点</label>X<input type="number" class="cf-mv-tx" min="0" max="100" placeholder="跟随样式" value="${v(mv.toX)}">Y<input type="number" class="cf-mv-ty" min="0" max="100" placeholder="跟随样式" value="${v(mv.toY)}"></div>
                <div class="cf-move-adv" style="display:none">
                    <div class="cf-row"><label>起点拉伸</label>X<input type="number" class="cf-mv-fsx" min="0.1" max="5" step="0.1" placeholder="跟随本体" value="${v(mv.fromScaleX)}">Y<input type="number" class="cf-mv-fsy" min="0.1" max="5" step="0.1" placeholder="跟随本体" value="${v(mv.fromScaleY)}"></div>
                    <div class="cf-row"><label>终点拉伸</label>X<input type="number" class="cf-mv-tsx" min="0.1" max="5" step="0.1" placeholder="跟随本体" value="${v(mv.toScaleX)}">Y<input type="number" class="cf-mv-tsy" min="0.1" max="5" step="0.1" placeholder="跟随本体" value="${v(mv.toScaleY)}"></div>
                    <div class="cf-row"><label>起点旋转</label>X<input type="number" class="cf-mv-frx cf-rot-inp" min="-3600" max="3600" placeholder="0" value="${v(mv.fromRotateX)}"><span class="cf-rot-hint"></span>Y<input type="number" class="cf-mv-fry cf-rot-inp" min="-3600" max="3600" placeholder="0" value="${v(mv.fromRotateY)}"><span class="cf-rot-hint"></span>Z<input type="number" class="cf-mv-frz cf-rot-inp" min="-3600" max="3600" placeholder="0" value="${v(mv.fromRotateZ)}"><span class="cf-rot-hint"></span></div>
                    <div class="cf-row"><label>终点旋转</label>X<input type="number" class="cf-mv-trx cf-rot-inp" min="-3600" max="3600" placeholder="0" value="${v(mv.toRotateX)}"><span class="cf-rot-hint"></span>Y<input type="number" class="cf-mv-try cf-rot-inp" min="-3600" max="3600" placeholder="0" value="${v(mv.toRotateY)}"><span class="cf-rot-hint"></span>Z<input type="number" class="cf-mv-trz cf-rot-inp" min="-3600" max="3600" placeholder="0" value="${v(mv.toRotateZ)}"><span class="cf-rot-hint"></span></div>
                </div>
                <div class="cf-row"><label>耗时</label><input type="number" class="cf-mv-mt" min="100" max="${MAX_DURATION}" step="100" placeholder="跟随时长" value="${v(mv.moveTime)}"><span style="font-size:11px;color:#999">ms</span>
                    <label>缓动</label><select class="cf-mv-tf">${TIMING_FUNCS.map((f) => `<option value="${f.value}"${f.value === (mv.timingFunction || 'linear') ? ' selected' : ''}>${f.label}</option>`).join('')}</select>
                </div>
            </div>`;
        }).join('');
        // 删除按钮
        box.querySelectorAll('.cf-move-del').forEach((btn) => {
            btn.addEventListener('click', () => {
                const i = +btn.closest('.cf-move-item').dataset.i;
                if (advancedConfig.moves.length <= 1) { status('至少保留一个动作', 'err'); return; }
                advancedConfig.moves.splice(i, 1);
                renderMoves();
            });
        });
        // 「⚙ 高级」折叠：展开/收起该段的拉伸+旋转高级项
        box.querySelectorAll('.cf-move-toggle').forEach((btn) => {
            btn.addEventListener('click', () => {
                const adv = btn.closest('.cf-move-item').querySelector('.cf-move-adv');
                if (!adv) return;
                const hidden = adv.style.display === 'none';
                adv.style.display = hidden ? '' : 'none';
                btn.textContent = hidden ? '▲ 收起' : '⚙ 高级';
            });
        });
        // 旋转圈数提示：输入变化时实时刷新旁边的「N圈M°」
        box.querySelectorAll('.cf-rot-inp').forEach((inp) => {
            const hint = inp.nextElementSibling;
            const upd = () => { if (hint) hint.textContent = rotateLabel(inp.value); };
            inp.addEventListener('input', upd);
            upd();
        });
    }

    // 添加一个运动动作：坐标/缩放/旋转/耗时默认空（跟随样式/预设与顶层变换），用户可手动填数字接管
    function addMove() {
        advancedConfig.moves.push({
            fromX: null, fromY: null, toX: null, toY: null,
            fromScaleX: null, fromScaleY: null, toScaleX: null, toScaleY: null,
            fromRotateX: null, fromRotateY: null, fromRotateZ: null,
            toRotateX: null, toRotateY: null, toRotateZ: null,
            moveTime: null, timingFunction: 'linear',
        });
        renderMoves();
    }

    // 高级编辑「恢复默认」：重置 advancedConfig 为默认快照，并同步全部控件/开关/运动轨迹 UI
    function resetAdvancedConfig() {
        advancedConfig = JSON.parse(JSON.stringify(DEFAULT_ADVANCED_CONFIG));
        const setVal = (id, val) => { const e = $(id); if (e) e.value = val; };
        setVal('#cf-adv-zindex', advancedConfig.zIndex);
        setVal('#cf-adv-rx', advancedConfig.rotate.x);
        setVal('#cf-adv-ry', advancedConfig.rotate.y);
        setVal('#cf-adv-rz', advancedConfig.rotate.z);
        setVal('#cf-adv-sx', advancedConfig.scale.x);
        setVal('#cf-adv-sy', advancedConfig.scale.y);
        setVal('#cf-adv-blur', advancedConfig.blur);
        // 投影/外发光：关闭并复位占位值
        setVal('#cf-adv-shx', DEFAULT_SHADOW_PLACEHOLDER.x);
        setVal('#cf-adv-shy', DEFAULT_SHADOW_PLACEHOLDER.y);
        setVal('#cf-adv-shb', DEFAULT_SHADOW_PLACEHOLDER.blur);
        setVal('#cf-adv-shc', DEFAULT_SHADOW_PLACEHOLDER.color);
        setVal('#cf-adv-snb', DEFAULT_SHINE_PLACEHOLDER.blur);
        setVal('#cf-adv-sns', DEFAULT_SHINE_PLACEHOLDER.size);
        setVal('#cf-adv-snc', DEFAULT_SHINE_PLACEHOLDER.color);
        const shOn = $('#cf-adv-sh-on'); if (shOn) shOn.checked = false;
        const snOn = $('#cf-adv-sn-on'); if (snOn) snOn.checked = false;
        const blurOn = $('#cf-adv-blur-on'); if (blurOn) blurOn.checked = false;
        syncAdvEnableUI();
        renderMoves();
        status('↩ 高级编辑已恢复默认', 'ok');
    }

    // 高级编辑折叠
    let advFolded = false;
    function toggleAdvFold() {
        advFolded = !advFolded;
        const body = $('#cf-adv-body');
        const btn = $('#cf-fold-adv');
        if (body) body.style.display = advFolded ? 'none' : '';
        if (btn) btn.textContent = advFolded ? '展开' : '折叠';
    }

    // 导出前的「可调字段」勾选层：勾中的字段会写成 params 声明（导入后可在预设区微调），
    // 未勾选的字段仍随 effects 整体导出并生效，只是不进入可调控件。
    function openAdjustablePicker(onConfirm) {
        const old = $('#cf-adjust-picker');
        if (old) old.remove();

        const mask = document.createElement('div');
        mask.id = 'cf-adjust-picker';
        mask.className = 'cf-adjust-picker';
        mask.innerHTML = `
            <div class="cf-adjust-dlg">
                <p class="cf-adjust-title">导出预设 · 勾选可调字段</p>
                <p class="cf-adjust-sub">勾选的字段写入 JSON 的 params，导入后可在预设区微调；未勾选仍生效但不可调。</p>
                <div class="cf-adjust-tools">
                    <button type="button" class="cf-fold-btn" data-act="all">全选</button>
                    <button type="button" class="cf-fold-btn" data-act="none">全不选</button>
                </div>
                <div class="cf-adjust-body"></div>
                <div class="cf-adjust-foot">
                    <button type="button" class="cf-btn cf-btn-b" data-act="cancel">取消</button>
                    <button type="button" class="cf-btn cf-btn-p" data-act="ok">导出</button>
                </div>
            </div>`;
        document.body.appendChild(mask);

        const body = mask.querySelector('.cf-adjust-body');
        let lastGroup = undefined;
        ADJUSTABLE_FIELDS.forEach((f) => {
            if (f.group !== lastGroup) {
                lastGroup = f.group;
                const t = document.createElement('div');
                t.className = 'cf-param-group-title';
                t.textContent = f.group;
                body.appendChild(t);
            }
            const row = document.createElement('label');
            row.className = 'cf-adjust-item';
            row.innerHTML = `<input type="checkbox" data-key="${f.key}" checked><span>${f.label}</span>`;
            body.appendChild(row);
        });

        const checks = () => Array.from(mask.querySelectorAll('input[type=checkbox]'));
        mask.querySelector('[data-act=all]').addEventListener('click', () => checks().forEach((c) => { c.checked = true; }));
        mask.querySelector('[data-act=none]').addEventListener('click', () => checks().forEach((c) => { c.checked = false; }));
        mask.querySelector('[data-act=cancel]').addEventListener('click', () => mask.remove());
        mask.querySelector('[data-act=ok]').addEventListener('click', () => {
            const keys = checks().filter((c) => c.checked).map((c) => c.dataset.key);
            mask.remove();
            onConfirm(keys);
        });
        mask.addEventListener('click', (e) => { if (e.target === mask) mask.remove(); });
    }

    // 一键导出：把当前样式 + 高级字段打包成 declarative 预设
    function exportAdvancedPreset() {
        readAdvancedConfig();
        openAdjustablePicker((checkedKeys) => {
            const chosen = new Set(checkedKeys);
            // 勾选的字段 → params 声明（保留 type/min/max/step/group/default，供导入后渲染控件）
            const params = ADJUSTABLE_FIELDS
                .filter((f) => chosen.has(f.key))
                .map((f) => {
                    const p = { key: f.key, label: f.label, type: f.type, group: f.group };
                    if (f.min !== undefined) p.min = f.min;
                    if (f.max !== undefined) p.max = f.max;
                    if (f.step !== undefined) p.step = f.step;
                    if (f.default !== undefined) p.default = f.default;
                    if (f.choices) p.choices = f.choices;
                    return p;
                });
            const name = '高级弹幕-' + Date.now();
            const id = 'adv-' + Math.random().toString(36).slice(2, 8);
            // 若运动轨迹里填了固定坐标，说明位置被接管，编辑器位置 X/Y 应禁用
            const hasFixedCoords = advancedConfig.moves.some((m) =>
                m.fromX != null || m.fromY != null || m.toX != null || m.toY != null);
            const preset = {
                id,
                name,
                desc: `由编辑器导出的全字段预设（含样式与运动，可调字段 ${params.length} 个）`,
                transform: 'none',
                options: {},
                params,
                owns: hasFixedCoords ? ['posX', 'posY'] : [],
                // 高级字段统一放 effects：导入后批量发送会应用这些字段
                effects: {
                    zIndex: advancedConfig.zIndex,
                    rotate: Object.assign({}, advancedConfig.rotate),
                    scale: Object.assign({}, advancedConfig.scale),
                    blur: advancedConfig.blur,
                    shine: advancedConfig.shine ? Object.assign({}, advancedConfig.shine) : null,
                    shadow: advancedConfig.shadow ? Object.assign({}, advancedConfig.shadow) : null,
                    moves: advancedConfig.moves.map((m) => Object.assign({}, m)),
                },
            };
            downloadJson(name + '.json', preset);
            status(`📤 已导出高级预设 ${name}.json（可调字段 ${params.length} 个）`, 'ok');
        });
    }

