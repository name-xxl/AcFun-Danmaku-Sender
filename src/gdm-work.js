    // ============================================================
    //  作品文件：把「我正在编辑的这一件东西」持久化（可多作品、可导出/导入 JSON）
    // ============================================================
    // 理解卡｜我拥有：作品的数据形状与存储（workSave / workLoad / workList / workRename / workDelete /
    //   workExportPayload / workImportText / workImportAdd / applyWork）、校验与归一（workPrepare 是唯一入口）、
    //   条数与字节双闸 + FIFO 轮转、写失败降级、默认命名（defaultWorkName）。
    // 我承诺：存储**照 gdm-ledger 那套来，不另发明**——键 `cf_sub_works`，信封带版本位 `{"v":1,"works":[...]}`，
    //   条数（WORK_MAX_WORKS）与字节（WORK_MAX_BYTES）双闸、超限**从最旧一端 FIFO 丢弃**；
    //   判写成功靠**读回比对**（40-core 的 storeSet 把配额异常静默吞掉，写没写进去它不会说），
    //   失败降级**绝不抛**（作品留在内存 + 可查的 writeState + 可查的失败标记键）；
    //   恢复前先**整体校验**——workPrepare 是纯函数、不改任何状态，校验不过一个字段都不落；
    //   applyWork 再带一次「快照 + 出错回滚」，两条合起来保证**不留半套状态的中间态**。
    // 我永不：**不缓存 models**。这一条**偏离计划书 P3.5 的「models 存展开结果（重新打开秒渲染）+ params
    //   存源——两份都存」**：本片只存「源」，加载后由 50-engine 的展开重算 models。依据是本仓的实测展开成本
    //   （闸③ 那一片量的：KTV × 300 条字幕 = 8200 条 model / 185ms，node 本机），即缓存 models 只省约 0.2 秒；
    //   而 model 带 animationFrames，一件 KTV 作品 100 条字幕 ≈ 2700 条 model，序列化后是 MB 级，
    //   要跟 cf_sub_customPresets / cf_sub_ledger / cf_sub_presetOpt_* 抢同源 5MB 配额。
    //   **用 0.2 秒换 MB 级配额不划算**，且展开是纯函数、可随时重算（`RELEASE_NOTES.md` 6.17.0 同步记了这条）。
    //   不发任何网络请求；不做 DOM（浮层在 gdm-work-ui）；不碰发送流程（作品存的是源，不是发送意图）。
    // 我永不（彩排）：`rehearsed` / `rehearsedAt` **本片只存不用**——它们不闸任何东西、不改任何现有行为。
    //   「未彩排不许发送/导出」（含失效指纹与解锁逻辑）是**闸①（下一片）**的事；混进本片会让行为面失控。
    //   字段先落位，是为了那时不必再改一次文件格式。
    // 改我前读：
    //   · 字段全集（归一后；workPrepare 是唯一入口，**外来的多余键一律不进作品**）：
    //       v            信封/文件版本位（6.17.0 = 1）
    //       type         类型标识，恒为 WORK_FILE_TYPE（'adl-work'）——导入时靠它把自己与预设 JSON 分开
    //       id           作品 id（'w' + 时间戳36进制 + '-' + 8 位随机 hex；作品靠 id 认，不靠名字）
    //       name         作品名（非空；默认名见 defaultWorkName，**可重复保存不撞名**）
    //       vid          作品是为哪个视频做的（getVideoInfo().videoId；取不到即 ''）。仅作元信息与列表显示
    //       createdAt / updatedAt  首次保存 / 最近一次保存的时刻（Date.now()）
    //       source       源（**唯一存的东西**——models 不存，见上）：
    //           subs            字幕列表。每条只留编辑意图：time · text · endTime? · style? · main? · sub? · selected
    //                           **`st`（已发/未发/发送中）不进作品**——它是运行期产物不是源，加载后一律清空
    //                           （所以载入的作品永远是「一条都没发过」的样子）
    //           subs2           第二语言字幕（同上；无则 []）
    //           styleSource     'ass' | 'editor'（样式来源）
    //           currentStyleConfig  样式区 10 个字段（WORK_STYLE_FIELDS 的键全集）
    //           timeOffset      全局时间偏移 ms（可为负）
    //           presetId        激活预设 id（无预设即 'none'；存的是**当时真正生效的**那个预设）
    //           presetOptions   { options, effects } 或 null——激活预设当时的参数（与 cf_sub_presetOpt_* 同形）
    //       rehearsed / rehearsedAt   彩排占位（本片恒 false / null，只存不用；见「我永不（彩排）」）
    //   · 覆盖语义：覆盖已有作品 = 丢掉旧的那份、把新的**追加到队尾**——于是它成了「最新」，
    //     不会被 FIFO 的字节闸在本次写入里当场裁掉（作品靠自己刚保存就不该丢）。
    //   · 加载预设的落点：作品里的 presetOptions 只写回**内存里**的预设对象（不写 cf_sub_presetOpt_*）——
    //     载入作品不该改掉用户为这个预设主动保存过的参数。预设不在本机（自定义预设没导入）时**如实报**：
    //     回落「无预设」，其余源照常回放。
    //   · 坏存储容错：load 逐条过 workPrepare，坏掉的**跳过并计数**（workStats().broken），列表不塌；
    //     load 是被 workList/workSave/workRename/workDelete 共用的内存缓存（一次读取后续复用，同 gdm-ledger
    //     的理由）。**workLoad 走的是存储原始条目**（不过滤）——否则一件坏作品只会报「没有这件作品」，
    //     真病灶（哪个字段坏了）会被吞掉。

