// ==UserScript==
// @name         AcFun 弹幕字幕发送器 (H5版高级弹幕)
// @namespace    https://github.com/acfun-danmaku-sender
// @version      6.5.0
// @description  上传 SRT/ASS/LRC 字幕文件，按时间轴自动发送高级弹幕。仿原生面板，替换 A 站高级弹幕编辑器并提供视频预览。
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

