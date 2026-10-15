    // ============================================================
    //  入口切换（替换式）
    // ============================================================
    // 理解卡｜我拥有：装配点 init()（initPresets→injectStyle→ensurePanel→bindEvents→setupEntry，DOMContentLoaded 门控）、
    //   约 155 行仿原生 CSS（injectStyle 单点注入，含闸④ 台账浮层）、入口按钮组、
    //   等原生面板壳出现的 MutationObserver（6.18.0：病灶③ 的 400ms 轮询已清零，策略在 15-shell-watch.js）。
    // 我承诺：switchView 切换时显隐原生 navs/content（寄生替换式——P3 改为浮层共存，行为变更已立项）。
    // 我永不：**定时器**（6.18.0 起全仓 setInterval = 0 处，tools/check.mjs 的守卫上限已从 1 收到 0，
    //   没有再涨的余地）；新样式只进 injectStyle 单点。
    //   ——代价（换掉轮询换来什么、又押上了什么）：稳态回调零查询、壳重建能自愈；但「壳什么时候出现」
    //   从此由 DOM 变动驱动而非定时兜底，真机时序未验，取舍与假设逐条写在 RELEASE_NOTES 6.18.0 的
    //   「已知边界」里（首要一条：观察目标 #danmaku 若被整体替换，观察器会静默失效）。
    // 改我前读：面板注入依赖 .danmaku-g-launcher-panel 存在（原生面板壳）；SCRIPT_VERSION 读 GM_info；
    //   「等壳出现」的判据（幂等 / 早退 / 壳重建 / 展开边沿）全在 15-shell-watch.js，本文件只提供
    //   五个依赖与观察目标；观察器挂在 #danmaku —— 实测原生 DOM 是
    //   #danmaku > .advanced-danmaku-wrapper > .danmaku-launcher-container > .danmaku-g-launcher-panel-wrapper
    //   > .danmaku-g-launcher-panel，壳只可能在 #danmaku 里出现/重建；#danmaku 取不到时退到 document.body；
    //   6.8.0 起 IIFE 外壳由 build.js 的 banner/footer 提供，本文件不再是收口点（原 `})();` 已删）。

