    // ============================================================
    //  事件绑定
    // ============================================================

    function bindEvents() {
        const p = ensurePanel();
        const file = $('#cf-file'), drop = $('#cf-drop');

        drop.addEventListener('click', () => file.click());
        drop.addEventListener('dragover', (e) => e.preventDefault());
        drop.addEventListener('drop', (e) => {
            e.preventDefault();
            if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
        });
        file.addEventListener('change', () => { if (file.files[0]) loadFile(file.files[0]); });

        $('#cf-send').addEventListener('click', startSend);
        $('#cf-verify').addEventListener('click', verifySent);
        $('#cf-reset').addEventListener('click', resetAll);
        $('#cf-preview-all').addEventListener('click', previewAll);
        $('#cf-preview-pause').addEventListener('click', () => {
            const p = getPlayer();
            if (!p) return;
            if (previewPaused) { previewPaused = false; playVideo(); status('▶ 预览继续', 'busy'); }
            else { previewPaused = true; pauseVideo(); status('⏸ 预览已暂停', 'busy'); }
        });
        $('#cf-remove').addEventListener('click', removeSubs);
        $('#cf-toggle-danmaku').addEventListener('click', () => switchPanelMode());
        $('#cf-danmaku-text').addEventListener('input', updateManualCount);
        $('#cf-danmaku-time').addEventListener('input', () => {
            const v = $('#cf-danmaku-time').value;
            if (v && parseManualTime(v) == null) status('⚠️ 时间格式不对，用 00:00:01.974 或秒数', 'err');
        });
        $('#cf-danmaku-pick').addEventListener('click', pickManualTime);
        $('#cf-danmaku-preview').addEventListener('click', previewManual);
        $('#cf-danmaku-send').addEventListener('click', sendManual);
        // 高级编辑
        $('#cf-fold-adv').addEventListener('click', toggleAdvFold);
        $('#cf-adv-reset').addEventListener('click', resetAdvancedConfig);
        $('#cf-move-add').addEventListener('click', addMove);
        $('#cf-export-advanced').addEventListener('click', exportAdvancedPreset);
        // 高级字段变化时即时写回 advancedConfig
        ['#cf-adv-zindex', '#cf-adv-rx', '#cf-adv-ry', '#cf-adv-rz', '#cf-adv-sx', '#cf-adv-sy', '#cf-adv-blur', '#cf-adv-shx', '#cf-adv-shy', '#cf-adv-shb', '#cf-adv-shc', '#cf-adv-snb', '#cf-adv-sns', '#cf-adv-snc'].forEach((sel) => {
            const el = $(sel);
            if (el) el.addEventListener('input', readAdvancedConfig);
        });
        // 投影/外发光/模糊「启用」开关：联动禁用态并回写 advancedConfig（关闭→置空）
        $('#cf-adv-sh-on').addEventListener('change', () => { syncAdvEnableUI(); readAdvancedConfig(); });
        $('#cf-adv-sn-on').addEventListener('change', () => { syncAdvEnableUI(); readAdvancedConfig(); });
        $('#cf-adv-blur-on').addEventListener('change', () => { syncAdvEnableUI(); readAdvancedConfig(); });
        syncAdvEnableUI();
        renderMoves();
        $('#cf-fold').addEventListener('click', toggleFold);
        $('#cf-sel-all').addEventListener('click', () => selectRange('all'));
        $('#cf-sel-none').addEventListener('click', () => selectRange('invert'));
        $('#cf-sel-range').addEventListener('click', selectByRange);
        $('#cf-slice').addEventListener('change', toggleSliceMode);

        // 预设
        $('#cf-preset').addEventListener('change', onPresetChange);
        $('#cf-fold-preset').addEventListener('click', togglePresetFold);
        $('#cf-fold-style').addEventListener('click', toggleStyleFold);
        $('#cf-open-dev-panel').addEventListener('click', openDevPanel);
        $('#cf-import-preset').addEventListener('click', importPreset);
        $('#cf-export-current').addEventListener('click', exportCurrentPreset);
        $('#cf-export-all').addEventListener('click', exportAllPresets);
        $('#cf-delete-preset').addEventListener('click', deleteCurrentPreset);
        $('#cf-preset-file').addEventListener('change', () => {
            if ($('#cf-preset-file').files[0]) loadPresetFile($('#cf-preset-file').files[0]);
        });
        $('#cf-sub2-btn').addEventListener('click', () => $('#cf-sub2-file').click());
        $('#cf-sub2-file').addEventListener('change', () => {
            if ($('#cf-sub2-file').files[0]) loadSub2File($('#cf-sub2-file').files[0]);
        });
        $('#cf-save-preset').addEventListener('click', saveActivePresetOptions);
        $('#cf-restore-preset').addEventListener('click', restoreActivePresetOptions);
        updatePresetUI();
        $('#cf-interval').addEventListener('change', (e) => {
            sendInterval = Math.max(0, Math.round(+e.target.value || 0));
            storeSet('sendInterval', sendInterval);
            status(`发送间隔已设为 ${sendInterval} ms`, 'ok');
        });

        $('#cf-style-source').addEventListener('change', (e) => { styleSource = e.target.value; storeSet('styleSource', styleSource); });

        $('#cf-font').addEventListener('change', (e) => (currentStyleConfig.font = e.target.value));
        $('#cf-size').addEventListener('change', (e) => (currentStyleConfig.size = clamp(e.target.value, 12, 150)));
        $('#cf-color').addEventListener('input', (e) => (currentStyleConfig.color = hexToRgb(e.target.value)));
        $('#cf-bold').addEventListener('change', (e) => (currentStyleConfig.bold = e.target.checked));
        $('#cf-stroke').addEventListener('change', (e) => (currentStyleConfig.stroke = e.target.checked));
        $('#cf-shadow').addEventListener('change', (e) => (currentStyleConfig.shadow = e.target.checked));
        $('#cf-posx').addEventListener('change', (e) => (currentStyleConfig.posX = clamp(e.target.value, 0, 100)));
        $('#cf-posy').addEventListener('change', (e) => (currentStyleConfig.posY = clamp(e.target.value, 0, 100)));
        $('#cf-time-offset').addEventListener('change', (e) => {
            // 手动改偏移时退出切片模式
            if (sliceMode) {
                const chk = $('#cf-slice');
                if (chk) chk.checked = false;
                sliceMode = false;
            }
            timeOffset = Math.round(+e.target.value || 0);
            storeSet('timeOffset', timeOffset);
        });

        $('#cf-anchor').addEventListener('click', (e) => {
            const cell = e.target.closest('.cf-anchor-cell');
            if (!cell) return;
            currentStyleConfig.anchor = +cell.dataset.v;
            $$('.cf-anchor-cell', $('#cf-anchor')).forEach((c) => c.classList.toggle('sel', c === cell));
        });

        // 双语 LRC 处理方式
        $('#cf-bilingual-mode').addEventListener('change', (e) => {
            bilingualMode = e.target.value;
            storeSet('bilingualMode', bilingualMode);
            status(`双语处理：${e.target.value === 'auto' ? '自动上下两行' : (e.target.value === 'main' ? '仅主语言' : '仅副语言')}`, 'ok');
        });

        // 列表点击：复选框切换选中；点其他区域预览该条
        $('#cf-list').addEventListener('click', (e) => {
            const chk = e.target.closest('.cf-chk-item');
            const item = e.target.closest('.cf-item');
            if (!item) return;
            const i = +item.dataset.i;
            if (chk) {
                // 点击复选框：只切换选中态，不触发预览
                subs[i].selected = chk.checked;
                updateCnt();
                applySliceOffset();
                return;
            }
            previewSub(subs[i]);
        });
    }

