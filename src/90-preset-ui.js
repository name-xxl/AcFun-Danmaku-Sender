    // ============================================================
    //  预设 UI 逻辑
    // ============================================================

    function refreshPresetSelect() {
        const sel = $('#cf-preset');
        if (!sel) return;
        const cur = activePresetId;
        sel.innerHTML = getAllPresets().map((p) => `<option value="${p.id}"${p.id === cur ? ' selected' : ''}>${p.name}</option>`).join('');
        updatePresetUI();
    }

    function updatePresetUI() {
        const preset = getActivePreset();
        const desc = $('#cf-preset-desc');
        if (desc) desc.textContent = preset ? (preset.desc || '') : '';
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

    // 取当前预设接管的字段集合：preset.owns 显式声明优先，否则按 transform 默认
    function getPresetOwns(preset) {
        if (!preset) return [];
        if (Array.isArray(preset.owns)) return preset.owns;
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
        const hasEffects = !!activePresetEffects;
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
        syncActiveEffects();
        renderPresetParams();
        status(`↩ 已恢复「${preset.name}」默认参数`, 'ok');
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
            const raw = getByPath(target.root, target.path);
            const cur = (raw !== undefined) ? raw : param.default;
            const row = document.createElement('div');
            row.className = 'cf-row cf-preset-param-row';
            const label = document.createElement('label');
            label.textContent = param.label || param.key;
            row.appendChild(label);

            let input;
            if (param.type === 'select') {
                input = document.createElement('select');
                (param.choices || []).forEach((c) => {
                    const o = document.createElement('option');
                    o.value = c.value; o.textContent = c.label;
                    if (String(cur) === String(c.value)) o.selected = true;
                    input.appendChild(o);
                });
                input.addEventListener('change', () => {
                    setByPath(target.root, target.path, input.value);
                    status(`已调整「${param.label}」= ${input.value}（未保存）`, 'busy');
                });
            } else if (param.type === 'color') {
                input = document.createElement('input');
                input.type = 'color';
                input.value = /^#[0-9a-fA-F]{6}$/.test(String(cur)) ? cur : '#ffffff';
                input.addEventListener('input', () => {
                    setByPath(target.root, target.path, input.value);
                });
            } else if (param.type === 'checkbox') {
                input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = !!cur;
                input.addEventListener('change', () => {
                    setByPath(target.root, target.path, input.checked);
                    status(`已调整「${param.label}」= ${input.checked}（未保存）`, 'busy');
                });
            } else { // number 及其他默认按 number 处理
                input = document.createElement('input');
                input.type = 'number';
                if (param.min !== undefined) input.min = param.min;
                if (param.max !== undefined) input.max = param.max;
                if (param.step !== undefined) input.step = param.step;
                input.value = cur;
                input.addEventListener('change', () => {
                    let v = parseFloat(input.value);
                    if (isNaN(v)) v = param.default;
                    setByPath(target.root, target.path, v);
                    status(`已调整「${param.label}」= ${v}（未保存）`, 'busy');
                });
            }
            row.appendChild(input);
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
        activePresetEffects = (preset && preset.effects) ? preset.effects : null;
        updatePresetUI();
        status(`已切换预设：${(preset || {}).name || '无'}${activePresetEffects ? '（含高级字段）' : ''}`, 'ok');
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
            if (p.effects) out.effects = JSON.parse(JSON.stringify(p.effects));
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

    // 导出单个预设（当前选中的，含内置与自定义）
    function exportCurrentPreset() {
        const p = getActivePreset();
        if (!p) { status('没有可导出的预设', 'err'); return; }
        downloadJson('预设-' + p.id + '.json', presetsToExport([p])[0]);
        status(`📤 已导出「${p.name}」`, 'ok');
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
        syncActiveEffects();
        status(`🗑 已删除「${p.name}」`, 'ok');
    }

    function loadPresetFile(file) {
        const r = new FileReader();
        r.onload = () => {
            try {
                const data = JSON.parse(r.result);
                const arr = Array.isArray(data) ? data : [data];
                let n = 0;
                for (const p of arr) {
                    if (!p || !p.id || !p.name) continue;
                    // 校验 transform 合法性
                    if (p.transform && p.transform !== 'none' && !TRANSFORMS[p.transform]) {
                        status(`⚠️ 预设「${p.name}」的 transform 类型无效，已跳过`, 'err');
                        continue;
                    }
                    if (!p.options || typeof p.options !== 'object') p.options = {};
                    if (!Array.isArray(p.params)) p.params = [];
                    p._origOptions = Object.assign({}, p.options);   // 记下 JSON 原值，供恢复默认
                    p._origEffects = p.effects ? JSON.parse(JSON.stringify(p.effects)) : null;
                    const dup = customPresets.findIndex((x) => x.id === p.id);
                    if (dup >= 0) customPresets[dup] = p; else customPresets.push(p);
                    n++;
                }
                refreshPresetSelect();
                // 导入后若当前激活预设带 effects，同步 activePresetEffects
                syncActiveEffects();
                status(`✅ 已导入 ${n} 个预设（仅本次会话，刷新后需重新导入）`, 'ok');
            } catch (e) {
                status('预设 JSON 解析失败: ' + e.message, 'err');
            }
        };
        r.readAsText(file, 'utf-8');
    }

    // 根据当前激活预设同步 activePresetEffects（导入/删除后调用）
    function syncActiveEffects() {
        const preset = getActivePreset();
        activePresetEffects = (preset && preset.effects) ? preset.effects : null;
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

