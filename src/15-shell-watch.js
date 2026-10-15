    // ============================================================
    //  壳观察策略（等 DOM 壳出现 / 重建 → 做一次幂等动作）
    // ============================================================
    // 理解卡｜我拥有：createShellWatch(deps) —— 把「等某个 DOM 壳出现」从定时轮询改成事件驱动的**纯策略**：
    //   findShell / isInjected / inject / isLauncherOpen / onLauncherOpen 全部由调用方注入，
    //   本文件不 new MutationObserver、不 querySelector、不碰任何 DOM API，也不持有定时器。
    //   于是它能在 node 里用几行桩对象跑单测（test/unit/shell-watch.test.mjs），
    //   而 mutation 记录的形状（records[i].type / records[i].target.classList）是它唯一的 DOM 知识。
    // 我承诺：① sweep 在稳态是 O(1) 早退——入口已注入且壳仍挂在文档上时，一次查找都不做
    //   （唯一的复核：本批有节点被移除时查一次「入口还在不在」，见 sweep 的 ③）；
    //   ② 壳被移除后重新出现时会再次注入（判活看 isConnected，不是「找到一次就永久锁死」）；
    //   ③ 注入幂等由两条同源判据兜住：本函数的 isInjected + inject 实现自身（见 boot 的 injectNativeEntry）；
    //   ④ 展开边沿的记忆（wasOpen）与玩家事件共用一份，避免两条路径重复处理同一次展开。
    // 我永不：不自己起定时器（本片把全仓 setInterval 清到了 0）；不自己 disconnect（壳会重建，观察器要一直挂着）。
    // 改我前读：为什么「壳不在」时还要读一次展开态——原实现的 400ms 轮询每跳都读一次 isLauncherOpen，
    //   少了它，「面板关掉时 wrapper 连节点一起消失（没有 class 变动记录）→ 再打开」这条路上
    //   wasOpen 会僵在 true，展开边沿丢失（默认视图设置静默失效）。这是本片最容易写坏的一处。
    function createShellWatch({ findShell, isInjected, inject, isLauncherOpen, launcherWrapperClass, onLauncherOpen }) {
        let shell = null;       // 入口按钮已注入的壳节点；null = 还没成功注入，或注入过的那份已经失效
        let wasOpen = false;    // 展开边沿的记忆（与玩家事件共用）

        function opened() {
            wasOpen = true;
            onLauncherOpen();
        }

        function closed() {
            wasOpen = false;
        }

        // 读一次展开态并处理边沿（与玩家事件同一套语义：展开且没记过 → 处理一次；收起 → 清记忆）
        function checkLauncherEdge() {
            const open = isLauncherOpen();
            if (open && !wasOpen) opened();
            else if (!open) wasOpen = false;
        }

        // 宿主 wrapper 的 class 变了吗——只认这一个节点的 class 属性变动。
        // 逐条 O(1) 且【不查询 DOM】：弹幕列表行高亮之类的 class 变动在这里就被判掉，
        // 不会因为「本页 class 变动很频繁」而把展开态查询带上热路径。
        function launcherClassChanged(records) {
            for (let i = 0; i < records.length; i++) {
                const r = records[i];
                if (r.type === 'attributes' && r.target && r.target.classList
                    && r.target.classList.contains(launcherWrapperClass)) return true;
            }
            return false;
        }

        // 本批有没有节点被移除（壳还在时，唯一需要复核入口还在不在的原因）
        function hasChildRemoval(records) {
            for (let i = 0; i < records.length; i++) {
                const r = records[i];
                if (r.type === 'childList' && r.removedNodes && r.removedNodes.length) return true;
            }
            return false;
        }

        // 本批有没有节点增删（壳出现/重建只会伴随 childList 变动）
        function hasChildListChange(records) {
            for (let i = 0; i < records.length; i++) {
                if (records[i].type === 'childList') return true;
            }
            return false;
        }

        // sweep(records)：直接挂给 MutationObserver；records 为 [] 时=「不看变动、整场巡检一遍」
        // （boot 在 setupEntry 里立即调一次：document-idle 下壳可能已经在了）。
        function sweep(records) {
            const edge = launcherClassChanged(records);
            // ① 与本片无关的批次（只有别的 class 变动、没有节点增删）：一次查找都不做，直接返回。
            //    空数组（首次巡检）故意跳过这条，把两个判据都看一遍。
            if (!edge && records.length && !hasChildListChange(records)) return;
            // ② wrapper 的 class 真的变了 → 读一次展开态，处理边沿
            if (edge) checkLauncherEdge();
            // ③ 稳态早退：入口已注入且壳仍在文档上 → 不再查找、不再注入。
            //    唯一例外：**本批有节点被移除**——重渲染可能顺手带走我们插在标题栏里的入口，而壳本身还在。
            //    旧轮询每 400ms 会自己补上，事件驱动不补就静默少一个入口。这时复核一次入口还在不在
            //    （1 次壳内查询，不重跑 findShell；入口还在就照常早退），被带走了才往下走重注入。
            if (shell && shell.isConnected && (!hasChildRemoval(records) || isInjected(shell))) return;
            // ④ 壳没了（重建中）、还没注入过，或入口被带走了 → 找一次
            shell = null;
            const found = findShell();
            if (found) {
                if (isInjected(found)) shell = found;        // 幂等：已经有我们的入口（含「别的实例注入过」）→ 只记标志
                else {
                    inject(found);
                    if (isInjected(found)) shell = found;    // 注入没成功（例如壳里还没长出标题栏）→ 不记标志，下次再看
                }
            }
            // ⑤ 壳不在/刚重建时也读一次展开态（替代原轮询每 400ms 的那半句，理由见理解卡「改我前读」）
            if (!edge) checkLauncherEdge();
        }

        return { sweep, opened, closed };
    }

// —— ESM 导出（6.18.0 新增：入口注入去轮询，boot 是唯一调用方）——
export {
    createShellWatch,
};
