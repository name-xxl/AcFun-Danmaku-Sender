    // ============================================================
    //  字幕解析（保留原有 SRT / ASS 逻辑）
    // ============================================================

    function parseSRT(t) {
        t = t.replace(/^﻿/, '');
        const out = [];
        for (const b of t.trim().split(/\n\s*\n/)) {
            const ls = b.trim().split('\n');
            const ti = ls.findIndex((l) => l.includes('-->'));
            if (ti < 0) continue;
            const parts = ls[ti].split('-->');
            const ms = t2ms(parts[0].trim());
            const endMs = t2ms((parts[1] || '').trim());
            const txt = ls.slice(ti + 1).join('\n').trim();
            if (ms !== null && txt) out.push({ time: ms, endTime: endMs, text: txt });
        }
        return out.sort((a, b) => a.time - b.time);
    }

    function parseASSWithStyles(t) {
        t = t.replace(/^﻿/, '');
        const out = [];
        let on = false, fmt = [];
        const styles = {};

        for (const raw of t.split('\n')) {
            const l = raw.trim();
            if (/^\[V4\+? Styles\]$/i.test(l)) { on = true; continue; }
            if (/^\[.+\]$/i.test(l) && on) break;
            if (!on) continue;
            if (l.startsWith('Format:')) { fmt = l.slice(7).split(',').map((f) => f.trim().toLowerCase()); continue; }
            if (!l.startsWith('Style:')) continue;
            const parts = l.slice(6).split(',');
            const style = {};
            for (let i = 0; i < fmt.length && i < parts.length; i++) style[fmt[i]] = parts[i].trim();
            styles[parts[0].trim()] = style;
        }

        on = false; fmt = [];
        for (const raw of t.split('\n')) {
            const l = raw.trim();
            if (/^\[Events\]$/i.test(l)) { on = true; continue; }
            if (/^\[.+\]$/i.test(l) && on) break;
            if (!on) continue;
            if (l.startsWith('Format:')) { fmt = l.slice(7).split(',').map((f) => f.trim().toLowerCase()); continue; }
            if (!l.startsWith('Dialogue:')) continue;
            const parts = l.slice(9).split(',');
            const si = fmt.indexOf('start'), ti = fmt.indexOf('text');
            let st, body, styleName;
            if (si >= 0 && ti >= 0 && parts.length > ti) {
                st = parts[si].trim();
                body = parts.slice(ti).join(',').trim();
                styleName = parts[1] ? parts[1].trim() : 'Default';
            } else {
                st = (parts[0] || '').trim();
                body = parts.slice((fmt.length || 9) - 1).join(',').trim();
                styleName = parts[1] ? parts[1].trim() : 'Default';
            }
            body = body.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').replace(/\\n/g, '\n').trim();
            const ms = ass2ms(st);
            // 保留全部行：{\N} 硬换行的多行对白不再只取首行。
            // 文本里的 \n 与 SRT 多行一致，后续由拆分引擎的「按行拆」处理；
            // 不拆时整段作为一条弹幕原样发送。
            if (ms !== null && body) {
                out.push({ time: ms, text: body, style: parseASSStyle(styles[styleName] || {}) });
            }
        }
        return out.sort((a, b) => a.time - b.time);
    }

    function parseASSStyle(style) {
        const parsed = {
            font: style.Fontname || 'SimHei',
            size: parseInt(style.Fontsize, 10) || 24,
            color: parseColor(style.PrimaryColour) || 0xffffff,
            bold: style.Bold === '-1',
            italic: style.Italic === '-1',
            underline: style.Underline === '-1',
            shadow: style.Shadow !== '0',
            stroke: (parseInt(style.Outline, 10) || 0) > 0,  // ASS 描边（Outline>0 即有描边）
            anchor: DEFAULT_ANCHOR,
        };
        const a = style.Alignment ? parseInt(style.Alignment, 10) : 2;
        // ASS numpad 对齐 → A 站锚点 0~8
        parsed.anchor = ({ 1: 6, 2: 7, 3: 8, 4: 3, 5: 4, 6: 5, 7: 0, 8: 1, 9: 2 })[a] ?? DEFAULT_ANCHOR;
        return parsed;
    }

    function parseColor(colorStr) {
        // ASS 颜色格式 &HAABBGGRR（AA 为 alpha，可能省略），末尾 & 是 libass 认可的可选后缀。
        // 用捕获组取出纯 hex（不含 &H 前缀与尾随 &），再取后 6 位 BBGGRR。
        const m = /^&H([0-9A-Fa-f]{6,8})&?$/.exec(colorStr || '');
        if (!m) return 0xffffff;
        const hex = m[1].slice(-6);
        const r = parseInt(hex.slice(4, 6), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(0, 2), 16);
        return (r << 16) | (g << 8) | b;
    }

    // LRC 歌词解析：支持 [mm:ss.xx] 和 [mm:ss.xxx] 时间标签，
    // 一行多个时间标签会展开成多条；无结束时间，靠相邻行时间差反推（由 calcDurationMs 处理）
    // 双语支持：同一行用 / 或 | 分隔，或同一时间戳相邻两行，会拆成 main / sub 两个字段
    function parseLRC(t) {
        t = t.replace(/^﻿/, '');
        const raw = [];
        for (const line of t.split('\n')) {
            const l = line.trim();
            if (!l) continue;
            const tags = [...l.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
            if (!tags.length) continue;
            const text = l.replace(/\[[^\]]*\]/g, '').trim();
            if (!text) continue;
            for (const tag of tags) {
                const mm = parseInt(tag[1], 10);
                const ss = parseInt(tag[2], 10);
                let frac = tag[3] || '0';
                if (frac.length === 1) frac += '00';
                else if (frac.length === 2) frac += '0';
                const ms = mm * 60000 + ss * 1000 + parseInt(frac.slice(0, 3), 10);
                raw.push({ time: ms, text });
            }
        }
        raw.sort((a, b) => a.time - b.time);

        // 1) 同一行内 / 或 | 分隔的双语，拆成 main / sub
        const out = [];
        for (const r of raw) {
            const parts = r.text.split(/\s*[/|]\s*/).filter((s) => s.trim());
            if (parts.length === 2) {
                out.push({ time: r.time, text: parts[0] + ' / ' + parts[1], main: parts[0], sub: parts[1] });
            } else {
                out.push({ time: r.time, text: r.text });
            }
        }

        // 2) 同一时间戳相邻两行（中文一行、外文一行），配对成 main / sub
        const merged = [];
        let i = 0;
        while (i < out.length) {
            const cur = out[i];
            const next = out[i + 1];
            if (cur.main == null && cur.sub == null && next && next.main == null && next.sub == null && next.time === cur.time) {
                merged.push({ time: cur.time, text: cur.text + ' / ' + next.text, main: cur.text, sub: next.text });
                i += 2;
            } else {
                merged.push(cur);
                i += 1;
            }
        }
        return merged;
    }

    function parseSub(text, name) {
        if (/\.lrc$/i.test(name)) return parseLRC(text);
        if (/\.ass[ai]?$/i.test(name)) return parseASSWithStyles(text);
        return parseSRT(text);
    }

