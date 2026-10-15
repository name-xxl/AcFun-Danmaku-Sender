    // ============================================================
    //  字幕解析（保留原有 SRT / ASS 逻辑）
    // ============================================================
    // 理解卡｜我拥有：parseSRT / parseASSWithStyles / parseLRC / parseSub（按扩展名分发的唯一入口）。
    // 我承诺：字符串进、{time, endTime?, text, style?, main?, sub?}[] 出；纯函数无 DOM/window（smoke #11 钉住）。
    // 我永不：不读播放器、不碰 UI、不做任何「发送/预览」语义的事。
    // 改我前读：ASS 的 &HAABBGGRR 色与 numpad→A 站锚点映射在 parseASSStyle；LRC 双语靠「/或| 与同时间戳
    //   相邻行」配对；新格式只需在 parseSub 加分发；输出结构变更会波及 50-engine 的 cfgFor 与切片/双语逻辑。

import { DEFAULT_ANCHOR } from './10-constants.js';
import { ass2ms, t2ms } from './20-utils.js';

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
            const si = fmt.indexOf('start'), ti = fmt.indexOf('text'), sty = fmt.indexOf('style');
            let st, body, styleName;
            if (si >= 0 && ti >= 0 && parts.length > ti) {
                st = parts[si].trim();
                body = parts.slice(ti).join(',').trim();
            } else {
                st = (parts[0] || '').trim();
                body = parts.slice((fmt.length || 9) - 1).join(',').trim();
            }
            // 6.9.1 修复（ASS 样式不生效的成因之一）：样式名原先一律取 parts[1]，而标准 Format
            // `Layer, Start, End, Style, Text` 的第 1 列是 Start —— 于是拿 '0:00:01.00' 去查样式表，
            // 必然落空。改为按 Format 定位 style 列。（成因之二是 parseASSStyle 的键名大小写。）
            styleName = (sty >= 0 && parts[sty]) ? parts[sty].trim() : 'Default';
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
        // 注意 style 的键是 parseASSWithStyles 里 `fmt[i].toLowerCase()` 的产物，**一律小写**
        // （name / fontname / fontsize / primarycolour / alignment / bold / italic / underline / shadow / outline）。
        // 6.9.1 修复：原先读的是 style.Fontname / style.Bold / style.PrimaryColour 这类【大写键】，
        // 取值全部落空 —— ASS 文件自带的字体/字号/颜色/粗斜体/描边从未生效，整份走默认值。
        const parsed = {
            font: style.fontname || 'SimHei',
            size: parseInt(style.fontsize, 10) || 24,
            color: parseColor(style.primarycolour) || 0xffffff,
            bold: style.bold === '-1',
            italic: style.italic === '-1',
            underline: style.underline === '-1',
            shadow: style.shadow !== '0',
            stroke: (parseInt(style.outline, 10) || 0) > 0,  // ASS 描边（Outline>0 即有描边）
            anchor: DEFAULT_ANCHOR,
        };
        const a = style.alignment ? parseInt(style.alignment, 10) : 2;
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
        // 6.9.1 修复：原正则 /\.ass[ai]?$/i 只认 .ass / .assa / .assi，而 SSA 的扩展名是 .ssa，
        // 于是 .ssa 掉进下面的 SRT 兜底 —— 产出 0 条且不报错，用户只看到「导入后没反应」。
        if (/\.(?:ass|ssa)$/i.test(name)) return parseASSWithStyles(text);
        return parseSRT(text);
    }

// —— ESM 导出（6.8.0 迁移：parseColor 供冒烟测试对拍，parseSub 供 80-ui/90-preset-ui 导入字幕）——
export { parseColor, parseSub };

