/*
 * 触发条冒烟测试：用最小 DOM 桩跑一遍真实脚本里的触发条逻辑
 *   - 默认形态（贴右边缘、距顶 15%、只露左半球 .ps-dock-right）
 *   - 纯点击（位移 <= 6px）开面板
 *   - 拖拽（位移 > 6px）跟随指针、松手就近吸附左/右边缘
 *   - 拖拽尾随 click 被吞掉、吸附后单击仍可开面板
 *   - 位置持久化 / 重置 / 视口缩小自动回夹
 *
 * 跑：node test-launcher.mjs
 */
import fs from 'fs';

class El {
  constructor(tag) {
    this.tagName = tag;
    this.id = '';
    this._cls = new Set();
    this.style = {};
    this.innerHTML = '';
    this.title = '';
    this.draggable = false;
    this.children = [];
    this.value = '';
    this.textContent = '';
    this.checked = false;
    this.disabled = false;
    this.dataset = {};
    this._h = {};
    this._cache = {};
    const self = this;
    this.classList = {
      add: (...c) => c.forEach((x) => self._cls.add(x)),
      remove: (...c) => c.forEach((x) => self._cls.delete(x)),
      contains: (c) => self._cls.has(c),
      toggle: (c) => (self._cls.has(c) ? self._cls.delete(c) : self._cls.add(c))
    };
  }
  appendChild(c) { this.children.push(c); return c; }
  remove() { this.removed = true; }
  focus() {}
  blur() {}
  addEventListener(t, f) { (this._h[t] = this._h[t] || []).push(f); }
  removeEventListener(t, f) { this._h[t] = (this._h[t] || []).filter((x) => x !== f); }
  fire(t, ev) { (this._h[t] || []).slice().forEach((f) => f(ev)); }
  setPointerCapture() {}
  querySelectorAll() { return []; }
  // 按 dock class 反推当前尺寸，供 getBoundingClientRect 使用（模拟浏览器布局）
  // 尺寸须与脚本里的 LAUNCHER_SIZE 保持一致：整球 25×25、半球 25×12.5
  get size() {
    if (this._cls.has('ps-dock-left') || this._cls.has('ps-dock-right')) return [12.5, 25];
    if (this._cls.has('ps-dock-top')) return [25, 12.5];
    if (this._cls.has('ps-floating')) return [25, 25];
    return [0, 0];
  }
  getBoundingClientRect() {
    const [w, h] = this.size;
    const vw = globalThis.window.innerWidth;
    let left = parseFloat(this.style.left);
    if (isNaN(left)) left = this._cls.has('ps-dock-right') || this._cls.has('ps-dock-top') ? vw - w : 0;
    let top = parseFloat(this.style.top);
    if (isNaN(top)) top = 0;
    return { left, top, width: w, height: h };
  }
  querySelector(sel) {
    const hit = this.children.find((c) => c.id && sel.indexOf('#' + c.id) === 0);
    if (hit) return hit;
    this._cache[sel] = this._cache[sel] || new El('div');
    return this._cache[sel];
  }
}

const store = {};
globalThis.GM_getValue = (k, d) => (k in store ? store[k] : d);
globalThis.GM_setValue = (k, v) => { store[k] = v; };
globalThis.GM_deleteValue = (k) => { delete store[k]; };
globalThis.GM_listValues = () => Object.keys(store);
let css = '';
globalThis.GM_addStyle = (s) => { css += s; };
globalThis.GM_registerMenuCommand = () => {};
globalThis.GM_xmlhttpRequest = () => {};

const body = new El('body');
globalThis.document = {
  body,
  createElement: (t) => new El(t),
  querySelector: (sel) => body.children.find((c) => sel.indexOf('#' + c.id) === 0) || null
};
// 视口 1200×800：默认距顶 15% → top = round(800*0.15) = 120
globalThis.window = { innerWidth: 1200, innerHeight: 800, addEventListener: () => {} };

const src = fs.readFileSync(new URL('./pansou-search.user.js', import.meta.url), 'utf8');
new Function(src)();

const LA = body.children.find((c) => c.id === 'ps-launcher');
const panel = () => body.children.find((c) => c.id === 'ps-backdrop');
let pass = 0;
let fail = 0;
const t = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); }
};
const down = (id, x, y) => LA.fire('pointerdown', { pointerId: id, pointerType: 'mouse', button: 0, clientX: x, clientY: y });
const move = (id, x, y) => LA.fire('pointermove', { pointerId: id, clientX: x, clientY: y });
const up = (id, x, y) => LA.fire('pointerup', { pointerId: id, clientX: x, clientY: y });

console.log('[1] 默认形态（贴右边缘、距顶 15%、只露左半球）');
t('挂上 .ps-dock-right', LA._cls.has('ps-dock-right'), [...LA._cls].join(','));
t('默认距顶 15% → inline top≈120', Math.abs(parseFloat(LA.style.top) - 120) < 1, 'top=' + LA.style.top);
t('贴右边缘 → inline right=0', LA.style.right === '0', JSON.stringify(LA.style));
t('半球尺寸 12.5×25（整球 25×25）', LA.size.join('×') === '12.5×25', LA.size.join('×'));
t('size 常量已落地', /const LAUNCHER_SIZE = 25;/.test(src));
t('内容只有图标', LA.innerHTML === '<span class="ps-launch-ico">🔍</span>', LA.innerHTML);
t('title 提示正确', LA.title === 'PanSou 网盘搜索（点击展开）');
t('draggable=false（防原生拖拽）', LA.draggable === false);

