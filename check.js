/* 自检脚本：交叉验证 HTML / CSS / JS 之间的引用是否完整 */
const fs = require("fs");
const path = require("path");

const root = __dirname;
const read = f => fs.readFileSync(path.join(root, f), "utf8");

const html = read("index.html");
const js = read("app.js");
const css = read("styles.css");

const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const jsIds = [...js.matchAll(/\$\("([^"]+)"\)/g)].map(m => m[1]);
const missingIds = [...new Set(jsIds)].filter(i => !htmlIds.has(i));

console.log("HTML id 数量:", htmlIds.size);
console.log("app.js 引用的 id 数量:", new Set(jsIds).size);
console.log("app.js 引用但 HTML 里没有的 id:", missingIds.length ? missingIds : "无");

const assets = [...html.matchAll(/(?:src|href)="([^":]+\.(?:css|js))"/g)].map(m => m[1]);
assets.forEach(a => console.log("资源", a, fs.existsSync(path.join(root, a)) ? "存在 ✓" : "缺失 ✗"));

// 关键类名是否在 CSS 中定义
const classes = [
  "card", "chip", "sheet", "mask", "opt", "word-btn", "speak-main",
  "grid", "quiz-options", "voice-warn", "status-line", "empty-tip",
  "big-char", "pinyin", "meaning", "tag", "close-btn", "primary-btn", "ghost-btn"
];
const missCss = classes.filter(c => !css.includes("." + c));
console.log("CSS 缺失的类:", missCss.length ? missCss : "无");

// 数据完整性
global.window = {};
require(path.join(root, "data.js"));
const data = window.HANZI_DATA;
let total = 0;
const problems = [];
data.forEach(cat => cat.chars.forEach(r => {
  total++;
  if (r.length !== 4) problems.push("字段数异常: " + r.join(","));
}));
console.log("分类数:", data.length, "| 总字数:", total, "| META:", window.HANZI_META.totalChars);
console.log("数据问题:", problems.length ? problems : "无");
