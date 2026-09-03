// 构建脚本：把 src/ 下的源文件按顺序拼接成 dist/acfun-danmaku-sender.user.js
// 用法：node build.js
const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');
const DIST_FILE = path.join(__dirname, 'dist', 'acfun-danmaku-sender.user.js');

// 顺序即最终脚本的拼接顺序，必须与 tools/split.js 的 PARTS 保持一致。
const FILES = [
    '00-header.js',
    '10-constants.js',
    '20-utils.js',
    '30-parser.js',
    '40-core.js',
    '50-engine.js',
    '60-network.js',
    '70-preview.js',
    '80-ui.js',
    '85-danmaku.js',
    '90-preset-ui.js',
    '95-events.js',
    '99-main.js',
];

let out = '';
for (const f of FILES) {
    const p = path.join(SRC_DIR, f);
    if (!fs.existsSync(p)) {
        console.error('缺少源文件: ' + f);
        process.exit(1);
    }
    out += fs.readFileSync(p, 'utf8');
}

fs.writeFileSync(DIST_FILE, out, 'utf8');
console.log('构建完成 -> ' + DIST_FILE);
console.log('拼接 ' + FILES.length + ' 个文件，' + out.length + ' 字符');
