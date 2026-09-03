    // ============================================================
    //  发送
    // ============================================================

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
                onerror: (e) => reject(new Error('网络错误：' + ((e && e.error) || JSON.stringify(e)))),
                ontimeout: () => reject(new Error('超时')),
            });
        });
    }

    async function sendModel(model) {
        const v = getVideoInfo();
        if (!v || !v.videoId) throw new Error('未获取到视频信息');

        const params = [
            ['body', model.content],
            ['videoId', v.videoId],
            ['position', model.startTime],
            ['mode', 1],                        // 高级弹幕固定 MOVE=1
            ['size', model.wordStyle.size],
            ['color', parseInt(model.wordStyle.color.slice(1), 16) || 16777215],
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
            return true;
        }
        const code = j ? j.result : ('HTTP ' + resp.status);
        throw new Error(RESULT_MSG[code] || (j && j.error_msg) || ('result=' + code));
    }

    // 发送一条字幕：按激活预设展开成多个 model，逐个发送
    async function sendDanmaku(sub, cfg, seq, prevTime) {
        const models = expandSub(sub, cfg, calcDurationMs(subs.indexOf(sub)), seq, prevTime);
        for (const m of models) {
            await sendModel(m);
        }
        return true;
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
            log('🔍 全片扫描：时长=' + (durMs / 1000) + 's，分段=' + segCount + '，高级弹幕总数=' + adv.length + '，你的弹幕=' + mine.length + '（去重后 ' + uniqueCount + ' 条）');

            if (mine.length) {
                status(`✅ 全片高级弹幕 ${adv.length} 条，其中你的 ${mine.length} 条（去重 ${uniqueCount} 条）`, 'ok');
                mine.slice(0, 12).forEach((d) => log('   ✓ danmakuId=' + d.danmakuId + ' body=' + d.body + ' position=' + d.position));
            } else if (adv.length) {
                status(`全片有 ${adv.length} 条高级弹幕，但都不是你的`, 'busy');
                adv.slice(0, 10).forEach((d) => log('   · danmakuId=' + d.danmakuId + ' body=' + d.body + ' position=' + d.position + ' user=' + d.userId));
            } else {
                status('⚠️ 全片未查到高级弹幕（可能仍在审核延迟，或接口返回受限）', 'err');
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
        return sec > 0 ? Math.floor(sec * 1000) : 60 * 60 * 1000;  // 兜底 1 小时
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

