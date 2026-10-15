    // ============================================================
    //  事件绑定
    // ============================================================
    // 理解卡｜我拥有：bindEvents()——面板壳与区块级按钮/控件的事件绑定（文件/列表/预设/样式/发送）。
    //   闸④ 台账入口（#cf-ledger-btn → gdm-ledger-ui.openLedgerPanel）、作品入口
    //   （#cf-work-btn → gdm-work-ui.openWorkPanel，6.17.0）也在这里绑。
    // 我承诺：纯绑定无自建状态；尾部首次同步（updatePresetUI/syncAdvEnableUI/renderMoves）是面板初始态唯一来源。
    // 我永不：不在绑定回调里写长段业务逻辑（调度回 80/85/90 的函数）。
    // 改我前读：新增控件必须同步此处，漏绑 = 静默无反应（无报错）；**例外是高级编辑区**——它的 17 个控件
    //   自 6.12.0 起由 renderAdvancedForm() 用声明生成并自带事件（本文件只负责在按 id 取节点前调用它），
    //   故这里不再有 '#cf-adv-*' 选择器；P3 随组件函数走，本文件将被消灭。

import { $, $$, hexToRgb, status } from './20-utils.js';
import {
    advancedConfig, bilingualMode, clamp, currentStyleConfig, getPlayer, pauseVideo, playVideo,
    previewPaused, sendInterval, setBilingualMode, setPreviewPaused, setSendInterval, setSliceMode,
    setStyleSource, setTimeOffset, sliceMode, storeSet, styleSource, subs, timeOffset,
} from './40-core.js';
import { verifySent } from './60-network.js';
import { previewAll, previewSub, setUseOfflinePreview, useOfflinePreview } from './70-preview.js';
import { stopOfflinePreview } from './71-canvas-preview.js';
import {
    applySliceOffset, ensurePanel, loadFile, removeSubs, resetAll, selectByRange, selectRange,
    startSend, toggleFold, togglePresetFold, toggleSliceMode, toggleStyleFold, updateCnt, updateSendAudit,
} from './80-ui.js';
import {
    addMove, exportAdvancedPreset, parseManualTime, pickManualTime, previewManual,
    renderAdvancedForm, renderMoves, resetAdvancedConfig, sendManual, switchPanelMode,
    toggleAdvFold, updateManualCount,
} from './85-danmaku.js';
import {
    deleteCurrentPreset, exportAllPresets, exportCurrentPreset, importPreset, loadPresetFile,
    loadSub2File, onPresetChange, openDevPanel, restoreActivePresetOptions, saveActivePresetOptions,
    syncAdvEnableUI, updatePresetUI,
} from './90-preset-ui.js';
import { openLedgerPanel } from './gdm-ledger-ui.js';
import { openWorkPanel } from './gdm-work-ui.js';

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
        $('#cf-ledger-btn').addEventListener('click', openLedgerPanel);   // 闸④ 台账视图（gdm-ledger-ui）
        $('#cf-work-btn').addEventListener('click', openWorkPanel);       // 作品视图（gdm-work-ui，6.17.0）
        $('#cf-reset').addEventListener('click', resetAll);
        $('#cf-preview-all').addEventListener('click', previewAll);
        $('#cf-offline-preview').addEventListener('change', (e) => {
            setUseOfflinePreview(e.target.checked);
            if (!useOfflinePreview) stopOfflinePreview();   // 切回在线预览时停掉离线画布，避免双重画面
            status(`预览方式：${useOfflinePreview ? '离线 Canvas 自绘' : '在线 A 站渲染器（页面需留在前台才会上屏）'}`, 'ok');
        });
        $('#cf-preview-pause').addEventListener('click', () => {
            const p = getPlayer();
            if (!p) return;
            if (previewPaused) { setPreviewPaused(false); playVideo(); status('▶ 预览继续', 'busy'); }
            else { setPreviewPaused(true); pauseVideo(); status('⏸ 预览已暂停', 'busy'); }
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
        // 17 个控件（含 3 个「启用」开关）由声明生成：渲染时事件一并接好（值 → readAdvancedConfig、
        // 门 → syncAdvEnableUI），故本行必须在下面任何按 id 取节点的语句**之前**；
        // 原「14 个 id 逐个绑 input + 3 个开关绑 change」的接线随之删除（改由控件自持，免得一条改动回读两遍）。
        renderAdvancedForm();
        $('#cf-fold-adv').addEventListener('click', toggleAdvFold);
        $('#cf-adv-reset').addEventListener('click', resetAdvancedConfig);
        $('#cf-move-add').addEventListener('click', addMove);
        $('#cf-export-advanced').addEventListener('click', exportAdvancedPreset);
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
            setSendInterval(Math.max(0, Math.round(+e.target.value || 0)));
            storeSet('sendInterval', sendInterval);
            status(`发送间隔已设为 ${sendInterval} ms`, 'ok');
        });

        $('#cf-style-source').addEventListener('change', (e) => { setStyleSource(e.target.value); storeSet('styleSource', styleSource); });

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
                setSliceMode(false);
            }
            setTimeOffset(Math.round(+e.target.value || 0));
            storeSet('timeOffset', timeOffset);
            updateSendAudit();   // 时间偏移变化 → 常驻计数行重算（startTime 会变）
        });

        $('#cf-anchor').addEventListener('click', (e) => {
            const cell = e.target.closest('.cf-anchor-cell');
            if (!cell) return;
            currentStyleConfig.anchor = +cell.dataset.v;
            $$('.cf-anchor-cell', $('#cf-anchor')).forEach((c) => c.classList.toggle('sel', c === cell));
        });

        // 双语 LRC 处理方式
        $('#cf-bilingual-mode').addEventListener('change', (e) => {
            setBilingualMode(e.target.value);
            storeSet('bilingualMode', bilingualMode);
            status(`双语处理：${e.target.value === 'auto' ? '自动上下两行' : (e.target.value === 'main' ? '仅主语言' : '仅副语言')}`, 'ok');
            updateSendAudit();   // 双语处理方式决定「一条字幕展开成几条」，必须重算
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
                updateSendAudit();   // 选中项变化 → 常驻计数行重算
                return;
            }
            previewSub(subs[i]);
        });

        // 初次上屏：面板里先摆出「本次将发送 0 条弹幕」（真实数字由随后各触发点补齐）
        updateSendAudit();
    }


// —— ESM 导出（6.8.0 迁移）——
export { bindEvents };
