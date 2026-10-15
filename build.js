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
 *   · 本轮不开 minify（保持 dist 可读、可逐行 diff）；压缩是后续独立版本的事
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
    charset: 'utf8',     // 中文文案/CSS 保持原样，不做 \uXXXX 转义
    minify: false,       // 见头注：压缩另立版本
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
