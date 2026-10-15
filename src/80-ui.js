    // ============================================================
    //  UI（仿原生面板壳）
    // ============================================================
    // 理解卡｜我拥有：字幕模式面板 ensurePanel（约 212 行 innerHTML 骨架）、字幕列表 renderList、
    //   startSend 批量发送循环、切片对齐、全选/反选/范围选、闸③ 的常驻计数行（#cf-audit）与
    //   大批量二次确认（confirmHighVolume）、闸② 的拒绝落点（startSend 里调 55-audit 的 auditSend）。
    // 我承诺：批量发送前 confirm 展示「N 条字幕 → M 条弹幕」计数；发送前先过 auditSend（有病灶即拒绝）；
    //   超过阈值的批次走内联二次确认（倒计时可撤）；逐条 sleep(sendInterval) 节流；取消即时生效。
    // 我永不：confirm( 全仓白名单 3 处我占 1（check 门禁盯着，只减不增）——闸③ 的二次确认走内联面板，不新开 confirm(。
    // 改我前读：面板先挂 body（display:none）再由 boot.js 搬进原生面板壳——document 级查询依赖这个顺序；
    //   高级编辑区（#cf-adv-body）自 6.12.0 起**只剩空容器**，17 个控件由 35-adv-fields 的声明经
    //   85-danmaku.renderAdvancedForm 生成（事件也随生成接好）——往模板里补一行 #cf-adv-* 即造出第二真源；
    //   P3 我将被 gdm-panel 取代，别在我身上加新功能（RISKS R2 范围守门）。

