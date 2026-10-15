    // ============================================================
    //  闸④ 台账：每条发送成功的弹幕逐条落账（可回查、可引导清理）
    // ============================================================
    // 理解卡｜我拥有：台账的存储与查询（ledgerRecord / ledgerList / ledgerByVideo / ledgerMarkVerified /
    //   ledgerClear / ledgerStats）、上限与 FIFO 轮转、写失败降级、状态标签口径、清理核对清单文本。
    //   **存储键 cf_sub_ledger**，经 40-core 的 storeGet / storeSet——脚本 @grant 只有 GM_xmlhttpRequest
    //   与 unsafeWindow、没有 GM 存储，故台账只能落 localStorage；前缀 cf_sub_ 与其它键（customPresets、
    //   presetOpt_*）共享同源配额。存储格式是带版本位的信封 `{"v":1,"entries":[...]}`（迁移有依据，R5 同款）。
    // 我承诺：**绝不抛错到发送流程**——发送是主线、台账只是记账，任何异常都在本模块内收掉（返回失败标志 +
    //   可查的 writeState），调用方（60-network 的 ledgerRecordSentModel）另有一层 try/catch 兜底。
    //   双闸轮转：条数 LEDGER_MAX_ENTRIES=1000 / 字节 LEDGER_MAX_BYTES=256K（按序列化 JSON 的**串长度**计，
    //   即 UTF-16 码元数——localStorage 配额正是按它计量的；中文 1 字 = 1 码元 ≈ 2 字节），超限**一律从最旧
    //   一端 FIFO 丢弃**，且绝不丢刚记下的这条。依据：1000 条 ≈ 一次二次确认阈值批次的量级（55-audit 的
    //   SEND_CONFIRM_MODEL_THRESHOLD），单条 JSON 约 150–250 码元 → 1000 条 ≈ 150–250K，与字节闸同量级
    //   （字节闸防长内容、条数闸防条目数失控），在同源 5MB 配额里占比 ≤ 5%。
    // 我永不：不发任何网络请求（60-network 的职责）；**不删除任何已发送的弹幕**——A 站根本没有删除接口
    //   （API.md §十一 列的 8 个弹幕接口里只有 new-danmaku/update，没有 delete；§九 末亦记「预览残留无法
    //   按 id 删除」），本模块只记账，清理是 UI 的引导；不把「未在池中查到」表达成「失败」（见状态口径）。
    // 改我前读：
    //   · 字段全集（normalize 是唯一入口，外来的多余键一律不进账）：
    //       danmakuId  弹幕 id（A 站返回；缺失时为空串，见下）
    //       content    实际进池的文本（model.content；逐字拆发预设下是单字，人工核对时按它比）
    //       vid        视频 id（getVideoInfo().videoId）· bangumi 布尔（决定视频页链接形态）
    //       sentAt     记账时刻 Date.now()（发送成功那一刻，不是入池时刻）
    //       startTime  该条弹幕的起始位置 ms（model.startTime，手动定位用）
    //       presetId / presetName  当时的预设（50-engine getActivePreset；无预设即内置「无预设」）
    //       verified / verifiedAt  是否已被 verifySent 的全片扫描确认「在池中可见」
    //   · **danmakuId 空值 / 重复的判定**：空 id **照记**（发送确已成功，内容/位置/视频仍是可核对的清理
    //     线索），只是永不参与去重与验证匹配，UI 显示「未返回 id」；重复 id **去重**（同一条弹幕在池里只有
    //     一条，重复记账只可能是同一 id 被记了两次），保留首条的时间与内容，只补后来才知道的预设名。
    //   · 状态口径（两态，**没有「失败」这个态**）：pending「待审核（未确认）」/ verified「已确认可见」。
    //     verifySent 的 pollByPosition 全片扫描查不到 ≠ 失败——审核延迟或接口受限都会这样，故未确认的记录
    //     一律停在 pending，只有真在池里看见过才翻成 verified。
    //   · 内存缓存：一次读取后在模块内复用。原因：每条记账都重新 getItem + JSON.parse 一遍全账，8000 条
    //     model 的批量发送会把它变成可观的同步开销（发送循环里有 80ms 节流，但没人愿意白花）。边界：只保证
    //     本模块内一致——同源另一个标签页写台账，本页看不到（刷新即同步）。

