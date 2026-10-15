    // ============================================================
    //  发送前审计：闸②（输出 lint 前置）+ 闸③（计数/量级显性化）
    // ============================================================
    // 理解卡｜我拥有：auditSend（展开 + 计数 + lint 的唯一落点）、poolImpact（池影响分级）、
    //   estimatedSendMs（发送耗时估算）、SEND_CONFIRM_MODEL_THRESHOLD（大批量二次确认阈值）。
    // 我承诺：auditSend 是**近纯**函数——只读入参 + 40-core/50-engine 的活绑定（cfgFor 读 currentStyleConfig、
    //   calcDurationMs 读模块级 subs，与 startSend 同源），不写状态、不抛错（lint 与展开抛错都在函数内收口）；
    //   展开参数与 80-ui/startSend 原有循环**逐字相同**（seq = k+1、prevTime = k > 0 ? targets[k-1].time : null）。
    // 我永不：不碰 DOM（UI 只读取本模块的返回）；不发网络；不因「展开抛错」推倒既有语义（照旧按 1 条计入）。
    // 改我前读：① 本模块必须坐在 50-engine 之上——gdm-model **不能** import 50-engine（成环，check-deps 立刻红），
    //   所以 auditSend 放不进 gdm-model；② expandSub 必须【import 活绑定后直接调用】，别在文件顶层解构成局部
    //   变量（smoke #15 会给 50-engine 的 expandSub 装替身，解构后替身看不见）；③ calcDurationMs(idx) 读的
    //   是 40-core 的模块级 subs，故入参 subs 必须与 40-core.subs 是同一份（startSend 里本来就是同一份；
    //   单测用 setSubs 对齐），否则「第 idx 条的下一句时间」会取错——这是本模块唯一的近纯妥协点。

