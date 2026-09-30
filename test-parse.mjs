// 开发期验证脚本（非交付主件）：校验 PanSou 油猴脚本的解析 / 分组 / 检测映射逻辑。
// 运行：node test-parse.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- 与油猴脚本保持一致的常量/逻辑 ----
const CLOUD_LABELS = {
  baidu: '百度网盘', aliyun: '阿里云盘', quark: '夸克网盘', guangya: '光亚网盘',
  tianyi: '天翼云盘', uc: 'UC网盘', mobile: '移动云盘', '115': '115网盘',
  pikpak: 'PikPak', xunlei: '迅雷网盘', '123': '123网盘', magnet: '磁力链接', ed2k: '电驴'
};
const labelOf = (t) => CLOUD_LABELS[t] || t;

function parseJson(res) {
  // 模拟 GM_xmlhttpRequest：res.response 为对象或 res.responseText 为字符串
  if (res.response && typeof res.response === 'object') return res.response;
  return JSON.parse(res.responseText);
}

function groupResults(json) {
  if (json.code !== undefined && json.code !== 0) {
    throw new Error(json.message || ('搜索失败 code=' + json.code));
  }
  const data = json.data || {};
  const merged = data.merged_by_type || {};
  const types = Object.keys(merged);
  return {
    total: data.total || 0,
    groups: types.map((t) => ({ type: t, label: labelOf(t), items: merged[t] || [] }))
  };
}

function tallyStates(results) {
  const byUrl = {};
  results.forEach((r) => { byUrl[r.url] = r; });
  const tally = { ok: 0, bad: 0, locked: 0, uncertain: 0 };
  return { byUrl, tally };
}

function applyState(tally, state) {
  if (state === 'ok') tally.ok++;
  else if (state === 'bad') tally.bad++;
  else if (state === 'locked') tally.locked++;
  else tally.uncertain++;
}

// ---- 断言 ----
let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra != null ? '→' + JSON.stringify(extra) : ''); }
}

console.log('1) 解析搜索响应（data.merged_by_type 外层）');
const raw = fs.readFileSync(path.join(__dirname, 'sample.json'), 'utf8');
const json = parseJson({ responseText: raw });
assert('code === 0', json.code === 0, json.code);
assert('存在 data.merged_by_type', !!json.data && !!json.data.merged_by_type);

console.log('2) 分组与类型中文映射');
const { total, groups } = groupResults(json);
assert('total === 25', total === 25, total);
assert('分组数 === 2', groups.length === 2, groups.length);
assert('quark → 夸克网盘', groups.find((g) => g.type === 'quark').label === '夸克网盘');
assert('magnet → 磁力链接', groups.find((g) => g.type === 'magnet').label === '磁力链接');
assert('quark 组有 3 条', groups.find((g) => g.type === 'quark').items.length === 3);
assert('magnet 条目的 url 为 magnet:', groups.find((g) => g.type === 'magnet').items[0].url.startsWith('magnet:'));

console.log('3) 未知类型回退原始 key');
assert('未知类型回退', labelOf('unknownxxx') === 'unknownxxx');

console.log('4) 链接检测状态映射（ok/bad/locked/uncertain）');
const fakeResults = [
  { url: 'https://pan.quark.cn/s/5bf74b0e4ffd', state: 'ok' },
  { url: 'https://pan.quark.cn/s/868458b0822a', state: 'bad' },
  { url: 'https://pan.quark.cn/s/c3e48933d21f', state: 'locked' },
  { url: 'magnet:?xt=urn:btih:7A4C9DCFE1C106A9CCCC7A33126061CAD81815A8', state: 'uncertain' }
];
const { byUrl, tally } = tallyStates(fakeResults);
fakeResults.forEach((r) => applyState(tally, r.state));
assert('byUrl 命中 4 条', Object.keys(byUrl).length === 4);
assert('ok=1', tally.ok === 1, tally);
assert('bad=1', tally.bad === 1, tally);
assert('locked=1', tally.locked === 1, tally);
assert('uncertain=1', tally.uncertain === 1, tally);

console.log('5) 错误响应处理（code!=0）');
let threw = false;
try { groupResults({ code: 400, message: '关键词不能为空', data: {} }); }
catch (e) { threw = true; assert('抛出 400 错误', e.message.includes('关键词不能为空')); }
assert('确实抛出了错误', threw);

console.log('\n结果：', pass, '通过,', fail, '失败');
process.exit(fail ? 1 : 0);
