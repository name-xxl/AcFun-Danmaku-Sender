    // ============================================================
    //  发送
    // ============================================================
    // 理解卡｜我拥有：gmPost/sendModel/sendDanmaku/verifySent/getUid/getAcfunAuthor/videoIdentity——全部对外网络的
    //   唯一出口 + 身份读取（6.16.0 加 videoIdentity：这是谁的作品）；闸④ 的接线落点（sendModel 的返回值 →
    //   ledgerRecordSentModel → gdm-ledger 台账，落账时带上当时的身份三态）。
    // 我承诺：sendModel 参数与 A 站原生请求逐字段一致（请求层 color 是十进制、wordStyle.color 是 #rrggbb，两套口径别混）；
    //   句内节流 MODEL_SEND_INTERVAL=80ms、句间 sendInterval 默认 400ms（风控底线，RISKS R3）；
    //   成功的 danmakuId 既记入 lastSentIds 供 verifySent 匹配，也由 sendModel **带出来**
    //   （6.15.0 起返回 `{ ok: true, id, videoId }`，此前只 return true）供台账逐条落账；
    //   videoIdentity 只读页面全局，**取数失败一律返回 unknown 并自诊断**，绝不抛、绝不猜。
    // 我永不：不做渲染/预览（那是 70/71 的职责）；「结果未知（可能已发送）」时绝不自动重试——重发前必须先 verifySent；
    //   台账记账失败绝不冒泡（记账是尽力而为，发送结果才是主线）；**videoIdentity 不发任何网络请求**（不加 douga/info
    //   兜底——那要新增 @connect，见 API.md §十三 的「何时该加」）。
    // 改我前读：verifySent 复刻播放器 pollByPosition 20 秒窗口全片扫描（new-danmaku/list 不返回高级弹幕）；
    //   uid 在 cookie 的 auth_key（字符串）；**作者 id 与自己的 uid 都必须 String() 归一后再比**——实测作者 id 是
    //   字符串 `"25380695"`，而 getUid() 可能来自 player.uid（数字）或 cookie 正则（字符串），`===` 直接比会漏判
    //   「自己的视频」；**页面对象必须经 unsafeWindow 取**（本文件用 40-core 的 getPageWindow，见 API.md §七 ⚠️）；
    //   **sendModel 的返回值有两个消费者**（sendDanmaku 的循环、85-danmaku 的单发），改形状要同时改那两处。

