/*
 * 构建脚本：src/（ES 模块）→ 单文件油猴脚本
 *   node build.js   产出 dist/acfun-adl.user.js
 *
 * 6.8.0 起由 build.js 的 FILES 拼接改为 esbuild 打包（范式抄 acvideo/build.js）：
 *   · 入口 src/boot.js，import 图决定模块求值顺序（原拼接顺序纪律废除）
 *   · IIFE 外壳与 'use strict' 由 banner/footer 提供（原 00-header.js 的 `(function(){` +
 *     boot.js 末尾的 `})();` 收口，两侧同时搬到这里——只改一处会直接语法错误）
 *   · UserScript 元数据由 userscriptHeader() 生成、@version 直取 package.json：
 *     旧版「@version 与 package.json 不一致」的漂移类 bug 从根上不可能再发生
 *   · 6.15.1 起开启压缩（minify + keepNames）：220967 → 146940 字节（−33.5%）。
 *     为什么开：纯重构那几轮把产物从 175204 推到 220967（+26.1%），安装件该回到小体积。
 *     为什么连 keepNames 一起开（多 5888 字节 / +4.17%）：压缩会把函数名改短，浏览器控制台的
 *     堆栈帧会变成 `at ko (...)`；keepNames 让 V8 打印 `at ledgerRecord (...)`（V8 的 stack
 *     读运行时 name 属性，已实测）。本仓**没有真浏览器测试**，控制台错误是唯一的浏览器侧
 *     排查通道，这 4.17% 买的是可诊断性，且它在函数声明处留一个可 grep 的锚点
 *     （`s(fn,"ledgerRecord")`），纯 minify 连这个都没有。
 *     取舍（**产物从此不可读**）：dist 不可逐行 diff、不可按符号名 grep 调用点（调用点的
 *     标识符全被 mangle，只有字符串字面量如 `cf-adv-*` 存活）。因此验收与审查一律以
 *     src/ 为准——三道静态守卫（check / check-scope / check-deps）本来就只扫 src/，
 *     check.mjs 对产物只读 @version 一项；产物仅作安装件，不再充当行为证据。
 *
 * 理解卡｜我拥有：userscriptHeader()（油猴元数据唯一出处）、banner/footer 外壳、构建参数。
 * 我承诺：@version 取自 package.json，绝不手写第二份；产物恒为 dist/acfun-adl.user.js（安装路径不变）。
 * 我永不：不在这里写任何业务逻辑；不改 @name/@namespace/@match（油猴身份键，改动 = 用户需卸载重装）。
 * 改我前读：新增 GM API 必须在 userscriptHeader 里同步补 @grant；src/ 里任何对导入绑定赋值
 *   都会被 esbuild 报成构建错误（ESM 语义），这是跨文件写的守门人。
 */
import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function userscriptHeader() {
    return '// ==UserScript==\n'
        + '// @name         AcFun 高级弹幕层编辑器 (ADL)\n'
        + '// @namespace    https://github.com/acfun-danmaku-sender\n'
        + '// @version      ' + pkg.version + '\n'
        + '// @description  视频的高级弹幕层编辑器：给视频加一条可发布的字幕/特效轨道，所见即所得，发送只是导出。导入 SRT/ASS/LRC，预设特效，彩排通过才可导出。\n'
        + '// @author       name_xxl\n'
        + '// @match        *://www.acfun.cn/v/ac*\n'
        + '// @match        *://www.acfun.cn/bangumi/aa*\n'
        + '// @grant        GM_xmlhttpRequest\n'
        + '// @grant        unsafeWindow\n'
        + '// @connect      www.acfun.cn\n'
        + '// @connect      member.acfun.cn\n'
        + '// @run-at       document-idle\n'
        + '// ==/UserScript==';
}

const options = {
    entryPoints: [path.join(ROOT, 'src', 'boot.js')],
    bundle: true,
    format: 'iife',
    target: ['es2018'],
    charset: 'utf8',     // 中文文案/CSS 保持原样，不做 \uXXXX 转义（实测产物里 \u 出现 0 次）
    minify: true,        // 见头注：6.15.1 起开启压缩
    keepNames: true,     // 见头注：保住函数名（控制台堆栈可读 + 声明处可 grep），代价 +4.17%
    outfile: path.join(ROOT, 'dist', 'acfun-adl.user.js'),
    banner: { js: userscriptHeader() + '\n\n(function () {\n\'use strict\';' },
    footer: { js: '\n})();\n' },
    logLevel: 'warning',
};

esbuild.build(options).then(() => {
    const size = fs.statSync(options.outfile).size;
    console.log('构建完成 -> ' + path.relative(ROOT, options.outfile) + '（' + size + ' 字节，v' + pkg.version + '）');
}).catch((e) => {
    console.error(e);
    process.exit(1);
});