import { ANCHORS, DEFAULT_DURATION, FONTS, FONT_LABELS, MAX_DURATION, MODEL_SEND_INTERVAL } from './10-constants.js';
import { $, escapeHtml, fmt, log, rgbToHex, sleep, status } from './20-utils.js';
import { parseSub } from './30-parser.js';
import {
    activePresetId, bilingualMode, cancelled, currentStyleConfig, getVideoInfo,
    listFolded, presetFolded, sendInterval, sending, setCancelled, setListFolded, setPresetFolded,
    setSending, setSliceMode, setStyleFolded, setSubs, setTimeOffset, setTimeOffsetBackup, sliceMode,
    storeSet, styleFolded, styleSource, subs, timeOffset, timeOffsetBackup,
} from './40-core.js';
import { cfgFor, getAllPresets } from './50-engine.js';
import { SEND_CONFIRM_MODEL_THRESHOLD, auditSend, estimatedSendMs, poolImpact } from './55-audit.js';
import { lastSentIds, sendDanmaku, setLastSentIds } from './60-network.js';
import { expirePreviews, useOfflinePreview } from './70-preview.js';
import { stopOfflinePreview } from './71-canvas-preview.js';

    let panelEl = null;          // 我们的面板根节点
    let isOurView = true;        // 当前显示的是我们的 UI 还是原生编辑器
    let panelMode = 'subtitle';  // 'subtitle' 字幕模式 | 'danmaku' 弹幕模式

    // 默认视图设置（localStorage 持久化）
    const STORE_KEY = 'cf_sub_default_native';
    function getDefaultNative() { try { return localStorage.getItem(STORE_KEY) === '1'; } catch (e) { return false; } }
    function setDefaultNative(v) { try { localStorage.setItem(STORE_KEY, v ? '1' : '0'); } catch (e) {} }

    function ensurePanel() {
        if (panelEl && panelEl.parentNode) return panelEl;
        panelEl = document.createElement('div');
        panelEl.id = 'cf-sub-panel';
        panelEl.innerHTML = `
        <div class="cf-mode-bar">
            <span class="cf-mode-hint" id="cf-mode-hint">字幕模式</span>
            <button type="button" class="cf-fold-btn" id="cf-toggle-danmaku">📝 弹幕模式</button>
        </div>
        <div class="cf-panel-body" id="cf-subtitle-body">
            <div class="cf-sec">
                <p class="cf-sec-title">字幕文件<button type="button" class="cf-fold-btn" id="cf-remove">🗑 移除</button></p>
                <div class="cf-drop" id="cf-drop">
                    <div class="cf-drop-icon">📂</div>
                    <div><b>点击上传</b> 或拖放字幕</div>
                    <div class="cf-drop-hint">SRT / ASS / LRC</div>
                </div>
                <input type="file" id="cf-file" accept=".srt,.ass,.ssa,.lrc" style="display:none">
                <div class="cf-row" id="cf-bilingual-row" style="display:none;margin-top:8px">
                    <label>双语LRC</label>
                    <select id="cf-bilingual-mode">
                        <option value="auto"${bilingualMode === 'auto' ? ' selected' : ''}>自动上下两行</option>
                        <option value="main"${bilingualMode === 'main' ? ' selected' : ''}>仅主语言</option>
                        <option value="sub"${bilingualMode === 'sub' ? ' selected' : ''}>仅副语言</option>
                    </select>
                </div>
            </div>

            <div class="cf-sec">
                <p class="cf-sec-title">字幕列表 <span class="cf-cnt" id="cf-cnt">未加载</span><button type="button" class="cf-fold-btn" id="cf-fold">折叠</button><button type="button" class="cf-fold-btn" id="cf-sel-all">全选</button><button type="button" class="cf-fold-btn" id="cf-sel-none">反选</button><label class="cf-slice-chk" title="勾选后，时间偏移自动设为首条选中字幕开始时间的负值，让切片视频里首条从 0 秒开始"><input type="checkbox" id="cf-slice"> 切片</label></p>
                <div class="cf-list" id="cf-list"><div class="cf-empty">暂无数据，请先上传字幕</div></div>
                <div class="cf-row" style="margin-top:8px">
                    <label>切片范围</label>
                    <input type="number" id="cf-range-start" min="0" step="0.1" placeholder="起">
                    <label>~</label>
                    <input type="number" id="cf-range-end" min="0" step="0.1" placeholder="止">
                    <button type="button" class="cf-fold-btn" id="cf-sel-range">选中该范围</button>
                    <span style="font-size:11px;color:#999">单位：秒</span>
                </div>
            </div>

            <div class="cf-sec" id="cf-preset-sec">
                <p class="cf-sec-title">预设<button type="button" class="cf-fold-btn" id="cf-open-dev-panel">🎨 开发</button><button type="button" class="cf-fold-btn" id="cf-fold-preset">折叠</button><button type="button" class="cf-fold-btn" id="cf-import-preset">📥 导入</button><input type="file" id="cf-preset-file" accept=".json" style="display:none"></p>
                <div id="cf-preset-body">
                    <div class="cf-row">
                        <label>预设</label>
                        <select id="cf-preset">${getAllPresets().map((p) => `<option value="${escapeHtml(p.id)}"${p.id === activePresetId ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select><span class="cf-preset-author" id="cf-preset-author" style="display:none">ⓘ</span>
                    </div>
                    <div class="cf-preset-desc" id="cf-preset-desc"></div>
                    <div class="cf-preset-params" id="cf-preset-params"></div>
                    <div class="cf-row" id="cf-preset-actions-row" style="display:none">
                        <button type="button" class="cf-fold-btn" id="cf-save-preset">💾 保存参数</button>
                        <button type="button" class="cf-fold-btn" id="cf-restore-preset">↩ 恢复默认</button>
                    </div>
                    <div class="cf-row">
                        <button type="button" class="cf-fold-btn" id="cf-export-current">📤 导出当前</button>
                        <button type="button" class="cf-fold-btn" id="cf-export-all">💾 备份全部</button>
                        <button type="button" class="cf-fold-btn" id="cf-delete-preset">🗑 删除</button>
                    </div>
                    <div class="cf-row" id="cf-sub2-row" style="display:none">
                        <label>第二语言</label>
                        <span class="cf-sub2-btn" id="cf-sub2-btn">📂 上传对照字幕</span>
                        <span class="cf-sub2-hint" id="cf-sub2-hint">未上传</span>
                        <input type="file" id="cf-sub2-file" accept=".srt,.ass,.ssa,.lrc" style="display:none">
                    </div>
                </div>
            </div>

            <div class="cf-sec" id="cf-style-sec">
                <p class="cf-sec-title">样式<button type="button" class="cf-fold-btn" id="cf-fold-style">折叠</button></p>
                <div id="cf-style-body">
                <div class="cf-row" id="cf-style-source-row">
                    <label>样式来源</label>
                    <select id="cf-style-source">
                        <option value="ass"${styleSource === 'ass' ? ' selected' : ''}>ASS 自带样式</option>
                        <option value="editor"${styleSource === 'editor' ? ' selected' : ''}>编辑器样式</option>
                    </select>
                </div>
                <div class="cf-row" id="cf-font-row">
                    <label>字体</label>
                    <select id="cf-font">${FONTS.map((f) => `<option value="${f}"${f === currentStyleConfig.font ? ' selected' : ''}>${FONT_LABELS[f]}</option>`).join('')}</select>
                    <span class="cf-gap"></span>
                    <label>字号</label>
                    <input type="number" id="cf-size" min="12" max="150" value="${currentStyleConfig.size}">
                </div>
                <div class="cf-row" id="cf-color-row">
                    <label>颜色</label>
                    <input type="color" id="cf-color" value="${rgbToHex(currentStyleConfig.color)}">
                    <span class="cf-gap"></span>
                    <label class="cf-chk"><input type="checkbox" id="cf-bold"${currentStyleConfig.bold ? ' checked' : ''}>加粗</label>
                    <label class="cf-chk"><input type="checkbox" id="cf-stroke"${currentStyleConfig.stroke ? ' checked' : ''}>描边</label>
                    <label class="cf-chk"><input type="checkbox" id="cf-shadow"${currentStyleConfig.shadow ? ' checked' : ''}>投影</label>
                </div>
                <div class="cf-row" id="cf-anchor-row">
                    <label>锚点</label>
                    <div class="cf-anchor-grid" id="cf-anchor">
                        ${ANCHORS.map((a) => `<div class="cf-anchor-cell${a.v === currentStyleConfig.anchor ? ' sel' : ''}" data-v="${a.v}">${a.label}</div>`).join('')}
                    </div>
                </div>
                <div class="cf-row" id="cf-pos-row">
                    <label>位置X</label>
                    <input type="number" id="cf-posx" min="0" max="100" value="${currentStyleConfig.posX}">
                    <label>Y</label>
                    <input type="number" id="cf-posy" min="0" max="100" value="${currentStyleConfig.posY}">
                </div>
                <div class="cf-row" id="cf-pos-owner-tip" style="display:none">
                    <span style="font-size:11px;color:#fd4c5d">📍 位置由预设控制，请在预设面板调整</span>
                </div>
                <div class="cf-row">
                    <label>时间偏移</label>
                    <input type="number" class="cf-wide-input" id="cf-time-offset" min="-60000" max="60000" step="100" value="${timeOffset}">
                    <span style="font-size:11px;color:#999">ms，正=延后，负=提前</span>
                </div>
                </div>
            </div>
        </div>
        <div class="cf-panel-actions" id="cf-subtitle-actions">
            <div class="cf-audit" id="cf-audit">本次将发送 0 条弹幕</div>
            <div class="cf-actions-row">
                <button type="button" class="cf-btn cf-btn-b" id="cf-preview-all">▶ 预览全部</button>
                <button type="button" class="cf-btn cf-btn-b" id="cf-preview-pause">⏸ 暂停预览</button>
                <button type="button" class="cf-btn cf-btn-b" id="cf-reset">↺ 重置</button>
                <label class="cf-chk" title="取消=复用 A 站原生渲染器（默认，与彩排同一渲染器）；勾选=自绘 Canvas 预览（不依赖 A 站渲染器）"><input type="checkbox" id="cf-offline-preview"${useOfflinePreview ? ' checked' : ''}> 离线预览</label>
            </div>
            <div class="cf-actions-row">
                <button type="button" class="cf-btn cf-btn-p" id="cf-send">▶ 发送全部</button>
                <button type="button" class="cf-btn cf-btn-b" id="cf-verify">🔍 验证已发</button>
                <label class="cf-interval">发送间隔
                    <input type="number" id="cf-interval" min="0" max="60000" step="100" value="${sendInterval}"> ms
                </label>
            </div>
        </div>
        <!-- 弹幕模式：单条手动输入，仿原生输入框 -->
        <div class="cf-panel-body" id="cf-danmaku-body" style="display:none">
            <div class="cf-sec">
                <p class="cf-sec-title">弹幕内容</p>
                <div class="cf-danmaku-input-wrap">
                    <textarea class="cf-danmaku-input" id="cf-danmaku-text" placeholder="发个高级弹幕呗，嗷嗷嗷" maxlength="255"></textarea>
                    <span class="cf-danmaku-count" id="cf-danmaku-count">0/255</span>
                </div>
            </div>
            <div class="cf-sec">
                <p class="cf-sec-title">时间</p>
                <div class="cf-row">
                    <label>起始</label>
                    <input type="text" class="cf-wide-input" id="cf-danmaku-time" placeholder="00:00:01.974">
                    <button type="button" class="cf-fold-btn" id="cf-danmaku-pick">⌚ 拾取当前</button>
                </div>
                <div class="cf-row">
                    <label>持续</label>
                    <input type="number" class="cf-wide-input" id="cf-danmaku-duration" min="100" max="${MAX_DURATION}" step="100" value="${DEFAULT_DURATION}">
                    <span style="font-size:11px;color:#999">ms</span>
                </div>
                <p class="cf-danmaku-tip">起始留空=当前播放位置；支持 00:00:01.974（A站原生）/ 0:01.974 / 秒数</p>
            </div>

            <div class="cf-sec">
                <p class="cf-sec-title">高级编辑<button type="button" class="cf-fold-btn" id="cf-adv-reset">↩ 恢复默认</button><button type="button" class="cf-fold-btn" id="cf-fold-adv">折叠</button></p>
                <div class="cf-row" id="cf-adv-owner-tip" style="display:none">
                    <span style="font-size:11px;color:#fd4c5d">📍 高级字段由预设控制，请在预设面板调整</span>
                </div>
                <!-- 高级编辑的 17 个控件由 35-adv-fields 的声明生成（85-danmaku 的表单渲染入口，
                     模板里再写一行 #cf-adv-* 就会给回读契约造出第二个来源） -->
                <div id="cf-adv-body"></div>
            </div>

            <div class="cf-sec" id="cf-moves-sec">
                <p class="cf-sec-title">运动轨迹<button type="button" class="cf-fold-btn" id="cf-move-add">＋ 加动作</button></p>
                <div id="cf-moves"></div>
                <p class="cf-danmaku-tip">多段运动按顺序衔接；每段指定起点/终点坐标与耗时</p>
            </div>
        </div>
        <div class="cf-panel-actions" id="cf-danmaku-actions" style="display:none">
            <div class="cf-actions-row">
                <button type="button" class="cf-btn cf-btn-b" id="cf-danmaku-preview">👁 预览</button>
                <button type="button" class="cf-btn cf-btn-p" id="cf-danmaku-send">▶ 发送</button>
            </div>
            <div class="cf-actions-row">
                <button type="button" class="cf-btn cf-btn-b" id="cf-export-advanced">📤 导出为预设</button>
            </div>
        </div>
        <div class="cf-status" id="cf-status">请上传字幕文件</div>`;
        // 先挂到 body 并隐藏，保证 bindEvents 的 document 级查询能命中元素；
        // 之后 switchView 会把它移到原生面板容器内
        panelEl.style.display = 'none';
        (document.body || document.documentElement).appendChild(panelEl);
        return panelEl;
    }

    // status（面板状态栏输出）6.8.0 起住 20-utils（依赖图无环要求，见该文件头注），此处不再重复。

    function renderList() {
        const w = $('#cf-list');
        if (!w) return;
        if (!subs.length) { w.innerHTML = '<div class="cf-empty">暂无数据，请先上传字幕</div>'; return; }
        const stIcon = { ok: '✓', ing: '…', err: '✗' };
        const stCls = { ok: 's-ok', ing: 's-ing', err: 's-err' };
        w.innerHTML = subs.map((s, i) => {
            const st = s.st || '';
            return `<div class="cf-item${st ? ' ' + st : ''}" data-i="${i}">
                <input type="checkbox" class="cf-chk-item"${s.selected ? ' checked' : ''} data-i="${i}">
                <span class="cf-t">${fmt(s.time)}</span>
                <span class="cf-c" title="${escapeHtml(s.text)}">${escapeHtml(s.text)}</span>
                <span class="cf-s ${stCls[st] || ''}">${stIcon[st] || '○'}</span>
            </div>`;
        }).join('');
        updateCnt();
    }

    function updateCnt() {
        const e = $('#cf-cnt');
        if (!e) return;
        if (!subs.length) { e.textContent = '未加载'; return; }
        const sel = subs.filter((s) => s.selected).length;
        const ok = subs.filter((s) => s.st === 'ok').length;
        e.textContent = `选中 ${sel}/${subs.length}` + (ok ? ` · 已发 ${ok}` : '');
    }

    function scrollToList(i) {
        const el = $(`.cf-item[data-i="${i}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function setBtns(on) {
        const go = $('#cf-send');
        if (go) go.disabled = on;
    }

    // ============================================================
    //  文件处理
    // ============================================================

    function loadFile(file) {
        const r = new FileReader();
        r.onload = () => {
            try {
                setSubs(parseSub(r.result, file.name));
                if (!subs.length) throw new Error('未解析到字幕');
                subs.forEach((s) => { s.st = ''; s.selected = true; });   // 默认全选
                // 检测双语 LRC，有则显示处理方式下拉
                const hasBilingual = subs.some((s) => s.main != null && s.sub != null);
                const bRow = $('#cf-bilingual-row');
                if (bRow) bRow.style.display = hasBilingual ? '' : 'none';
                renderList();
                status(`📂 ${file.name} · ${subs.length} 条${hasBilingual ? '（检测到双语）' : ''}`, 'ok');
                updateSendAudit();
            } catch (e) {
                status('解析失败: ' + e.message, 'err');
            }
        };
        r.readAsText(file, 'utf-8');
    }

    // ============================================================
    //  闸③ 计数显性化：常驻审计行（#cf-audit）+ 大批量二次确认
    // ============================================================
    // 数据来源与闸② 同源：同一遍 auditSend（55-audit）既出计数又出病灶，常驻行与「发送前拒绝」用的是
    //   同一个函数、同一套展开参数——面板上看到的 N 就是发送时要发的 N（发送时再算一遍是权威判据：
    //   两次之间预设/选中/偏移都可能变）。
    // 重算时机（调用点分散在 95-events / 90-preset-ui）：选中项变化、字幕列表变化（装载/移除/重置）、
    //   全选/反选/范围选、预设切换、预设参数改动、保存/恢复参数、时间偏移变化、双语处理方式变化。
    // 节流策略：**前沿 + 尾随合并**，最小间隔 AUDIT_MIN_INTERVAL。逐字拆发预设 × 几百条字幕是重活
    //   （实测 KTV × 300 条字幕 = 8200 条 model / 约 185ms，见 test/unit/send-audit.test.mjs 的标定输出）：
    //   连点勾选、全选、拖参数会连着触发，逐次展开会把面板卡住。故：距上次重算 ≥ 250ms 就立即算
    //   （点完马上看到新数字），否则只记一次尾随重算（窗口内的重复触发合并成一次）。
    //   **最坏耗时 = 250ms 等待 + 一遍展开**（300 条 KTV 实测 185ms；1000 条字幕的 KTV 外推 ≈ 0.6s）。
    //   展开与 lint 都是同步的，会占主线程——本片不与 Worker/分片缠斗（零依赖 + 范围守门），
    //   只用节流把频次压住；真要消掉这 0.6s 得把 lint 挪出主线程，另立一片。
    const AUDIT_MIN_INTERVAL = 250;
    let auditTimer = null;
    let auditLastAt = 0;

    // 本次要发的字幕（与 startSend 的第一行同一判据）
    function auditTargets() { return subs.filter((s) => s.selected && s.st !== 'ok'); }

    function paintSendAudit() {
        const el = $('#cf-audit');
        if (!el) return;
        if (!subs.length) {
            el.className = 'cf-audit';
            el.textContent = '本次将发送 0 条弹幕';
            el.title = '';
            return;
        }
        const targets = auditTargets();
        if (!targets.length) {
            el.className = 'cf-audit';
            el.textContent = '本次没有可发送的字幕（未选中或已全部发送）';
            el.title = '';
            return;
        }
        const a = auditSend(targets, subs);
        const bad = a.problems.length;
        const impact = poolImpact(a.modelCount);
        const parts = [`本次将发送 ${a.modelCount} 条弹幕`, `输出校验 ${bad ? `⛔ ${bad} 条病灶` : '✅'}`, `池影响 ${impact.label}`];
        if (a.expandErrors.length) parts.push(`⚠ ${a.expandErrors.length} 条展开失败`);
        el.className = 'cf-audit ' + (bad ? 'bad' : (a.expandErrors.length ? 'warn' : 'ok'));
        el.textContent = parts.join(' · ');
        el.title = `选中 ${a.subtitleCount} 条字幕 → 展开 ${a.modelCount} 条弹幕`
            + (bad ? `；首条病灶：${a.problems[0].rule} @ ${a.problems[0].path}` : '')
            + '（发送前会再算一遍，那一次才是闸）';
    }

    // 重算入口（节流见上）。发送中不重算：循环里每条都在改 st，重算既无意义又会抢主线程。
    function updateSendAudit() {
        if (!$('#cf-audit') || sending) return;
        const now = Date.now();
        const wait = AUDIT_MIN_INTERVAL - (now - auditLastAt);
        if (wait > 0) {
            if (!auditTimer) auditTimer = setTimeout(() => { auditTimer = null; updateSendAudit(); }, wait);
            return;
        }
        auditLastAt = now;
        paintSendAudit();
    }

    function fmtSpan(ms) {
        const s = Math.round(Math.max(0, ms) / 1000);
        if (s < 60) return s + ' 秒';
        const m = Math.floor(s / 60);
        if (m < 60) return m + ' 分' + (s % 60 ? ' ' + (s % 60) + ' 秒' : '');
        return Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分';
    }

    // 大批量二次确认——**内联面板**，不是 confirm(（硬约束：本仓 confirm(/alert( 白名单 3 处只减不增，
    // tools/check.mjs 盯着；复用既有那处 confirm 的措辞升级会把「发送 N 条字幕」那句话撑成半屏，也不合适）。
    // 范式抄 90-preset-ui/openExportDialog：mask + dlg + 底部两键，关掉即 return。
    // 「仍要发送」带 3 秒倒计时（禁用 → 可点）：越过阈值就该慢一拍，3 秒够读完数字、也够点「取消」
    // （取消按钮全程可点，倒计时不是强制等待，是防手滑）。
    const CONFIRM_LOCK_MS = 3000;
    function confirmHighVolume(info) {
        return new Promise((resolve) => {
            const old = $('#cf-audit-confirm');
            if (old) old.remove();
            const mask = document.createElement('div');
            mask.id = 'cf-audit-confirm';
            mask.className = 'cf-dev-panel-mask';
            mask.innerHTML = `
                <div class="cf-dev-dlg">
                    <p class="cf-dev-title">⚠️ 大批量发送二次确认</p>
                    <p class="cf-dev-sub">本次将发送 <b>${info.modelCount}</b> 条弹幕（${info.subtitleCount} 条字幕），
                        超过二次确认阈值 ${SEND_CONFIRM_MODEL_THRESHOLD} 条 · 池影响 <b>${info.impact.label}</b>：${escapeHtml(info.impact.note)}<br>
                        按句内 ${MODEL_SEND_INTERVAL}ms/条 + 句间 ${info.intervalMs}ms 估算，连续发送至少约 ${fmtSpan(info.estimatedMs)}（不含网络耗时）。<br>
                        发送后无法撤回。</p>
                    <div class="cf-dev-foot">
                        <button type="button" class="cf-audit-btn" data-act="cancel">取消</button>
                        <button type="button" class="cf-audit-btn primary" data-act="go" disabled></button>
                    </div>
                </div>`;
            const goBtn = mask.querySelector('[data-act=go]');
            let left = Math.ceil(CONFIRM_LOCK_MS / 1000);
            let done = false;
            let timer = null;
            const arm = () => {
                goBtn.textContent = `仍要发送（${left}s）`;
                timer = setTimeout(() => {
                    left -= 1;
                    if (left > 0) { arm(); return; }
                    goBtn.disabled = false;
                    goBtn.textContent = '仍要发送';
                }, 1000);
            };
            const finish = (ok) => {
                if (done) return;
                done = true;
                if (timer) clearTimeout(timer);
                mask.remove();
                resolve(ok);
            };
            goBtn.disabled = true;
            arm();
            mask.querySelector('[data-act=cancel]').addEventListener('click', () => finish(false));
            mask.addEventListener('click', (e) => { if (e.target === mask) finish(false); });
            goBtn.addEventListener('click', () => { if (!goBtn.disabled) finish(true); });
            document.body.appendChild(mask);
        });
    }

    // ============================================================
    //  发送循环
    // ============================================================

    async function startSend() {
        if (!subs.length) { status('请先上传字幕文件', 'err'); return; }
        const targets = subs.filter((s) => s.selected && s.st !== 'ok');
        if (!targets.length) { status('没有可发送的字幕（未选中或已全部发送）', 'err'); return; }
        const v = getVideoInfo();
        if (!v || !v.videoId) { status('❌ 未获取到视频信息，请确认已登录且在视频页', 'err'); return; }
        // 闸③ 计数 + 闸② 输出 lint：一遍展开同时产出「要发多少条」和「有没有病灶」
        // （展开参数与原计数循环逐字相同：seq = k+1、prevTime = k>0 ? targets[k-1].time : null——
        //   这一遍是发送前的**权威判据**：面板常驻行可能已过期，这里算的才是真的要发的）
        const audit = auditSend(targets, subs);
        if (audit.problems.length) {
            // 闸②：有病灶就不进入发送流程（不弹确认、不动 sending/按钮）
            status(`⛔ 输出校验未通过：${audit.problems.length} 条病灶，已阻止发送（详见控制台）`, 'err');
            log(`⛔ 输出校验未通过，已阻止发送（病灶 ${audit.problems.length} 条，下面逐条列出：字幕序号 / rule @ path / detail）`);
            audit.problems.forEach((p) => {
                const t = targets[p.subtitleIndex];
                log(`  #${p.seq} ${t ? fmt(t.time) + ' ' + t.text : '(字幕已不在发送序列)'} → ${p.rule} @ ${p.path}`
                    + `\n     ${p.detail}`);
            });
            return;
        }
        // 展开抛错不改既有行为（原循环也是按 1 条计入后照发），只在这里留个痕迹
        audit.expandErrors.forEach((e) => {
            log(`⚠ ${e.subListIndex >= 0 ? fmt(subs[e.subListIndex].time) + ' ' : ''}第 ${e.seq} 条字幕展开失败`
                + `（按 1 条计入）：${e.message}`);
        });
        const totalModels = audit.modelCount;
        if (!confirm(`发送 ${targets.length} 条字幕（展开 ${totalModels} 条弹幕）？\n发送后无法撤回。`)) { status('已取消'); return; }
        // 闸③ 阈值：超过 SEND_CONFIRM_MODEL_THRESHOLD 再要一次确认（内联面板，见 confirmHighVolume）
        if (totalModels > SEND_CONFIRM_MODEL_THRESHOLD) {
            const go = await confirmHighVolume({
                modelCount: totalModels,
                subtitleCount: audit.subtitleCount,
                impact: poolImpact(totalModels),
                estimatedMs: estimatedSendMs(totalModels, audit.subtitleCount, sendInterval),
                intervalMs: sendInterval,
            });
            if (!go) { status(`已取消：${totalModels} 条弹幕超过二次确认阈值 ${SEND_CONFIRM_MODEL_THRESHOLD}`); return; }
            status(`⚠ 已二次确认大批量发送：${totalModels} 条弹幕`, 'busy');
        }

        setSending(true); setCancelled(false); setBtns(true);
        setLastSentIds([]);   // 清空上次批次的 danmakuId，验证只针对本次发送

        for (let k = 0; k < targets.length; k++) {
            if (cancelled) break;
            const s = targets[k];
            const i = subs.indexOf(s);
            s.st = 'ing'; renderList(); scrollToList(i);
            try {
                const cfg = cfgFor(s);
                const prevTime = k > 0 ? targets[k - 1].time : null;
                const r = await sendDanmaku(s, cfg, k + 1, prevTime);   // 序号从 1 起，供双排 KTV 决定上下行
                if (r.sent < r.total) {
                    // 中途取消导致部分发送：标 err 让本句留在重发池，且如实告知重发会重复已发部分
                    s.st = 'err';
                    const msg = r.sent
                        ? `已取消：本句仅发送 ${r.sent}/${r.total} 条，重发会重复已发部分`
                        : '已取消：本句未发送';
                    status(`✗ ${fmt(s.time)} ${msg}`, 'err');
                } else {
                    s.st = 'ok';
                    status(`✓ ${fmt(s.time)} ${s.text}`, 'ok');
                }
            } catch (e) {
                s.st = 'err';
                status(`✗ ${fmt(s.time)} ${e.message}`, 'err');
            }
            renderList();
            if (!cancelled) await sleep(sendInterval);
        }

        setSending(false); setBtns(false);
        const ok = subs.filter((s) => s.st === 'ok').length;
        const fail = subs.filter((s) => s.st === 'err').length;
        if (!cancelled) status(`✅ 完成 · 成功 ${ok} 条${fail ? ` · 失败 ${fail} 条` : ''}`, 'ok');
        updateSendAudit();   // 发完 st 变了，常驻行要跟着变（发送中它被 updateSendAudit 的 sending 守卫挡住）
    }

    function resetAll() {
        if (sending) { setCancelled(true); }
        subs.forEach((s) => (s.st = ''));
        stopOfflinePreview();   // 清除离线预览画布
        renderList(); setBtns(false);
        status('↺ 已重置');
        updateSendAudit();
    }

    // 移除导入的字幕（清空列表）
    function removeSubs() {
        if (sending) { setCancelled(true); setSending(false); }
        expirePreviews();
        stopOfflinePreview();   // 清除离线预览画布
        setSubs([]);
        renderList(); setBtns(false);
        const uz = $('#cf-drop');
        if (uz) { uz.classList.remove('ok'); }
        status('🗑 已移除字幕');
        updateSendAudit();
    }

    // 折叠 / 展开字幕列表
    function toggleFold() {
        setListFolded(!listFolded);
        const list = $('#cf-list');
        const btn = $('#cf-fold');
        if (list) list.style.display = listFolded ? 'none' : '';
        if (btn) btn.textContent = listFolded ? '展开' : '折叠';
    }

    // 折叠 / 展开预设区
    function togglePresetFold() {
        setPresetFolded(!presetFolded);
        const body = $('#cf-preset-body');
        const btn = $('#cf-fold-preset');
        if (body) body.style.display = presetFolded ? 'none' : '';
        if (btn) btn.textContent = presetFolded ? '展开' : '折叠';
    }

    // 折叠 / 展开样式区
    function toggleStyleFold() {
        setStyleFolded(!styleFolded);
        const body = $('#cf-style-body');
        const btn = $('#cf-fold-style');
        if (body) body.style.display = styleFolded ? 'none' : '';
        if (btn) btn.textContent = styleFolded ? '展开' : '折叠';
    }

    // 全选 / 反选
    function selectRange(mode) {
        if (!subs.length) { status('请先上传字幕', 'err'); return; }
        if (mode === 'all') subs.forEach((s) => (s.selected = true));
        else subs.forEach((s) => (s.selected = !s.selected));
        renderList();
        const sel = subs.filter((s) => s.selected).length;
        status(mode === 'all' ? `✅ 已全选 ${sel} 条` : `🔄 反选，当前选中 ${sel} 条`, 'ok');
        applySliceOffset();
        updateSendAudit();
    }

    // 按切片时间范围选中（单位：秒）
    function selectByRange() {
        if (!subs.length) { status('请先上传字幕', 'err'); return; }
        const sEl = $('#cf-range-start'), eEl = $('#cf-range-end');
        const start = parseFloat(sEl ? sEl.value : '');
        const end = parseFloat(eEl ? eEl.value : '');
        if (isNaN(start) || isNaN(end) || start > end) { status('请输入有效的起止秒数（起 ≤ 止）', 'err'); return; }
        const startMs = Math.round(start * 1000), endMs = Math.round(end * 1000);
        let n = 0;
        subs.forEach((s) => {
            s.selected = s.time >= startMs && s.time <= endMs;
            if (s.selected) n++;
        });
        renderList();
        status(`✅ 已选中 ${fmt(startMs)} ~ ${fmt(endMs)} 内的 ${n} 条`, 'ok');
        applySliceOffset();
        updateSendAudit();
    }

    // 同步时间偏移输入框显示
    function syncTimeOffsetInput() {
        const el = $('#cf-time-offset');
        if (el) el.value = timeOffset;
    }

    // 切片模式：偏移 = 首条选中字幕开始时间的负值
    function applySliceOffset() {
        if (!sliceMode) return;
        const first = subs.filter((s) => s.selected).sort((a, b) => a.time - b.time)[0];
        if (first) {
            setTimeOffset(-Math.round(first.time));
            storeSet('timeOffset', timeOffset);
            syncTimeOffsetInput();
            status(`🔪 切片模式：偏移已设为 -${fmt(first.time)}（首条 ${fmt(first.time)}）`, 'busy');
            updateSendAudit();   // 偏移变了 → startTime 变 → 常驻行重算（数量通常不变，但口径要一致）
        }
    }

    // 切换切片模式
    function toggleSliceMode() {
        const chk = $('#cf-slice');
        setSliceMode(chk ? chk.checked : false);
        if (sliceMode) {
            setTimeOffsetBackup(timeOffset);
            applySliceOffset();
        } else {
            setTimeOffset(timeOffsetBackup);
            syncTimeOffsetInput();
            status('🔪 已退出切片模式，恢复手动偏移', 'ok');
            updateSendAudit();
        }
    }


// —— ESM 导出（6.8.0 迁移）——
export {
    applySliceOffset, ensurePanel, getDefaultNative, isOurView, loadFile, panelMode, removeSubs,
    resetAll, selectByRange, selectRange, setDefaultNative, startSend, toggleFold, togglePresetFold,
    toggleSliceMode, toggleStyleFold, updateCnt, updateSendAudit,
};
// 跨文件写：ESM 导入绑定只读，故本文件的两个模块级 let 走 setter（声明留原地，初始化未改）
export function setIsOurView(v) { isOurView = v; }
export function setPanelMode(v) { panelMode = v; }
