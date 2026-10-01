/*
 * 触发条冒烟测试：用最小 DOM 桩跑一遍真实脚本里的触发条逻辑
 *   - 默认形态（右上角贴边半球 .ps-dock-top）
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
  get size() {
    if (this._cls.has('ps-dock-left') || this._cls.has('ps-dock-right')) return [22, 44];
    if (this._cls.has('ps-dock-top')) return [44, 22];
    if (this._cls.has('ps-floating')) return [44, 44];
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
globalThis.GM_addStyle = () => {};
globalThis.GM_registerMenuCommand = () => {};
globalThis.GM_xmlhttpRequest = () => {};

const body = new El('body');
globalThis.document = {
  body,
  createElement: (t) => new El(t),
  querySelector: (sel) => body.children.find((c) => sel.indexOf('#' + c.id) === 0) || null
};
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

console.log('[1] 默认形态（右上角贴顶、只露下半球）');
t('挂上 .ps-dock-top', LA._cls.has('ps-dock-top'), [...LA._cls].join(','));
t('无内联定位（交给 CSS 贴角 + top:0）', !LA.style.top && !LA.style.left && !LA.style.right);
t('内容只有图标', LA.innerHTML === '<span class="ps-launch-ico">🔍</span>', LA.innerHTML);
t('title 提示正确', LA.title === 'PanSou 网盘搜索（点击展开）');
t('draggable=false（防原生拖拽）', LA.draggable === false);

console.log('[2] 纯点击（位移 0）→ 弹出搜索面板');
down(1, 1178, 11);                                   // 默认态球体中心 (1178, 11)
move(1, 1178, 11);
up(1, 1178, 11);
LA.fire('click', {});
t('面板打开', !!panel() && panel()._cls.has('ps-open'), panel() ? [...panel()._cls].join(',') : 'no panel');
t('未进入拖拽态', !LA._cls.has('ps-dragging'));

console.log('[3] 拖拽到左半屏 → 吸附左边缘');
panel()._cls.delete('ps-open');
down(2, 1178, 11);
move(2, 1138, 30);                                    // 位移 > 6px，起拖
t('进入拖拽态 + 自由态', LA._cls.has('ps-dragging') && LA._cls.has('ps-floating'));
t('已摘掉 dock 类（回到自由态）', !LA._cls.has('ps-dock-top'));
move(2, 300, 400);
t('跟随指针 left≈278', Math.abs(parseFloat(LA.style.left) - 278) < 2, 'left=' + LA.style.left);
t('跟随指针 top≈378', Math.abs(parseFloat(LA.style.top) - 378) < 2, 'top=' + LA.style.top);
up(2, 300, 400);
LA.fire('click', {});                                 // 拖拽尾随的 click 必须被吞掉
t('吞掉尾随 click（面板没被打开）', !panel()._cls.has('ps-open'));
t('挂 .ps-dock-left', LA._cls.has('ps-dock-left'), [...LA._cls].join(','));
t('贴左边缘 left=0', LA.style.left === '0', 'left=' + LA.style.left);
t('保留松手高度 top≈378', Math.abs(parseFloat(LA.style.top) - 378) < 2, 'top=' + LA.style.top);
t('位置已持久化', JSON.parse(store.pansou_launcher_dock).dock === 'left', store.pansou_launcher_dock);

console.log('[4] 吸附后单击（位移 0）→ 仍能开面板');
down(4, 11, 400);                                     // .ps-dock-left 球体中心 (11, 400)
up(4, 11, 400);
LA.fire('click', {});
t('单击打开面板', panel()._cls.has('ps-open'));

console.log('[5] 拖到右半屏 → 吸附右边缘');
panel()._cls.delete('ps-open');
down(3, 11, 400);
move(3, 1000, 300);
up(3, 1000, 300);
t('挂 .ps-dock-right', LA._cls.has('ps-dock-right'), [...LA._cls].join(','));
t('贴右边缘 right=0', LA.style.right === '0', JSON.stringify(LA.style));
t('持久化 dock=right', JSON.parse(store.pansou_launcher_dock).dock === 'right');

console.log('[6] 重置位置');
globalThis.window.__panSou.resetLauncherPos();
t('回到 .ps-dock-top', LA._cls.has('ps-dock-top'), [...LA._cls].join(','));
t('清掉内联定位（回到 CSS 的 top:0）', !LA.style.top && !LA.style.left && !LA.style.right, JSON.stringify(LA.style));
t('持久化 dock=top', JSON.parse(store.pansou_launcher_dock).dock === 'top');

console.log('[7] 视口缩小后自动回夹');
down(9, 1178, 11);
move(9, 100, 700);                                    // 拖到左边缘、top≈678
up(9, 100, 700);
t('先吸附到左边缘 top≈678', Math.abs(parseFloat(LA.style.top) - 678) < 2, 'top=' + LA.style.top);
globalThis.window.innerHeight = 300;                  // 视口缩到 300 高，resize 时会做同样的事
globalThis.window.__panSou.applyLauncherPos();
t('top 夹回可视范围 (<=244)', parseFloat(LA.style.top) <= 244.001, 'top=' + LA.style.top);

console.log('');
console.log('结果：' + pass + ' 通过, ' + fail + ' 失败');
process.exitCode = fail ? 1 : 0;                      // process.exit 可能截断管道输出
