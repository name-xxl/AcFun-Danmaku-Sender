## 更新内容（6.7.0）

- 工程地基：新增 tools/check.js 门禁——FILES 单源 / 版本三处一致 / 孤儿文件 / 禁模式守门（confirm/alert ≤3、setInterval ≤1，白名单只减不增）
- package.json 补齐四门 scripts：build → check → test，gate 一键串联
- smoke-test.js 拼接清单改为解析 build.js 的 FILES（消除两份清单漂移风险）
- 新增 RISKS.md 风险登记（R1–R7）；14 个源文件头注补「理解卡」（我拥有/我承诺/我永不/改我前读）
- @namespace 回指实际仓库 acfun-danmaku-sender（仓库暂不改名；package/dist 的 acfun-adl 名不变，真改名时一并切换）
- 代码零行为变更（纯工程设施与注释）
