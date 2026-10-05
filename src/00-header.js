// ==UserScript==
// @name         AcFun 高级弹幕层编辑器 (ADL)
// @namespace    https://github.com/acfun-adl
// @version      6.6.0
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

