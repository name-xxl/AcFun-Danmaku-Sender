    // ============================================================
    //  作品视图：保存 / 载入 / 列表 / 重命名 / 删除 / 导出 / 导入
    // ============================================================
    // 理解卡｜我拥有：openWorkPanel（内联浮层。入口按钮在 80-ui 的面板模板 #cf-work-btn，事件绑在 95-events）、
    //   作品列表的渲染、保存表单（新建或覆盖）、载入、重命名、两步删除、导出 JSON、导入 JSON 的类型分流。
    // 我承诺：数据与存储/校验全在 gdm-work.js——本文件只做「取数据 → 画出来 → 把用户的选择交给它」，
    //   状态文案与上限一律取自 gdm-work（不在这里另写第二份）；导出 JSON 复用 90-preset-ui 的 downloadJson
    //   （JSON 下载的唯一实现，本文件不另写一份）；**载入作品前先 workLoad 校验**，校验不过就如实报病灶并收手。
    // 我永不：不新增 confirm(/alert(（硬约束：白名单 3 处只减不增）——删除走两步内联按钮（上膛 + 自动解除）；
    //   不发网络请求；不缓存 models（作品只存源，理由见 gdm-work 头注）；不新增任何 CSS（样式只进 boot.js
    //   的 injectStyle 单点，前缀 #cf-work-panel）。
    // 我永不（彩排）：本片 `rehearsed` 恒为「未彩排」，视图把它**照实显示**，但**不拿它闸任何动作**——
    //   「未彩排不许发送/导出」是闸①（下一片）的事；这里顺手加一道锁会让本片的行为面失控。
    // 改我前读：浮层外壳复用 .cf-dev-panel-mask / .cf-dev-dlg / .cf-dev-foot（与 #cf-dev-panel、
    //   openExportDialog、#cf-ledger-panel 同一范式）；载入后的界面回写走 80-ui 的 refreshEditorFromState
    //   与 90-preset-ui 的 refreshPresetSelect（面板控件的「状态 → 控件」回写点只有那两处，别在这里再写一份）；
    //   导入的类型判别在 gdm-work 的 workImportText（预设 JSON / 别的 JSON / 作品文件各有各的提示）。

