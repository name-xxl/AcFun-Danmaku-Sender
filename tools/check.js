// 工程门禁：轻量四查，供 npm run check / npm run gate 使用
// 1) FILES 单源（smoke-test 不得内嵌清单副本）  2) 版本三处一致（@version ↔ package.json ↔ RELEASE_NOTES）
// 3) 孤儿文件（src/ ↔ build.js FILES 双向一致） 4) 禁模式守门（UI 五病灶防回潮，白名单只减不增）
// 用法：node tools/check.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src');
let failed = 0;
const fail = (msg) => { console.error('✗ ' + msg); failed++; };
const ok = (msg) => console.log('✓ ' + msg);

// 1) FILES 单源：smoke-test.js 应解析 build.js 的 FILES，而不是复制一份清单字面量
const smokeSrc = fs.readFileSync(path.join(ROOT, 'tools', 'smoke-test.js'), 'utf8');
if (/const FILES = \[\s*'/.test(smokeSrc)) {
    fail('smoke-test.js 内嵌了 FILES 清单副本，应改为解析 build.js（单源）');
} else {
    ok('FILES 单源生效（smoke-test.js 解析 build.js）');
}

// 2) 版本三处一致
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const header = fs.readFileSync(path.join(SRC_DIR, '00-header.js'), 'utf8');
const vm = header.match(/@version\s+([^\s]+)/);
const hv = vm ? vm[1] : '(未找到)';
if (hv !== pkg.version) {
    fail(`版本不一致：@version=${hv} vs package.json=${pkg.version}`);
} else {
    ok('版本一致：' + pkg.version);
}
const notes = fs.readFileSync(path.join(ROOT, 'RELEASE_NOTES.md'), 'utf8');
if (!notes.includes(pkg.version)) {
    fail('RELEASE_NOTES.md 未包含当前版本号 ' + pkg.version);
} else {
    ok('RELEASE_NOTES.md 含当前版本号');
}

// 3) 孤儿文件：src/ 实际 .js 与 build.js FILES 双向一致
const buildSrc = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8');
const fm = buildSrc.match(/const FILES = \[([\s\S]*?)\];/);
if (!fm) {
    fail('build.js 中未找到 FILES 数组');
} else {
    const FILES = fm[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    const actual = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.js'));
    const missing = FILES.filter((f) => !actual.includes(f));
    const orphan = actual.filter((f) => !FILES.includes(f));
    if (missing.length) fail('FILES 引用了不存在的文件：' + missing.join(', '));
    if (orphan.length) fail('src/ 存在未拼入 FILES 的孤儿文件（不会进产物）：' + orphan.join(', '));
    if (!missing.length && !orphan.length) ok('src/ ↔ FILES 双向一致（' + actual.length + ' 个文件）');
}

// 4) 禁模式守门：上限=现存白名单数量，只减不增（P3 重写时应逐步清零）
const LIMITS = [
    { re: /confirm\(|alert\(/g, max: 3, label: 'confirm(/alert(' },
    { re: /setInterval\(/g, max: 1, label: 'setInterval(' },
];
for (const { re, max, label } of LIMITS) {
    let count = 0;
    const where = [];
    for (const f of fs.readdirSync(SRC_DIR).filter((x) => x.endsWith('.js'))) {
        // 只数真实代码：先剥离行注释（理解卡等注释里提及模式名不算违规）
        const code = fs.readFileSync(path.join(SRC_DIR, f), 'utf8').replace(/\/\/[^\n]*/g, '');
        const n = (code.match(re) || []).length;
        if (n) { count += n; where.push(f.split('-')[0] + '×' + n); }
    }
    if (count > max) {
        fail(`${label} 共 ${count} 处，超过白名单上限 ${max}：${where.join(', ')}（只减不增）`);
    } else {
        ok(`${label} ${count}/${max}（白名单内${where.length ? '：' + where.join(', ') : ''}）`);
    }
}

if (failed) {
    console.error(`\ncheck 未通过：${failed} 项`);
    process.exit(1);
}
console.log('\ncheck 全部通过');
