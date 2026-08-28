// ==UserScript==
// @name         AcFun 弹幕字幕发送器
// @namespace    https://github.com/acfun-danmaku-sender
// @version      4.0.0
// @description  上传 SRT/ASS 字幕文件，按时间轴自动发送弹幕
// @author       Cherry Assistant
// @match        *://www.acfun.cn/v/ac*
// @match        *://www.acfun.cn/bangumi/aa*
// @grant        GM_xmlhttpRequest
// @connect      www.acfun.cn
// @connect      member.acfun.cn
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const DEF = { interval: 15, size: 25, mode: 4, color: 16777215 };
    const COLORS = { '白色':16777215,'红色':16711680,'橙色':16744448,'黄色':16776960,'绿色':65280,'青色':65535,'蓝色':255,'紫色':8388736,'粉色':16758465 };

    let subs = [], sending = false, paused = false, cancelled = false, cachedVideo = null;

    // ===================== 样式 =====================

    const S = document.createElement('style');
    S.textContent = `
    #ap{position:fixed;top:80px;right:20px;z-index:999999;width:380px;max-height:88vh;
        background:#0f0f17;color:#d4d4d8;border:1px solid rgba(255,255,255,.06);
        border-radius:14px;box-shadow:0 16px 48px rgba(0,0,0,.7);font:13px/1.6 -apple-system,sans-serif;
        display:none;flex-direction:column;overflow:hidden}
    #ap-hd{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;
        background:linear-gradient(135deg,#6366f1,#8b5cf6);cursor:move;user-select:none}
    #ap-hd b{font-size:14px;color:#fff}
    #ap-hd button{background:rgba(255,255,255,.15);border:none;border-radius:6px;padding:3px 10px;color:#fff;font-size:11px;cursor:pointer}
    #ap-hd button:hover{background:rgba(255,255,255,.3)}
    #ap-bd{padding:14px 16px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:10px}
    .up-z{border:2px dashed #2a2a3a;border-radius:10px;padding:18px;text-align:center;cursor:pointer;transition:.2s}
    .up-z:hover{border-color:#6366f1;background:rgba(99,102,241,.05)}
    .up-z.ok{border-color:#22c55e;background:rgba(34,197,94,.04);padding:10px}
    .fr{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .fr label{font-size:11px;color:#71717a;min-width:28px}
    .fr select,.fr input{background:#1a1a28;border:1px solid #2a2a3a;border-radius:6px;color:#d4d4d8;padding:4px 8px;font-size:12px;outline:none}
    .fr select:focus,.fr input:focus{border-color:#6366f1}
    .fr input[type=number]{width:52px}
    .fr .sep{width:1px;height:14px;background:#2a2a3a}
    .ab{border:none;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:500;cursor:pointer;transition:.15s}
    .ab:active{transform:scale(.96)}.ab:disabled{opacity:.3;cursor:not-allowed}
    .ab-p{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff}
    .ab-p:hover:not(:disabled){box-shadow:0 4px 16px rgba(99,102,241,.5)}
    .ab-s{background:#2a2a3a;color:#a1a1aa}.ab-s:hover:not(:disabled){background:#3a3a4a;color:#d4d4d8}
    .pg{height:3px;background:#1a1a28;border-radius:2px;overflow:hidden}
    .pg-f{height:100%;background:linear-gradient(90deg,#6366f1,#8b5cf6);border-radius:2px;transition:width .3s}
    #ap-st{padding:8px 10px;border-radius:8px;font-size:12px;background:#1a1a28;min-height:20px;word-break:break-all}
    #ap-st.ok{background:#052e16;color:#4ade80}#ap-st.err{background:#2a0a0a;color:#f87171}#ap-st.busy{background:#1e1a0a;color:#fbbf24}
    .tw{max-height:220px;overflow-y:auto;border-radius:8px;border:1px solid #2a2a3a}
    .tw table{width:100%;border-collapse:collapse;font-size:12px}
    .tw th{background:#1a1a28;padding:5px 8px;text-align:left;font-weight:500;color:#71717a;border-bottom:1px solid #2a2a3a;position:sticky;top:0}
    .tw td{padding:4px 8px;border-bottom:1px solid #16161f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .tw tr:hover td{background:rgba(99,102,241,.04)}
    .tw .c-t{font-family:monospace;color:#60a5fa;width:72px}.tw .c-i{width:32px;color:#52525b;text-align:center}
    .tw .c-s{text-align:center;width:36px}.s-ok{color:#4ade80}.s-ing{color:#fbbf24}.s-err{color:#f87171}
    .ad-inj{display:inline-flex;align-items:center;gap:3px;cursor:pointer;padding:0 8px;height:22px;border-radius:4px;transition:.15s;margin-left:4px}
    .ad-inj:hover{background:rgba(99,102,241,.1)}.ad-inj.on{background:rgba(99,102,241,.15)}
    .ad-inj span{font-size:12px;color:#71717a;line-height:22px}
    .ad-inj:hover span,.ad-inj.on span{color:#6366f1}`;
    document.head.appendChild(S);

    // ===================== 字幕解析 =====================

    function parseSRT(t) {
        t = t.replace(/^﻿/, '');
        const out = [];
        for (const b of t.trim().split(/\n\s*\n/)) {
            const ls = b.trim().split('\n');
            const ti = ls.findIndex(l => l.includes('-->'));
            if (ti < 0) continue;
            const ms = t2ms(ls[ti].split('-->')[0].trim());
            const txt = ls.slice(ti + 1).join('\n').trim();
            if (ms !== null && txt) out.push({ time: ms, text: txt });
        }
        return out.sort((a, b) => a.time - b.time);
    }

    function parseASS(t) {
        t = t.replace(/^﻿/, '');
        const out = []; let on = false, fmt = [];
        for (const raw of t.split('\n')) {
            const l = raw.trim();
            if (/^\[Events\]$/i.test(l)) { on = true; continue; }
            if (/^\[.+\]$/.test(l) && on) break;
            if (!on) continue;
            if (l.startsWith('Format:')) { fmt = l.slice(7).split(',').map(f => f.trim().toLowerCase()); continue; }
            if (!l.startsWith('Dialogue:')) continue;
            const parts = l.slice(9).split(',');
            const si = fmt.indexOf('start'), ti = fmt.indexOf('text');
            let st, body;
            if (si >= 0 && ti >= 0 && parts.length > ti) {
                st = parts[si].trim(); body = parts.slice(ti).join(',').trim();
            } else {
                st = (parts[0] || '').trim(); body = parts.slice((fmt.length || 9) - 1).join(',').trim();
            }
            body = body.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').replace(/\\n/g, '\n').trim();
            const first = body.split('\n')[0].trim();
            const ms = ass2ms(st);
            if (ms !== null && first) out.push({ time: ms, text: first });
        }
        return out.sort((a, b) => a.time - b.time);
    }

    function parseSub(text, name) { return /\.ass[ai]?$/i.test(name) ? parseASS(text) : parseSRT(text); }

    function t2ms(s) { s = s.replace(',', '.'); const m = s.match(/(\d+):(\d+):(\d+)(?:\.(\d+))?/); return m ? +m[1]*36e5 + +m[2]*6e4 + +m[3]*1e3 + +(m[4]||'0').padEnd(3,'0').slice(0,3) : null; }
    function ass2ms(s) { const m = s.match(/(\d+):(\d+):(\d+)\.(\d+)/); return m ? +m[1]*36e5 + +m[2]*6e4 + +m[3]*1e3 + +(m[4]||'0').padEnd(2,'0').slice(0,2)*10 : null; }
    function fmt(ms) { return `${p(ms/36e5|0)}:${p(ms%36e5/6e4|0)}:${p(ms%6e4/1e3|0)}.${String(ms%1e3).padStart(3,'0')}`; }
    function p(n) { return String(n).padStart(2, '0'); }

    // ===================== 视频信息 =====================

    function urlIds() {
        let m = location.pathname.match(/\/v\/ac(\d+)/);
        if (m) return { t: 'douga', id: +m[1] };
        m = location.pathname.match(/\/bangumi\/aa(\d+)/);
        if (m) return { t: 'bangumi', id: +m[1] };
        return null;
    }

    async function getVideo() {
        if (cachedVideo) return cachedVideo;
        const el = document.getElementById('v-id');
        const manual = el?.value?.trim();
        if (manual && /^\d{6,10}$/.test(manual)) {
            const ids = urlIds();
            cachedVideo = { videoId: +manual, rid: ids?.id || 0, chId: '', chName: '', bangumi: ids?.t === 'bangumi' };
            return cachedVideo;
        }
        cachedVideo = await fetchVideo();
        if (el && cachedVideo?.videoId) el.value = cachedVideo.videoId;
        return cachedVideo;
    }

    async function fetchVideo() {
        const ids = urlIds();
        if (!ids) throw new Error('无法提取视频ID');
        const ac = ids.id;

        // 方法1: 页面 script 提取
        for (const s of document.querySelectorAll('script:not([src])')) {
            const t = s.textContent;
            if (!t || !t.includes(String(ac))) continue;
            const vm = t.match(/videoId['":\s]*['"]?(\d{6,10})['"]?/);
            if (vm) {
                const cm = t.match(/(?:subChannelId|channelId)['":\s]*['"]?(\d+)['"]?/);
                const nm = t.match(/(?:subChannelName|channelName)['":\s]*['"]?([^'"}\s,]+)['"]?/);
                return { videoId: +vm[1], rid: ac, chId: cm ? +cm[1] : '', chName: nm ? nm[1] : '', bangumi: ids.t === 'bangumi' };
            }
        }

        // 方法2: 请求视频页 HTML
        try {
            const r = await gmGet(`https://www.acfun.cn/v/ac${ac}`);
            const html = r.responseText || '';
            const vi = html.match(/videoInfo\s*=\s*(\{[\s\S]*?\})\s*;/);
            if (vi) { try { const d = JSON.parse(vi[1]); const vid = d.videoId || d.currentVideoId; const ch = d.channel || {};
                if (vid) return { videoId: +vid, rid: ac, chId: ch.id || '', chName: ch.name || '', bangumi: ids.t === 'bangumi' }; } catch {} }
            const vm = html.match(/["']?currentVideoId["']?\s*[:=]\s*["']?(\d{6,10})["']?/) || html.match(/["']?videoId["']?\s*[:=]\s*["']?(\d{6,10})["']?/);
            const cm = html.match(/["']?subChannelId["']?\s*[:=]\s*["']?(\d+)["']?/) || html.match(/"channel"\s*:\s*\{[^}]*"id"\s*:\s*(\d+)/);
            const nm = html.match(/["']?subChannelName["']?\s*[:=]\s*["']?([^'"},\s]+)["']?/) || html.match(/"channel"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/);
            if (vm) return { videoId: +vm[1], rid: ac, chId: cm ? +cm[1] : '', chName: nm ? nm[1] : '', bangumi: ids.t === 'bangumi' };
        } catch {}

        // 方法3: 等播放器请求
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('获取失败，请手动填 videoId')), 10000);
            window._adsVid = (body) => { const m = body.match(/videoId=(\d+)/); if (m) { clearTimeout(t); window._adsVid = null; resolve({
                videoId: +m[1], rid: ac, chId: (body.match(/subChannelId=(\d+)/)||[])[1]||'', chName: decodeURIComponent((body.match(/subChannelName=([^&]+)/)||[])[1]||''), bangumi: ids.t === 'bangumi' }); } };
        });
    }

    function gmGet(url) { return new Promise((ok, no) => { GM_xmlhttpRequest({ method: 'GET', url, headers: { Referer: 'https://www.acfun.cn/' }, onload: ok, onerror: no }); }); }

    // ===================== 发送弹幕 =====================

    async function sendDanmaku(text, timeMs, cfg) {
        const v = await getVideo();
        const params = [
            ['mode', cfg.mode], ['color', cfg.color], ['size', cfg.size],
            ['body', text], ['videoId', v.videoId], ['position', timeMs],
            ['type', v.bangumi ? 'bangumi' : 'douga'], ['id', v.rid],
        ];
        if (v.chId) { params.push(['subChannelId', v.chId], ['subChannelName', v.chName || '']); }
        params.push(['roleId', '']);
        const data = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

        // 调试: 打印精确时间
        console.log(`[字幕弹幕] position=${timeMs} (${(timeMs/1000).toFixed(3)}s) text="${text}"`);

        return new Promise((ok, no) => {
            GM_xmlhttpRequest({
                method: 'POST', url: 'https://www.acfun.cn/rest/pc-direct/new-danmaku/add',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: location.href },
                data,
                onload(r) { try { const j = JSON.parse(r.responseText); j.result === 0 ? ok(true) : no(new Error(j.error_msg || `result=${j.result}`)); } catch { no(new Error('响应异常')); } },
                onerror() { no(new Error('网络错误')); },
            });
        });
    }

    // ===================== UI =====================

    function $(id) { return document.getElementById(id); }

    function ui() {
        const panel = document.createElement('div');
        panel.id = 'ap';
        Object.assign(panel.style, { position:'fixed', top:'80px', right:'20px', zIndex:'999999', width:'380px', maxHeight:'88vh', display:'none', flexDirection:'column' });

        panel.innerHTML = `
        <div id="ap-hd"><b>📝 弹幕字幕发送器</b><button id="ap-x">─</button></div>
        <div id="ap-bd">
            <div class="up-z" id="up-z"><div style="font-size:28px;margin-bottom:4px">📂</div><div><b>点击上传</b> 或拖放字幕</div><div style="font-size:11px;color:#52525b;margin-top:2px">SRT / ASS</div></div>
            <input type="file" id="up-f" accept=".srt,.ass,.ssa" style="display:none">

            <div class="fr"><label>vid</label><input id="v-id" type="text" placeholder="自动获取"><span style="font-size:11px;color:#52525b">失败时手动填</span></div>

            <div class="fr">
                <label>模式</label><select id="s-md">
                    <option value="4" selected>底端固定</option><option value="5">顶端固定</option><option value="1">滚动</option>
                </select><div class="sep"></div>
                <label>字号</label><select id="s-sz">
                    <option value="16">小</option><option value="25" selected>中</option><option value="36">大</option>
                </select><div class="sep"></div>
                <label>颜色</label><select id="s-cl">${Object.entries(COLORS).map(([n,v])=>`<option value="${v}"${n==='白色'?' selected':''}>${n}</option>`).join('')}</select>
            </div>

            <div class="fr"><label>间隔</label><input id="s-it" type="number" value="${DEF.interval}" min="5" max="60"><span style="font-size:11px;color:#52525b">秒</span></div>

            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                <button class="ab ab-p" id="b-go">▶ 发送全部</button>
                <button class="ab ab-s" id="b-pu" disabled>⏸ 暂停</button>
                <button class="ab ab-s" id="b-rs">↺ 重置</button>
                <button class="ab ab-s" id="b-fl">📂</button>
                <span id="ap-cnt" style="margin-left:auto;font-size:12px;color:#52525b">未加载</span>
            </div>
            <div class="pg"><div class="pg-f" id="pf" style="width:0"></div></div>
            <div id="ap-st">请上传字幕文件</div>
            <div class="tw" id="tw"><div style="text-align:center;color:#52525b;padding:20px">暂无数据</div></div>
        </div>`;
        document.body.appendChild(panel);

        panel.querySelector('#ap-x').addEventListener('click', e => {
            e.stopPropagation();
            panel.style.setProperty('display','none','important');
            document.querySelector('.ad-inj')?.classList.remove('on');
        });
        const uz = $('up-z'), uf = $('up-f');
        uz.onclick = () => uf.click();
        $('b-fl').onclick = () => uf.click();
        uz.ondragover = e => e.preventDefault();
        uz.ondrop = e => { e.preventDefault(); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); };
        uf.onchange = () => { if (uf.files[0]) loadFile(uf.files[0]); };
        $('b-go').onclick = startSend;
        $('b-pu').onclick = () => { if (!sending) return; paused = !paused; const b = $('b-pu'); b.textContent = paused ? '▶ 继续' : '⏸ 暂停'; b.style.color = paused ? '#fbbf24' : ''; };
        $('b-rs').onclick = resetAll;

        // 拖动面板
        const header = panel.querySelector('#ap-hd');
        let dragging = false, startX, startY, startLeft, startTop;
        header.addEventListener('mousedown', e => {
            if (e.target.closest('button')) return; // 点按钮不拖动
            dragging = true;
            startX = e.clientX; startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            startLeft = rect.left; startTop = rect.top;
            e.preventDefault();
        });
        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            panel.style.left = (startLeft + e.clientX - startX) + 'px';
            panel.style.top = (startTop + e.clientY - startY) + 'px';
            panel.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => { dragging = false; });

        injectBtn(panel);
    }

    function injectBtn(panel) {
        const area = document.querySelector('.wrap-danmaku-setting');
        if (!area) { const obs = new MutationObserver(() => { if (document.querySelector('.wrap-danmaku-setting')) { obs.disconnect(); injectBtn(panel); } }); obs.observe(document.body, { childList: true, subtree: true }); setTimeout(() => obs.disconnect(), 10000); return; }
        if (area.querySelector('.ad-inj')) return;
        const btn = document.createElement('div');
        btn.className = 'ad-inj'; btn.title = '弹幕字幕发送器';
        btn.innerHTML = '<span>📝</span><span>字幕弹幕</span>';
        btn.onclick = () => { const showing = panel.style.getPropertyValue('display') !== 'none'; panel.style.setProperty('display', showing ? 'none' : 'flex', 'important'); btn.classList.toggle('on', !showing); };
        const setting = area.querySelector('.danmaku-setting');
        setting ? area.insertBefore(btn, setting) : area.appendChild(btn);
    }

    // ===================== 文件处理 =====================

    function loadFile(file) {
        const r = new FileReader();
        r.onload = () => {
            try {
                subs = parseSub(r.result, file.name);
                if (!subs.length) throw new Error('未解析到字幕');
                renderTable(); updateCnt(); updateProg();
                st(`📂 ${file.name} · ${subs.length} 条 · ${fmt(subs[subs.length-1].time)}`, 'ok');
                const uz = $('up-z'); uz.classList.add('ok'); uz.querySelector('div').innerHTML = `<b>${file.name}</b> · ${subs.length} 条`;
            } catch (e) { st('解析失败: ' + e.message, 'err'); }
        };
        r.readAsText(file, 'utf-8');
    }

    // ===================== 状态 =====================

    function st(msg, type) { const e = $('ap-st'); if (!e) return; e.textContent = msg; e.className = type === 'ok' ? 'ok' : type === 'err' ? 'err' : type === 'busy' ? 'busy' : ''; }
    function updateCnt() { const e = $('ap-cnt'); if (e) e.textContent = subs.length ? `${subs.filter(s=>s.st==='ok').length}/${subs.length}` : '未加载'; }
    function updateProg() { const f = $('pf'); if (f) f.style.width = subs.length ? `${subs.filter(s=>s.st==='ok').length/subs.length*100}%` : '0%'; }

    function renderTable() {
        const w = $('tw'); if (!w) return;
        if (!subs.length) { w.innerHTML = '<div style="text-align:center;color:#52525b;padding:20px">暂无数据</div>'; return; }
        const sc = { ok:'s-ok', ing:'s-ing', err:'s-err' }, si = { ok:'✓', ing:'…', err:'✗' };
        let h = '<table><thead><tr><th class="c-i">#</th><th class="c-t">时间</th><th>内容</th><th class="c-s">状态</th></tr></thead><tbody>';
        for (let i = 0; i < subs.length; i++) { const s = subs[i]; h += `<tr><td class="c-i">${i+1}</td><td class="c-t">${fmt(s.time)}</td><td title="${s.text}">${s.text}</td><td class="c-s ${sc[s.st]||''}">${si[s.st]||'○'}</td></tr>`; }
        w.innerHTML = h + '</tbody></table>';
    }

    function scrollTo(i) { const r = $('tw')?.querySelectorAll('tbody tr')[i]; r?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }

    function setBtns(sending) {
        const go = $('b-go'), pu = $('b-pu'), fl = $('b-fl');
        if (go) go.disabled = sending; if (fl) fl.disabled = sending;
        if (pu) { pu.disabled = !sending; pu.style.opacity = sending ? '1' : '.3'; }
        if (!sending && pu) { pu.textContent = '⏸ 暂停'; pu.style.color = ''; }
    }

    // ===================== 发送 =====================

    async function startSend() {
        if (!subs.length) { st('请先上传字幕文件', 'err'); return; }
        const unsent = subs.filter(s => s.st !== 'ok').length;
        const md = { 1:'滚动', 4:'底端固定', 5:'顶端固定' }[+$('s-md').value] || '?';
        const sz = { 16:'小', 25:'中', 36:'大' }[+$('s-sz').value] || '?';
        const it = +$('s-it').value || 15;
        const eta = Math.ceil(unsent * it / 60);
        if (!confirm(`发送 ${unsent} 条弹幕\n模式: ${md} | 字号: ${sz} | 间隔: ${it}s | 预计 ~${eta} 分钟\n\n⚠️ 发送后无法撤回`)) { st('已取消'); return; }

        sending = true; paused = false; cancelled = false; setBtns(true);
        const cfg = { mode: +$('s-md').value, size: +$('s-sz').value, color: +$('s-cl').value };

        for (let i = 0; i < subs.length; i++) {
            while (paused && !cancelled) { st('⏸ 已暂停 · 点击"继续"恢复', 'busy'); await sleep(500); }
            if (cancelled) break;
            const s = subs[i]; if (s.st === 'ok') continue;
            s.st = 'ing'; renderTable(); scrollTo(i);
            try {
                await sendDanmaku(s.text, s.time, cfg);
                s.st = 'ok'; st(`✓ ${fmt(s.time)} ${s.text}`, 'ok');
            } catch (e) { s.st = 'err'; st(`✗ ${fmt(s.time)} ${e.message}`, 'err'); }
            renderTable(); updateCnt(); updateProg();
            if (i < subs.length - 1 && !cancelled && !paused) {
                const rm = Math.ceil((subs.length - i - 1) * it / 60);
                st(`⏳ ${i+1}/${subs.length} · 剩余 ~${rm} 分钟`, 'busy');
                await sleep(it * 1000);
            }
        }
        sending = false; paused = false; setBtns(false);
        const ok = subs.filter(s => s.st === 'ok').length, fail = subs.filter(s => s.st === 'err').length;
        if (!cancelled) st(`✅ 完成 · 成功 ${ok} 条${fail ? ` · 失败 ${fail} 条` : ''}`, 'ok');
    }

    function resetAll() { if (sending) { cancelled = true; paused = false; } subs.forEach(s => s.st = ''); renderTable(); updateCnt(); updateProg(); setBtns(false); st('↺ 已重置'); }
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ===================== 拦截器 =====================

    (function () { const o = XMLHttpRequest.prototype.open, s = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (m, u, ...a) { this._u = u; return o.call(this, m, u, ...a); };
        XMLHttpRequest.prototype.send = function (b) { if (this._u?.includes('danmaku') && this._u?.includes('poll') && b && typeof b === 'string' && window._adsVid) window._adsVid(b); return s.call(this, b); };
    })();

    // ===================== 初始化 =====================

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ui); else ui();
})();