import { $, escapeHtml, p2, status } from './20-utils.js';
import {
    applyWork, defaultWorkName, problemsText, workDelete, workExportPayload, workImportAdd,
    workImportText, workList, workLoad, workRename, workSave, workStats, workSubCount,
} from './gdm-work.js';
import { refreshEditorFromState } from './80-ui.js';
import { downloadJson, refreshPresetSelect } from './90-preset-ui.js';

    const DEL_ARM_MS = 5000;   // 删除的二次确认窗口（防手滑留窗，到点自动解除）

    function stamp(ts) {
        const d = new Date(Number(ts) || 0);
        return (d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
    }

    // 文件名里不能有的字符（与 90-preset-ui 导预设同一口径）
    function safeName(name) { return String(name || '作品').replace(/[\\/:*?"<>|]/g, '_'); }

    function presetLabel(w) {
        const id = (w.source && w.source.presetId) || 'none';
        return id === 'none' ? '无预设' : id;
    }

    // 一件作品一行：名称 / 视频 / 条数 / 更新时间 / 彩排标志 + 载入·重命名·导出·删除
    function workRow(w, mask) {
        const row = document.createElement('div');
        row.className = 'cf-wk-item';
        row.dataset.id = w.id;
        row.innerHTML = rowHtml(w);

        row.querySelector('[data-act=use]').addEventListener('click', () => {
            // **先校验后落值**：workLoad 不过就一个字段都不改，如实报病灶（不留半套状态）
            const r = workLoad(w.id);
            if (!r.ok) { status('❌ 作品校验未通过，已拒绝载入：' + problemsText(r.problems), 'err'); return; }
            const a = applyWork(r.work);
            if (!a.ok) { status('⚠ 载入失败（已回滚，编辑器状态未变）：' + problemsText(a.problems), 'err'); render(mask); return; }
            refreshPresetSelect();      // 预设下拉 + 预设区
            refreshEditorFromState();   // 字幕列表 / 样式控件 / 偏移 / 计数行
            const warn = a.warnings.length ? '（⚠ ' + a.warnings.join('；') + '）' : '';
            status('✅ 已载入作品「' + r.work.name + '」（' + workSubCount(r.work) + ' 条字幕 · 预设 ' + presetLabel(r.work) + '）' + warn,
                a.warnings.length ? 'busy' : 'ok');
        });

        row.querySelector('[data-act=export]').addEventListener('click', () => {
            const r = workExportPayload(w.id);
            if (!r.ok) { status('⚠ 导出失败：' + problemsText(r.problems), 'err'); return; }
            downloadJson('作品-' + safeName(r.work.name) + '-' + stamp(Date.now()).replace(/[-: ]/g, '') + '.json', r.payload);
            status('📤 已导出作品「' + r.work.name + '」（' + workSubCount(r.work) + ' 条字幕）', 'ok');
        });

        row.querySelector('[data-act=rename]').addEventListener('click', () => startRename(row, w, mask));

        // 删除：两步内联确认（**不用 confirm(**：白名单 3 处只减不增）。第一次点只是「上膛」，
        // 第二次点才真删；5 秒内没跟上自动解除（防手滑，也防误触）。
        const delBtn = row.querySelector('[data-act=del]');
        let timer = null;
        const disarm = () => {
            if (timer) { clearTimeout(timer); timer = null; }
            delBtn.dataset.armed = '';
            delBtn.classList.remove('armed');
            delBtn.textContent = '🗑 删除';
        };
        delBtn.addEventListener('click', () => {
            if (delBtn.dataset.armed !== '1') {
                delBtn.dataset.armed = '1';
                delBtn.classList.add('armed');
                delBtn.textContent = '⚠ 再点一次确认删除';
                timer = setTimeout(disarm, DEL_ARM_MS);
                return;
            }
            disarm();
            const r = workDelete(w.id);
            if (!r.deleted) { status('⚠ 删除失败：' + r.reason, 'err'); render(mask); return; }
            status(r.ok ? ('🗑 已删除作品「' + w.name + '」') : ('⚠ 已从本页删除，但写入失败：' + r.reason), r.ok ? 'ok' : 'err');
            render(mask);
        });
        return row;
    }

    function rowHtml(w) {
        const vid = (w.vid === '' || w.vid == null) ? '' : String(w.vid);
        const video = vid
            ? '<a class="cf-wk-link" href="https://www.acfun.cn/v/ac' + escapeHtml(vid) + '" target="_blank" rel="noopener">ac' + escapeHtml(vid) + '</a>'
            : '<span class="cf-wk-link">视频 ?</span>';
        // 彩排标志：本片恒为「未彩排」——只显示，不闸任何动作（闸① 才会让它有意义）
        const rehearse = w.rehearsed ? '已彩排' : '未彩排';
        return '<div class="cf-wk-head">'
            + '<span class="cf-wk-name" title="' + escapeHtml(w.name) + '">' + escapeHtml(w.name) + '</span>'
            + '<span class="cf-wk-badge' + (w.rehearsed ? ' done' : '') + '">' + rehearse + '</span>'
            + '</div>'
            + '<div class="cf-wk-meta">' + video
            + ' · ' + workSubCount(w) + ' 条字幕 · 预设 ' + escapeHtml(presetLabel(w))
            + ' · 更新 ' + escapeHtml(stamp(w.updatedAt))
            + '</div>'
            + '<div class="cf-wk-acts">'
            + '<button type="button" class="cf-wk-btn cf-wk-primary" data-act="use">📂 载入</button>'
            + '<button type="button" class="cf-wk-btn" data-act="rename">✎ 重命名</button>'
            + '<button type="button" class="cf-wk-btn" data-act="export">📤 导出</button>'
            + '<button type="button" class="cf-wk-btn cf-wk-danger" data-act="del">🗑 删除</button>'
            + '</div>';
    }

    // 行内重命名：把这一行换成输入框 + 确定/取消（保存后整表重画）
    function startRename(row, w, mask) {
        row.innerHTML = '<div class="cf-wk-head">'
            + '<input type="text" class="cf-wk-nameinput" value="' + escapeHtml(w.name) + '" maxlength="60">'
            + '</div>'
            + '<div class="cf-wk-acts">'
            + '<button type="button" class="cf-wk-btn cf-wk-primary" data-act="rename-ok">✔ 确定</button>'
            + '<button type="button" class="cf-wk-btn" data-act="rename-cancel">取消</button>'
            + '</div>';
        const input = row.querySelector('.cf-wk-nameinput');
        input.value = w.name;   // 显式写值（不只靠 HTML 的 value 属性：属性与属性值两处一份才不易漂）
        const done = (save) => {
            if (!save) { render(mask); return; }
            const r = workRename(w.id, input.value);
            if (!r.renamed) { status('⚠ 重命名失败：' + r.reason, 'err'); return; }
            // renamed 为真但 ok 为假 = 名字在内存里改了、只是没写进存储（刷新会回到旧名）——照实说
            status(r.ok ? ('✎ 已重命名为「' + input.value.trim() + '」')
                : ('⚠ 已改名，但写入存储失败（刷新后会回到旧名）：' + r.reason), r.ok ? 'ok' : 'err');
            render(mask);
        };
        row.querySelector('[data-act=rename-ok]').addEventListener('click', () => done(true));
        row.querySelector('[data-act=rename-cancel]').addEventListener('click', () => done(false));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') done(true);
            else if (e.key === 'Escape') done(false);
        });
        if (input.focus) input.focus();
        if (input.select) input.select();
    }

    function statsText() {
        const st = workStats();
        return '共 ' + st.count + ' 件作品 · 占用约 ' + Math.round(st.bytes / 1024) + 'KB'
            + ' / 上限 ' + st.maxWorks + ' 件 · ' + Math.round(st.maxBytes / 1024) + 'KB（超出按 FIFO 丢弃最旧的）'
            + (st.broken ? ' · ⚠ ' + st.broken + ' 件校验不过已跳过' : '')
            + (st.write.ok ? '' : ' · ⚠ ' + st.write.lastError);
    }

    function render(mask) {
        const statsEl = mask.querySelector('#cf-wk-stats');
        const body = mask.querySelector('#cf-wk-body');
        const st = workStats();
        statsEl.textContent = statsText();
        statsEl.className = 'cf-wk-stats' + (st.write.ok && !st.broken ? '' : ' bad');

        body.innerHTML = '';
        const works = workList();
        if (!works.length) {
            body.innerHTML = '<div class="cf-wk-empty">还没有作品。点下面「💾 保存当前」把当前的字幕、样式、'
                + '时间偏移与激活预设存成一件作品；也可以「📥 导入作品」载入作品 JSON 文件。<br>'
                + '作品只存「源」（字幕 / 样式 / 偏移 / 预设）——展开成弹幕的 models 不存，打开时按源重算。</div>';
            syncSaveTargets(mask);
            return;
        }
        works.forEach((w) => body.appendChild(workRow(w, mask)));
        syncSaveTargets(mask);
    }

    // 保存表单的「覆盖目标」下拉：永远重建（列表可能刚变过）
    function syncSaveTargets(mask) {
        const sel = mask.querySelector('#cf-wk-target');
        if (!sel) return;
        const cur = sel.value;
        sel.innerHTML = '<option value="">＋ 新建一件</option>'
            + workList().map((w) => '<option value="' + escapeHtml(w.id) + '">覆盖：「' + escapeHtml(w.name) + '」</option>').join('');
        // 原目标还在就留着，否则回「新建」
        const still = workList().some((w) => w.id === cur);
        sel.value = still ? cur : '';
        const nameInput = mask.querySelector('#cf-wk-name');
        if (nameInput && !nameInput.value) nameInput.value = defaultWorkName();
    }

    // 打开作品浮层。mask + dlg 范式与 #cf-ledger-panel / openExportDialog 一致，关闭即 remove。
    function openWorkPanel() {
        const old = $('#cf-work-panel');
        if (old) old.remove();
        const mask = document.createElement('div');
        mask.id = 'cf-work-panel';
        mask.className = 'cf-dev-panel-mask';
        mask.innerHTML = `
            <div class="cf-dev-dlg cf-wk-dlg">
                <p class="cf-dev-title">📁 作品</p>
                <p class="cf-dev-sub">把「正在编辑的这一件东西」存下来：字幕 / 样式 / 偏移 / 激活预设与它的参数。
                    可存多件、可导出成 JSON 文件、可导入。作品只存「源」，展开成弹幕在打开时重算——所以文件很小。</p>
                <p class="cf-wk-stats" id="cf-wk-stats"></p>
                <div class="cf-wk-body" id="cf-wk-body"></div>
                <div class="cf-wk-saverow" id="cf-wk-saverow" style="display:none">
                    <div class="cf-wk-saverow-inner">
                        <input type="text" id="cf-wk-name" placeholder="作品名（留空用默认名）" maxlength="60">
                        <select id="cf-wk-target"></select>
                        <button type="button" class="cf-wk-btn cf-wk-primary" data-act="save-ok">✔ 保存</button>
                        <button type="button" class="cf-wk-btn" data-act="save-cancel">取消</button>
                    </div>
                </div>
                <div class="cf-dev-foot">
                    <button type="button" class="cf-wk-btn" data-act="close">关闭</button>
                    <button type="button" class="cf-wk-btn cf-wk-primary" data-act="save">💾 保存当前</button>
                    <button type="button" class="cf-wk-btn" data-act="import">📥 导入作品</button>
                </div>
                <input type="file" id="cf-wk-file" accept=".json,application/json" style="display:none">
            </div>`;
        document.body.appendChild(mask);
        render(mask);

        mask.querySelector('[data-act=close]').addEventListener('click', () => mask.remove());
        mask.addEventListener('click', (e) => { if (e.target === mask) mask.remove(); });

        const saveRow = mask.querySelector('#cf-wk-saverow');
        const nameInput = mask.querySelector('#cf-wk-name');
        const targetSel = mask.querySelector('#cf-wk-target');
        saveRow.style.display = 'none';

        // 「保存当前」：展开保存表单（名称 + 新建/覆盖）。默认名由 gdm-work 给（重名自动加序号）。
        mask.querySelector('[data-act=save]').addEventListener('click', () => {
            saveRow.style.display = '';
            targetSel.value = '';
            nameInput.value = defaultWorkName();
            if (nameInput.focus) nameInput.focus();
        });
        mask.querySelector('[data-act=save-cancel]').addEventListener('click', () => { saveRow.style.display = 'none'; });
        // 切到「覆盖某件」时，名字默认填那件的名字（改不改由用户决定）
        targetSel.addEventListener('change', () => {
            const w = workList().find((x) => x.id === targetSel.value);
            nameInput.value = w ? w.name : defaultWorkName();
        });
        mask.querySelector('[data-act=save-ok]').addEventListener('click', () => {
            const target = targetSel.value;
            const r = workSave(nameInput.value, target ? { id: target } : {});
            if (!r.ok) { status('⚠ 保存失败：' + (r.reason || '未知原因'), 'err'); return; }
            saveRow.style.display = 'none';
            // 超限轮转**必须报出来**：用户的作品被 FIFO 丢掉不是静默的事
            status((r.overwritten ? '💾 已覆盖作品' : '💾 已保存作品') + '「' + r.work.name + '」（' + workSubCount(r.work) + ' 条字幕）'
                + (r.dropped ? '；⚠ 超出上限，已按 FIFO 丢弃最旧的 ' + r.dropped + ' 件' : ''),
                r.dropped ? 'err' : 'ok');
            render(mask);
        });

        // 导入作品：读出文本 → gdm-work 分流（作品文件 / 预设 JSON / 别的 JSON / 坏 JSON）→ 各自提示
        mask.querySelector('[data-act=import]').addEventListener('click', () => mask.querySelector('#cf-wk-file').click());
        mask.querySelector('#cf-wk-file').addEventListener('change', () => {
            const file = mask.querySelector('#cf-wk-file').files[0];
            if (file) readWorkFile(file, mask);
        });
    }

    // 导入一个作品 JSON 文件。**分类提示必须各不相同**（拿预设文件来导作品是最现实的误用）。
    function readWorkFile(file, mask) {
        const r = new FileReader();
        r.onload = () => {
            const res = workImportText(r.result);
            if (!res.ok) {
                status(importErrorText(res), 'err');
                return;
            }
            const add = workImportAdd(res.work);
            if (!add.ok) { status('⚠ 导入写入失败：' + (add.reason || '未知原因'), 'err'); return; }
            render(mask);
            status('📥 已导入作品「' + add.work.name + '」（' + workSubCount(add.work) + ' 条字幕）'
                + (add.renamed ? '；⚠ 已有同名作品，名称已加序号' : '') + (add.dropped ? '；⚠ 已按 FIFO 丢弃最旧的 ' + add.dropped + ' 件' : ''),
                add.dropped ? 'err' : 'ok');
        };
        r.readAsText(file, 'utf-8');
    }

    // 导入失败的提示：**按类型分流**（预设 JSON 与其它错误说的话不一样，且各自指路）
    function importErrorText(res) {
        if (res.kind === 'preset') {
            return '❌ 这是预设 JSON，不是作品文件：预设请到预设面板用「📥 导入预设」；'
                + '作品文件必须带 type:"adl-work" 与 v:1（作品面板「📤 导出」产出的就是这种）。';
        }
        if (res.kind === 'json') {
            return '❌ 作品文件解析失败（不是合法 JSON）：' + problemsText(res.problems);
        }
        if (res.kind === 'unknown') {
            return '❌ 认不出这个 JSON 是什么：' + problemsText(res.problems);
        }
        return '❌ 作品文件校验未通过，已拒绝导入：' + problemsText(res.problems);
    }

// —— ESM 导出（6.8.0 迁移）——
export { openWorkPanel };
// 仅供测试（本片的两条硬要求值得逐条断言）：导入失败的分类提示文本（两种误用的文案必须不同）与统计行文本。
// 生产代码只用 openWorkPanel。条数口径在 gdm-work 的 workSubCount（数据形状的知识不在这里）。
export { importErrorText, statsText };
