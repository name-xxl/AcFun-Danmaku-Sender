    // ============================================================
    //  参数表单渲染层（schema → 控件 DOM 的唯一出口）
    // ============================================================
    // 理解卡｜我拥有：buildParamControl（param 声明 → 控件行，返回 { node, sync }）、订阅注册表
    //   （subscribeToParams / clearParamSubscriptions）、引擎参数声明的纯查询
    //   （activeCompositionOf / validateComposition / activeEngineParamKeys / filterOptionsByKeys）。
    // 我承诺：DOM 形状与样式稳定——只产出 div.cf-row > label + input，**行类名由调用方追加**（cf-preset-param-row /
    //   cf-dev-param-row），不设 id / name（预设区与 dev 面板同时挂两份控件，加 id 必然重名），不产出新类名
    //   （数字框宽度靠 boot.js 既有的 .cf-row input[type=number]{width:56px}，无 .cf-num/.cf-sel/.cf-txt 这类类）；
    //   sync() 幂等——重读 get() 并按与首次构建**完全相同**的回退规则回写控件显示，重复执行无副作用。
    // 我永不：不持状态（参数真源是 preset.options / preset.effects 与 devDraft.options，本模块不建 store）；
    //   不发网络请求、不读播放器；不在重建容器时留着上一轮的订阅（重建前必须 clearParamSubscriptions）。
    // 改我前读：schema 真源是 50-engine.js 的 ENGINES[stage][name].params（与 10-constants 的
    //   BUILTIN_PRESETS[].params）——本模块只认识 number / select / color / checkbox / text 五种控件，
    //   声明里出现第六种必须红灯（test/unit/form.test.mjs 的类型覆盖断言，学自 svfeed）；
    //   值回退链 default 可为 null（引擎 dualX/dualY 就是 null），清空输入框要写回 null 而不是 0；
    //   number 的 min/max/step 只在 !== undefined 时才上 DOM，change 时 parseFloat + isNaN 回 default——这是
    //   控件语义，**不是** 40-core 的 num()，别替换；`effects.` 前缀必须经 paramTarget 返回本体引用，
    //   浅拷贝会让改动不生效（旧故障：参数改了但间距/颜色没反应）。
    //   本片只抽取不新增控件类型：可增删列表 / 复合三连 X-Y-Z / 枚举网格 anchor / 依赖禁用态留给后续分片。

import { COMPOSITIONS, ENGINES, STAGES } from './50-engine.js';

    // 参数控件构造器（预设参数面板与效果开发面板共用）：
    //   param   —— 参数声明 { key,label,type,choices?,min?,max?,step?,default?,placeholder? }
    //   get     —— 读当前值；set —— 写回值；onChange —— 变化后回调（color 用 input 事件连续触发，不回调）
    // 返回 { node, sync }：node 为控件行 DOM（调用方追加自己的行类名后挂进容器）；
    //   sync() 重新调 get() 并按同一回退规则回写控件显示（幂等），供「值被外部改动后刷新显示」使用。
    function buildParamControl(param, get, set, onChange) {
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
