    // ============================================================
    //  参数表单渲染层（schema → 控件 DOM 的唯一出口）
    // ============================================================
    // 理解卡｜我拥有：buildParamControl（param 声明 → 控件，返回 { node, sync }；type:'list' 另有 add）、
    //   订阅注册表（subscribeToParams / clearParamSubscriptions）、引擎参数声明的纯查询
    //   （activeCompositionOf / validateComposition / activeEngineParamKeys / filterOptionsByKeys）。
    // 我承诺：DOM 形状与样式稳定——单值控件只产出 div.cf-row > label + input，**行类名由调用方追加**
    //   （cf-preset-param-row / cf-dev-param-row），不设 id / name（预设区与 dev 面板同时挂两份控件，
    //   加 id 必然重名），不产出调用方没声明的类名（数字框宽度靠 boot.js 既有的
    //   .cf-row input[type=number]{width:56px}，无 .cf-num/.cf-sel/.cf-txt 这类类）；
    //   list 控件的所有类名（容器/每项/按钮/子区/输入框）一律来自声明，本模块不硬编码任何 cf- 类名；
    //   sync() 幂等——重读 get() 并按与首次构建**完全相同**的回退规则回写控件显示，重复执行无副作用。
    // 我永不：不持状态（参数真源是 preset.options / preset.effects 与 devDraft.options，本模块不建 store）；
    //   不发网络请求、不读播放器；不在重建容器时留着上一轮的订阅（重建前必须 clearParamSubscriptions）。
    // 改我前读：schema 真源是 50-engine.js 的 ENGINES[stage][name].params（与 10-constants 的
    //   BUILTIN_PRESETS[].params）——本模块认识 number / select / color / checkbox / text / list 六种控件，
    //   声明里出现第七种必须红灯（test/unit/form.test.mjs 的类型覆盖断言，学自 svfeed）；
    //   值回退链 default 可为 null（引擎 dualX/dualY 就是 null），清空输入框要写回 null 而不是 0；
    //   number 的 min/max/step 只在 !== undefined 时才上 DOM，change 时 parseFloat + isNaN 回 default——这是
    //   控件语义，**不是** 40-core 的 num()，别替换；`effects.` 前缀必须经 paramTarget 返回本体引用，
    //   浅拷贝会让改动不生效（旧故障：参数改了但间距/颜色没反应）；
    //   list 的子字段另有 **nullable** 语义（空串 ⇒ null，与 number 分支相反），见 buildListControl 头注。
    //   本片新增 list（可增删列表，运动轨迹用）；复合三连 X-Y-Z / 枚举网格 anchor / 依赖禁用态留给后续分片。

