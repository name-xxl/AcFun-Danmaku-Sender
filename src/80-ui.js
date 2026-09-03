    // ============================================================
    //  UI（仿原生面板壳）
    // ============================================================

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
            <div class="cf-actions-row">
                <button type="button" class="cf-btn cf-btn-b" id="cf-preview-all">▶ 预览全部</button>
                <button type="button" class="cf-btn cf-btn-b" id="cf-preview-pause">⏸ 暂停预览</button>
                <button type="button" class="cf-btn cf-btn-b" id="cf-reset">↺ 重置</button>
                <label class="cf-chk" title="勾选=自绘 Canvas 预览（不依赖 A 站渲染器）；取消=复用 A 站原生渲染器"><input type="checkbox" id="cf-offline-preview"${useOfflinePreview ? ' checked' : ''}> 离线预览</label>
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
                <div id="cf-adv-body">
                    <div class="cf-row">
                        <label>层级</label>
                        <input type="number" id="cf-adv-zindex" min="1" max="99" value="${advancedConfig.zIndex}">
                    </div>
                    <div class="cf-row">
                        <label>旋转</label>
                        <span class="cf-adv-3">X<input type="number" id="cf-adv-rx" min="-360" max="360" value="${advancedConfig.rotate.x}"></span>
                        <span class="cf-adv-3">Y<input type="number" id="cf-adv-ry" min="-360" max="360" value="${advancedConfig.rotate.y}"></span>
                        <span class="cf-adv-3">Z<input type="number" id="cf-adv-rz" min="-360" max="360" value="${advancedConfig.rotate.z}"></span>
                    </div>
                    <div class="cf-row">
                        <label>缩放</label>
                        <span class="cf-adv-3">X<input type="number" id="cf-adv-sx" min="0.1" max="5" step="0.1" value="${advancedConfig.scale.x}"></span>
                        <span class="cf-adv-3">Y<input type="number" id="cf-adv-sy" min="0.1" max="5" step="0.1" value="${advancedConfig.scale.y}"></span>
                    </div>
                    <div class="cf-row">
                        <label>模糊</label>
                        <label class="cf-chk"><input type="checkbox" id="cf-adv-blur-on"${advancedConfig.blur > 0 ? ' checked' : ''}>启用</label>
                        <input type="number" id="cf-adv-blur" min="0" max="50" value="${advancedConfig.blur || 0}"${advancedConfig.blur > 0 ? '' : ' disabled'}>
                        <span style="font-size:11px;color:#999">px</span>
                    </div>
                    <div class="cf-row">
                        <label>投影</label>
                        <label class="cf-chk"><input type="checkbox" id="cf-adv-sh-on"${advancedConfig.shadow ? ' checked' : ''}>启用</label>
                        <span class="cf-adv-3">X<input type="number" id="cf-adv-shx" min="-100" max="100" value="${advancedConfig.shadow ? advancedConfig.shadow.x : DEFAULT_SHADOW_PLACEHOLDER.x}"${advancedConfig.shadow ? '' : ' disabled'}></span>
                        <span class="cf-adv-3">Y<input type="number" id="cf-adv-shy" min="-100" max="100" value="${advancedConfig.shadow ? advancedConfig.shadow.y : DEFAULT_SHADOW_PLACEHOLDER.y}"${advancedConfig.shadow ? '' : ' disabled'}></span>
                        <span class="cf-adv-3">模糊<input type="number" id="cf-adv-shb" min="0" max="50" value="${advancedConfig.shadow ? advancedConfig.shadow.blur : DEFAULT_SHADOW_PLACEHOLDER.blur}"${advancedConfig.shadow ? '' : ' disabled'}></span>
                        <input type="color" id="cf-adv-shc" value="${advancedConfig.shadow ? advancedConfig.shadow.color : DEFAULT_SHADOW_PLACEHOLDER.color}"${advancedConfig.shadow ? '' : ' disabled'}>
                    </div>
                    <div class="cf-row">
                        <label>外发光</label>
                        <label class="cf-chk"><input type="checkbox" id="cf-adv-sn-on"${advancedConfig.shine ? ' checked' : ''}>启用</label>
                        <span class="cf-adv-3">模糊<input type="number" id="cf-adv-snb" min="0" max="50" value="${advancedConfig.shine ? advancedConfig.shine.blur : DEFAULT_SHINE_PLACEHOLDER.blur}"${advancedConfig.shine ? '' : ' disabled'}></span>
                        <span class="cf-adv-3">大小<input type="number" id="cf-adv-sns" min="0" max="20" value="${advancedConfig.shine ? advancedConfig.shine.size : DEFAULT_SHINE_PLACEHOLDER.size}"${advancedConfig.shine ? '' : ' disabled'}></span>
                        <input type="color" id="cf-adv-snc" value="${advancedConfig.shine ? advancedConfig.shine.color : DEFAULT_SHINE_PLACEHOLDER.color}"${advancedConfig.shine ? '' : ' disabled'}>
                    </div>
                </div>
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

    function status(msg, type) {
        const e = $('#cf-status');
        if (!e) return;
        e.textContent = msg;
        e.className = 'cf-status ' + (type || '');
    }

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
                subs = parseSub(r.result, file.name);
                if (!subs.length) throw new Error('未解析到字幕');
                subs.forEach((s) => { s.st = ''; s.selected = true; });   // 默认全选
                // 检测双语 LRC，有则显示处理方式下拉
                const hasBilingual = subs.some((s) => s.main != null && s.sub != null);
                const bRow = $('#cf-bilingual-row');
                if (bRow) bRow.style.display = hasBilingual ? '' : 'none';
                renderList();
                status(`📂 ${file.name} · ${subs.length} 条${hasBilingual ? '（检测到双语）' : ''}`, 'ok');
            } catch (e) {
                status('解析失败: ' + e.message, 'err');
            }
        };
        r.readAsText(file, 'utf-8');
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
        // 预展开计数：让用户对真实请求量有预期（一句字幕经预设可展开成几十条弹幕）
        let totalModels = 0;
        for (let k = 0; k < targets.length; k++) {
            const s = targets[k];
            try {
                const cfg = cfgFor(s);
                const prevTime = k > 0 ? targets[k - 1].time : null;
                totalModels += expandSub(s, cfg, calcDurationMs(subs.indexOf(s)), k + 1, prevTime).length;
            } catch (e) { totalModels += 1; }
        }
        if (!confirm(`发送 ${targets.length} 条字幕（展开 ${totalModels} 条弹幕）？\n发送后无法撤回。`)) { status('已取消'); return; }

        sending = true; cancelled = false; setBtns(true);
        lastSentIds = [];   // 清空上次批次的 danmakuId，验证只针对本次发送

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

        sending = false; setBtns(false);
        const ok = subs.filter((s) => s.st === 'ok').length;
        const fail = subs.filter((s) => s.st === 'err').length;
        if (!cancelled) status(`✅ 完成 · 成功 ${ok} 条${fail ? ` · 失败 ${fail} 条` : ''}`, 'ok');
    }

    function resetAll() {
        if (sending) { cancelled = true; }
        subs.forEach((s) => (s.st = ''));
        stopOfflinePreview();   // 清除离线预览画布
        renderList(); setBtns(false);
        status('↺ 已重置');
    }

    // 移除导入的字幕（清空列表）
    function removeSubs() {
        if (sending) { cancelled = true; sending = false; }
        expirePreviews();
        stopOfflinePreview();   // 清除离线预览画布
        subs = [];
        renderList(); setBtns(false);
        const uz = $('#cf-drop');
        if (uz) { uz.classList.remove('ok'); }
        status('🗑 已移除字幕');
    }

    // 折叠 / 展开字幕列表
    function toggleFold() {
        listFolded = !listFolded;
        const list = $('#cf-list');
        const btn = $('#cf-fold');
        if (list) list.style.display = listFolded ? 'none' : '';
        if (btn) btn.textContent = listFolded ? '展开' : '折叠';
    }

    // 折叠 / 展开预设区
    function togglePresetFold() {
        presetFolded = !presetFolded;
        const body = $('#cf-preset-body');
        const btn = $('#cf-fold-preset');
        if (body) body.style.display = presetFolded ? 'none' : '';
        if (btn) btn.textContent = presetFolded ? '展开' : '折叠';
    }

    // 折叠 / 展开样式区
    function toggleStyleFold() {
        styleFolded = !styleFolded;
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
            timeOffset = -Math.round(first.time);
            storeSet('timeOffset', timeOffset);
            syncTimeOffsetInput();
            status(`🔪 切片模式：偏移已设为 -${fmt(first.time)}（首条 ${fmt(first.time)}）`, 'busy');
        }
    }

    // 切换切片模式
    function toggleSliceMode() {
        const chk = $('#cf-slice');
        sliceMode = chk ? chk.checked : false;
        if (sliceMode) {
            timeOffsetBackup = timeOffset;
            applySliceOffset();
        } else {
            timeOffset = timeOffsetBackup;
            syncTimeOffsetInput();
            status('🔪 已退出切片模式，恢复手动偏移', 'ok');
        }
    }