import { $, log, status } from './20-utils.js';
import { createShellWatch } from './15-shell-watch.js';
import { getPlayer } from './40-core.js';
import { initPresets } from './50-engine.js';
import { ensurePanel, getDefaultNative, isOurView, setDefaultNative, setIsOurView } from './80-ui.js';
import { bindEvents } from './95-events.js';

    // 观察器句柄（15-shell-watch 的策略函数是纯的，观察器本体在这里创建）：
    // 浏览器会因「仍在观察」保住它，但不依赖这条实现细节——setupEntry 里把它挂在这里，别落进 GC 射程。
    let entryObserver = null;

    function getNativePanel() { return $('.danmaku-g-launcher-panel'); }

    // 面板是否处于展开状态（wrapper 带 unfold class）
    function isLauncherOpen() {
        const w = $('.advanced-danmaku-wrapper');
        return !!(w && w.classList.contains('unfold'));
    }

    // 切换视图：保留原生标题栏，只替换标题栏下方的区域
    function switchView(toOur) {
        setIsOurView(toOur);
        const native = getNativePanel();
        if (!native) return;
        const our = ensurePanel();
        const title = native.querySelector('.panel-title');

        // 我们的面板插到标题栏之后，作为 panel 的内容区
        if (title && our.parentNode !== native) {
            title.insertAdjacentElement('afterend', our);
        }

        // 原生内容区 = 标题栏以外的兄弟节点
        ['.panel-navs', '.panel-content-wrapper', '.panel-actions'].forEach((sel) => {
            const el = native.querySelector(sel);
            if (el) el.style.display = toOur ? 'none' : '';
        });

        our.style.display = toOur ? '' : 'none';

        injectNativeEntry(native);
    }

    function syncEntryBtn() {
        const btn = $('#cf-entry-btn');
        if (btn) btn.textContent = isOurView ? '↩ 原生编辑器' : '📝 字幕发送';
    }

    function injectNativeEntry(native) {
        const title = native.querySelector('.panel-title');
        if (!title) return;
        if (title.querySelector('#cf-entry-group')) { syncEntryBtn(); return; }

        const group = document.createElement('span');
        group.id = 'cf-entry-group';
        group.innerHTML = `
            <label class="cf-default-chk" title="打开面板时，是否默认进入 A 站原生编辑器">
                <input type="checkbox" id="cf-default-native"> 默认原生
            </label>
            <button type="button" class="cf-entry-btn" id="cf-entry-btn">字幕发送</button>`;
        title.appendChild(group);

        const chk = group.querySelector('#cf-default-native');
        chk.checked = getDefaultNative();
        chk.addEventListener('change', () => setDefaultNative(chk.checked));

        group.querySelector('#cf-entry-btn').addEventListener('click', () => switchView(!isOurView));
        syncEntryBtn();
    }

    function setupEntry() {
        // 面板从折叠变展开的边沿：注入入口 + 按默认设置决定视图
        function onLauncherOpen() {
            log('🔔 检测到高级弹幕面板展开');
            const native = getNativePanel();
            if (native) { injectNativeEntry(native); switchView(!getDefaultNative()); }
            else { log('⚠️ 未找到 .danmaku-g-launcher-panel'); }
        }

        // 等壳出现 / 重建 → 注入入口。策略（幂等 / O(1) 早退 / 壳重建 / 展开边沿）全在 15-shell-watch.js，
        // 这里只给五个依赖：找壳、判「已注入」、注入动作、读展开态、展开边沿做什么。
        const watch = createShellWatch({
            findShell: getNativePanel,
            // 判据与 injectNativeEntry 内部同源（都在标题栏下找 #cf-entry-group），这里放宽到整个壳
            isInjected: (native) => !!native.querySelector('#cf-entry-group'),
            inject: injectNativeEntry,
            isLauncherOpen,
            launcherWrapperClass: 'advanced-danmaku-wrapper',
            onLauncherOpen,
        });

        // 玩家事件：与观察器共用同一份展开记忆（一处分叉就会重复处理同一次展开）
        const p = getPlayer();
        if (p && p.on) {
            p.on('openDanmakuGLauncher', () => watch.opened());
            p.on('closeDanmakuGLauncher', () => watch.closed());
        }

        // 主机制：事件驱动（6.18.0 替掉 400ms 轮询）。观察目标取 #danmaku（原生面板壳的宿主区，
        // 见理解卡里的实测 DOM 链）——它是能包住壳的最窄的稳定容器；取不到时（别的页面形态）
        // 退到 document.body，那时的代价是**整页**的节点增删与 class 变动都会进回调。
        // 回调的闸门在 15-shell-watch.js：与本片无关的批次直接返回、稳态（入口已注入 + 壳在树上）
        // 零查询——所以上面的代价只是空转的微任务，不是重复查找与重复注入。
        const target = $('#danmaku') || document.body;
        entryObserver = new MutationObserver(watch.sweep);
        entryObserver.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

        watch.sweep([]);     // 立即巡检一次：@run-at document-idle 下壳可能已经在了

        log('✅ 入口已就绪：点第三个按钮（高级弹幕）展开编辑器，标题栏“高级弹幕”旁即切换入口');
    }

    // ============================================================
    //  样式
    // ============================================================

    function injectStyle() {
        const S = document.createElement('style');
        S.textContent = `
        /* —— 仿 A 站原生高级弹幕面板：浅色主题，主色 #fd4c5d —— */
        #cf-sub-panel{display:flex;flex-direction:column;width:100%;max-width:100%;min-width:0;flex:1 1 0;min-height:0;height:auto;background:#fff;color:#666;font:12px/1.6 PingFangSC,-apple-system,Microsoft Yahei,sans-serif;overflow:hidden;box-sizing:border-box}
        #cf-sub-panel *{box-sizing:border-box;max-width:100%}
        #cf-sub-panel .cf-panel-body{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:14px}
        #cf-sub-panel .cf-mode-bar{flex:none;display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #e5e5e5;background:#fafafa}
        #cf-sub-panel .cf-mode-hint{font-size:12px;font-weight:500;color:#333;margin-right:auto}
        #cf-sub-panel .cf-sec{border-bottom:1px solid #e5e5e5;padding-bottom:14px}
        #cf-sub-panel .cf-sec:last-child{border-bottom:none;padding-bottom:0}
        #cf-sub-panel .cf-sec-title{position:relative;font-weight:500;font-size:14px;color:#333;line-height:16px;margin:0 0 10px}
        #cf-sub-panel .cf-cnt{margin-left:8px;color:#999;font-weight:400;font-size:12px}
        #cf-sub-panel .cf-drop{border:1px dashed #ccc;border-radius:3px;padding:16px;text-align:center;cursor:pointer;transition:.2s;color:#666}
        #cf-sub-panel .cf-drop:hover{border-color:#fd4c5d;background:#fff5f5}
        #cf-sub-panel .cf-drop-icon{font-size:26px}
        #cf-sub-panel .cf-drop-hint{font-size:11px;color:#999;margin-top:2px}
        /* 弹幕模式输入框（仿原生 danmaku-g-input） */
        #cf-sub-panel .cf-danmaku-input-wrap{position:relative}
        #cf-sub-panel .cf-danmaku-input{width:100%;height:62px;padding:8px;border:1px solid #e5e5e5;border-radius:3px;background:#fff;color:rgba(0,0,0,.65);font-size:14px;line-height:1.5;outline:none;resize:none;box-sizing:border-box;transition:border-color .3s}
        #cf-sub-panel .cf-danmaku-input:focus{border-color:#fd4c5d}
        #cf-sub-panel .cf-danmaku-count{position:absolute;right:8px;bottom:6px;font-size:11px;color:#999;pointer-events:none}
        #cf-sub-panel .cf-danmaku-tip{font-size:11px;color:#999;margin-top:6px}
        #cf-sub-panel .cf-adv-3{display:inline-flex;align-items:center;gap:2px;font-size:11px;color:#666}
        #cf-sub-panel .cf-adv-3 input{width:48px}
        #cf-sub-panel .cf-rot-hint{display:inline-block;min-width:0;margin-left:2px;font-size:10px;color:#fa8c16;line-height:1}
        #cf-sub-panel .cf-move-item{border:1px solid #e5e5e5;border-radius:4px;padding:6px;margin-bottom:6px;background:#fafafa}
        #cf-sub-panel .cf-move-item .cf-row{margin-bottom:4px}
        #cf-sub-panel .cf-move-del{background:#fff;border:1px solid #f5222d;color:#f5222d;border-radius:3px;font-size:11px;padding:1px 8px;cursor:pointer;float:right}
        #cf-sub-panel .cf-move-toggle{background:#fff;border:1px solid #999;color:#666;border-radius:3px;font-size:11px;padding:1px 8px;cursor:pointer;float:right;margin-right:6px}
        #cf-sub-panel .cf-list{border:1px solid #e5e5e5;border-radius:3px;max-height:200px;overflow-y:auto;background:#fff}
        #cf-sub-panel .cf-empty{text-align:center;color:#999;padding:18px;font-size:12px}
        #cf-sub-panel .cf-item{display:flex;align-items:center;gap:8px;padding:5px 10px;border-bottom:1px solid #f0f0f0;cursor:pointer;font-size:12px}
        #cf-sub-panel .cf-item:last-child{border-bottom:none}
        #cf-sub-panel .cf-item:hover{background:#f5f5f5}
        #cf-sub-panel .cf-item.s-ing{background:#fffbe6}
        #cf-sub-panel .cf-item.s-ok{background:#f6ffed}
        #cf-sub-panel .cf-item.s-err{background:#fff1f0}
        #cf-sub-panel .cf-chk-item{flex:0 0 14px;width:14px;height:14px;margin:0;accent-color:#fd4c5d;cursor:pointer}
        #cf-sub-panel .cf-t{font-family:monospace;color:#409bef;flex:0 0 78px}
        #cf-sub-panel .cf-c{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#333}
        #cf-sub-panel .cf-s{flex:0 0 18px;text-align:center}
        #cf-sub-panel .s-ok{color:#52c41a}#cf-sub-panel .s-ing{color:#faad14}#cf-sub-panel .s-err{color:#f5222d}
        #cf-sub-panel .cf-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px}
        #cf-sub-panel .cf-row label{font-size:12px;color:#666;min-width:30px}
        #cf-sub-panel .cf-row select,#cf-sub-panel .cf-row input{background:#fff;border:1px solid #e5e5e5;border-radius:3px;color:rgba(0,0,0,.65);padding:2px 8px;font-size:12px;outline:none;height:22px;transition:all .3s}
        #cf-sub-panel .cf-row select:focus,#cf-sub-panel .cf-row input:focus{border-color:#fd4c5d}
        #cf-sub-panel .cf-row input[type=number]{width:56px}
        #cf-sub-panel .cf-row input[type=color]{width:36px;height:22px;padding:0;border:1px solid #e5e5e5;background:#fff;cursor:pointer}
        /* 宽输入框：带元素选择器（input.cf-wide-input），优先级与 input[type=number] 同级，
           靠声明顺序压过默认 56px 窄框，避免长数字/时间值被裁剪 */
        #cf-sub-panel .cf-row input.cf-wide-input{width:112px}
        #cf-sub-panel .cf-owner-disabled{opacity:.45;pointer-events:none;background:#f5f5f5}
        #cf-sub-panel .cf-gap{flex:0 0 6px}
        #cf-sub-panel .cf-chk{display:inline-flex;align-items:center;gap:4px;cursor:pointer;color:#666;font-size:12px}
        #cf-sub-panel .cf-chk input{accent-color:#fd4c5d}
        #cf-sub-panel .cf-anchor-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;width:100%}
        #cf-sub-panel .cf-anchor-cell{border:1px solid #e5e5e5;border-radius:3px;text-align:center;font-size:11px;padding:3px 0;cursor:pointer;transition:.15s;color:#666;background:#fff}
        #cf-sub-panel .cf-anchor-cell:hover{background:#f5f5f5}
        #cf-sub-panel .cf-anchor-cell.sel{background:#fd4c5d;border-color:#fd4c5d;color:#fff}
        #cf-sub-panel .cf-panel-actions{display:flex;flex-direction:column;gap:6px;padding:10px;border-top:1px solid #e5e5e5;background:#f4f4f4;flex:none}
        #cf-sub-panel .cf-actions-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
        #cf-sub-panel .cf-fold-btn{margin-left:8px;background:#fff;border:1px solid #999;border-radius:2px;color:#666;font-size:11px;padding:1px 8px;cursor:pointer;line-height:16px;font-weight:400}
        #cf-sub-panel .cf-fold-btn:hover{background:#e5e5e5}
        #cf-sub-panel .cf-slice-chk{margin-left:8px;display:inline-flex;align-items:center;gap:3px;font-size:11px;color:#666;cursor:pointer;white-space:nowrap;font-weight:400}
        #cf-sub-panel .cf-slice-chk input{accent-color:#fd4c5d;cursor:pointer}
        #cf-sub-panel .cf-preset-desc{font-size:11px;color:#999;margin-bottom:8px}
        #cf-sub-panel .cf-preset-author{font-size:12px;color:#999;cursor:help;margin-left:4px;vertical-align:middle;user-select:none}
        #cf-sub-panel .cf-preset-params{display:flex;flex-direction:column;gap:6px;margin-bottom:8px}
        #cf-sub-panel .cf-param-group-title{font-size:11px;color:#fd4c5d;font-weight:600;margin:8px 0 2px;padding-bottom:2px;border-bottom:1px solid #f0f0f0}
        #cf-sub-panel .cf-preset-param-row{margin-bottom:2px}
        #cf-sub-panel .cf-preset-param-row label{min-width:70px}
        #cf-sub-panel .cf-sub2-btn{display:inline-block;background:#fff;border:1px solid #fd4c5d;border-radius:3px;color:#fd4c5d;font-size:12px;padding:2px 10px;cursor:pointer}
        #cf-sub-panel .cf-sub2-btn:hover{background:#fd4c5d;color:#fff}
        #cf-sub-panel .cf-sub2-hint{font-size:11px;color:#999}
        #cf-sub-panel .cf-interval{margin-left:auto;display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#666;white-space:nowrap}
        #cf-sub-panel .cf-interval input{width:64px;height:22px;background:#fff;border:1px solid #e5e5e5;border-radius:3px;color:rgba(0,0,0,.65);padding:2px 6px;font-size:12px;outline:none}
        #cf-sub-panel .cf-interval input:focus{border-color:#fd4c5d}
        #cf-sub-panel .cf-flex{flex:1}
        #cf-sub-panel .cf-btn{border:1px solid transparent;border-radius:3px;padding:4px 12px;font-size:12px;cursor:pointer;transition:.15s;height:24px;line-height:16px}
        #cf-sub-panel .cf-btn:disabled{opacity:.4;cursor:not-allowed}
        #cf-sub-panel .cf-btn-p{background-color:#fd4c5d;border-color:#fd4c5d;color:#fff}
        #cf-sub-panel .cf-btn-p:hover:not(:disabled){background-color:#ec4556;border-color:#ec4556}
        #cf-sub-panel .cf-btn-b{background:#f4f4f4;border:1px solid #999;color:#666}
        #cf-sub-panel .cf-btn-b:hover:not(:disabled){background:#e5e5e5}
        #cf-sub-panel .cf-status{padding:6px 10px;font-size:12px;background:#fafafa;border-top:1px solid #e5e5e5;min-height:18px;word-break:break-all;color:#666;flex:none}
        #cf-sub-panel .cf-status.ok{background:#f6ffed;color:#52c41a}
        #cf-sub-panel .cf-status.err{background:#fff1f0;color:#f5222d}
        #cf-sub-panel .cf-status.busy{background:#fffbe6;color:#faad14}
        /* 计数闸（闸③）：常驻计数行 + 大批量二次确认的内联面板（不用原生 confirm，白名单只减不增） */
        #cf-sub-panel .cf-audit{font-size:11px;line-height:16px;color:#999;word-break:break-all}
        #cf-sub-panel .cf-audit.ok{color:#52c41a}
        #cf-sub-panel .cf-audit.warn{color:#faad14}
        #cf-sub-panel .cf-audit.bad{color:#f5222d}
        /* 身份行（6.16.0 身份感知，紧贴计数行下方）：三态各自配色——他人视频用警示黄，自己的视频用常规绿，
           身份未知保持中性灰（不确定不该被染成危险或安全任一种脸色） */
        #cf-sub-panel .cf-identity{font-size:11px;line-height:16px;color:#999;word-break:break-all}
        #cf-sub-panel .cf-identity.self{color:#52c41a}
        #cf-sub-panel .cf-identity.other{color:#faad14}
        #cf-sub-panel .cf-identity.unknown{color:#999}
        #cf-audit-confirm .cf-dev-sub b{color:#fd4c5d}
        #cf-audit-confirm .cf-audit-btn{border:1px solid #999;background:#f4f4f4;color:#666;border-radius:3px;padding:4px 12px;font-size:12px;height:24px;line-height:16px;cursor:pointer}
        #cf-audit-confirm .cf-audit-btn:hover:not(:disabled){background:#e5e5e5}
        #cf-audit-confirm .cf-audit-btn.primary{background:#fd4c5d;border-color:#fd4c5d;color:#fff}
        #cf-audit-confirm .cf-audit-btn.primary:hover:not(:disabled){background:#ec4556;border-color:#ec4556}
        #cf-audit-confirm .cf-audit-btn:disabled{opacity:.4;cursor:not-allowed}
        /* 导出预设的「可调字段」勾选层 */
        .cf-adjust-picker{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:2147483000;display:flex;align-items:center;justify-content:center}
        .cf-adjust-dlg{width:300px;max-height:70vh;display:flex;flex-direction:column;background:#fff;border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,.2);overflow:hidden}
        .cf-adjust-title{font-size:14px;font-weight:600;color:#333;padding:12px 14px 4px}
        .cf-adjust-sub{font-size:11px;color:#999;padding:0 14px 8px;line-height:1.5}
        .cf-adjust-tools{display:flex;gap:6px;padding:0 14px 6px}
        .cf-adjust-body{flex:1;overflow-y:auto;padding:0 14px 8px;display:flex;flex-direction:column;gap:4px}
        .cf-adjust-item{display:flex;align-items:center;gap:6px;font-size:12px;color:#666;cursor:pointer;padding:2px 0}
        .cf-adjust-item input{accent-color:#fd4c5d;cursor:pointer}
        .cf-adjust-foot{display:flex;justify-content:flex-end;gap:6px;padding:10px 14px;border-top:1px solid #f0f0f0;background:#fafafa}
        /* 效果开发面板弹窗 */
        .cf-dev-panel-mask{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2147483000;display:flex;align-items:center;justify-content:center}
        .cf-dev-panel-mask.cf-dev-min{background:transparent;pointer-events:none}
        .cf-dev-restore{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483001;pointer-events:auto;background:#fd4c5d;color:#fff;border:none;border-radius:20px;font-size:14px;padding:10px 26px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.4)}
        .cf-dev-dlg{width:420px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;background:#fff;border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,.25);overflow:hidden}
        .cf-dev-title{font-size:14px;font-weight:600;color:#333;padding:12px 14px 4px}
        .cf-dev-sub{font-size:11px;color:#999;padding:0 14px 8px;line-height:1.5}
        .cf-dev-preview-text{display:flex;align-items:flex-start;gap:8px;padding:0 14px 8px}
        .cf-dev-preview-text label{font-size:12px;color:#333;white-space:nowrap;line-height:24px}
        .cf-dev-text-input{flex:1;min-height:42px;border:1px solid #e5e5e5;border-radius:3px;font-size:13px;color:rgba(0,0,0,.65);background:#fff;padding:4px 8px;outline:none;resize:vertical;font-family:inherit;line-height:1.5}
        .cf-dev-text-input:focus{border-color:#fd4c5d}
        .cf-dev-body{flex:1;overflow-y:auto;padding:0 14px 10px;display:flex;flex-direction:column;gap:8px}
        .cf-dev-split-tip{font-size:11px;color:#fa8c16;background:#fff7e6;border:1px solid #ffd591;border-radius:3px;padding:5px 8px;line-height:1.5}
        .cf-dev-stage{border:1px solid #e5e5e5;border-radius:4px;padding:8px;background:#fafafa}
        .cf-dev-stage-head{display:flex;align-items:center;gap:8px;margin-bottom:4px}
        .cf-dev-stage-head label{font-size:12px;font-weight:600;color:#333;min-width:32px}
        .cf-dev-stage-head select{flex:1;height:22px;border:1px solid #e5e5e5;border-radius:3px;font-size:12px;color:rgba(0,0,0,.65);background:#fff;padding:0 6px;outline:none}
        .cf-dev-desc{font-size:12px;color:#999;cursor:help;flex:none;line-height:22px;user-select:none}
        .cf-dev-params{display:flex;flex-direction:column;gap:4px}
        .cf-dev-param-row{margin-bottom:0}
        .cf-dev-param-row label{min-width:80px}
        .cf-dev-foot{display:flex;justify-content:flex-end;gap:6px;padding:10px 14px;border-top:1px solid #f0f0f0;background:#fafafa}
        /* 导出预设弹窗的表单行（挂在 body 上，复用 cf-dev-dlg 外壳） */
        #cf-export-panel .cf-exp-row{display:flex;align-items:flex-start;gap:8px;padding:0 14px 10px}
        #cf-export-panel .cf-exp-row label{font-size:12px;color:#333;white-space:nowrap;min-width:34px;line-height:24px}
        #cf-export-panel .cf-exp-row input,#cf-export-panel .cf-exp-row textarea{flex:1;background:#fff;border:1px solid #e5e5e5;border-radius:3px;color:rgba(0,0,0,.65);padding:4px 8px;font-size:12px;outline:none;font-family:inherit;line-height:1.5}
        #cf-export-panel .cf-exp-row textarea{resize:vertical;min-height:36px}
        #cf-export-panel .cf-exp-row input:focus,#cf-export-panel .cf-exp-row textarea:focus{border-color:#fd4c5d}
        /* 原生面板标题栏“高级弹幕”旁的切换入口（标题栏改为 flex，按钮靠右） */
        .danmaku-g-launcher-panel .panel-title{display:flex;align-items:center;justify-content:space-between}
        #cf-entry-group{margin-left:auto;display:inline-flex;align-items:center;gap:8px}
        #cf-entry-group .cf-entry-btn{background:#fff;border:1px solid #fd4c5d;border-radius:2px;color:#fd4c5d;font-size:12px;padding:3px 10px;cursor:pointer;transition:.15s;white-space:nowrap;line-height:16px}
        #cf-entry-group .cf-entry-btn:hover{background:#fd4c5d;color:#fff}
        #cf-entry-group .cf-default-chk{display:inline-flex;align-items:center;gap:3px;font-size:11px;color:#666;cursor:pointer;white-space:nowrap}
        #cf-entry-group .cf-default-chk input{accent-color:#fd4c5d;cursor:pointer}
        /* 闸④ 台账视图（gdm-ledger-ui.openLedgerPanel；外壳复用 .cf-dev-panel-mask/.cf-dev-dlg。
           全部选择器前缀 #cf-ledger-panel：浮层挂在 body 上，拿不到 #cf-sub-panel 的那套样式） */
        #cf-ledger-panel *{box-sizing:border-box}
        #cf-ledger-panel .cf-lg-dlg{width:560px}
        #cf-ledger-panel .cf-lg-stats{font-size:11px;color:#999;padding:0 14px 8px;line-height:1.5;word-break:break-all}
        #cf-ledger-panel .cf-lg-stats.bad{color:#f5222d}
        #cf-ledger-panel .cf-lg-body{flex:1;overflow-y:auto;padding:0 14px 10px;display:flex;flex-direction:column;gap:8px}
        #cf-ledger-panel .cf-lg-empty{text-align:center;color:#999;font-size:12px;padding:26px 10px;line-height:1.9}
        #cf-ledger-panel .cf-lg-video{border:1px solid #e5e5e5;border-radius:4px;overflow:hidden;flex:none}
        #cf-ledger-panel .cf-lg-head{display:flex;align-items:center;gap:8px;padding:6px 8px;background:#fafafa;border-bottom:1px solid #f0f0f0;font-size:12px;color:#666;flex-wrap:wrap}
        #cf-ledger-panel .cf-lg-link{color:#409bef;text-decoration:none;font-family:monospace;flex:none}
        #cf-ledger-panel a.cf-lg-link:hover{text-decoration:underline}
        #cf-ledger-panel .cf-lg-meta{color:#999;font-size:11px;margin-right:auto;flex:1;min-width:0}
        #cf-ledger-panel .cf-lg-other{color:#faad14;font-weight:600}
        #cf-ledger-panel .cf-lg-list{max-height:220px;overflow-y:auto}
        #cf-ledger-panel .cf-lg-item{display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:1px solid #f7f7f7;font-size:12px}
        #cf-ledger-panel .cf-lg-item:last-child{border-bottom:none}
        #cf-ledger-panel .cf-lg-time{font-family:monospace;color:#409bef;flex:0 0 104px}
        #cf-ledger-panel .cf-lg-content{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#333;min-width:0}
        #cf-ledger-panel .cf-lg-id{font-family:monospace;color:#999;font-size:11px;flex:0 0 auto;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        #cf-ledger-panel .cf-lg-badge{flex:none;font-size:11px;border-radius:2px;padding:0 5px;line-height:16px;white-space:nowrap}
        #cf-ledger-panel .cf-lg-badge.pending{background:#fffbe6;color:#faad14;border:1px solid #ffe58f}
        #cf-ledger-panel .cf-lg-badge.verified{background:#f6ffed;color:#52c41a;border:1px solid #b7eb8f}
        #cf-ledger-panel .cf-lg-guide{font-size:11px;line-height:1.7;color:#666;background:#fff7e6;border-bottom:1px solid #ffe58f;padding:8px 10px}
        #cf-ledger-panel .cf-lg-guide b{color:#fa8c16}
        #cf-ledger-panel .cf-lg-checklist{width:100%;height:110px;margin-top:6px;border:1px solid #e5e5e5;border-radius:3px;font:11px/1.5 monospace;color:#666;background:#fff;padding:4px 6px;resize:vertical;outline:none}
        #cf-ledger-panel .cf-lg-btn{border:1px solid #999;background:#f4f4f4;color:#666;border-radius:3px;padding:0 10px;font-size:12px;height:24px;line-height:16px;cursor:pointer;flex:none}
        #cf-ledger-panel .cf-lg-btn:hover{background:#e5e5e5}
        #cf-ledger-panel .cf-lg-btn.armed{background:#fff1f0;border-color:#f5222d;color:#f5222d}
        /* 作品视图（gdm-work-ui.openWorkPanel；外壳复用 .cf-dev-panel-mask/.cf-dev-dlg。
           全部选择器前缀 #cf-work-panel：浮层挂在 body 上，拿不到 #cf-sub-panel 的那套样式） */
        #cf-work-panel *{box-sizing:border-box}
        #cf-work-panel .cf-wk-dlg{width:600px}
        #cf-work-panel .cf-wk-stats{font-size:11px;color:#999;padding:0 14px 8px;line-height:1.5;word-break:break-all}
        #cf-work-panel .cf-wk-stats.bad{color:#f5222d}
        #cf-work-panel .cf-wk-body{flex:1;overflow-y:auto;padding:0 14px 10px;display:flex;flex-direction:column;gap:8px}
        #cf-work-panel .cf-wk-empty{text-align:center;color:#999;font-size:12px;padding:26px 10px;line-height:1.9}
        #cf-work-panel .cf-wk-item{border:1px solid #e5e5e5;border-radius:4px;padding:8px 10px;flex:none}
        #cf-work-panel .cf-wk-head{display:flex;align-items:center;gap:8px;margin-bottom:4px}
        #cf-work-panel .cf-wk-name{flex:1;min-width:0;font-size:13px;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        #cf-work-panel .cf-wk-badge{flex:none;font-size:11px;border-radius:2px;padding:0 5px;line-height:16px;white-space:nowrap;background:#fffbe6;color:#faad14;border:1px solid #ffe58f}
        #cf-work-panel .cf-wk-badge.done{background:#f6ffed;color:#52c41a;border-color:#b7eb8f}
        #cf-work-panel .cf-wk-meta{font-size:11px;color:#999;line-height:1.6;margin-bottom:6px}
        #cf-work-panel .cf-wk-link{color:#409bef;text-decoration:none;font-family:monospace}
        #cf-work-panel a.cf-wk-link:hover{text-decoration:underline}
        #cf-work-panel .cf-wk-acts{display:flex;gap:6px;flex-wrap:wrap}
        #cf-work-panel .cf-wk-btn{border:1px solid #999;background:#f4f4f4;color:#666;border-radius:3px;padding:0 10px;font-size:12px;height:24px;line-height:16px;cursor:pointer;flex:none}
        #cf-work-panel .cf-wk-btn:hover{background:#e5e5e5}
        #cf-work-panel .cf-wk-btn.cf-wk-primary{background:#409bef;border-color:#409bef;color:#fff}
        #cf-work-panel .cf-wk-btn.cf-wk-primary:hover{background:#2f86d8}
        #cf-work-panel .cf-wk-btn.cf-wk-danger{color:#f5222d;border-color:#ffa39e}
        #cf-work-panel .cf-wk-btn.armed{background:#fff1f0;border-color:#f5222d;color:#f5222d}
        #cf-work-panel .cf-wk-nameinput{flex:1;min-width:0;height:24px;border:1px solid #e5e5e5;border-radius:3px;padding:0 6px;font-size:13px;color:rgba(0,0,0,.65);outline:none;font-family:inherit}
        #cf-work-panel .cf-wk-nameinput:focus{border-color:#409bef}
        #cf-work-panel .cf-wk-saverow{padding:0 14px 10px}
        #cf-work-panel .cf-wk-saverow-inner{display:flex;gap:6px;align-items:center;background:#fafafa;border:1px solid #f0f0f0;border-radius:4px;padding:8px}
        #cf-work-panel .cf-wk-saverow-inner input{flex:1;min-width:0;height:24px;border:1px solid #e5e5e5;border-radius:3px;padding:0 6px;font-size:12px;color:rgba(0,0,0,.65);outline:none;font-family:inherit}
        #cf-work-panel .cf-wk-saverow-inner input:focus{border-color:#fd4c5d}
        #cf-work-panel .cf-wk-saverow-inner select{flex:0 0 auto;height:24px;max-width:190px;border:1px solid #e5e5e5;border-radius:3px;font-size:12px;color:rgba(0,0,0,.65);background:#fff;padding:0 4px;outline:none}
        `;
        document.head.appendChild(S);
    }

    // ============================================================
    //  初始化
    // ============================================================

    // 版本号单一来源：运行时读 Tampermonkey 注入的 GM_info（即头部 @version），
    // 非油猴环境（node 冒烟测试等）显示 dev，避免手写数字与 @version 漂移
    const SCRIPT_VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || 'dev';

    function init() {
        log('🚀 弹幕字幕发送器 v' + SCRIPT_VERSION + ' 开始初始化');

        const steps = [
            ['恢复预设', initPresets],
            ['注入样式', injectStyle],
            ['创建面板', ensurePanel],
            ['绑定事件', bindEvents],
            ['建立入口', setupEntry],
        ];
        for (const [name, fn] of steps) {
            try {
                fn();
                log('✅ ' + name + ' 完成');
            } catch (e) {
                console.error('[弹幕字幕] ❌ ' + name + ' 失败:', e);
            }
        }
        log('✅ 初始化结束（上方若有 ❌ 请把控制台错误发我）');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