import { status } from './20-utils.js';
import { COMPOSITIONS, ENGINES, STAGES } from './50-engine.js';

    // 参数控件构造器（预设参数面板与效果开发面板共用）：
    //   param   —— 参数声明 { key,label,type,choices?,min?,max?,step?,default?,placeholder? }；
    //              type:'list' 走 buildListControl（声明形状见其头注）
    //   get     —— 读当前值；set —— 写回值；onChange —— 变化后回调（color 用 input 事件连续触发，不回调）
    // 返回 { node, sync }：node 为控件行 DOM（调用方追加自己的行类名后挂进容器）；
    //   sync() 重新调 get() 并按同一回退规则回写控件显示（幂等），供「值被外部改动后刷新显示」使用。
    function buildParamControl(param, get, set, onChange) {
        if (param.type === 'list') return buildListControl(param, get, set, onChange);
        const row = document.createElement('div');
        row.className = 'cf-row';
        const label = document.createElement('label');
        label.textContent = param.label || param.key;
        row.appendChild(label);

        // 唯一的值回退点：get() 的 undefined / null 一律落回 param.default（default 可为 null）
        const readVal = () => {
            const raw = get();
            return (raw !== undefined && raw !== null) ? raw : param.default;
        };
        const val = readVal();
        let input;
        let sync;
        if (param.type === 'select') {
            input = document.createElement('select');
            (param.choices || []).forEach((c) => {
                const o = document.createElement('option');
                o.value = c.value; o.textContent = c.label;
                if (String(val) === String(c.value)) o.selected = true;
                input.appendChild(o);
            });
            input.addEventListener('change', () => { set(input.value); if (onChange) onChange(input.value); });
            sync = () => {
                const v = readVal();
                Array.from(input.options).forEach((o) => { o.selected = String(v) === String(o.value); });
            };
        } else if (param.type === 'color') {
            input = document.createElement('input');
            input.type = 'color';
            input.value = /^#[0-9a-fA-F]{6}$/.test(String(val)) ? val : '#ffffff';
            input.addEventListener('input', () => set(input.value));
            sync = () => {
                const v = readVal();
                input.value = /^#[0-9a-fA-F]{6}$/.test(String(v)) ? v : '#ffffff';
            };
        } else if (param.type === 'checkbox') {
            input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = !!val;
            input.addEventListener('change', () => { set(input.checked); if (onChange) onChange(input.checked); });
            sync = () => { input.checked = !!readVal(); };
        } else if (param.type === 'text') {
            input = document.createElement('input');
            input.type = 'text';
            input.placeholder = param.placeholder || '';
            input.value = (val !== undefined && val !== null) ? val : '';
            input.addEventListener('change', () => { set(input.value); if (onChange) onChange(input.value); });
            sync = () => {
                const v = readVal();
                input.value = (v !== undefined && v !== null) ? v : '';
            };
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
            sync = () => {
                const v = readVal();
                input.value = (v === undefined || v === null) ? '' : v;
            };
        }
        row.appendChild(input);
        return { node: row, sync };
    }

    // ============================================================
    //  可增删列表控件（type: 'list'）——每项由子字段声明拼出，结构变化即整份重建
    // ============================================================
    // 声明（**全部类名与文案由消费方声明**，本模块不认识任何 cf- 类名，也不新增类名）：
    //   { key, label, type: 'list',
    //     item: [子字段…],                    常显子字段（按 row 分组，声明顺序即出现顺序）
    //     advanced?: { label, expandedLabel?, className?, toggleClass?, after?, fields: [子字段…] }
    //                                         初始折叠、可收起的子区（拉伸/旋转这类低频项）；
    //                                         after 给 row 名 → 子区插在该行之后，不给 → 落在末尾
    //     min?, minMessage?,                  最少条目数；删除会跌破时 status() 提示并拒绝（默认文案「至少保留 N 项」）
    //     addLabel?, addClass?,               「添加」按钮（不传则不产出按钮，由外部按钮调 add()）
    //     removeLabel?, removeClass?,         每项删除按钮（文案默认「删除」）
    //     title?,                             每项标题（{n} 占位为序号，用 <label> 产出；不传则无标题元素）
    //     containerClass?, itemClass? }       容器 / 每项容器的类名（不传则无类名）
    // 子字段（与顶层描述符同形状，故 min/max/step/placeholder/choices 的落地规则与单值控件一致）：
    //   { key, label?, type, row?, letter?, className?, min?, max?, step?, placeholder?, choices?,
    //     default?, nullable?, hint?: { className, format }, after?: { text, style? } }
    //   · row    —— 同 row 的字段排进同一个 div.cf-row；字段声明了 label 就在它前面产出 <label>
    //               （行首字段的 label 即行标题；「耗时」行里的第二个 label「缓动」由同一规则产出）
    //   · letter —— 输入框前的行内字母（X/Y/Z），纯文本节点，不额外包元素
    //   · nullable —— number 的**可空**语义：输入框空串 ⇒ null（含义是「跟随样式/本体/时长」），
    //               与 buildParamControl 的 number 分支**相反**（那里 parseFloat('') → NaN → 落回 default），
    //               两者的用途不同：单值参数空 = 取默认值，列表条目空 = 交还上层变换。别混用。
    //   · hint   —— 输入框**紧后**的提示 span（即它的 nextElementSibling）；format(输入框原值) → 文本，
    //               初始算一次并绑 input 事件刷新（旋转圈数「N圈M°」提示）
    //   · after  —— 输入框后的静态说明 span（沿用旧模板的行内小字样式，由声明给出 style）
    // 值语义：字段级编辑**就地**改内存里的那条对象再 set(整个新数组)，不重渲染（否则输入框失焦）；
    //   结构级编辑（add / 删除 / sync）set(新数组) 并重建整份列表 DOM。
    function buildListControl(param, get, set, onChange) {
        const container = document.createElement('div');
        if (param.containerClass) container.className = param.containerClass;
        const readItems = () => { const v = get(); return Array.isArray(v) ? v : []; };
        const commit = (next) => { set(next); if (onChange) onChange(next); };

        // 字段 → 行：同 row 的字段归一行，首次出现的位置决定行序
        const groupRows = (fields) => {
            const out = [];
            fields.forEach((f) => {
                const key = f.row || ('#' + f.key);
                let r = out.filter((x) => x.key === key)[0];
                if (!r) { r = { key, fields: [] }; out.push(r); }
                r.fields.push(f);
            });
            return out;
        };
        // 条目字段的显示文本：null/undefined → 空（空输入框 + 占位文案），显式值才显示数值
        const textOf = (f, item) => {
            const v = item ? item[f.key] : undefined;
            return (v === undefined || v === null) ? '' : String(v);
        };

        const buildInput = (f, item, onEdit) => {
            if (f.type === 'select') {
                const sel = document.createElement('select');
                const choices = f.choices || [];
                const want = textOf(f, item);
                const hit = choices.some((c) => String(c.value) === want);
                choices.forEach((c, ci) => {
                    const o = document.createElement('option');
                    o.value = c.value;
                    o.textContent = c.label;
                    // 命中的选项标 selected；一个都不命中时标首个（select 本就必须有选中项，
                    // 且旧模板对未知缓动也是回落 linear = 首项）
                    if (String(c.value) === want || (!hit && ci === 0)) o.setAttribute('selected', '');
                    sel.appendChild(o);
                });
                sel.addEventListener('change', () => onEdit(sel.value));
                return sel;
            }
            // number 与其余未知 type（兜底按 number，同 buildParamControl 的默认分支）
            const input = document.createElement('input');
            input.type = 'number';
            if (f.min !== undefined) input.min = f.min;
            if (f.max !== undefined) input.max = f.max;
            if (f.step !== undefined) input.step = f.step;
            input.placeholder = f.placeholder || '';
            // 初值走 setAttribute：与旧 innerHTML 模板产出的 DOM 逐属性一致（空值也留 value=""）
            input.setAttribute('value', textOf(f, item));
            input.addEventListener('change', () => {
                let v = parseFloat(input.value);
                // 可空字段：空串/非法 ⇒ null（交还上层变换）；否则与 number 分支同规则落回 default
                if (isNaN(v)) v = f.nullable ? null : (f.default !== undefined ? f.default : 0);
                onEdit(v);
            });
            return input;
        };

        // 一行：字段依次产出 [label?] [letter?] input [hint?] [after?]
        const buildRow = (fields, item, onEdit) => {
            const row = document.createElement('div');
            row.className = 'cf-row';
            fields.forEach((f) => {
                if (f.label) {
                    const label = document.createElement('label');
                    label.textContent = f.label;
                    row.appendChild(label);
                }
                if (f.letter) row.appendChild(document.createTextNode(f.letter));
                const input = buildInput(f, item, (v) => onEdit(f.key, v));
                if (f.className) input.className = f.className;
                row.appendChild(input);
                if (f.hint) {
                    const hint = document.createElement('span');
                    hint.className = f.hint.className || '';
                    const upd = () => { hint.textContent = f.hint.format ? f.hint.format(input.value) : ''; };
                    input.addEventListener('input', upd);
                    upd();                      // 初始也算一次（否则空值下提示与输入框不同步）
                    row.appendChild(hint);
                }
                if (f.after) {
                    const note = document.createElement('span');
                    note.textContent = f.after.text;
                    if (f.after.style) note.setAttribute('style', f.after.style);
                    row.appendChild(note);
                }
            });
            return row;
        };

        const buildAdvanced = (adv, item, onEdit) => {
            const box = document.createElement('div');
            if (adv.className) box.className = adv.className;
            box.style.display = 'none';         // 初始折叠（旧模板的 style="display:none"）
            groupRows(adv.fields || []).forEach((r) => box.appendChild(buildRow(r.fields, item, onEdit)));
            return box;
        };

        const buildItem = (item, i) => {
            const el = document.createElement('div');
            el.className = param.itemClass || '';
            el.dataset.i = String(i);           // 删除/折叠按钮靠它定位（旧模板同为 data-i）
            // 字段级编辑：就地改内存里的那条，set 整个新数组，**不重渲染**（输入框保持焦点）
            const onEdit = (key, v) => {
                const cur = readItems();
                const target = cur[i];
                if (!target || typeof target !== 'object') return;
                target[key] = v;
                commit(cur.slice());
            };
            let toggle = null;
            if (param.advanced) {
                toggle = document.createElement('button');
                toggle.type = 'button';
                if (param.advanced.toggleClass) toggle.className = param.advanced.toggleClass;
                toggle.textContent = param.advanced.label || '';
                el.appendChild(toggle);
            }
            const del = document.createElement('button');
            del.type = 'button';
            if (param.removeClass) del.className = param.removeClass;
            del.textContent = param.removeLabel || '删除';
            del.addEventListener('click', () => {
                const cur = readItems();
                if (param.min !== undefined && cur.length <= param.min) {
                    status(param.minMessage || ('至少保留 ' + param.min + ' 项'), 'err');
                    return;
                }
                const next = cur.slice();
                next.splice(i, 1);
                commit(next);
                render();
            });
            el.appendChild(del);
            if (param.title) {
                const t = document.createElement('label');
                t.textContent = String(param.title).replace('{n}', String(i + 1));
                el.insertBefore(t, el.firstChild);
            }
            // 子区：按 after 指定的 row 之后插入，未指定则落在常显行之后
            const advEl = param.advanced ? buildAdvanced(param.advanced, item, onEdit) : null;
            const itemRows = groupRows(param.item || []);
            let insertAt = itemRows.length;
            if (advEl && param.advanced.after) {
                const k = itemRows.findIndex((r) => r.key === param.advanced.after);
                if (k >= 0) insertAt = k + 1;
            }
            if (toggle && advEl) {
                toggle.addEventListener('click', () => {
                    const hidden = advEl.style.display === 'none';
                    advEl.style.display = hidden ? '' : 'none';
                    toggle.textContent = hidden ? (param.advanced.expandedLabel || '▲ 收起') : (param.advanced.label || '');
                });
            }
            itemRows.forEach((r, ri) => {
                if (advEl && ri === insertAt) el.appendChild(advEl);
                el.appendChild(buildRow(r.fields, item, onEdit));
            });
            if (advEl && insertAt >= itemRows.length) el.appendChild(advEl);
            return el;
        };

        // 结构级编辑：追加一条空条目（初值由声明推出）并重建
        const add = () => {
            const next = readItems().slice();
            next.push(blankListItem(param));
            commit(next);
            render();
        };
        // sync() = 重读 get() 重建整份列表 DOM（幂等；展开态随之复位，与旧 innerHTML 重建一致）
        const render = () => {
            container.innerHTML = '';
            readItems().forEach((item, i) => container.appendChild(buildItem(item, i)));
            if (param.addLabel) {
                const btn = document.createElement('button');
                btn.type = 'button';
                if (param.addClass) btn.className = param.addClass;
                btn.textContent = param.addLabel;
                btn.addEventListener('click', add);
                container.appendChild(btn);
            }
        };
        render();
        return { node: container, sync: render, add };
    }

    // 新条目的初值由子字段声明推出（声明是唯一真源，控件与调用方都不另写一份空条目字面量）：
    //   default 优先 → nullable ⇒ null（跟随样式/本体/时长）→ select 取首个选项 → 其余空串
    function blankListItem(param) {
        const out = {};
        const fields = (param.item || []).concat(param.advanced ? (param.advanced.fields || []) : []);
        fields.forEach((f) => {
            if (f.default !== undefined) out[f.key] = f.default;
            else if (f.nullable) out[f.key] = null;
            else if (f.type === 'select') out[f.key] = (f.choices && f.choices[0]) ? f.choices[0].value : '';
            else out[f.key] = '';
        });
        return out;
    }

    // ============================================================
    //  订阅注册表：控件 sync 的登记处
    //  纪律——消费方在重建容器**前**先 clearParamSubscriptions(owner)，重建后再逐个 subscribeToParams(sync, owner)。
    //  注册表按 owner 分区（owner 用容器元素或容器标识）：dev 面板一轮渲染要重建 5 个阶段框，
    //  不带 owner 的扁平注册表会让后建的框清掉先建的订阅——那样「重建后登记表恰为在挂控件」就不成立。
    //  本片只落这条纪律，不建全局 store；外部值被改动后刷新显示的统一入口（遍历注册表调 sync）留给后续分片。
    // ============================================================
    let paramSubscriptions = [];   // [{ owner, fn }]

    // 登记一个控件的 sync；owner 标识它属于哪个容器（重建时按 owner 退订，互不牵连）。返回单个退订函数。
    function subscribeToParams(fn, owner) {
        if (typeof fn !== 'function') return () => {};
        const entry = { owner, fn };
        paramSubscriptions.push(entry);
        return () => {
            const i = paramSubscriptions.indexOf(entry);
            if (i >= 0) paramSubscriptions.splice(i, 1);
        };
    }

    // 退订：给了 owner 只退该容器的，不给则清空全部（面板整体拆除用）。只清登记，不触发任何回调。
    function clearParamSubscriptions(owner) {
        if (owner === undefined) { paramSubscriptions = []; return; }
        paramSubscriptions = paramSubscriptions.filter((s) => s.owner !== owner);
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

// —— ESM 导出（6.10.0 从 90-preset-ui 抽出：表单渲染层的唯一出口）——
export {
    activeCompositionOf, activeEngineParamKeys, buildParamControl, clearParamSubscriptions,
    filterOptionsByKeys, subscribeToParams, validateComposition,
};
