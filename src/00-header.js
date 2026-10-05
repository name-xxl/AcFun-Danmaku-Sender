// ==UserScript==
// @name         AcFun 高级弹幕层编辑器 (ADL)
// @namespace    https://github.com/acfun-danmaku-sender
// @version      6.7.0
// @description  视频的高级弹幕层编辑器：给视频加一条可发布的字幕/特效轨道，所见即所得，发送只是导出。导入 SRT/ASS/LRC，预设特效，彩排通过才可导出。
// @author       name_xxl
// @match        *://www.acfun.cn/v/ac*
// @match        *://www.acfun.cn/bangumi/aa*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      www.acfun.cn
// @connect      member.acfun.cn
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // 理解卡｜我拥有：@元数据与 IIFE 外壳（整个脚本的闭包边界）。
    // 我承诺：@version 与 package.json 一致（check 门禁校验）；@grant 只列实际用到的 API。
    // 我永不：不放任何逻辑代码；@name/@namespace 是油猴身份键，改动 = 用户需卸载重装。
    // 改我前读：新增 GM API 必须同步补 @grant；本文件的 `(function(){` 由 99-main.js 末尾的 `})();` 收口。

