    // ============================================================
    //  离线预览（Canvas 自绘，不依赖 A 站渲染器）
    // ============================================================

    // 缓动进度：timingFunction → 归一化进度。
    // 支持 CSS 关键字（linear/ease-*）与 cubic-bezier(x1,y1,x2,y2) 字符串；
    // 未知值一律回落 linear。
    function cubicBezierXY(t, p1, p2) {
        const mt = 1 - t;
        return 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t;
    }
    function cubicBezierDX(t, p1, p2) {
        const mt = 1 - t;
        return 3 * mt * mt * p1 + 6 * mt * t * (p2 - p1) + 3 * t * t * (1 - p2);
    }
    function easeProgress(t, fn) {
        if (fn && fn.indexOf('cubic-bezier') === 0) {
            const m = /^cubic-bezier\(\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*\)$/.exec(fn);
            if (!m) return t;
            const x1 = parseFloat(m[1]), y1 = parseFloat(m[2]), x2 = parseFloat(m[3]), y2 = parseFloat(m[4]);
            // 牛顿迭代求 x(u) = t 的参数 u（x1/x2∈[0,1] 时 x(u) 单调），再回代求 y(u)。
            // 平缓区曲线（如 (1,0,0,1) 在 u=0.5 处导数为 0）会让牛顿一步跨出 [0,1] 而发散，
            // 出界/停滞即放弃牛顿，改用二分（单调性保证收敛）。
            let u = t, ok = false;
            for (let i = 0; i < 8; i++) {
                const dx = cubicBezierXY(u, x1, x2) - t;
                if (Math.abs(dx) < 1e-6) { ok = true; break; }
                const d = cubicBezierDX(u, x1, x2);
                if (Math.abs(d) < 1e-6) break;
                const un = u - dx / d;
                if (un < 0 || un > 1) break;
                u = un;
            }
            if (!ok) {
                let lo = 0, hi = 1;
                for (let i = 0; i < 32; i++) {
                    u = (lo + hi) / 2;
                    if (cubicBezierXY(u, x1, x2) < t) lo = u; else hi = u;
                }
            }
            return cubicBezierXY(u, y1, y2);
        }
        switch (fn) {
            case 'linear': return t;
            case 'ease-in': return t * t;
            case 'ease-out': return t * (2 - t);
            case 'ease-in-out': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            default: return t;
        }
    }

    function lerp(a, b, t) { return a + (b - a) * t; }

    // 把 model 在 elapsedMs（相对 startTime）处的绘制状态算出来。
    // 多段 animationFrames 按 moveTime 累加定位当前段，段内按 timingFunction 插值。
    // 返回 { x, y, scaleX, scaleY, rotateX, rotateY, rotateZ }；不可见 / 越界返回 null。
    function interpolateModel(model, elapsedMs) {
        if (!model || elapsedMs < 0) return null;
        const frames = model.animationFrames || [];
        if (!frames.length) return null;
        let acc = 0;
        for (const f of frames) {
            const mt = f.moveTime || 0;
            if (elapsedMs < acc + mt || mt <= 0) {
                const p = mt > 0 ? Math.max(0, Math.min(1, (elapsedMs - acc) / mt)) : 1;
                const e = easeProgress(p, f.timingFunction || 'linear');
                return {
                    x: lerp(f.from.pos.x, f.to.pos.x, e),
                    y: lerp(f.from.pos.y, f.to.pos.y, e),
                    scaleX: lerp(f.from.scale.x, f.to.scale.x, e),
                    scaleY: lerp(f.from.scale.y, f.to.scale.y, e),
                    rotateX: lerp(f.from.rotate.x, f.to.rotate.x, e),
                    rotateY: lerp(f.from.rotate.y, f.to.rotate.y, e),
                    rotateZ: lerp(f.from.rotate.z, f.to.rotate.z, e),
                };
            }
            acc += mt;
        }
        return null;
    }

    // ============================================================
    //  Canvas 渲染器：把 model[] 自绘到覆盖在视频上的画布
    //  （不依赖 A 站渲染器；时钟跟随播放器 currentTime）
    // ============================================================

    let offlineCanvas = null;
    let offlineCtx = null;
    let offlineVideo = null;
    let offlineModels = [];     // 当前预览的 model 列表
    let offlineRaf = null;
    let offlineDpr = 1;         // 当前 devicePixelRatio（retina 清晰度）
    let offlineCssW = 0;        // 画布 CSS 尺寸（逻辑像素）
    let offlineCssH = 0;

    // 挂载画布到视频画面容器（container-video），并精确对齐 <video> 元素的实际画面区域。
    // A 站视频画面 = player.$video；其父级 .container-video 是 relative 定位上下文。
    function ensureOfflineCanvas() {
        if (offlineCanvas && offlineCanvas.parentNode) return offlineCanvas;
        const p = getPlayer();
        const video = p && p.$video;
        const host = (video && video.parentNode)
            || document.querySelector('.container-video')
            || document.body;
        offlineVideo = video || null;
        offlineCanvas = document.createElement('canvas');
        offlineCanvas.id = 'cf-offline-preview';
        offlineCanvas.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:1000;';
        offlineCtx = offlineCanvas.getContext('2d');
        host.appendChild(offlineCanvas);
        return offlineCanvas;
    }

    // 对齐：让 canvas 精确覆盖 <video> 画面（而非整个 container-video，后者高度含黑边，
    // 用 video 画面尺寸才与 A 站 pos.x/pos.y 百分比坐标系一致）。
    // 像素尺寸乘 devicePixelRatio，避免 retina 屏发虚。
    function alignOfflineCanvas() {
        const c = offlineCanvas;
        if (!c || !c.parentNode) return;
        let left = 0, top = 0, w = 0, h = 0;
        if (offlineVideo) {
            const hr = c.parentNode.getBoundingClientRect();
            const vr = offlineVideo.getBoundingClientRect();
            left = vr.left - hr.left;
            top = vr.top - hr.top;
            w = vr.width;
            h = vr.height;
        } else {
            const r = c.parentNode.getBoundingClientRect();
            w = r.width; h = r.height;
        }
        w = Math.max(1, w); h = Math.max(1, h);
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        c.style.left = left + 'px';
        c.style.top = top + 'px';
        c.style.width = w + 'px';
        c.style.height = h + 'px';
        const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
        if (c.width !== pw) c.width = pw;
        if (c.height !== ph) c.height = ph;
        offlineDpr = dpr;
        offlineCssW = w;
        offlineCssH = h;
    }

    function drawModel(ctx, model, frame, cw, ch) {
        const ws = model.wordStyle || {};
        const text = model.content || '';
        const size = ws.size || 24;
        const family = ws.font || 'SimHei';
        ctx.save();
        ctx.font = (ws.bold ? 'bold ' : '') + size + 'px ' + family;
        // fillText 不渲染 \n，多行字幕（SRT/ASS 的 {\N}）需按行拆画；行高对齐 A 站 line-height = fontSize
        const lines = text.split('\n');
        const lineHeight = size;
        const blockH = lines.length * lineHeight;
        const x = frame.x / 100 * cw;
        const y = frame.y / 100 * ch;
        const anchor = model.anchor == null ? 4 : model.anchor;
        const col = anchor % 3, row = Math.floor(anchor / 3);
        // 锚点对齐交给 canvas 原生 textAlign/textBaseline（与 A 站 transform-origin 九宫格一致）
        ctx.translate(x, y);
        ctx.scale(frame.scaleX, frame.scaleY);
        ctx.rotate(frame.rotateZ * Math.PI / 180);
        ctx.textAlign = col === 0 ? 'left' : col === 1 ? 'center' : 'right';
        ctx.textBaseline = 'middle';
        // 文本块垂直对齐：row 0=顶 1=中 2=底
        const yStart = row === 0 ? 0 : row === 1 ? -blockH / 2 : -blockH;
        if (ws.stroke !== false) {
            ctx.lineWidth = Math.max(1, size / 12);
            ctx.strokeStyle = '#000000';
        }
        for (let i = 0; i < lines.length; i++) {
            if (ws.stroke !== false) ctx.strokeText(lines[i], 0, yStart + (i + 0.5) * lineHeight);
        }
        if (ws.shadow) {
            ctx.shadowColor = ws.shadow.color || '#000000';
            ctx.shadowBlur = ws.shadow.blur || 0;
            ctx.shadowOffsetX = ws.shadow.x || 0;
            ctx.shadowOffsetY = ws.shadow.y || 0;
        }
        ctx.fillStyle = ws.color || '#ffffff';
        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], 0, yStart + (i + 0.5) * lineHeight);
        }
        ctx.restore();
    }

    function renderOfflineFrame() {
        const c = offlineCanvas;
        if (!c || !offlineCtx) return;
        const p = getPlayer();
        // 时间源优先 <video>.currentTime（原生、随视频帧实时更新），player.currentTime 可能有缓存滞后
        const src = (p && p.$video && typeof p.$video.currentTime === 'number') ? p.$video : p;
        const now = (src && typeof src.currentTime === 'number') ? src.currentTime * 1000 : 0;
        alignOfflineCanvas();
        const cw = offlineCssW || c.width, ch = offlineCssH || c.height;
        offlineCtx.setTransform(offlineDpr || 1, 0, 0, offlineDpr || 1, 0, 0);
        offlineCtx.clearRect(0, 0, cw, ch);
        for (const m of offlineModels) {
            const frame = interpolateModel(m, now - m.startTime);
            if (frame) drawModel(offlineCtx, m, frame, cw, ch);
        }
    }

    function startOfflinePreview(models) {
        offlineModels = models || [];
        ensureOfflineCanvas();
        if (offlineRaf) cancelAnimationFrame(offlineRaf);
        const loop = () => { renderOfflineFrame(); offlineRaf = requestAnimationFrame(loop); };
        offlineRaf = requestAnimationFrame(loop);
    }

    function stopOfflinePreview() {
        if (offlineRaf) { cancelAnimationFrame(offlineRaf); offlineRaf = null; }
        offlineModels = [];
        if (offlineCtx && offlineCanvas) {
            offlineCtx.setTransform(1, 0, 0, 1, 0, 0);
            offlineCtx.clearRect(0, 0, offlineCanvas.width, offlineCanvas.height);
        }
    }
