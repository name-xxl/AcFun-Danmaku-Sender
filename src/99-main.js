    // ============================================================
    //  入口切换（替换式）
    // ============================================================

    function getNativePanel() { return $('.danmaku-g-launcher-panel'); }

    // 面板是否处于展开状态（wrapper 带 unfold class）
    function isLauncherOpen() {
        const w = $('.advanced-danmaku-wrapper');
        return !!(w && w.classList.contains('unfold'));
    }

    // 切换视图：保留原生标题栏，只替换标题栏下方的区域
    function switchView(toOur) {
        isOurView = toOur;
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
        let wasUnfold = false;

        // 面板从折叠变展开的边沿：注入入口 + 按默认设置决定视图
        function onLauncherOpen() {
            log('🔔 检测到高级弹幕面板展开');
            const native = getNativePanel();
            if (native) { injectNativeEntry(native); switchView(!getDefaultNative()); }
            else { log('⚠️ 未找到 .danmaku-g-launcher-panel'); }
        }

        const p = getPlayer();
        if (p && p.on) {
            p.on('openDanmakuGLauncher', () => { wasUnfold = true; onLauncherOpen(); });
            p.on('closeDanmakuGLauncher', () => { wasUnfold = false; });
        }

        // 主机制：持续轮询（比事件/观察器都可靠，不失效）
        setInterval(() => {
            const native = getNativePanel();
            if (native) injectNativeEntry(native);   // 只要面板在 DOM 就注入按钮
            const open = isLauncherOpen();
            if (open && !wasUnfold) {
                wasUnfold = true;
                onLauncherOpen();
            } else if (!open) {
                wasUnfold = false;
            }
        }, 400);

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
})();