import { MODEL_SEND_INTERVAL } from './10-constants.js';
import { num } from './40-core.js';
import { lintModel } from './gdm-model.js';
import { calcDurationMs, cfgFor, expandSub } from './50-engine.js';

    // ============================================================
    //  闸③ 的数字：阈值与分级（数值依据写在常量旁，不给魔法数）
    // ============================================================
    // 发送真实耗时 = Σ(每句 model 数 × 句内 80ms 节流) + (句数-1) × 句间 sendInterval（默认 400ms）
    //   + 网络往返（真机每条约 100–300ms，不在估算内）。
    //   故「modelCount × 80ms」是发送**下界**，也是"这批有多大"最好的一把尺子——两个常量都按它定。

    // 池影响分级（粗粒度标签，给用户一眼看出这批对弹幕池的冲击量级）：
    //   低 ≤ 400  → 下界 ~32 秒连续写入。无预设的一整集字幕（50–100 条 = 50–100 条 model）**远在这一档内**
    //               （8 秒以内）；这一档收的是「拆字预设但只发十几到三十来句」和「无预设的任意长度」。
    //   中 ≤ 2000 → 下界 ~33 秒 ~ 2 分 40 秒：拆字预设下一集中段到接近整集的量（竖排 ≈ 30–150 句、
    //               KTV ≈ 15–73 句，按实测的 13.67 / 27.33 条·每句换算）。
    //   高  > 2000 → 下界超过 2 分 40 秒的连续写入，风控面暴露显著（RISKS R3）。
    // 依据：实测「一集」的字幕量级是 50–100 条，而展开倍率由预设决定（无预设 1×、竖排 13.67×、
    //   KTV 27.33×，见 test/unit/send-audit.test.mjs 的标定输出）——两级分界就落在「无预设整集永不进中档」
    //   与「拆字整集会进中/高」之间，用户不必换算就能对上自己的场景。
    const POOL_IMPACT_BANDS = [
        { level: 'low', label: '低', max: 400, note: '下界 ≈ 32 秒以内的连续发送（无预设的整集、或拆字预设的十几句）' },
        { level: 'mid', label: '中', max: 2000, note: '下界 ≈ 33 秒 ~ 2 分 40 秒（拆字预设下一集中段到整集的量）' },
        { level: 'high', label: '高', max: Infinity, note: '下界 > 2 分 40 秒的连续写入，风控面暴露显著' },
    ];

    // 大批量二次确认阈值：**1000 条 model**（下界 ≈ 80 秒连续发送）。
    // 上游建议的 50 按真实展开量校准后否决——50 太靠前，会把「无预设 + 50 条字幕」这种最日常的一次
    // 导出也拖进二次确认（首次 confirm 已经报过计数，再拦一次是骚扰，不是把关）。
    // 取 1000 的依据（三端夹逼，实测见 test/unit/send-audit.test.mjs）：
    //   ① 无预设路径：1000 = **1000 条字幕**——单集字幕量的 10 倍以上，属异常输入，值得拦；
    //   ② 拆字路径（竖排 1×/字、KTV 2×/字 → 实测 13.67 / 27.33 条·每句）：1000 条 ≈ **竖排 73 句 / KTV 37 句**，
    //      即「一集中段到整集」的拆发量——正是 A 站弹幕规范提示（isCharSplitComposition）要管的场景；
    //   ③ 耗时：1000 × 80ms ≈ 80 秒，越过「一次点击等一下」的心理线，用户此刻确实应该被告知总时长。
    // 与分级的关系：1000 落在「中」段（400–2000）的中后部——二次确认与「池影响 中」同时出现，两者不打架。
    const SEND_CONFIRM_MODEL_THRESHOLD = 1000;

    // 按 modelCount 取池影响分级（粗粒度标签，超出上界即最高档）
    function poolImpact(modelCount) {
        const n = Math.max(0, Math.round(num(modelCount)));
        for (let i = 0; i < POOL_IMPACT_BANDS.length; i++) {
            if (n <= POOL_IMPACT_BANDS[i].max) {
                const b = POOL_IMPACT_BANDS[i];
                return { level: b.level, label: b.label, note: b.note, modelCount: n };
            }
        }
    }

    // 发送耗时下界估算（ms）：句内每条 80ms 节流（MODEL_SEND_INTERVAL）+ 句间 sendInterval。
    // 不算网络往返，所以是下界——UI 文案里必须写「至少 / 约」，不能写成预计完成时间。
    function estimatedSendMs(modelCount, subtitleCount, intervalMs) {
        const n = Math.max(0, Math.round(num(modelCount)));
        const s = Math.max(0, Math.round(num(subtitleCount)));
        const gap = Math.max(0, Math.round(num(intervalMs)));
        return n * MODEL_SEND_INTERVAL + Math.max(0, s - 1) * gap;
    }

    // ============================================================
    //  闸② 的落点：展开 + 计数 + lint（一遍展开同时产出两样东西）
    // ============================================================
    // auditSend(targets, subs) →
    //   {
    //     subtitleCount,                     // 本次要发的字幕条数（= targets.length）
    //     modelCount,                        // 展开后的弹幕条数（与 startSend 原循环同源同算法）
    //     problems: [{ subtitleIndex, subListIndex, seq, modelIndex, rule, detail, path }],
    //     expandErrors: [{ subtitleIndex, subListIndex, seq, message }],
    //   }
    //   problems 的 subtitleIndex = 病灶字幕在【发送序列 targets】里的 0 基下标（+1 即 seq）；subListIndex =
    //   它在【字幕列表 subs】里的 0 基下标（UI 定位用 data-i，不在列表里为 -1）；rule/detail/path 原样透传
    //   lintModel（rule 是稳定标识，UI 可按类归并）。
    //   语义边界：**展开抛错不阻断发送**——原 startSend 就是 catch 后按 1 条计入（照旧），这里同样只计数
    //   并把事件收进 expandErrors 供 UI 提示，不塞进 problems（不改变既有发送行为）。
    function auditSend(targets, subs) {
        const list = targets || [];
        const all = subs || [];
        const problems = [];
        const expandErrors = [];
        let modelCount = 0;

        // subs.indexOf(s) 的 O(1) 版（同一份数组、首个匹配优先，与 indexOf 同义）
        const idxOf = new Map();
        all.forEach((s, i) => { if (!idxOf.has(s)) idxOf.set(s, i); });

        for (let k = 0; k < list.length; k++) {
            const s = list[k];
            const subListIndex = idxOf.has(s) ? idxOf.get(s) : -1;
            const seq = k + 1;
            const prevTime = k > 0 ? list[k - 1].time : null;
            let models;
            try {
                const cfg = cfgFor(s);
                models = expandSub(s, cfg, calcDurationMs(subListIndex), seq, prevTime);
            } catch (e) {
                // 既有语义（80-ui 原计数循环）：展开抛错按 1 条计入，绝不把异常抛出去
                modelCount += 1;
                expandErrors.push({
                    subtitleIndex: k, subListIndex, seq,
                    message: (e && e.message) ? e.message : String(e),
                });
                continue;
            }
            modelCount += models.length;
            for (let j = 0; j < models.length; j++) {
                const r = lintModel(models[j]);
                if (r.ok) continue;
                r.problems.forEach((p) => {
                    problems.push({
                        subtitleIndex: k, subListIndex, seq, modelIndex: j,
                        rule: p.rule, detail: p.detail, path: p.path,
                    });
                });
            }
        }

        return { subtitleCount: list.length, modelCount, problems, expandErrors };
    }

// —— ESM 导出（6.14.0 新增：闸② 的调用点 + 闸③ 的数字）——
// 读：80-ui（发送前 lint 与常驻计数行）、90-preset-ui（预设/参数变化时重算）、95-events（选中/偏移变化时重算）。
export {
    POOL_IMPACT_BANDS, SEND_CONFIRM_MODEL_THRESHOLD, auditSend, estimatedSendMs, poolImpact,
};
