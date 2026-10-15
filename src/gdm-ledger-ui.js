    // ============================================================
    //  闸④ 台账视图（作品管理）：按视频回查 + 诚实的清理引导
    // ============================================================
    // 理解卡｜我拥有：openLedgerPanel（内联浮层。入口按钮在 80-ui 的面板模板 #cf-ledger-btn，事件绑在 95-events）、
    //   按视频分组的渲染、导出 JSON、清空台账的两步内联确认、清理引导文案。
    // 我承诺：视图只读台账 + 引导，绝不改动已发送的弹幕；导出 JSON 复用 90-preset-ui 的 downloadJson
    //   （JSON 导出的唯一实现，本文件不另写一份）；清空走两步内联按钮；台账为空给明确空态文案。
    // 我永不：**不做任何自动删除的尝试**——A 站没有删除接口（API.md §十一 列的 8 个弹幕接口里没有 delete，
    //   §九 末亦记「预览残留无法按 id 删除」），本文件只有「请到视频页手动删除」这句引导 + 核对清单；
    //   不新增 confirm(/alert(（硬约束：白名单 3 处只减不增）；不发网络请求；不把「未在池中查到」显示成失败。
    // 改我前读：台账的存储/上限/轮转/状态语义全在 gdm-ledger.js——状态文案一律取自 ledgerStatusLabel，
    //   不在这里另写第二份（改口径只改那一处）；样式加在 boot.js 的 injectStyle 单点（前缀 #cf-ledger-panel）；
    //   浮层外壳复用 .cf-dev-panel-mask / .cf-dev-dlg / .cf-dev-foot（与 openExportDialog、#cf-dev-panel 同一范式）。