import { IDENTITY_OTHER, IDENTITY_SELF, IDENTITY_UNKNOWN, MODEL_SEND_INTERVAL } from './10-constants.js';
import { getByPath, log, sleep, status } from './20-utils.js';
import { cancelled, getPageWindow, getPlayer, getVideoInfo, subs } from './40-core.js';
import { calcDurationMs, expandSub, getActivePreset } from './50-engine.js';
import { ledgerMarkVerified, ledgerRecord } from './gdm-ledger.js';

    function gmPost(url, data) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: location.href },
                data,
                timeout: 15000,
                onload(r) {
                    const txt = (r && r.responseText) || '';
                    let j = null;
                    try { j = JSON.parse(txt); } catch (e) { /* 保留 txt 供日志 */ }
                    resolve({ status: r.status, text: txt, json: j });
                },
                onerror: (e) => reject(new Error('网络错误（结果未知，可能已发送，重发前请先验证）：' + ((e && e.error) || JSON.stringify(e)))),
                ontimeout: () => reject(new Error('超时（结果未知，可能已发送，重发前请先验证）')),
            });
        });
    }

    async function sendModel(model) {
        const v = getVideoInfo();
        if (!v || !v.videoId) throw new Error('未获取到视频信息');

        const colorInt = parseInt(model.wordStyle.color.slice(1), 16);
        const params = [
            ['body', model.content],
            ['videoId', v.videoId],
            ['position', model.startTime],
            ['mode', 1],                        // 高级弹幕固定 MOVE=1
            ['size', model.wordStyle.size],
            ['color', isNaN(colorInt) ? 16777215 : colorInt],
            ['type', v.contentType],
            ['id', v.contentId],
            ['danmakuType', 1],
            ['advancedDanmakuExtData', JSON.stringify(model)],
            ['roleId', ''],
        ];
        // 仅当有子频道信息（番剧等）时才携带
        if (v.subChannelId) {
            params.push(['subChannelId', v.subChannelId], ['subChannelName', v.subChannelName || '']);
        }
        const data = params.map(([k, val]) => `${encodeURIComponent(k)}=${encodeURIComponent(val)}`).join('&');

        log('📤 发送弹幕:', model.content, '| position=' + model.startTime, '| videoId=' + v.videoId);

        const resp = await gmPost('https://www.acfun.cn/rest/pc-direct/new-danmaku/add', data);
        log('📥 响应 status=' + resp.status + ' body=' + resp.text);

        const j = resp.json;
        const RESULT_MSG = {
            0: null,
            128019: '用户等级不足',
            128020: 'UP主设置了无法发送高级弹幕',
            128023: 'UP主设置仅粉丝可发送',
            128024: 'UP主设置关注后可发送',
        };
        // 宽松比较：result 可能是数字 0 或字符串 "0"
        if (j && (j.result === 0 || j.result === '0' || j.result == 0)) {
            const id = String(j.danmakuId || '');
            log('✅ 发送成功 danmakuId=' + id);
            if (id) lastSentIds.push(id);
            // 6.15.0：把 id 带出来（闸④ 台账要用）。原来只 return true——全仓无消费者依赖那个布尔值
            // （grep 证据见 test/unit/gdm-ledger.test.mjs ⑥）；两个消费者都要看返回值，别再退回布尔。
            return { ok: true, id: id, videoId: v.videoId };
        }
        const code = j ? j.result : ('HTTP ' + resp.status);
        throw new Error(RESULT_MSG[code] || (j && j.error_msg) || ('result=' + code));
    }

    // 闸④ 台账记账（尽力而为）：一条 sendModel 成功就记一条。
    // 返回值与记账无关，只为测试可断言；**任何失败都在这里收掉**，绝不影响发送结果、绝不抛给 startSend。
    // 字段来源：id 取 sendModel 的返回（可能为空串——A 站没返回 danmakuId 时照记，见 gdm-ledger 头注）；
    //   内容/起点位置取真正发出去的那个 model；视频取当前视频（含番剧标记，决定清理清单里的链接形态）；
    //   预设取当前激活预设（getActivePreset 是纯查表，成本可忽略）；
    //   身份（6.16.0）取落账这一刻的 videoIdentity().state——他人视频上的记录在台账里更该被看见（台账视图会给分组打标）。
    function ledgerRecordSentModel(model, ret) {
        try {
            const v = getVideoInfo();
            const preset = getActivePreset();
            const id = (ret && typeof ret === 'object' && ret.id != null) ? String(ret.id) : '';
            return ledgerRecord({
                danmakuId: id,
                content: (model && model.content) || '',
                vid: (v && v.videoId) || 0,
                bangumi: !!(v && v.bangumi),
                startTime: (model && model.startTime != null) ? model.startTime : null,
                presetId: (preset && preset.id) || '',
                presetName: (preset && preset.name) || '',
                identity: videoIdentity().state,
            });
        } catch (e) {
            log('⚠ 台账记录失败（不影响发送）: ' + e.message);
            return null;
        }
    }

    // 发送一条字幕：按激活预设展开成多个 model，逐个发送。
    // 展开出的多条弹幕之间加 MODEL_SEND_INTERVAL 节流，避免一句 KTV 几十条请求背靠背触发限流；
    // 每条发送前检查 cancelled，让取消能在一句内部的弹幕间及时生效。
    // 返回 {sent, total}：中途取消时 sent < total（部分发送），由调用方标记未完成，避免整句被误判为已发完。
    async function sendDanmaku(sub, cfg, seq, prevTime) {
        const models = expandSub(sub, cfg, calcDurationMs(subs.indexOf(sub)), seq, prevTime);
        let sent = 0;
        for (let i = 0; i < models.length; i++) {
            if (cancelled) break;
            const ret = await sendModel(models[i]);
            sent++;
            // 闸④：记录紧跟 await 之后、本轮 break 判定之前——**被取消时已发出的那些照记**。
            // 取消只可能发生在别处（循环开头的 break / 句间 sleep 期间 / await 期间），等到下一轮
            // 顶部才发现，那时这条的成功已经在上一轮记完了；这里没有任何「取消就不记」的分支。
            ledgerRecordSentModel(models[i], ret);
            if (i < models.length - 1 && !cancelled) await sleep(MODEL_SEND_INTERVAL);
        }
        return { sent, total: models.length };
    }

    // ============================================================
    //  发送验证：从服务器拉取弹幕列表，确认自己发的弹幕真的上库
    // ============================================================

    let lastSentIds = [];   // 最近一次发送批次拿到的 danmakuId

    async function verifySent() {
        const p = getPlayer();
        const v = getVideoInfo();
        if (!v || !v.videoId) { status('❌ 未获取到视频信息', 'err'); return; }
        status('🔍 正在全片拉取高级弹幕验证…', 'busy');

        // 高级弹幕不走 new-danmaku/list（只返回普通弹幕），
        // 而是通过 pollByPosition（播放器轮询接口）按位置窗口下发。
        // 播放器每次只查约 20 秒窗口，窗口太大单段返回可能被截断导致漏数。
        // 因此复刻播放器逻辑：每 20 秒一段全片扫，累加去重。
        const durMs = getVideoDurationMs();
        if (!durMs) { status('⚠️ 无法获取视频时长，无法验证', 'err'); return; }
        const SEG = 20 * 1000;   // 20 秒一段
        const seen = new Map();  // danmakuId -> 弹幕对象（去重）
        let segCount = 0;

        try {
            for (let from = 0; from < durMs; from += SEG) {
                const to = Math.min(from + SEG, durMs);
                const params = [
                    ['resourceId', v.videoId],
                    ['enableAdvanced', 'true'],
                    ['positionFromInclude', from],
                    ['positionToExclude', to],
                ];
                const data = params.map(([k, val]) => `${encodeURIComponent(k)}=${encodeURIComponent(val)}`).join('&');
                const resp = await gmPost('https://www.acfun.cn/rest/pc-direct/new-danmaku/pollByPosition', data);
                const j = resp.json;
                segCount++;
                if (!j || (j.result != 0 && j.result != '0')) continue;
                const list = j.danmakus || j.list || [];
                for (const d of list) {
                    if (+d.danmakuType === 1 && d.danmakuId != null) {
                        if (!seen.has(String(d.danmakuId))) seen.set(String(d.danmakuId), d);
                    }
                }
                if (segCount % 30 === 0) await sleep(100);   // 每 30 段歇一下
            }

            const adv = Array.from(seen.values());
            const uid = getUid();
            const mineById = adv.filter((d) => lastSentIds.includes(String(d.danmakuId)));
            // 你发的弹幕：优先按本次 danmakuId 匹配；没有记录时按用户 id 匹配
            const mine = mineById.length ? mineById : (uid ? adv.filter((d) => String(d.userId) === String(uid)) : []);
            // 按 body+position 去重，统计「去重后的你的弹幕条数」
            const uniqueKey = (d) => d.body + '@' + d.position;
            const uniqueCount = new Set(mine.map(uniqueKey)).size;
            // 闸④：**确认到的才回写台账**（在池里真看见过 → verified「已确认可见」）。
            // 只传 mine 的 id：它们确实是本次全片扫描在池里查到的；台账按 id 匹配，匹配不到的条目不受影响。
            const marked = ledgerMarkVerified(mine.map((d) => String(d.danmakuId)));
            log('🔍 全片扫描：时长=' + (durMs / 1000) + 's，分段=' + segCount + '，高级弹幕总数=' + adv.length + '，你的弹幕=' + mine.length + '（去重 ' + uniqueCount + ' 条，台账确认 ' + marked + ' 条）');

            if (mine.length) {
                status(`✅ 全片高级弹幕 ${adv.length} 条，其中你的 ${mine.length} 条（去重 ${uniqueCount} 条）`, 'ok');
                mine.slice(0, 12).forEach((d) => log('   ✓ danmakuId=' + d.danmakuId + ' body=' + d.body + ' position=' + d.position));
            } else if (adv.length) {
                status(`全片有 ${adv.length} 条高级弹幕，但都不是你的`, 'busy');
                adv.slice(0, 10).forEach((d) => log('   · danmakuId=' + d.danmakuId + ' body=' + d.body + ' position=' + d.position + ' user=' + d.userId));
            } else {
                // 「查不到」不是「失败」：审核延迟 / 接口返回受限都会这样，台账里这些记录仍是「待审核（未确认）」。
                // 6.15.0 起从 err 改为 busy（红色 error 态会让人以为发送失败了）。
                status('⚠️ 全片未查到高级弹幕（可能仍在审核延迟，或接口返回受限）——这不等于发送失败，台账里仍是「待审核（未确认）」', 'busy');
            }
        } catch (e) {
            status('验证失败: ' + e.message, 'err');
        }
    }

    // 获取视频总时长（毫秒），多字段兜底
    function getVideoDurationMs() {
        const p = getPlayer();
        let sec = 0;
        if (p) {
            sec = p.duration || (p.$video && p.$video.duration) || 0;
        }
        if (!sec || sec <= 0) {
            // 从页面元素兜底：视频时长常挂在 .video-info 或 data 属性里
            const el = document.querySelector('.video-info .duration, .video-duration, [data-duration]');
            if (el) {
                const t = el.getAttribute('data-duration') || el.textContent || '';
                const m = t.match(/(\d+):(\d+):(\d+)/) || t.match(/(\d+):(\d+)/);
                if (m) {
                    if (m.length === 4) sec = +m[1] * 3600 + +m[2] * 60 + +m[3];
                    else sec = +m[1] * 60 + +m[2];
                }
            }
        }
        return sec > 0 ? Math.floor(sec * 1000) : 0;   // 拿不到时长返回 0，由调用方提示，而非兜底扫 1 小时
    }

    function getUid() {
        try {
            const p = getPlayer();
            if (p && p.uid) return p.uid;
            // player.uid 不存在时，从 cookie 取（A 站用 auth_key 存用户 id）
            const m = document.cookie.match(/(?:^|;\s*)auth_key=(\d+)/)
                || document.cookie.match(/(?:^|;\s*)userId=(\d+)/);
            return m ? m[1] : '';
        } catch (e) { return ''; }
    }

    // 当前登录用户的署名（A 站昵称 + uid，格式「昵称(uid)」），供预设导出的作者栏自动填写。
    // 昵称在 cookie 的 ac_username（URI 编码）；两项都拿不到时返回空串，让用户手填。
    function getAcfunAuthor() {
        let name = '';
        try {
            const m = document.cookie.match(/(?:^|;\s*)ac_username=([^;]*)/);
            if (m && m[1]) name = decodeURIComponent(m[1]);
        } catch (e) {}
        const uid = String(getUid() || '');
        if (name && uid) return name + '(' + uid + ')';
        if (name) return name;
        return uid ? 'uid:' + uid : '';
    }

    // ============================================================
    //  身份感知（6.16.0）：这是谁的作品？
    // ============================================================
    // videoIdentity() → { state: 'self' | 'other' | 'unknown', ownerUid, ownerName, source }
    //
    // **主路径 = 读页面全局，不发请求**：v 页自身没有独立 JSON 请求，服务端把 douga/info 等价数据直出进
    //   HTML，脚本在页面里能直接读 `window.videoInfo`（**含 mkey**）——取数路径与出处见 API.md §十三
    //   （来源是 svfeed 项目的实测文档，**本仓没有独立实测**）。页面全局必须经 unsafeWindow 取（本文件用
    //   40-core 的 getPageWindow；@grant 含 unsafeWindow 时 window 是沙箱 window，见 API.md §七 ⚠️）。
    //
    // 尝试顺序（照 douga/info 的**已实测形状**去取，不自己另创路径）：
    //   ① videoInfo.user        —— douga/info 回包顶层就是这个形状，作者 uid 在 `user.id`（**字符串**）
    //   ② videoInfo.detail.user —— 嵌套一层（同族回包里的常见包裹）
    //   ③ videoInfo.userInfo    —— 视频卡家族里的富用户对象键名
    //   三处都要求「是对象且 id 非空」；都不中 → **unknown**（不猜），并把诊断打到控制台（见下）。
    //   注：window.videoInfo 的形状**没有逐字段核实过**（只知「与 douga/info 等价」），所以这三条路径是
    //   「按已实测形状去试」，也正是取不到时要打诊断的原因——用户把诊断贴回来才能定位真实形状。
    //
    // 三态判定（**归一成字符串再比**：作者 id 实测是字符串，自己的 uid 可能是数字或字符串）：
    //   自己的 uid 拿得到 + 作者 id 相等 → self；拿得到 + 不相等 → other；
    //   作者 id 取不到，或自己的 uid 取不到（未登录）→ **unknown**。
    //   **unknown 绝不当成 self**（不知道就不声称是自己的视频）：未登录连「自己是谁」都不确定，
    //   归入 unknown 而不是 other——它是不确定，不该被当成任何一方的结论。
    // 放在本模块的理由：它是 getUid()（自己的身份）的同一族读取，且闸④ 台账落账（ledgerRecordSentModel）
    //   也在这里——换模块会让「落账带身份」要么跨层取值、要么成环（gdm-ledger 已在 60 的下游）。

    const VIDEO_OWNER_PATHS = ['user', 'detail.user', 'userInfo'];

    // 诊断只打**键名与值类型**，不打值本身——用户可以把这几行安全地贴回来定位真实形状
    const IDENTITY_DIAG_MAX_KEYS = 60;
    const IDENTITY_DIAG_MAX_SUBKEYS = 40;
    let identityDiagSig = null;   // 上一次已打过的诊断签名（同一页面同一种失败不重复刷屏）

    function valueType(v) {
        if (v === null) return 'null';
        if (Array.isArray(v)) return 'array(' + v.length + ')';
        return typeof v;
    }

    // 读不到的当场自诊断（**硬要求**：绝不静默 unknown）。返回诊断行数组，便于测试直接断言。
    function identityDiagnostic(vi) {
        const lines = [];
        if (!vi) {
            lines.push('window.videoInfo 不存在 / 不是对象（v 页本应由服务端直出该全局；不在 v 页，或页面结构变了）');
            lines.push('已尝试的路径: ' + VIDEO_OWNER_PATHS.join(' → ') + '（无从尝试：没有 videoInfo）');
            return lines;
        }
        let keys = [];
        try { keys = Object.keys(vi); } catch (e) { keys = []; }
        lines.push('window.videoInfo 顶层键（' + keys.length + ' 个）: ' + keys.slice(0, IDENTITY_DIAG_MAX_KEYS).join(', '));
        keys.slice(0, IDENTITY_DIAG_MAX_KEYS).forEach((k) => {
            try {
                const v = vi[k];
                if (!v || typeof v !== 'object' || Array.isArray(v)) return;
                const sub = Object.keys(v);
                // 「像作者」判据：键名像 user/author/up，或子对象自带 id —— 只报这一类，避免把整个 videoInfo 倒出来
                if (!/user|author|up/i.test(k) && sub.indexOf('id') < 0) return;
                lines.push('  ' + k + '.{ ' + sub.slice(0, IDENTITY_DIAG_MAX_SUBKEYS)
                    .map((x) => x + ': ' + valueType(v[x])).join(', ') + ' }');
            } catch (e) {
                lines.push('  ' + k + ': <读取抛错：' + ((e && e.message) || e) + '>');
            }
        });
        lines.push('已尝试的路径: ' + VIDEO_OWNER_PATHS.join(' → ') + '（都取不到「对象且 id 非空」的作者）');
        return lines;
    }

    function logIdentityOnce(sig, text) {
        if (sig === identityDiagSig) return;
        identityDiagSig = sig;
        log(text);
    }

    // 按路径表取作者（返回第一个「对象且 id 非空」的候选）
    function ownerCandidate(vi) {
        for (let i = 0; i < VIDEO_OWNER_PATHS.length; i++) {
            const path = VIDEO_OWNER_PATHS[i];
            let u;
            try { u = getByPath(vi, path); } catch (e) { u = undefined; }
            if (!u || typeof u !== 'object') continue;
            let id, name;
            try { id = u.id; name = u.name; } catch (e) { continue; }
            if (id === null || id === undefined || String(id) === '') continue;
            return { ownerUid: String(id), ownerName: String(name == null ? '' : name), path };
        }
        return null;
    }

    // 三态判定。**不抛**：页面全局读不到、形状不对、只要 id 的 getter 一炸，一律退回 unknown + 诊断。
    function videoIdentity() {
        let vi = null;
        try {
            const w = getPageWindow();
            const raw = w ? w.videoInfo : null;
            if (raw && typeof raw === 'object') vi = raw;
        } catch (e) { vi = null; }

        const found = vi ? ownerCandidate(vi) : null;
        if (!found) {
            const lines = identityDiagnostic(vi);
            logIdentityOnce('no-owner|' + lines.join('|'),
                '⚠ 身份感知取不到视频作者 → 判定 unknown（**不当作自己的视频**）。'
                + '请把下面几行贴回作者（只有键名与类型，没有值）：\n  ' + lines.join('\n  '));
            return { state: IDENTITY_UNKNOWN, ownerUid: '', ownerName: '', source: '' };
        }

        const selfUid = String(getUid() || '');
        if (!selfUid) {
            // 未登录（或拿不到自己的 uid）：作者读到了，但「我是谁」不知道 → unknown（不收紧、也绝不声称是自己的视频）
            logIdentityOnce('no-self',
                '⚠ 身份感知拿不到自己的 uid（未登录？cookie 无 auth_key 且 player.uid 缺失）→ 判定 unknown。'
                + '作者 uid 读到了：' + found.ownerUid + '（未作比较）');
            return { state: IDENTITY_UNKNOWN, ownerUid: found.ownerUid, ownerName: found.ownerName, source: found.path };
        }

        const state = (found.ownerUid === selfUid) ? IDENTITY_SELF : IDENTITY_OTHER;
        return { state, ownerUid: found.ownerUid, ownerName: found.ownerName, source: found.path };
    }


// —— ESM 导出（6.8.0 迁移）——
export {
    getAcfunAuthor, getUid, lastSentIds, ledgerRecordSentModel, sendDanmaku, sendModel, verifySent,
    videoIdentity,
};
// 仅供测试：清掉「同一种身份取数失败只打一次日志」的签名（单测要在同一进程里反复造取数失败场景）。
// 生产代码不调用它——一次会话里同一页面同一种失败只该打一行。
export function resetIdentityDiagnostic() { identityDiagSig = null; }
// 跨文件写：ESM 导入绑定只读，80-ui 发起新批次时清空 lastSentIds 走此 setter（声明留原地，初始化未改）
export function setLastSentIds(v) { lastSentIds = v; }
// 仅供冒烟测试（#15 探针给发送循环装替身）：不对其它 src 模块开放
export function setSendModel(fn) { sendModel = fn; }