import { storeGet, storeSet } from './40-core.js';

    // —— 存储 ——
    const LEDGER_KEY = 'ledger';                    // 交给 storeSet/storeGet 的键（它们补 cf_sub_ 前缀）
    const LEDGER_STORE_KEY = 'cf_sub_' + LEDGER_KEY; // 完整键名（只用于显示/文档，读写仍走 storeSet 单点）
    const LEDGER_VERSION = 1;
    const LEDGER_WRITE_ERROR_KEY = 'ledgerWriteError';   // 写失败标记（可查；见 persist）

    // —— 双闸上限（依据见头注）——
    const LEDGER_MAX_ENTRIES = 1000;
    const LEDGER_MAX_BYTES = 256 * 1024;            // 序列化 JSON 的串长度（UTF-16 码元）
    const LEDGER_WRITE_RETRIES = 3;                 // 写失败后「丢最旧一批再试」的次数上限
    const LEDGER_DROP_RATIO = 0.25;                 // 每次重试丢弃的比例

    // —— 状态（两态，没有「失败」）——
    const LEDGER_STATUS_PENDING = 'pending';
    const LEDGER_STATUS_VERIFIED = 'verified';
    const LEDGER_STATUS_LABELS = { pending: '待审核（未确认）', verified: '已确认可见' };

    let cache = null;   // 已加载的条目数组（写入顺序：旧 → 新）；null = 尚未从存储加载
    let writeState = { ok: true, lastError: null, dropped: 0, at: 0 };

    function serialize(entries) { return JSON.stringify({ v: LEDGER_VERSION, entries }); }
    function emptyRaw() { return serialize([]); }

    function pickNum(v, d) {
        if (v === null || v === undefined || v === '') return d;
        const n = Number(v);
        return isFinite(n) ? n : d;
    }

    // 加载（容错到极致：坏 JSON / 非数组 / 混杂条目一律退回空账或逐条剔除，绝不抛）
    function load() {
        if (cache) return cache;
        let arr = [];
        try {
            const raw = storeGet(LEDGER_KEY, '');
            if (raw) {
                const j = JSON.parse(raw);
                // 接受信封 {v,entries}，也接受裸数组（手改过 / 早期格式）
                const list = Array.isArray(j) ? j : (j && Array.isArray(j.entries) ? j.entries : []);
                arr = list.filter((e) => e && typeof e === 'object');
            }
        } catch (e) {
            arr = [];
        }
        cache = arr;
        return cache;
    }

    // 归一化：只落已知字段（外来键不进账），类型收成可 JSON 往返的形状
    function normalize(entry) {
        const e = (entry && typeof entry === 'object') ? entry : {};
        return {
            danmakuId: String(e.danmakuId == null ? '' : e.danmakuId),
            content: String(e.content == null ? '' : e.content),
            vid: (e.vid === null || e.vid === undefined ? '' : e.vid),
            bangumi: !!e.bangumi,
            sentAt: pickNum(e.sentAt, Date.now()),
            startTime: pickNum(e.startTime, null),
            presetId: String(e.presetId == null ? '' : e.presetId),
            presetName: String(e.presetName == null ? '' : e.presetName),
            verified: !!e.verified,
            verifiedAt: pickNum(e.verifiedAt, null),
        };
    }

    // 双闸裁剪：先按条数、再按字节，只从最旧一端丢（FIFO）。
    // 字节这关用「超出量 ÷ 平均条大小」估算一次要丢多少条，避免逐条 stringify 的 O(n²)。
    // 保留至少 1 条（**刚记下的这条永远留得住**，哪怕它自己就超了字节闸）。
    function fitLimits(entries) {
        let dropped = 0;
        while (entries.length > LEDGER_MAX_ENTRIES) { entries.shift(); dropped++; }
        let raw = serialize(entries);
        let guard = 0;
        while (entries.length > 1 && raw.length > LEDGER_MAX_BYTES && guard++ < 32) {
            const avg = Math.max(1, Math.floor(raw.length / entries.length));
            const n = Math.min(entries.length - 1, Math.max(1, Math.ceil((raw.length - LEDGER_MAX_BYTES) / avg)));
            entries.splice(0, n);
            dropped += n;
            raw = serialize(entries);
        }
        return { dropped, raw };
    }

    // 落盘。storeSet 内部 try/catch 把配额异常静默吞掉（40-core），故**判成败靠读回比对**：
    // 写进去再读出来不一致 = 没写成功 → 丢最旧的一批再试；重试到头仍不成功 → 降级（内存里留着，
    // 返回 ok:false 并记下可查的失败标记），绝不抛。
    function persist(entries) {
        const fit = fitLimits(entries);
        let dropped = fit.dropped;
        // 裁剪后的完整账（重试期间为腾地方丢掉的旧条目从这里复原：它们只是写不下，并没有被删掉）
        const kept = entries.slice();
        let raw = fit.raw;
        for (let i = 0; i < LEDGER_WRITE_RETRIES; i++) {
            storeSet(LEDGER_KEY, raw);
            if (storeGet(LEDGER_KEY, null) === raw) {
                if (writeState.ok === false) storeSet(LEDGER_WRITE_ERROR_KEY, '');   // 上回失败过：清掉标记
                writeState = { ok: true, lastError: null, dropped, at: Date.now() };
                return { ok: true, dropped };
            }
            if (entries.length <= 1) break;   // 只剩最新一条还写不下：不再丢（丢它就等于没记）
            const n = Math.min(entries.length - 1, Math.max(1, Math.ceil(entries.length * LEDGER_DROP_RATIO)));
            entries.splice(0, n);
            dropped += n;
            raw = serialize(entries);
        }
        // 全失败：把为了腾地方而丢的旧条目放回来（账只留在内存，等下次写成功再一起补上）
        entries.length = 0;
        kept.forEach((e) => entries.push(e));
        const reason = '台账写入失败（localStorage 配额可能已满），本页仍有记录但刷新后会丢';
        writeState = { ok: false, lastError: reason, dropped, at: Date.now() };
        storeSet(LEDGER_WRITE_ERROR_KEY, JSON.stringify({ at: writeState.at, reason, dropped }));
        return { ok: false, dropped, reason };
    }

    // 记一条发送成功的弹幕。**永不出错**：任何输入都返回结果对象。
    // 返回 { ok, entry, deduped, dropped, reason? }；ok=false 表示没能落盘（记录只在本页内存里）。
    function ledgerRecord(entry) {
        const rec = normalize(entry);
        const entries = load();
        // 重复 id：不追加，保留首条（首条的时间/内容才是这条弹幕真正的来源），只补预设名这类后到信息
        if (rec.danmakuId) {
            const dup = entries.find((e) => e.danmakuId === rec.danmakuId);
            if (dup) {
                let touched = false;
                if (!dup.presetName && rec.presetName) { dup.presetName = rec.presetName; touched = true; }
                const res = touched ? persist(entries) : { ok: writeState.ok, dropped: 0 };
                return { ok: res.ok, entry: dup, deduped: true, dropped: res.dropped, reason: res.reason };
            }
        }
        entries.push(rec);
        const res = persist(entries);
        return { ok: res.ok, entry: rec, deduped: false, dropped: res.dropped, reason: res.reason };
    }

    // 全部记录（写入顺序：旧 → 新）的浅副本——调用方改这份数组不影响台账
    function ledgerList() { return load().slice(); }

    // 按视频分组：视频 id / 链接 / 条数 / 时间范围 / 已确认条数 + 该视频的条目（写入顺序）。
    // 组间按「最近有活动」排前（回查时最想先看到刚发过的那条）。
    function ledgerByVideo() {
        const groups = new Map();
        load().forEach((e) => {
            const key = String(e.vid);
            if (!groups.has(key)) {
                groups.set(key, {
                    vid: e.vid, url: ledgerVideoUrl(e), count: 0, verifiedCount: 0,
                    firstAt: e.sentAt, lastAt: e.sentAt, entries: [],
                });
            }
            const g = groups.get(key);
            g.entries.push(e);
            g.count++;
            if (e.sentAt < g.firstAt) g.firstAt = e.sentAt;
            if (e.sentAt > g.lastAt) g.lastAt = e.sentAt;
            if (e.verified) g.verifiedCount++;
            if (!g.url) g.url = ledgerVideoUrl(e);
        });
        return Array.from(groups.values()).sort((a, b) => b.lastAt - a.lastAt);
    }

    // 把一批 danmakuId 标成「已在池中确认可见」（verifySent 全片扫描到之后顺手回写）。
    // 只翻未确认的（保留首次确认时刻）；返回翻了多少条。空集合/脏输入返回 0。
    function ledgerMarkVerified(ids) {
        let list = [];
        if (typeof ids === 'string') list = [ids];
        else if (Array.isArray(ids)) list = ids;
        else if (ids && typeof ids.forEach === 'function') { ids.forEach((x) => list.push(x)); }
        const set = new Set(list.map((x) => String(x)).filter(Boolean));
        if (!set.size) return 0;
        const at = Date.now();
        let n = 0;
        load().forEach((e) => {
            if (e.danmakuId && set.has(e.danmakuId) && !e.verified) { e.verified = true; e.verifiedAt = at; n++; }
        });
        if (n) persist(load());
        return n;
    }

    // 清空台账（供 UI 的两步内联确认调用）。写空信封而不是删键：删除要走 localStorage.removeItem，
    // 本模块的读写一律走 storeGet/storeSet 单点。返回 { ok, cleared }。
    function ledgerClear() {
        const cleared = load().length;
        cache = [];
        storeSet(LEDGER_KEY, emptyRaw());
        const ok = storeGet(LEDGER_KEY, null) === emptyRaw();
        if (ok) storeSet(LEDGER_WRITE_ERROR_KEY, '');
        writeState = { ok, lastError: ok ? null : '台账清空失败（localStorage 写入被拒）', dropped: 0, at: Date.now() };
        return { ok, cleared };
    }

    function ledgerStats() {
        const entries = load();
        return {
            count: entries.length,
            verified: entries.filter((e) => e.verified).length,
            bytes: serialize(entries).length,
            maxEntries: LEDGER_MAX_ENTRIES,
            maxBytes: LEDGER_MAX_BYTES,
            write: writeState,
        };
    }

    function ledgerWriteState() { return writeState; }

    function ledgerStatusOf(entry) { return (entry && entry.verified) ? LEDGER_STATUS_VERIFIED : LEDGER_STATUS_PENDING; }
    function ledgerStatusLabel(entry) { return LEDGER_STATUS_LABELS[ledgerStatusOf(entry)]; }

    function ledgerVideoUrl(entry) {
        const e = entry || {};
        const id = (e.vid === null || e.vid === undefined || e.vid === '') ? '' : e.vid;
        if (!id) return '';
        return (e.bangumi ? 'https://www.acfun.cn/bangumi/aa' : 'https://www.acfun.cn/v/ac') + id;
    }

    // 时间戳 → MM-DD HH:mm:ss（台账列表与核对清单共用）
    function fmtStamp(ts) {
        const pad = (n) => String(n).padStart(2, '0');
        const d = new Date(pickNum(ts, 0));
        return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' '
            + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }

    // 清理核对清单（纯文本，供台账视图「清理引导」复制）：一行一条，人工到视频页比对用。
    // 列 = 时间 · 状态 · 起始位置 · 内容 · danmakuId。**这里没有任何可执行动作**——A 站没有删除接口
    // （API.md §十一 / §九 末），这份清单只是给眼睛看的。
    function ledgerChecklistText(entries) {
        const list = Array.isArray(entries) ? entries : load();
        return list.map((e) => [
            fmtStamp(e.sentAt),
            ledgerStatusLabel(e),
            'pos ' + (e.startTime == null ? '?' : (e.startTime / 1000).toFixed(3) + 's'),
            e.content,
            'id=' + (e.danmakuId || '(未返回)'),
        ].join(' | ')).join('\n');
    }

// —— ESM 导出（6.8.0 迁移）——
export {
    LEDGER_MAX_BYTES, LEDGER_MAX_ENTRIES, LEDGER_STATUS_LABELS, LEDGER_STORE_KEY,
    fmtStamp, ledgerByVideo, ledgerChecklistText, ledgerClear, ledgerList, ledgerMarkVerified,
    ledgerRecord, ledgerStats, ledgerStatusLabel, ledgerStatusOf, ledgerVideoUrl, ledgerWriteState,
};
// 仅供测试：把内存缓存与写状态重置回「未加载」。单测要在同一进程里反复造场景（预置存储 → 读账），
// 没有这个钩子就只能靠「缓存恰好还没加载」这种顺序巧合。生产代码不调用它。
export function resetLedgerState() {
    cache = null;
    writeState = { ok: true, lastError: null, dropped: 0, at: 0 };
}