console.log('[2] 纯点击（位移 0）→ 弹出搜索面板');
down(1, 1193, 132);                                    // 默认态（dock-right）半球中心 (1187.5+6.25, 120+12.5)
move(1, 1193, 132);
up(1, 1193, 132);
LA.fire('click', {});
t('面板打开', !!panel() && panel()._cls.has('ps-open'), panel() ? [...panel()._cls].join(',') : 'no panel');
t('未进入拖拽态', !LA._cls.has('ps-dragging'));

console.log('[3] 拖拽到左半屏 → 吸附左边缘');
panel()._cls.delete('ps-open');
down(2, 1193, 132);
move(2, 1153, 146);                                    // 位移 > 6px，起拖
t('进入拖拽态 + 自由态', LA._cls.has('ps-dragging') && LA._cls.has('ps-floating'));
t('已摘掉 dock 类（回到自由态）', !LA._cls.has('ps-dock-top'));
move(2, 300, 400);
t('跟随指针 left≈288', Math.abs(parseFloat(LA.style.left) - 288) < 2, 'left=' + LA.style.left);
t('跟随指针 top≈388', Math.abs(parseFloat(LA.style.top) - 388) < 2, 'top=' + LA.style.top);
up(2, 300, 400);
LA.fire('click', {});                                 // 拖拽尾随的 click 必须被吞掉
t('吞掉尾随 click（面板没被打开）', !panel()._cls.has('ps-open'));
t('挂 .ps-dock-left', LA._cls.has('ps-dock-left'), [...LA._cls].join(','));
t('贴左边缘 left=0', LA.style.left === '0', 'left=' + LA.style.left);
t('保留松手高度 top≈388', Math.abs(parseFloat(LA.style.top) - 388) < 2, 'top=' + LA.style.top);
t('位置已持久化', JSON.parse(store.pansou_launcher_dock).dock === 'left', store.pansou_launcher_dock);

console.log('[4] 吸附后单击（位移 0）→ 仍能开面板');
down(4, 6, 400);                                      // .ps-dock-left 竖立半球中心 ≈ (6.25, 400.5)
up(4, 6, 400);
LA.fire('click', {});
t('单击打开面板', panel()._cls.has('ps-open'));

console.log('[5] 拖到右半屏 → 吸附右边缘');
panel()._cls.delete('ps-open');
down(3, 6, 400);
move(3, 1000, 300);
up(3, 1000, 300);
t('挂 .ps-dock-right', LA._cls.has('ps-dock-right'), [...LA._cls].join(','));
t('贴右边缘 right=0', LA.style.right === '0', JSON.stringify(LA.style));
t('持久化 dock=right', JSON.parse(store.pansou_launcher_dock).dock === 'right');

console.log('[6] 重置位置');
globalThis.window.__panSou.resetLauncherPos();
t('回到 .ps-dock-right', LA._cls.has('ps-dock-right'), [...LA._cls].join(','));
t('回到默认距顶 15%（inline top≈120）', Math.abs(parseFloat(LA.style.top) - 120) < 1, 'top=' + LA.style.top);
t('贴右边缘 → inline right=0', LA.style.right === '0', JSON.stringify(LA.style));
t('持久化 dock=right', JSON.parse(store.pansou_launcher_dock).dock === 'right');

console.log('[7] 视口缩小后自动回夹');
down(9, 1193, 132);
move(9, 100, 760);                                    // 拖到左边缘、尽量靠下
up(9, 100, 760);
t('先吸附到左边缘', LA._cls.has('ps-dock-left'), [...LA._cls].join(','));
t('拖出较大 top（≈748）', Math.abs(parseFloat(LA.style.top) - 748) < 2, 'top=' + LA.style.top);
globalThis.window.innerHeight = 300;                  // 视口缩到 300 高，resize 时会做同样的事
globalThis.window.__panSou.applyLauncherPos();
const topAfter = parseFloat(LA.style.top);
t('resize 后 top 夹回可视范围 (12.5 ≤ top ≤ 262.5)', topAfter >= 12.5 - 0.01 && topAfter <= 262.5 + 0.01, 'top=' + topAfter);

console.log('[8] 生成的 CSS：尺寸与 hover 选择器');
t('半球 25×12.5（.ps-dock-top）', /\.ps-dock-top\{[^}]*width:25px;height:12\.5px/.test(css), 'css 里找不到');
t('整球 25×25（.ps-floating）', /\.ps-floating\{width:25px;height:25px;border-radius:12\.5px;\}/.test(css));
t('hover 鼓成整球（.ps-dock-top 收缩态 → 25px 高）', /#ps-launcher\.ps-dock-top:hover\{height:25px/.test(css));
t('hover 选择器用 id+class（不是不存在的 #ps-dock-top）', !/#ps-dock-(top|left|right)[:{\s]/.test(css), '存在无效 id 选择器');
t('图标字号 17px', /\.ps-launch-ico\{font-size:17px/.test(css));
t('图标默认隐藏（半球只有 12.5px 高，避免裁成半截）', /\.ps-launch-ico\{font-size:17px;line-height:1;\s*opacity:0;/.test(css));
t('hover 时淡入图标', /#ps-launcher:hover \.ps-launch-ico\{opacity:1;\}/.test(css));
t('触屏常驻显示图标（无 hover 可依赖）', /\.ps-launch-ico\{font-size:20px;opacity:1;\}/.test(css));

console.log('');
console.log('结果：' + pass + ' 通过, ' + fail + ' 失败');
process.exitCode = fail ? 1 : 0;                      // process.exit 可能截断管道输出