import { IDENTITY_OTHER } from './10-constants.js';
import { $, escapeHtml, status } from './20-utils.js';
import {
    fmtStamp, ledgerByVideo, ledgerChecklistText, ledgerClear, ledgerList, ledgerStats,
    ledgerStatusLabel, ledgerStatusOf,
} from './gdm-ledger.js';
import { downloadJson } from './90-preset-ui.js';

    const CLEAR_ARM_MS = 5000;   // 清空的二次确认窗口（防手滑留窗，到点自动解除）

    // 清理引导（诚实版）：先说清「本工具删不掉」，再给手动路径与核对清单。
    // 「2 条/分钟」这类速率数字在这里**不写**——API.md 与 RISKS.md 都没有出处，速率限制未知。
    // 6.16.0：这一组的记录若落在**他人的视频**上，先加一句——批量清理他人的作品更该先跟 UP 主说明。
    function guideText(video) {
        const id = String(video.vid == null ? '' : video.vid);
        const otherCount = (video.entries || []).filter((e) => e.identity === IDENTITY_OTHER).length;
        const ownNote = otherCount
            ? '<b>⚠ 这 ' + otherCount + ' 条发在<b>他人的视频</b>上</b>：清理（或保留）之前建议先与 UP 主说明一下，'
                + '别让 UP 主在自己作品下看到一批来路不明的弹幕。<br>'
            : '';
        return ownNote + '<b>本工具无法删除已发送的弹幕</b>：A 站没有提供删除接口（API.md §十一 列的弹幕接口里没有 delete，'
            + '§九 末亦记「预览残留无法按 id 删除」）。清理只能手动，路径是：'
            + '① 点上方 ac' + escapeHtml(id) + ' 的链接打开视频页 → ② 在画面上定位该条（下方清单给了时间/内容/danmakuId）'
            + '→ ③ 用 A 站的弹幕管理入口手动删除。<br>'
            + '<b>速率限制未知</b>：本工具不掌握 A 站的删除/发送速率上限（API.md 与 RISKS.md 均无出处），'
            + '批量清理请自己把握节奏。<br>'
            + '<b>状态只是「我们看见过没有」</b>：待审核（未确认）= 发送成功但全片扫描还没查到（审核延迟或接口受限都会这样），'
            + '<b>不等于失败</b>。下面是本视频的核对清单，可直接复制：';
    }

    function itemHtml(e) {
        const label = ledgerStatusLabel(e);
        const cls = ledgerStatusOf(e) === 'verified' ? 'verified' : 'pending';
        const id = e.danmakuId ? '#' + escapeHtml(e.danmakuId) : '未返回 id';
        return '<div class="cf-lg-item">'
            + '<span class="cf-lg-badge ' + cls + '">' + escapeHtml(label) + '</span>'
            + '<span class="cf-lg-time">' + escapeHtml(fmtStamp(e.sentAt)) + '</span>'
            + '<span class="cf-lg-content" title="' + escapeHtml(e.content) + '">' + escapeHtml(e.content) + '</span>'
            + '<span class="cf-lg-id">' + id + '</span>'
            + '</div>';
    }

    function videoBlock(group) {
        const box = document.createElement('div');
        box.className = 'cf-lg-video';
        // 身份标记（6.16.0）：该视频的记录里有「发送时判定为他人视频」的 → 在分组头上打标。
        // 一个分组 = 一个视频，身份通常一致；早期条目可能是 unknown（那时还没这功能），故按条数写。
        const otherCount = group.entries.filter((e) => e.identity === IDENTITY_OTHER).length;
        const head = group.url
            ? '<a class="cf-lg-link" href="' + escapeHtml(group.url) + '" target="_blank" rel="noopener">ac'
                + escapeHtml(String(group.vid)) + '</a>'
            : '<span class="cf-lg-link">视频 ' + escapeHtml(String(group.vid)) + '（无 id）</span>';
        box.innerHTML = '<div class="cf-lg-head">'
            + head
            + '<span class="cf-lg-meta">' + group.count + ' 条 · 已确认 ' + group.verifiedCount
            + ' · ' + escapeHtml(fmtStamp(group.firstAt)) + ' ~ ' + escapeHtml(fmtStamp(group.lastAt))
            + (otherCount ? ' · <b class="cf-lg-other">⚠ 他人的视频 ' + otherCount + '/' + group.count + ' 条</b>' : '')
            + '</span>'
            + '<button type="button" class="cf-lg-btn" data-act="guide">🧹 清理引导</button>'
            + '</div>'
            + '<div class="cf-lg-guide" style="display:none"></div>'
            + '<div class="cf-lg-list">' + group.entries.map(itemHtml).join('') + '</div>';

        const btn = box.querySelector('[data-act=guide]');
        const guide = box.querySelector('.cf-lg-guide');
        // 开合状态记在闭包里，不去读 style.display——DOM 属性一旦没按预期落上（或样式被外部改动），
        // 「读回来判方向」会让按钮反着走；闭包里那份是唯一真源。
        let open = false;
        btn.addEventListener('click', () => {
            open = !open;
            if (!open) { guide.style.display = 'none'; btn.textContent = '🧹 清理引导'; return; }
            // 引导 + 核对清单（textarea 只读：可选中复制，不依赖剪贴板权限）
            guide.innerHTML = '<div class="cf-lg-guide-text">' + guideText(group) + '</div>'
                + '<textarea class="cf-lg-checklist" readonly spellcheck="false"></textarea>';
            guide.querySelector('.cf-lg-checklist').value = ledgerChecklistText(group.entries);
            guide.style.display = '';
            btn.textContent = '▲ 收起引导';
        });
        return box;
    }

    function renderLedger(mask) {
        const statsEl = mask.querySelector('#cf-lg-stats');
        const body = mask.querySelector('#cf-lg-body');
        const st = ledgerStats();
        statsEl.textContent = '共 ' + st.count + ' 条（已确认可见 ' + st.verified + ' · 待审核 '
            + (st.count - st.verified) + '）· 占用约 ' + Math.round(st.bytes / 1024) + 'KB'
            + ' / 上限 ' + st.maxEntries + ' 条 · ' + Math.round(st.maxBytes / 1024) + 'KB'
            + (st.write.ok ? '' : ' · ⚠ ' + st.write.lastError);
        statsEl.className = 'cf-lg-stats' + (st.write.ok ? '' : ' bad');

        body.innerHTML = '';
        const groups = ledgerByVideo();
        if (!groups.length) {
            body.innerHTML = '<div class="cf-lg-empty">台账为空：还没有记录到发送成功的弹幕。<br>'
                + '发送一次之后回到这里，就能看到每条弹幕的时间、内容、danmakuId 与状态。</div>';
            return;
        }
        groups.forEach((g) => body.appendChild(videoBlock(g)));
    }

    // 打开台账浮层。mask + dlg 范式与 openExportDialog / #cf-dev-panel 一致，关闭即 remove。
    function openLedgerPanel() {
        const old = $('#cf-ledger-panel');
        if (old) old.remove();
        const mask = document.createElement('div');
        mask.id = 'cf-ledger-panel';
        mask.className = 'cf-dev-panel-mask';
        mask.innerHTML = `
            <div class="cf-dev-dlg cf-lg-dlg">
                <p class="cf-dev-title">📋 发送台账（闸④）</p>
                <p class="cf-dev-sub">每次发送成功的弹幕逐条记录（时间 / 内容 / danmakuId / 视频）。
                    <b>本工具不能删除已发送的弹幕</b>——A 站没有删除接口，清理要你到视频页手动做（点各视频右侧的「🧹 清理引导」）。</p>
                <p class="cf-lg-stats" id="cf-lg-stats"></p>
                <div class="cf-lg-body" id="cf-lg-body"></div>
                <div class="cf-dev-foot">
                    <button type="button" class="cf-lg-btn" data-act="close">关闭</button>
                    <button type="button" class="cf-lg-btn" data-act="export">📤 导出 JSON</button>
                    <button type="button" class="cf-lg-btn cf-lg-danger" data-act="clear">🗑 清空台账</button>
                </div>
            </div>`;
        document.body.appendChild(mask);
        renderLedger(mask);

        mask.querySelector('[data-act=close]').addEventListener('click', () => mask.remove());
        mask.addEventListener('click', (e) => { if (e.target === mask) mask.remove(); });

        mask.querySelector('[data-act=export]').addEventListener('click', () => {
            const entries = ledgerList();
            if (!entries.length) { status('台账为空，没有可导出的记录', 'err'); return; }
            const st = ledgerStats();
            // 导出带元信息的信封：接收方（或你自己存档）能看到导出时刻、上限与条数口径
            downloadJson('弹幕台账-' + fmtStamp(Date.now()).replace(/[-: ]/g, '') + '.json', {
                exportedAt: Date.now(),
                exportedAtText: fmtStamp(Date.now()),
                count: entries.length,
                limits: { maxEntries: st.maxEntries, maxBytes: st.maxBytes },
                note: '本工具无法删除已发送的弹幕：A 站没有删除接口（API.md §十一 / §九 末），清理只能到视频页手动做。'
                    + '「待审核（未确认）」不等于失败——审核延迟或接口受限都会让全片扫描查不到。',
                entries,
            });
            status('📤 已导出台账 ' + entries.length + ' 条', 'ok');
        });

        // 清空：两步内联确认（**不用 confirm(**：白名单 3 处只减不增）。第一次点只是「上膛」，
        // 第二次点才真清；5 秒内没跟上自动解除（防手滑，也防误触）。
        const clearBtn = mask.querySelector('[data-act=clear]');
        let timer = null;
        const disarm = () => {
            if (timer) { clearTimeout(timer); timer = null; }
            clearBtn.dataset.armed = '';
            clearBtn.classList.remove('armed');
            clearBtn.textContent = '🗑 清空台账';
        };
        clearBtn.addEventListener('click', () => {
            if (clearBtn.dataset.armed !== '1') {
                clearBtn.dataset.armed = '1';
                clearBtn.classList.add('armed');
                clearBtn.textContent = '⚠ 再点一次确认清空（' + ledgerStats().count + ' 条）';
                timer = setTimeout(disarm, CLEAR_ARM_MS);
                return;
            }
            disarm();
            const r = ledgerClear();
            renderLedger(mask);
            status(r.ok ? ('🗑 已清空台账（' + r.cleared + ' 条）') : '⚠ 台账清空失败（localStorage 写入被拒）', r.ok ? 'ok' : 'err');
        });
    }

// —— ESM 导出（6.8.0 迁移）——
export { openLedgerPanel };