import { WORK_FILE_TYPE } from './10-constants.js';
import { genId } from './20-utils.js';
import {
    activePresetId, currentStyleConfig, getVideoInfo, setActivePresetId, setStyleSource, setSubs,
    setSubs2, setTimeOffset, storeGet, storeSet, styleSource, subs, subs2, timeOffset,
} from './40-core.js';
import { getAllPresets } from './50-engine.js';

    // —— 存储 ——
    const WORK_KEY = 'works';                        // 交给 storeSet/storeGet 的键（它们补 cf_sub_ 前缀）
    const WORK_STORE_KEY = 'cf_sub_' + WORK_KEY;     // 完整键名（只用于显示/文档，读写仍走 storeSet 单点）
    const WORK_VERSION = 1;
    const WORK_WRITE_ERROR_KEY = 'workWriteError';   // 写失败标记（可查；见 persist）

    // —— 双闸上限（依据见头注与 RELEASE_NOTES 6.17.0）——
    // 同源 5MB 里：台账 ≤256KB、预设（customPresets + presetOpt_*）典型 <200KB，给作品留 2MB（≈40%），
    // 其余留给页面自身。单件作品典型 10–30KB（100 条字幕 × 约 60 码元 + 样式 + 预设 options），
    // 20 件 ≈ 200–600KB，远在字节闸内。两闸各守一个失败面：条数闸防「很多小作品」，字节闸防
    // 「一件巨大作品」（3000 条字幕 ≈ 200KB/件，10 件即到 2MB；不设字节闸就会把同源配额一次吃光）。
    const WORK_MAX_WORKS = 20;
    const WORK_MAX_BYTES = 2 * 1024 * 1024;          // 序列化 JSON 的串长度（UTF-16 码元，localStorage 的计量口径）
    const WORK_WRITE_RETRIES = 3;                    // 写失败后「丢最旧一批再试」的次数上限
    const WORK_DROP_RATIO = 0.25;                    // 每次重试丢弃的比例

    // 样式区字段全集（= 40-core 的 currentStyleConfig 的键）。加字段要同步这里与 validation。
    const WORK_STYLE_FIELDS = {
        font: 'string', size: 'number', color: 'number', bold: 'boolean', stroke: 'boolean',
        anchor: 'number', posX: 'number', posY: 'number', moveTime: 'number', shadow: 'boolean',
    };
    // 字幕 style 子对象（30-parser 的 parseASSStyle 产出）——只登记已知键，其余不进作品。
    const WORK_SUB_STYLE_FIELDS = {
        font: 'string', size: 'number', color: 'number', bold: 'boolean', italic: 'boolean',
        underline: 'boolean', shadow: 'boolean', stroke: 'boolean', anchor: 'number',
    };
    const WORK_ROOT_PATH = '(根)';               // 病灶路径里的「根」（problemsText 判断用；不写 '$'——那是 20-utils 导出的 $ 的裸名字）
    const WORK_MAX_PROBLEMS = 20;                    // 报病灶的条数上限（超了给一条汇总，别刷屏）

    let cache = null;        // 已加载的作品数组（FIFO 顺序：旧 → 新）；null = 尚未从存储加载
    let brokenCount = 0;     // 上一次 load 里校验不过被跳过的条数
    let writeState = { ok: true, lastError: null, dropped: 0, at: 0 };

    function serialize(works) { return JSON.stringify({ v: WORK_VERSION, works }); }
    function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
    function typeOf(v) { return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v; }
    function pickNum(v, d) {
        if (v === null || v === undefined || v === '') return d;
        const n = Number(v);
        return isFinite(n) ? n : d;
    }
    function workNow() { return Date.now(); }

    // ============================================================
    //  归一（只留已知字段）
    // ============================================================

    function normSub(s) {
        const o = { time: Number(s.time), text: String(s.text) };
        if (s.endTime !== undefined && s.endTime !== null) o.endTime = Number(s.endTime);
        if (isObj(s.style)) {
            const st = {};
            Object.keys(WORK_SUB_STYLE_FIELDS).forEach((k) => { if (s.style[k] !== undefined) st[k] = s.style[k]; });
            o.style = st;
        }
        if (s.main !== undefined && s.main !== null) o.main = String(s.main);
        if (s.sub !== undefined && s.sub !== null) o.sub = String(s.sub);
        o.selected = s.selected !== false;   // 缺省=选中（loadFile 装载后也是全选）
        return o;
    }

    // 声明类型 → 取值归一（string 字段别走 Number()：Number('SimHei') 是 NaN）
    function coerceField(want, v) {
        if (want === 'boolean') return !!v;
        if (want === 'number') return Number(v);
        return String(v);
    }
    // 声明类型 → 是否合形（校验用）
    function fieldOk(want, v) {
        if (want === 'boolean') return typeof v === 'boolean';
        if (want === 'number') return Number.isFinite(v);
        return typeof v === 'string';
    }

    function normStyleConfig(cfg) {
        const o = {};
        Object.keys(WORK_STYLE_FIELDS).forEach((k) => { o[k] = coerceField(WORK_STYLE_FIELDS[k], cfg[k]); });
        return o;
    }

    function normWork(raw) {
        const src = raw.source;
        const name = String(raw.name == null ? '' : raw.name).trim();
        return {
            v: WORK_VERSION,
            type: WORK_FILE_TYPE,
            id: String(raw.id),
            name: name || '未命名作品',
            vid: (raw.vid === '' || raw.vid === null || raw.vid === undefined) ? '' : Number(raw.vid),
            createdAt: pickNum(raw.createdAt, pickNum(raw.updatedAt, workNow())),
            updatedAt: pickNum(raw.updatedAt, workNow()),
            source: {
                subs: (src.subs || []).map(normSub),
                subs2: (src.subs2 || []).map(normSub),
                styleSource: src.styleSource === 'editor' ? 'editor' : 'ass',
                currentStyleConfig: normStyleConfig(src.currentStyleConfig),
                timeOffset: Math.round(Number(src.timeOffset) || 0),
                presetId: String(src.presetId),
                presetOptions: src.presetOptions == null ? null : {
                    options: isObj(src.presetOptions.options) ? JSON.parse(JSON.stringify(src.presetOptions.options)) : {},
                    effects: src.presetOptions.effects == null
                        ? null : JSON.parse(JSON.stringify(src.presetOptions.effects)),
                },
            },
            rehearsed: raw.rehearsed === true,
            rehearsedAt: raw.rehearsedAt == null ? null : Number(raw.rehearsedAt),
        };
    }

    // ============================================================
    //  校验（唯一入口；纯函数，绝不改状态）
    // ============================================================
    // 顺序：整体形状 → 类型标识 → 版本位 → 元信息 → source（字幕 → 样式来源 → 样式 10 字段 → 偏移 →
    //   预设）→ 彩排占位。**一次把病灶列全**（到 WORK_MAX_PROBLEMS 为止），而不是只报第一条——
    //   「形状不对就拒绝」时要让人一眼看清哪里不对。任一条不过即 ok:false、work:null，
    //   调用方据此在**动任何状态之前**收手（applyWork 还会再校验一遍，双保险）。
    // 外层再包一层 try/catch：**校验本身也绝不抛**。外来的 JSON 一旦带个抛异常的 getter
    //   （或别的读不动的形状），异常从这里甩出去就等于把「拒绝并报病灶」变回「炸在调用点」。
    function workPrepare(raw) {
        try {
            return workPrepareInner(raw);
        } catch (e) {
            return {
                ok: false, work: null,
                problems: [{ path: WORK_ROOT_PATH, reason: '校验时读不动这份数据（形状异常）：' + (e && e.message ? e.message : String(e)) }],
            };
        }
    }

    function workPrepareInner(raw) {
        const problems = [];
        const bad = (path, reason) => problems.push({ path, reason });
        if (!isObj(raw)) {
            return { ok: false, work: null, problems: [{ path: WORK_ROOT_PATH, reason: '不是对象（作品必须是一个 JSON 对象，实际 ' + typeOf(raw) + '）' }] };
        }
        if (raw.type !== WORK_FILE_TYPE) {
            bad('type', '类型标识不是 "' + WORK_FILE_TYPE + '"（实际 ' + typeOf(raw.type) + '）——不是作品文件');
        }
        if (raw.v !== WORK_VERSION) {
            bad('v', '版本位不受支持（要求 ' + WORK_VERSION + '，实际 ' + typeOf(raw.v) + '）');
        }
        if (typeof raw.id !== 'string' || !raw.id) bad('id', '缺少作品 id（要求非空字符串）');
        if (typeof raw.name !== 'string' || !raw.name.trim()) bad('name', '缺少作品名（要求非空字符串）');
        if (!Number.isFinite(raw.updatedAt)) bad('updatedAt', '缺少更新时间（要求 Date.now() 时间戳，实际 ' + typeOf(raw.updatedAt) + '）');
        if (!(raw.vid === '' || raw.vid === null || raw.vid === undefined || Number.isFinite(raw.vid))) {
            bad('vid', '视频 id 必须是数值或空串（实际 ' + typeOf(raw.vid) + '）');
        }
        const src = raw.source;
        if (!isObj(src)) {
            bad('source', '缺少 source（源）对象');
        } else {
            validateSubs(src.subs, 'source.subs', bad);
            if (src.subs2 !== undefined && src.subs2 !== null) validateSubs(src.subs2, 'source.subs2', bad);
            if (src.styleSource !== 'ass' && src.styleSource !== 'editor') {
                bad('source.styleSource', '样式来源必须是 "ass" 或 "editor"（实际 ' + typeOf(src.styleSource) + '）');
            }
            const cfg = src.currentStyleConfig;
            if (!isObj(cfg)) {
                bad('source.currentStyleConfig', '缺少样式配置对象');
            } else {
                Object.keys(WORK_STYLE_FIELDS).forEach((k) => {
                    const want = WORK_STYLE_FIELDS[k];
                    const got = cfg[k];
                    if (!fieldOk(want, got)) {
                        bad('source.currentStyleConfig.' + k,
                            '应为' + (want === 'boolean' ? '布尔' : want === 'number' ? '数值' : '字符串') + '（实际 ' + typeOf(got) + '）');
                    }
                });
            }
            if (!Number.isFinite(src.timeOffset)) bad('source.timeOffset', '时间偏移应为数值 ms（实际 ' + typeOf(src.timeOffset) + '）');
            if (typeof src.presetId !== 'string' || !src.presetId) bad('source.presetId', '缺少激活预设 id（无预设请写 "none"）');
            if (src.presetOptions !== null && src.presetOptions !== undefined && !isObj(src.presetOptions)) {
                bad('source.presetOptions', '预设参数必须是对象或 null（实际 ' + typeOf(src.presetOptions) + '）');
            }
        }
        if (typeof raw.rehearsed !== 'boolean') bad('rehearsed', '彩排标志应为布尔（本片恒为 false；实际 ' + typeOf(raw.rehearsed) + '）');
        if (!(raw.rehearsedAt === null || raw.rehearsedAt === undefined || Number.isFinite(raw.rehearsedAt))) {
            bad('rehearsedAt', '彩排时刻应为 null 或时间戳（实际 ' + typeOf(raw.rehearsedAt) + '）');
        }
        if (problems.length) {
            return { ok: false, work: null, problems: capProblems(problems) };
        }
        return { ok: true, work: normWork(raw), problems: [] };
    }

    function capProblems(list) {
        if (list.length <= WORK_MAX_PROBLEMS) return list;
        const kept = list.slice(0, WORK_MAX_PROBLEMS);
        kept.push({ path: '…', reason: '还有 ' + (list.length - WORK_MAX_PROBLEMS) + ' 处同类问题未列出（前 ' + WORK_MAX_PROBLEMS + ' 条已在上方）' });
        return kept;
    }

    function validateSubs(list, path, bad) {
        if (!Array.isArray(list)) { bad(path, '字幕列表必须是数组（实际 ' + typeOf(list) + '）'); return; }
        list.forEach((s, i) => {
            const p = path + '[' + i + ']';
            if (!isObj(s)) { bad(p, '字幕条目不是对象（实际 ' + typeOf(s) + '）'); return; }
            if (!Number.isFinite(s.time)) bad(p + '.time', '起始时间应为数值 ms（实际 ' + typeOf(s.time) + '）');
            if (typeof s.text !== 'string') bad(p + '.text', '文本应为字符串（实际 ' + typeOf(s.text) + '）');
            if (s.style !== undefined && s.style !== null) {
                if (!isObj(s.style)) { bad(p + '.style', '样式应为对象（实际 ' + typeOf(s.style) + '）'); return; }
                Object.keys(WORK_SUB_STYLE_FIELDS).forEach((k) => {
                    if (s.style[k] === undefined) return;
                    const want = WORK_SUB_STYLE_FIELDS[k];
                    if (!fieldOk(want, s.style[k])) {
                        bad(p + '.style.' + k,
                            '应为' + (want === 'boolean' ? '布尔' : want === 'number' ? '数值' : '字符串') + '（实际 ' + typeOf(s.style[k]) + '）');
                    }
                });
            }
        });
    }

    // ============================================================
    //  采集当前编辑状态 → 一件作品
    // ============================================================

    function currentVid() {
        let info = null;
        try { info = getVideoInfo(); } catch (e) { info = null; }
        const id = info ? Number(info.videoId) : NaN;
        return (Number.isFinite(id) && id > 0) ? id : '';
    }

    function newWorkId() { return 'w' + workNow().toString(36) + '-' + genId().slice(0, 8); }

    function captureSource() {
        const preset = getActivePresetSafe();
        const pid = (preset && preset.id) ? preset.id : 'none';
        let presetOptions = null;
        if (pid !== 'none') {
            const opts = JSON.parse(JSON.stringify(preset.options || {}));
            delete opts.__seq;                       // __seq 是分配顺序名的运行期字段（presetsToExport 同样剥掉）
            presetOptions = {
                options: opts,
                effects: preset.effects ? JSON.parse(JSON.stringify(preset.effects)) : null,
            };
        }
        return {
            subs: subs.map(normSub),
            subs2: subs2.map(normSub),
            styleSource: styleSource === 'editor' ? 'editor' : 'ass',
            currentStyleConfig: normStyleConfig(currentStyleConfig),
            timeOffset: Math.round(Number(timeOffset) || 0),
            presetId: pid,
            presetOptions,
        };
    }

    // getActivePreset 兜底返回内置「无预设」——作品里记的应是**当时真正生效的**那个，故照实取它的 id。
    function getActivePresetSafe() {
        try { return getAllPresets().find((p) => p.id === activePresetId) || getAllPresets()[0] || null; } catch (e) { return null; }
    }

    // 默认名字：作品 + 秒级时间戳（可读、可排序）；**重名时自动加序号**，保证反复保存不撞名。
    function defaultWorkName() {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        const base = '作品 ' + (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
        return uniqueName(base, new Set(load().map((w) => w.name)));
    }

    function uniqueName(name, taken) {
        if (!taken.has(name)) return name;
        for (let i = 2; i < 1000; i++) {
            const cand = name + ' #' + i;
            if (!taken.has(cand)) return cand;
        }
        return name + ' #' + genId().slice(0, 4);
    }

    // 采集一件作品（不落盘）。opts.id 存在 = 覆盖那件（沿用它的 createdAt，更新时间刷成现在）。
    function workCapture(name, opts) {
        const o = opts || {};
        const src = captureSource();
        return normWork({
            v: WORK_VERSION,
            type: WORK_FILE_TYPE,
            id: o.id || newWorkId(),
            name: String(name == null ? '' : name).trim() || defaultWorkName(),
            vid: currentVid(),
            createdAt: o.createdAt || workNow(),
            updatedAt: workNow(),
            source: src,
            rehearsed: false,          // 本片只存不用：恒未彩排（闸① 才会改它）
            rehearsedAt: null,
        });
    }

    // ============================================================
    //  存储（读回比对 + 双闸 FIFO + 失败降级；与 gdm-ledger 同构）
    // ============================================================

    // 存储里的原始条目数组（**不过滤、不校验**）：workLoad 靠它才能对一件坏作品报出真病灶，
    // load 靠它做逐条校验。信封坏掉（乱 JSON / 不是数组）一律当空。
    function rawEntries() {
        try {
            const raw = storeGet(WORK_KEY, '');
            if (!raw) return [];
            const j = JSON.parse(raw);
            const list = Array.isArray(j) ? j : (j && Array.isArray(j.works) ? j.works : []);
            return list.filter((w) => w && typeof w === 'object');
        } catch (e) {
            return [];
        }
    }

    // 逐条过校验：坏掉的跳过并计数（列表不塌），好的归一后进内存。
    function load() {
        if (cache) return cache;
        brokenCount = 0;
        let arr = [];
        try {
            rawEntries().forEach((w) => {
                const r = workPrepare(w);
                if (r.ok) arr.push(r.work); else brokenCount++;
            });
        } catch (e) {
            arr = [];
            brokenCount = 0;
        }
        cache = arr;
        return cache;
    }

    // 双闸裁剪：先条数、再字节，只从最旧一端丢（FIFO）；保留至少 1 件
    // （**刚保存的这件永远留得住**，哪怕它自己就超了字节闸——丢它等于没保存）。
    function fitLimits(works) {
        let dropped = 0;
        while (works.length > WORK_MAX_WORKS) { works.shift(); dropped++; }
        let raw = serialize(works);
        let guard = 0;
        while (works.length > 1 && raw.length > WORK_MAX_BYTES && guard++ < 32) {
            const avg = Math.max(1, Math.floor(raw.length / works.length));
            const n = Math.min(works.length - 1, Math.max(1, Math.ceil((raw.length - WORK_MAX_BYTES) / avg)));
            works.splice(0, n);
            dropped += n;
            raw = serialize(works);
        }
        return { dropped, raw };
    }

    // 落盘。storeSet 内部 try/catch 把配额异常静默吞掉（40-core），故**判成败靠读回比对**：
    // 写进去再读出来不一致 = 没写成功 → 丢最旧的一批再试；重试到头仍不成功 → 降级
    // （作品留在内存、返回 ok:false、记下可查的失败标记），**绝不抛**。
    function persist(works) {
        const fit = fitLimits(works);
        let dropped = fit.dropped;
        const kept = works.slice();   // 重试期间为腾地方丢掉的旧作品（它们只是写不下，并没有被删掉）
        let raw = fit.raw;
        for (let i = 0; i < WORK_WRITE_RETRIES; i++) {
            storeSet(WORK_KEY, raw);
            if (storeGet(WORK_KEY, null) === raw) {
                if (writeState.ok === false) storeSet(WORK_WRITE_ERROR_KEY, '');
                writeState = { ok: true, lastError: null, dropped, at: workNow() };
                return { ok: true, dropped };
            }
            if (works.length <= 1) break;
            const n = Math.min(works.length - 1, Math.max(1, Math.ceil(works.length * WORK_DROP_RATIO)));
            works.splice(0, n);
            dropped += n;
            raw = serialize(works);
        }
        // 全失败：把为腾地方而丢的旧作品放回来（只留在内存，等下次写成功再一起补上）
        works.length = 0;
        kept.forEach((w) => works.push(w));
        const reason = '作品写入失败（localStorage 配额可能已满），本页仍能看到这些作品但刷新后会丢';
        writeState = { ok: false, lastError: reason, dropped, at: workNow() };
        storeSet(WORK_WRITE_ERROR_KEY, JSON.stringify({ at: writeState.at, reason, dropped }));
        return { ok: false, dropped, reason };
    }

    // ============================================================
    //  公开操作
    // ============================================================

    // 保存当前状态。opts.id = 覆盖那件（否则新建）。返回 { ok, work, dropped, overwritten, reason? }。
    // 覆盖 = 丢掉旧的那份 + 追加到队尾：于是它成了「最新」，不会被本次写入的 FIFO 当场裁掉。
    function workSave(name, opts) {
        const o = opts || {};
        const works = load();
        let overwritten = false;
        let work;
        if (o.id) {
            const i = works.findIndex((w) => w.id === o.id);
            if (i < 0) {
                return { ok: false, work: null, dropped: 0, overwritten: false, reason: '要覆盖的作品已不存在（可能已被删除，或超出上限被轮转掉）' };
            }
            const old = works[i];
            // 覆盖时名字：本次给的非空名优先，否则沿用旧名（不悄悄改名）
            const finalName = (name != null && String(name).trim()) ? name : old.name;
            work = workCapture(finalName, { id: old.id, createdAt: old.createdAt });
            works.splice(i, 1);
            works.push(work);
            overwritten = true;
        } else {
            work = workCapture(name, {});
            works.push(work);
        }
        const res = persist(works);
        return { ok: res.ok, work, dropped: res.dropped, overwritten, reason: res.reason };
    }

    // 全部作品（**按更新时间倒序**，最近保存的排最前）。返回新数组——调用方改它不影响存储。
    function workList() { return load().slice().sort((a, b) => b.updatedAt - a.updatedAt); }

    // 一件作品带多少条字幕（列表显示用）。数据形状的知识留在本模块，视图只问条数。
    function workSubCount(w) { return (w && w.source && Array.isArray(w.source.subs)) ? w.source.subs.length : 0; }

    // 读一件并校验。**从存储的原始条目里找**（不走 load 的过滤），这样一件坏作品也能报出真病灶
    // （走过滤的话它只会变成「没有这件作品」，病灶被吞掉）。返回 workPrepare 的结果；
    // ok:false 时**一个字段都不落**（调用方据此收手）。
    function workLoad(id) {
        const raw = rawEntries().find((w) => w.id === id);
        if (!raw) return { ok: false, work: null, problems: [{ path: 'id', reason: '没有这件作品（可能已被删除，或超出上限被轮转掉）' }] };
        return workPrepare(raw);
    }

    function workRename(id, name) {
        const next = String(name == null ? '' : name).trim();
        if (!next) return { ok: false, renamed: false, reason: '作品名不能为空' };
        const works = load();
        const w = works.find((x) => x.id === id);
        if (!w) return { ok: false, renamed: false, reason: '没有这件作品（可能已被删除）' };
        w.name = next;
        w.updatedAt = workNow();
        const res = persist(works);
        return { ok: res.ok, renamed: true, dropped: res.dropped, reason: res.reason };
    }

    function workDelete(id) {
        const works = load();
        const i = works.findIndex((x) => x.id === id);
        if (i < 0) return { ok: false, deleted: false, reason: '没有这件作品（可能已被删除）' };
        works.splice(i, 1);
        const res = persist(works);
        return { ok: res.ok, deleted: true, dropped: res.dropped, reason: res.reason };
    }

    // 导出用载荷：作品本体（自描述：type + v）另加导出时刻/生成者。多出来的键不是作品字段全集的一部分，
    // 导入时被 workPrepare 丢掉（只留已知字段）——导出文件的「元信息」与作品的「字段」因此不会混为一谈。
    function workExportPayload(id) {
        const r = workLoad(id);
        if (!r.ok) return r;
        const out = JSON.parse(JSON.stringify(r.work));
        out.exportedAt = workNow();
        out.exportedBy = 'acfun-adl';
        return { ok: true, work: r.work, payload: out, problems: [] };
    }

    // 导入文本 → 分类 + 校验。**区分作品文件与预设 JSON**（两个方向的误用各有各的提示）：
    //   kind 'work'    带 type:'adl-work' → 走作品校验
    //   kind 'preset'  形状像预设（数组，或带 id+name+options/params/transform/composition 的对象）
    //   kind 'json'    连 JSON 都不是
    //   kind 'unknown' 认不出
    // 返回 { ok, kind, work, problems }——纯函数，不改状态。
    function workImportText(text) {
        let data;
        try {
            data = JSON.parse(String(text == null ? '' : text));
        } catch (e) {
            return { ok: false, kind: 'json', work: null, problems: [{ path: WORK_ROOT_PATH, reason: 'JSON 解析失败：' + e.message }] };
        }
        if (isObj(data) && data.type === WORK_FILE_TYPE) {
            const r = workPrepare(data);
            return { ok: r.ok, kind: 'work', work: r.work, problems: r.problems };
        }
        if (looksLikePreset(data)) {
            return {
                ok: false, kind: 'preset', work: null,
                problems: [{ path: WORK_ROOT_PATH, reason: '这是预设 JSON（' + presetShapeHint(data) + '），不是作品文件' }],
            };
        }
        return {
            ok: false, kind: 'unknown', work: null,
            problems: [{
                path: 'type',
                reason: '这份 JSON 没有类型标识（实际 type=' + typeOf(data && data.type) + '）；'
                    + '作品文件必须带 type:"' + WORK_FILE_TYPE + '" 与 v:' + WORK_VERSION,
            }],
        };
    }

    function looksLikePreset(data) {
        const one = (p) => isObj(p) && typeof p.id === 'string' && typeof p.name === 'string'
            && ('options' in p || 'params' in p || 'transform' in p || 'composition' in p);
        if (Array.isArray(data)) return data.length === 0 || data.some(one);
        return one(data);
    }

    function presetShapeHint(data) {
        const p = Array.isArray(data) ? (data[0] || {}) : data;
        return '带 ' + ['id', 'name', 'transform', 'options', 'params', 'composition'].filter((k) => k in (p || {})).join('/')
            + (Array.isArray(data) ? '，且是一个数组' : '');
    }

    // 把导入的作品放进作品集：**永远新建一件**（id 撞了就换新 id；名字撞了就加序号），
    // 不静默覆盖已有的同 id 作品（那可能是用户手里那份的旧版）。
    function workImportAdd(work) {
        const works = load();
        const ids = new Set(works.map((w) => w.id));
        const names = new Set(works.map((w) => w.name));
        const id = ids.has(work.id) ? newWorkId() : work.id;
        const name = uniqueName(work.name, names);
        const out = normWork(Object.assign({}, work, { id, name, updatedAt: workNow() }));
        works.push(out);
        const res = persist(works);
        return { ok: res.ok, work: out, renamed: name !== work.name, dropped: res.dropped, reason: res.reason };
    }

    // 把作品恢复到编辑器状态。**先校验、后快照、再落值**：任何一步不过都不落值；
    // 中间抛错则用快照整体回滚——这就是「不留半套状态的中间态」的两道保险。
    // 返回 { ok, warnings, problems }；warnings 是「恢复了但有一处打折」（如预设不在本机），不是失败。
    function applyWork(work) {
        const r = workPrepare(work);
        if (!r.ok) return { ok: false, warnings: [], problems: r.problems };
        const w = r.work;
        let before = null;
        const warnings = [];
        try {
            before = snapshotEditor();   // 快照也在 try 里：取快照本身抛错时，状态还没被碰过
            const src = w.source;
            setSubs(src.subs.map((s) => Object.assign({}, s, { st: '' })));
            setSubs2(src.subs2.map((s) => Object.assign({}, s, { st: '' })));
            setStyleSource(src.styleSource);
            Object.assign(currentStyleConfig, src.currentStyleConfig);
            setTimeOffset(src.timeOffset);
            // 与用户手改这两项时一样落盘：刷新后仍保持（它们是全局设置，不是作品的私产）
            storeSet('timeOffset', String(src.timeOffset));
            storeSet('styleSource', src.styleSource);

            const preset = getAllPresets().find((p) => p.id === src.presetId);
            if (src.presetId !== 'none' && !preset) {
                warnings.push('作品引用的预设「' + src.presetId + '」不在本机（该预设多半来自导入的自定义预设，请先导入它），已回落到「无预设」');
                setActivePresetId('none');
            } else {
                setActivePresetId(preset ? preset.id : 'none');
                if (preset && src.presetOptions) {
                    // 只写回内存里的预设对象：不动 cf_sub_presetOpt_*（那是用户为这个预设主动保存过的参数）
                    if (isObj(src.presetOptions.options)) {
                        preset.options = Object.assign({}, preset.options || {}, src.presetOptions.options);
                    }
                    if (src.presetOptions.effects != null) {
                        preset.effects = JSON.parse(JSON.stringify(src.presetOptions.effects));
                    }
                }
            }
            return { ok: true, warnings, problems: [] };
        } catch (e) {
            let rolled = '已回滚到载入前的状态';
            if (before) {
                try { restoreEditor(before); } catch (e2) { rolled = '回滚也失败了（' + (e2 && e2.message ? e2.message : String(e2)) + '），编辑器可能停在半套状态'; }
            }
            return {
                ok: false, warnings: [],
                problems: [{
                    path: 'apply',
                    reason: '恢复过程中出错，' + rolled + '：' + (e && e.message ? e.message : String(e)),
                }],
            };
        }
    }

    function snapshotEditor() {
        return {
            subs, subs2, styleSource, timeOffset, activePresetId,
            styleConfig: Object.assign({}, currentStyleConfig),
            presets: getAllPresets().map((p) => ({ p, options: p.options, effects: p.effects })),
        };
    }

    function restoreEditor(s) {
        setSubs(s.subs);
        setSubs2(s.subs2);
        setStyleSource(s.styleSource);
        setTimeOffset(s.timeOffset);
        setActivePresetId(s.activePresetId);
        Object.assign(currentStyleConfig, s.styleConfig);
        s.presets.forEach((x) => { x.p.options = x.options; x.p.effects = x.effects; });
    }

    function workStats() {
        const works = load();
        return {
            count: works.length,
            broken: brokenCount,
            bytes: serialize(works).length,
            maxWorks: WORK_MAX_WORKS,
            maxBytes: WORK_MAX_BYTES,
            write: writeState,
        };
    }

    function workWriteState() { return writeState; }

    // 校验/导入的病灶 → 一行可读文本（UI 的状态栏用；这里只拼文本，不碰 DOM）
    function problemsText(problems) {
        const list = Array.isArray(problems) ? problems : [];
        if (!list.length) return '';
        return list.map((p) => (p.path === WORK_ROOT_PATH ? p.reason : p.path + '：' + p.reason)).join('；');
    }

// —— ESM 导出（6.8.0 迁移）——
export {
    WORK_MAX_BYTES, WORK_MAX_WORKS, WORK_STORE_KEY, WORK_VERSION,
    applyWork, defaultWorkName, problemsText, workDelete, workExportPayload, workImportAdd,
    workImportText, workList, workLoad, workPrepare, workRename, workSave, workStats, workSubCount,
    workWriteState,
};
// 仅供测试：把内存缓存与写状态重置回「未加载」。单测要在同一进程里反复造场景（预置存储 → 读作品集），
// 没有这个钩子就只能靠「缓存恰好还没加载」这种顺序巧合。生产代码不调用它。
export function resetWorkState() {
    cache = null;
    brokenCount = 0;
    writeState = { ok: true, lastError: null, dropped: 0, at: 0 };
}
