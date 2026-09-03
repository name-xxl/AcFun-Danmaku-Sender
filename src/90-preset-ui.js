    // ============================================================
    //  预设 UI 逻辑
    // ============================================================

    function refreshPresetSelect() {
        const sel = $('#cf-preset');
        if (!sel) return;
        const cur = activePresetId;
        sel.innerHTML = getAllPresets().map((p) => `<option value="${escapeHtml(p.id)}"${p.id === cur ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
        updatePresetUI();
    }

    function updatePresetUI() {
        const preset = getActivePreset();
        const desc = $('#cf-preset-desc');
        if (desc) {
            let d = preset ? (preset.desc || '') : '';
            // 拆字 + 逐字延迟/扫光预设会拆发大量弹幕，提示注意 A 站弹幕规范
            if (preset && isCharSplitComposition(activeCompositionOf(preset))) {
                d += (d ? '　' : '') + '⚠️ 逐字拆发，弹幕量大，请注意 A 站弹幕规范';
            }
            desc.textContent = d;
        }
        const sub2Row = $('#cf-sub2-row');
        if (sub2Row) sub2Row.style.display = (preset && preset.transform === 'multi-lang') ? '' : 'none';
        // 保存/恢复按钮：有可调参数、或带 effects、或带 options 时显示（带 effects 的预设也能一键还原）
        const actRow = $('#cf-preset-actions-row');
        const hasAny = preset && ((preset.params && preset.params.length) || !!preset.effects || Object.keys(preset.options || {}).length > 0);
        if (actRow) actRow.style.display = hasAny ? '' : 'none';
        syncEditorOwnedUI();
        renderPresetParams();
    }

    // ============================================================
    //  编辑器字段「接管」机制：预设声明自己接管了哪些字段，编辑器据此禁用对应输入，
    //  避免“改了没反应”的困惑。这是统一入口，新增预设只需声明 owns，不用逐个改 UI。
    //  字段名对应 cfg（buildModel 读的样式配置）里的 key。
    // ============================================================
    // 各 transform 默认接管的字段（预设可在 JSON 里用 owns 覆盖）
    const TRANSFORM_OWNS = {
        'none': [],
        'chars-vertical': ['posX', 'posY'],          // 竖排：引擎算每个字的 X/Y
        'chars-karaoke': ['posX', 'posY', 'color'],  // KTV：引擎算 X/Y + 唱到/待唱色
        'multi-lang': ['posY', 'color'],             // 多语：引擎定主/副行 Y 与颜色
        'declarative': ['posX', 'posY', 'color'],    // 声明式：base 定 X/Y，color 定颜色
    };
    // 编辑器字段 → 控件选择器（禁用/启用的目标）
    const EDITOR_FIELD_CTRLS = {
        font: '#cf-font',
        size: '#cf-size',
        color: '#cf-color',
        bold: '#cf-bold',
        stroke: '#cf-stroke',
        shadow: '#cf-shadow',
        anchor: '#cf-anchor',
        posX: '#cf-posx',
        posY: '#cf-posy',
    };

    // 按 composition（引擎组合）推导接管的字段：布局引擎非 none 接管位置，着色引擎非 single 接管颜色
    function ownsForComposition(comp) {
        if (!comp) return [];
        const owns = [];
        if (comp.layout && comp.layout !== 'none') {
            if (comp.layout === 'bilingual') owns.push('posY');   // 上下两行只控制 Y
            else owns.push('posX', 'posY');
        }
        if (comp.color && comp.color !== 'single') owns.push('color');
        return owns;
    }

    // 取当前预设接管的字段集合：preset.owns 显式声明优先，其次按 composition，最后按 transform 默认
    function getPresetOwns(preset) {
        if (!preset) return [];
        if (Array.isArray(preset.owns)) return preset.owns;
        if (preset.composition) return ownsForComposition(preset.composition);
        return TRANSFORM_OWNS[preset.transform] || [];
    }

    // 根据当前预设的 owns 同步编辑器：被接管的字段禁用（灰 + 提示），其余启用。
    function syncEditorOwnedUI() {
        const preset = getActivePreset();
        const owns = getPresetOwns(preset);
        const owned = (f) => owns.includes(f);

        // 字段控件禁用/启用
        Object.keys(EDITOR_FIELD_CTRLS).forEach((field) => {
            const ctrl = $(EDITOR_FIELD_CTRLS[field]);
            if (!ctrl) return;
            const taken = owned(field);
            ctrl.disabled = taken;
            ctrl.classList.toggle('cf-owner-disabled', taken);
            if (taken) ctrl.title = '由预设控制，请在预设面板调整';
            else ctrl.removeAttribute('title');
        });

        // 位置提示行：posX/posY 被接管时显示
        const tip = $('#cf-pos-owner-tip');
        if (tip) tip.style.display = (owned('posX') || owned('posY')) ? '' : 'none';

        // 高级编辑区：激活预设带 effects 时，高级字段由预设决定，整区禁用并提示
        const hasEffects = activePresetHasEffects();
        const advBody = $('#cf-adv-body');
        const advTip = $('#cf-adv-owner-tip');
        if (advBody) {
            advBody.classList.toggle('cf-owner-disabled', hasEffects);
            advBody.querySelectorAll('input,select,button').forEach((c) => { c.disabled = hasEffects; });
            // 无 effects 接管时，按投影/外发光/模糊各自的开关恢复子输入状态
            if (!hasEffects) syncAdvEnableUI();
        }
        if (advTip) advTip.style.display = hasEffects ? '' : 'none';

        // 运动轨迹区：坐标本质是 posX/posY，被接管时整区隐藏
        const movesSec = $('#cf-moves-sec');
        if (movesSec) movesSec.style.display = (owned('posX') || owned('posY')) ? 'none' : '';
    }

    // 主动保存当前预设的微调参数
    function saveActivePresetOptions() {
        const preset = getActivePreset();
        if (!preset) return;
        // 同时持久化 options（排版参数）与 effects（高级样式/运动），刷新后都生效
        savePresetOptions(preset.id, {
            options: preset.options || {},
            effects: preset.effects || null,
        });
        status(`💾 已保存「${preset.name}」的当前参数，刷新后生效`, 'ok');
    }

    // 恢复当前预设为 JSON 定义的原值（清掉保存过的微调）
    function restoreActivePresetOptions() {
        const preset = getActivePreset();
        if (!preset) return;
        try { localStorage.removeItem('cf_sub_presetOpt_' + preset.id); } catch (e) {}
        // 内置预设用快照；自定义预设用导入时记下的原值
        const orig = DEFAULT_PRESET_OPTIONS[preset.id] || (preset._origOptions || {});
        preset.options = Object.assign({}, orig);
        // effects 同样还原到导入时的原值
        if (preset._origEffects) preset.effects = JSON.parse(JSON.stringify(preset._origEffects));
        renderPresetParams();
        status(`↩ 已恢复「${preset.name}」默认参数`, 'ok');
    }

    // 参数控件构造器（预设参数面板与效果开发面板共用）：
    //   param   —— 参数声明 { key,label,type,choices?,min?,max?,step?,default?,placeholder? }
    //   get     —— 读当前值；set —— 写回值；onChange —— 变化后回调（color 用 input 事件连续触发，不回调）
    function buildParamControl(param, get, set, onChange) {
        const row = document.createElement('div');
        row.className = 'cf-row';
        const label = document.createElement('label');
        label.textContent = param.label || param.key;
        row.appendChild(label);

        const raw = get();
        const val = (raw !== undefined && raw !== null) ? raw : param.default;
        let input;
        if (param.type === 'select') {
            input = document.createElement('select');
            (param.choices || []).forEach((c) => {
                const o = document.createElement('option');
                o.value = c.value; o.textContent = c.label;
                if (String(val) === String(c.value)) o.selected = true;
                input.appendChild(o);
            });
            input.addEventListener('change', () => { set(input.value); if (onChange) onChange(input.value); });
        } else if (param.type === 'color') {
            input = document.createElement('input');
            input.type = 'color';
            input.value = /^#[0-9a-fA-F]{6}$/.test(String(val)) ? val : '#ffffff';
            input.addEventListener('input', () => set(input.value));
        } else if (param.type === 'checkbox') {
            input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = !!val;
            input.addEventListener('change', () => { set(input.checked); if (onChange) onChange(input.checked); });
        } else if (param.type === 'text') {
            input = document.createElement('input');
            input.type = 'text';
            input.placeholder = param.placeholder || '';
            input.value = (val !== undefined && val !== null) ? val : '';
            input.addEventListener('change', () => { set(input.value); if (onChange) onChange(input.value); });
        } else { // number 及其他默认按 number 处理
            input = document.createElement('input');
            input.type = 'number';
            if (param.min !== undefined) input.min = param.min;
            if (param.max !== undefined) input.max = param.max;
            if (param.step !== undefined) input.step = param.step;
            input.value = (val === undefined || val === null) ? '' : val;
            input.addEventListener('change', () => {
                let v = parseFloat(input.value);
                if (isNaN(v)) v = (param.default !== undefined ? param.default : 0);
                set(v);
                if (onChange) onChange(v);
            });
        }
        row.appendChild(input);
        return row;
    }

    // 按激活预设的 params 声明，动态生成参数编辑控件。
    // 支持 param.group 字段：同组参数聚在一起，组间显示分组标题，
    // 让开发者能通过 JSON 控制面板的分组与顺序，参数多了也不乱。
    function renderPresetParams() {
        const box = $('#cf-preset-params');
        if (!box) return;
        const preset = getActivePreset();
        const params = (preset && preset.params) || [];
        box.innerHTML = '';
        if (!params.length) { box.style.display = 'none'; return; }
        box.style.display = '';

        function makeRow(param) {
            // 直接定位 preset.options / preset.effects 的真实字段，读写都落到本体
            const target = paramTarget(preset, param.key);
            const row = buildParamControl(param,
                () => getByPath(target.root, target.path),
                (v) => setByPath(target.root, target.path, v),
                (v) => status(`已调整「${param.label}」= ${v}（未保存）`, 'busy'));
            row.classList.add('cf-preset-param-row');
            return row;
        }

        // 按 group 分组渲染（保持 params 里 group 首次出现的顺序）
        let lastGroup = undefined;
        let lastTitle = null;
        params.forEach((param) => {
            if (!param || !param.key) return;
            const g = param.group || '';
            if (g !== lastGroup) {
                lastGroup = g;
                if (g) {
                    const t = document.createElement('div');
                    t.className = 'cf-param-group-title';
                    t.textContent = g;
                    box.appendChild(t);
                    lastTitle = t;
                } else {
                    lastTitle = null;
                }
            }
            box.appendChild(makeRow(param));
        });
    }

    function onPresetChange() {
        const sel = $('#cf-preset');
        activePresetId = sel ? sel.value : 'none';
        // 激活预设带 effects 时，批量发送复用这些高级字段
        const preset = getActivePreset();
        updatePresetUI();
        status(`已切换预设：${(preset || {}).name || '无'}${activePresetHasEffects() ? '（含高级字段）' : ''}`, 'ok');
    }

    function importPreset() { $('#cf-preset-file').click(); }

    // 把预设对象转成「可分享 JSON」：剥离内部字段，带上当前微调后的 options 与 effects
    function presetsToExport(list) {
        return list.map((p) => {
            const o = Object.assign({}, p.options);
            // 去掉运行时内部字段
            delete o.__seq;
            const out = {
                id: p.id,
                name: p.name,
                desc: p.desc || '',
                transform: p.transform,
                options: o,
                params: (p.params || []).map((x) => ({ ...x })),
            };
            // owns 是预设对编辑器字段的接管声明，导出时保留，保证开发者手写的声明不丢
            if (Array.isArray(p.owns)) out.owns = p.owns.slice();
            // 作者署名（导出弹窗填写，默认 A 站昵称 + uid）
            if (p.author) out.author = p.author;
            if (p.effects) out.effects = JSON.parse(JSON.stringify(p.effects));
            // composition 是效果开发面板创作的引擎组合，导出时保留
            if (p.composition) out.composition = JSON.parse(JSON.stringify(p.composition));
            return out;
        });
    }

    // 触发浏览器下载 JSON 文件
    function downloadJson(filename, obj) {
        try {
            const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (e) {
            status('导出失败: ' + e.message, 'err');
        }
    }

    // 导出弹窗：补全命名/描述/作者后导出为 JSON 文件（接收方用「导入预设」使用，不涉及脚本改动）。
    // preset 为要导出的预设对象：列表里的预设会把填写的元信息写回本体（下次导出记住），
    // 临时构造的预设（如高级编辑导出）仅用于本次导出。作者默认填当前 A 站昵称 + uid。
    function openExportDialog(preset) {
        if (!preset) { status('没有可导出的预设', 'err'); return; }
        const old = $('#cf-export-panel');
        if (old) old.remove();
        const mask = document.createElement('div');
        mask.id = 'cf-export-panel';
        mask.className = 'cf-dev-panel-mask';
        mask.innerHTML = `
            <div class="cf-dev-dlg">
                <p class="cf-dev-title">📤 导出预设（JSON）</p>
                <p class="cf-dev-sub">补全分享信息后导出 JSON 文件；导入方通过「📥 导入预设」使用</p>
                <div class="cf-exp-row"><label>名称</label><input type="text" id="cf-exp-name" placeholder="预设名称（必填）"></div>
                <div class="cf-exp-row"><label>描述</label><textarea id="cf-exp-desc" rows="2" placeholder="预设效果说明（可选）"></textarea></div>
                <div class="cf-exp-row"><label>作者</label><input type="text" id="cf-exp-author" placeholder="默认填当前登录的 A 站昵称 + uid"></div>
                <div class="cf-dev-foot">
                    <button type="button" class="cf-btn cf-btn-b" data-act="cancel">取消</button>
                    <button type="button" class="cf-btn cf-btn-p" data-act="export">📤 导出 JSON</button>
                </div>
            </div>`;
        mask.querySelector('#cf-exp-name').value = preset.name || '';
        mask.querySelector('#cf-exp-desc').value = preset.desc || '';
        mask.querySelector('#cf-exp-author').value = preset.author || getAcfunAuthor();
        document.body.appendChild(mask);
        const close = () => mask.remove();
        mask.querySelector('[data-act=cancel]').addEventListener('click', close);
        mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
        mask.querySelector('[data-act=export]').addEventListener('click', () => {
            const name = mask.querySelector('#cf-exp-name').value.trim();
            const desc = mask.querySelector('#cf-exp-desc').value.trim();
            const author = mask.querySelector('#cf-exp-author').value.trim();
            if (!name) { status('请填写预设名称', 'err'); return; }
            // 元信息写回预设本体：列表里的预设同步更名/更新描述，下次导出不再重填；
            // author 可为空串，presetsToExport 对空值不写 JSON
            preset.name = name;
            preset.desc = desc;
            preset.author = author;
            downloadJson('预设-' + name.replace(/[\\/:*?"<>|]/g, '_') + '.json', presetsToExport([preset])[0]);
            refreshPresetSelect();
            status(`📤 已导出「${name}」${author ? ' · 作者 ' + author : ''}`, 'ok');
            close();
        });
        const nameInput = mask.querySelector('#cf-exp-name');
        if (nameInput) { nameInput.focus(); nameInput.select(); }
    }

    // 导出单个预设（当前选中的，含内置与自定义）：先补全命名/描述/作者再导出
    function exportCurrentPreset() {
        openExportDialog(getActivePreset());
    }

    // 导出全部自定义预设（备份）
    function exportAllPresets() {
        if (!customPresets.length) { status('没有导入的自定义预设可导出', 'err'); return; }
        downloadJson('预设备份-' + customPresets.length + '个.json', presetsToExport(customPresets));
        status(`📤 已导出 ${customPresets.length} 个自定义预设`, 'ok');
    }

    // 删除当前选中的自定义预设（内置预设不可删）
    function deleteCurrentPreset() {
        const p = getActivePreset();
        if (!p) return;
        const isBuiltin = BUILTIN_PRESETS.some((b) => b.id === p.id);
        if (isBuiltin) { status('内置预设不可删除', 'err'); return; }
        const idx = customPresets.findIndex((x) => x.id === p.id);
        if (idx < 0) { status('该预设不是导入的自定义预设', 'err'); return; }
        if (!confirm(`删除预设「${p.name}」？`)) return;
        customPresets.splice(idx, 1);
        // 清理该预设保存过的参数
        try { localStorage.removeItem('cf_sub_presetOpt_' + p.id); } catch (e) {}
        activePresetId = 'none';
        refreshPresetSelect();
        status(`🗑 已删除「${p.name}」`, 'ok');
    }

    // 校验 composition（效果开发面板创作的引擎组合）：每个阶段的引擎名必须在 ENGINES 里存在
    function validateComposition(comp) {
        if (!comp || typeof comp !== 'object') return false;
        return STAGES.every((s) => {
            const name = comp[s.key];
            return name != null && ENGINES[s.key] && ENGINES[s.key][name];
        });
    }

    // 预设的激活引擎组合：composition 优先，旧 transform 字段折算成 composition（none 则无）
    function activeCompositionOf(p) {
        if (p.composition) return p.composition;
        if (p.transform && COMPOSITIONS[p.transform]) return COMPOSITIONS[p.transform];
        return null;
    }

    // 导入时的参数校验：剔除无 key / 重复 key 的项，提醒 type 拼错、
    // 以及「引擎组合没声明、调了不生效」的参数（多为手写 JSON 笔误）。
    // 只提醒不阻断——声明少于引擎参数是合法用法（预设可只暴露部分参数）。
    function sanitizePresetParams(p) {
        const warnings = [];
        const out = [];
        const seen = {};
        const TYPES = ['number', 'select', 'color', 'checkbox', 'text'];
        const comp = activeCompositionOf(p);
        const declared = comp ? activeEngineParamKeys(comp) : null;
        // 声明 key 是 'step.x' 时，父路径 'step' 也算命中（嵌套对象参数）
        const isDeclared = (k) => declared && declared.some((d) => d === k || d.indexOf(k + '.') === 0);
        (p.params || []).forEach((param) => {
            if (!param || typeof param !== 'object' || !param.key) {
                warnings.push('有一个参数缺少 key，已忽略');
                return;
            }
            const key = String(param.key);
            if (seen[key]) { warnings.push(`参数「${key}」重复，已忽略后者`); return; }
            seen[key] = true;
            if (param.type && TYPES.indexOf(param.type) < 0) {
                warnings.push(`参数「${key}」的 type "${param.type}" 无法识别，将按数字处理`);
            }
            if (declared && key.indexOf('effects.') !== 0 && !isDeclared(key)) {
                warnings.push(`参数「${key}」未被当前引擎组合声明，调整它不会生效`);
            }
            out.push(param);
        });
        return { params: out, warnings };
    }

    function loadPresetFile(file) {
        const r = new FileReader();
        r.onload = () => {
            try {
                const data = JSON.parse(r.result);
                const arr = Array.isArray(data) ? data : [data];
                let n = 0;
                const warns = [];
                for (const p of arr) {
                    if (!p || !p.id || !p.name) continue;
                    // 校验 transform 合法性
                    if (p.transform && p.transform !== 'none' && !COMPOSITIONS[p.transform]) {
                        status(`⚠️ 预设「${p.name}」的 transform 类型无效，已跳过`, 'err');
                        continue;
                    }
                    // 校验 composition 合法性（开发面板创作的预设走 composition）
                    if (p.composition && !validateComposition(p.composition)) {
                        status(`⚠️ 预设「${p.name}」的 composition 无效，已跳过`, 'err');
                        continue;
                    }
                    if (!p.options || typeof p.options !== 'object') p.options = {};
                    if (!Array.isArray(p.params)) p.params = [];
                    // 参数校验：剔除无效项并收集提醒（type 拼错、引擎未声明等）
                    const sp = sanitizePresetParams(p);
                    p.params = sp.params;
                    sp.warnings.forEach((w) => warns.push(`「${p.name}」${w}`));
                    p._origOptions = Object.assign({}, p.options);   // 记下 JSON 原值，供恢复默认
                    p._origEffects = p.effects ? JSON.parse(JSON.stringify(p.effects)) : null;
                    const dup = customPresets.findIndex((x) => x.id === p.id);
                    if (dup >= 0) customPresets[dup] = p; else customPresets.push(p);
                    n++;
                }
                if (warns.length) status('⚠️ 导入提醒：' + warns.join('；'), 'err');
                refreshPresetSelect();
                status(`✅ 已导入 ${n} 个预设（仅本次会话，刷新后需重新导入）`, 'ok');
            } catch (e) {
                status('预设 JSON 解析失败: ' + e.message, 'err');
            }
        };
        r.readAsText(file, 'utf-8');
    }

    // ============================================================
    //  效果开发面板：自由组合 5 阶段引擎，创作新预设
    //  草稿 devDraft = { split, layout, color, timing, motion, options }
    //    composition（引擎名映射）+ options（各引擎参数，扁平、支持点路径）
    // ============================================================
    let devDraft = null;
    let devRestoreBtn = null;   // 预览最小化后的「恢复面板」按钮（挂在 body 上，确保可见可点）

    // —— 草稿持久化：关面板 / 刷新页面后重新打开，还原上次的引擎组合、参数与预览文本 ——
    function defaultDevDraft() {
        return { split: 'none', layout: 'none', color: 'single', timing: 'uniform', motion: 'none', options: {}, previewText: '' };
    }
    function persistDevDraft() {
        try { storeSet('devDraft', JSON.stringify(devDraft)); } catch (e) {}
    }
    // 还原已保存的草稿：引擎名按当前 ENGINES 校验（版本更迭后旧草稿可能引用已删引擎），
    // options 只保留激活引擎声明过的 key，防止旧草稿残留值污染新组合
    function loadSavedDevDraft() {
        let raw;
        try { raw = JSON.parse(storeGet('devDraft', 'null')); } catch (e) { return null; }
        if (!raw || typeof raw !== 'object') return null;
        const d = defaultDevDraft();
        let touched = false;
        STAGES.forEach((s) => {
            const v = raw[s.key];
            if (typeof v === 'string' && ENGINES[s.key] && ENGINES[s.key][v]) { d[s.key] = v; touched = true; }
        });
        if (!touched) return null;
        if (raw.options && typeof raw.options === 'object') d.options = raw.options;
        if (typeof raw.previewText === 'string') d.previewText = raw.previewText;
        d.options = filterOptionsByKeys(d.options, activeEngineParamKeys(d));
        return d;
    }

    function closeDevPanel(mask) {
        if (devRestoreBtn) { devRestoreBtn.remove(); devRestoreBtn = null; }
        if (mask) mask.remove();
    }

    function openDevPanel() {
        const old = $('#cf-dev-panel');
        if (old) closeDevPanel(old);
        devDraft = loadSavedDevDraft() || defaultDevDraft();
        const mask = document.createElement('div');
        mask.id = 'cf-dev-panel';
        mask.className = 'cf-dev-panel-mask';
        mask.innerHTML = `
            <div class="cf-dev-dlg">
                <p class="cf-dev-title">🎨 效果开发面板</p>
                <p class="cf-dev-sub">自由组合 5 个阶段的效果引擎，创作预设里没有的新效果</p>
                <div class="cf-dev-preview-text">
                    <label>预览文本</label>
                    <textarea class="cf-dev-text-input" id="cf-dev-preview-text" rows="3" placeholder="每行一句，多句预览跨句效果；留空则预览全部选中字幕"></textarea>
                </div>
                <div class="cf-dev-body" id="cf-dev-body"></div>
                <div class="cf-dev-foot">
                    <button type="button" class="cf-btn cf-btn-b" data-act="cancel">取消</button>
                    <button type="button" class="cf-btn cf-btn-b" data-act="reset">↺ 重置</button>
                    <button type="button" class="cf-btn cf-btn-b" data-act="preview">👁 预览</button>
                    <button type="button" class="cf-btn cf-btn-p" data-act="save">💾 保存为预设</button>
                </div>
            </div>`;
        document.body.appendChild(mask);
        renderDevStages(mask);
        // 还原上次输入的预览文本，并随输入持久化
        const textInput = mask.querySelector('#cf-dev-preview-text');
        if (textInput) {
            textInput.value = devDraft.previewText || '';
            textInput.addEventListener('input', () => { devDraft.previewText = textInput.value; persistDevDraft(); });
        }
        mask.querySelector('[data-act=cancel]').addEventListener('click', () => closeDevPanel(mask));
        mask.querySelector('[data-act=reset]').addEventListener('click', () => resetDevPanel(mask));
        mask.querySelector('[data-act=preview]').addEventListener('click', previewDev);
        mask.querySelector('[data-act=save]').addEventListener('click', () => saveDevPreset(mask));
        mask.addEventListener('click', (e) => { if (e.target === mask) closeDevPanel(mask); });
    }

    // 重置开发面板：草稿清回初始组合（含预览文本），同步覆盖持久化存档
    function resetDevPanel(mask) {
        if (!confirm('重置开发面板？当前引擎组合、参数与预览文本将被清空')) return;
        devDraft = defaultDevDraft();
        persistDevDraft();
        renderDevStages(mask);
        const textInput = mask.querySelector('#cf-dev-preview-text');
        if (textInput) textInput.value = '';
        status('↺ 开发面板已重置为初始状态', 'ok');
    }

    function renderDevStages(mask) {
        const body = mask.querySelector('#cf-dev-body');
        body.innerHTML = '';
        STAGES.forEach((stage) => {
            const engines = ENGINES[stage.key];
            const cur = devDraft[stage.key];
            const wrap = document.createElement('div');
            wrap.className = 'cf-dev-stage';
            wrap.innerHTML = `
                <div class="cf-dev-stage-head">
                    <label>${stage.label}</label>
                    <select class="cf-dev-engine" data-stage="${stage.key}">
                        ${Object.keys(engines).filter((name) => !engines[name].hidden).map((name) => `<option value="${name}"${name === cur ? ' selected' : ''}>${engines[name].label}</option>`).join('')}
                    </select>
                    <span class="cf-dev-desc"></span>
                </div>
                <div class="cf-dev-params" data-stage-params="${stage.key}"></div>`;
            body.appendChild(wrap);
            const sel = wrap.querySelector('.cf-dev-engine');
            sel.addEventListener('change', () => {
                devDraft[stage.key] = sel.value;
                renderDevParams(wrap, stage.key);
                renderDevSplitTip(mask);
                persistDevDraft();
            });
            renderDevParams(wrap, stage.key);
        });
        renderDevSplitTip(mask);
    }

    // 开发面板：逐字拆发提示（拆字 + 逐字延迟/扫光时弹幕量极大）
    function renderDevSplitTip(mask) {
        const body = mask.querySelector('#cf-dev-body');
        if (!body) return;
        let tip = body.querySelector('.cf-dev-split-tip');
        if (isCharSplitComposition(devDraft)) {
            if (!tip) {
                tip = document.createElement('div');
                tip.className = 'cf-dev-split-tip';
                body.insertBefore(tip, body.firstChild);
            }
            tip.textContent = '⚠️ 当前组合逐字拆发，每句拆成大量弹幕（约字数×N 倍），请控制发送量、注意 A 站弹幕规范';
        } else if (tip) {
            tip.remove();
        }
    }

    function renderDevParams(wrap, stageKey) {
        const engine = ENGINES[stageKey][devDraft[stageKey]];
        const box = wrap.querySelector('.cf-dev-params');
        const descEl = wrap.querySelector('.cf-dev-desc');
        if (descEl) {
            // 说明文字受布局限制会被截断，改成 ⓘ 图标 + title 悬浮提示完整说明
            const d = engine.desc || '';
            descEl.textContent = d ? 'ⓘ' : '';
            descEl.title = d;
        }
        box.innerHTML = '';
        if (!engine.params.length) { box.style.display = 'none'; return; }
        box.style.display = '';
        engine.params.forEach((param) => {
            const row = buildParamControl(param,
                () => getByPath(devDraft.options, param.key),
                (v) => { setByPath(devDraft.options, param.key, v); persistDevDraft(); });
            row.classList.add('cf-dev-param-row');
            box.appendChild(row);
        });
    }

    // 激活引擎组合声明过的参数 key 列表（含 dot 路径），供残留值过滤与导入校验共用
    function activeEngineParamKeys(comp) {
        const keys = [];
        STAGES.forEach((s) => {
            const eng = ENGINES[s.key] && ENGINES[s.key][comp[s.key]];
            if (eng && eng.params) eng.params.forEach((p) => { if (p && p.key) keys.push(p.key); });
        });
        return keys;
    }

    // 只保留 keys 声明过的参数（含父路径，如 'step' 保留给 'step.x'），
    // 避免切换引擎时残留的旧值被带进导出 JSON / 草稿还原
    function filterOptionsByKeys(options, keys) {
        const out = {};
        Object.keys(options || {}).forEach((k) => {
            if (keys.some((ak) => ak === k || ak.indexOf(k + '.') === 0)) out[k] = options[k];
        });
        return out;
    }

    function collectDevDraft() {
        const composition = {};
        const params = [];
        STAGES.forEach((s) => {
            composition[s.key] = devDraft[s.key];
            const eng = ENGINES[s.key] && ENGINES[s.key][devDraft[s.key]];
            if (!eng || !eng.params) return;
            // 把激活引擎声明的参数一并带进保存的预设：保存后预设面板可直接微调
            //（分组标题缺省用阶段名，让不同阶段的参数在面板里自然分开）
            eng.params.forEach((p) => {
                if (!p || !p.key) return;
                const copy = Object.assign({}, p);
                if (copy.group === undefined) copy.group = s.label;
                params.push(copy);
            });
        });
        return {
            composition,
            options: filterOptionsByKeys(devDraft.options, activeEngineParamKeys(composition)),
            params,
        };
    }

    function minimizeDevPanel(mask) {
        if (!mask) return;
        const dlg = mask.querySelector('.cf-dev-dlg');
        if (dlg) dlg.style.display = 'none';
        mask.classList.add('cf-dev-min');
        if (!devRestoreBtn) {
            devRestoreBtn = document.createElement('button');
            devRestoreBtn.type = 'button';
            devRestoreBtn.className = 'cf-dev-restore';
            devRestoreBtn.textContent = '🎨 预览中 · 点击恢复开发面板';
            document.body.appendChild(devRestoreBtn);
            devRestoreBtn.addEventListener('click', () => restoreDevPanel(mask));
        }
        devRestoreBtn.style.display = '';
    }

    function restoreDevPanel(mask) {
        if (mask) {
            const dlg = mask.querySelector('.cf-dev-dlg');
            if (dlg) dlg.style.display = '';
            mask.classList.remove('cf-dev-min');
        }
        if (devRestoreBtn) devRestoreBtn.style.display = 'none';
    }

    function previewDev() {
        const mask = $('#cf-dev-panel');
        minimizeDevPanel(mask);
        const draft = collectDevDraft();
        const p = getPlayer();
        const curMs = (p && typeof p.currentTime === 'number') ? Math.round(p.currentTime * 1000) : 0;
        const textInput = $('#cf-dev-preview-text');
        const customText = textInput ? textInput.value.trim() : '';
        const GAP = 2000;   // 多句预览时，每句间隔 2 秒
        let subList;
        if (customText) {
            // 多行拆成多句，每句独立、按顺序衔接（供 KTV 双排 / 竖排 KTV 等跨句效果）
            const lines = customText.split(/\n/).map((s) => s.trim()).filter(Boolean);
            subList = lines.map((text, i) => ({ time: curMs + i * GAP, text, duration: GAP }));
        } else {
            // 导入字幕：用全部选中字幕，按真实时间轴预览全部
            const selected = subs.filter((s) => s.selected);
            if (selected.length) {
                subList = selected.map((s) => ({ time: s.time, text: s.text, duration: calcDurationMs(subs.indexOf(s)) }));
            } else {
                subList = ['AC在，爱一直在', '天下漫友是一家'].map((text, i) => ({ time: curMs + i * GAP, text, duration: GAP }));
            }
        }
        const tempId = '__dev_preview__';
        customPresets.push({ id: tempId, name: '预览', desc: '', transform: 'none', composition: draft.composition, options: draft.options, params: [] });
        const oldId = activePresetId;
        activePresetId = tempId;
        syncEditorOwnedUI();
        previewMulti(subList, GAP).then(() => {
            activePresetId = oldId;
            const i = customPresets.findIndex((p) => p.id === tempId);
            if (i >= 0) customPresets.splice(i, 1);
            syncEditorOwnedUI();
        });
    }

    function saveDevPreset(mask) {
        const draft = collectDevDraft();
        const preset = {
            id: 'dev-' + genId().slice(0, 8),
            name: '开发预设-' + new Date().toISOString().slice(11, 19).replace(/:/g, ''),
            desc: '由效果开发面板创作',
            transform: 'none',
            composition: draft.composition,
            options: draft.options,
            params: draft.params,   // 带上引擎声明的参数，保存后预设面板可直接微调
            author: getAcfunAuthor(),   // 自动署名（A 站昵称 + uid），导出弹窗可直接改
        };
        customPresets.push(preset);
        activePresetId = preset.id;
        refreshPresetSelect();
        status(`💾 已保存新预设「${preset.name}」，可像普通预设一样使用`, 'ok');
        closeDevPanel(mask);
    }

    function loadSub2File(file) {
        const r = new FileReader();
        r.onload = () => {
            try {
                subs2 = parseSub(r.result, file.name);
                if (!subs2.length) throw new Error('未解析到第二语言字幕');
                $('#cf-sub2-hint').textContent = `${file.name} · ${subs2.length} 条`;
                status(`✅ 第二语言字幕已加载：${subs2.length} 条`, 'ok');
            } catch (e) {
                subs2 = [];
                $('#cf-sub2-hint').textContent = '未上传';
                status('第二语言字幕解析失败: ' + e.message, 'err');
            }
        };
        r.readAsText(file, 'utf-8');
    }

