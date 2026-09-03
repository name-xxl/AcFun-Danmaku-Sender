// 一次性切分工具：把根目录的单文件 acfun-danmaku-sender.user.js
// 按逻辑块切成 src/ 下的多个源文件。
// 用法：node tools/split.js
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;                                   // tools/
const SRC_SINGLE = path.join(ROOT, '..', '..', 'acfun-danmaku-sender.user.js');
const OUT_DIR = path.join(ROOT, '..', 'src');

// 文件 -> [start, end]（1-based，含 end）。顺序即构建拼接顺序。
const PARTS = [
    { file: '00-header.js',    start: 1,    end: 18 },    // UserScript 元数据 + IIFE 开头
    { file: '10-constants.js', start: 19,   end: 124 },   // 常量 + 默认值 + 预设
    { file: '20-utils.js',     start: 125,  end: 191 },   // 工具
    { file: '30-parser.js',    start: 192,  end: 349 },   // 字幕解析
    { file: '40-core.js',      start: 350,  end: 632 },   // 播放器封装 + 状态 + 模型构造
    { file: '50-engine.js',    start: 633,  end: 977 },   // 预设引擎
    { file: '60-network.js',   start: 978,  end: 1158 },  // 发送 + 验证
    { file: '70-preview.js',   start: 1159, end: 1303 },  // 预览
    { file: '80-ui.js',        start: 1304, end: 1751 },  // UI 面板 + 文件处理 + 发送循环
    { file: '85-danmaku.js',   start: 1752, end: 2227 },  // 弹幕模式 + 高级编辑
    { file: '90-preset-ui.js', start: 2228, end: 2581 },  // 预设 UI + 字段接管
    { file: '95-events.js',    start: 2582, end: 2715 },  // 事件绑定
    { file: '99-main.js',      start: 2716, end: 2953 },  // 入口 + 样式 + 初始化 + IIFE 结尾
];

const src = fs.readFileSync(SRC_SINGLE, 'utf8');
const lines = src.split('\n');

// 源文件末尾带换行时 split 会多一个空元素，故用 2954 兜底；PARTS 边界已按行号精确指定。
if (lines.length < 2953) {
    console.warn('警告：源文件行数 = ' + lines.length + '（预期 ≥2953），若已改动源文件请同步更新 PARTS 边界。');
}

for (const p of PARTS) {
    const chunk = lines.slice(p.start - 1, p.end).join('\n');
    const out = path.join(OUT_DIR, p.file);
    fs.writeFileSync(out, chunk + '\n', 'utf8');
    console.log('写入 ' + p.file + '（行 ' + p.start + '-' + p.end + '，共 ' + (p.end - p.start + 1) + ' 行）');
}
console.log('切分完成 -> ' + OUT_DIR);
