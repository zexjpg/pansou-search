// ==UserScript==
// @name         PanSou 网盘搜索
// @namespace    https://github.com/fish2018/pansou
// @version      0.2.12
// @description  基于 PanSou 后端 API 的网盘资源搜索展示前端。默认连接演示站 so.252035.xyz，可在设置中改为自建后端。支持按网盘类型分组、关键词过滤、链接有效性检测。仅供学习研究，请勿用于盈利。
// @author       WorkBuddy
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      *
// @noframes
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  /* ============================================================
   * 1. 配置
   * ============================================================ */
  const DEFAULT_BASE = 'https://so.252035.xyz';
  // PanSou 支持的网盘类型全集
  const CLOUD_TYPES = ['baidu', 'aliyun', 'quark', 'guangya', 'tianyi', 'uc', 'mobile', '115', 'pikpak', 'xunlei', '123', 'magnet', 'ed2k'];
  // 类型中文名（缺省回退原始 key）
  const CLOUD_LABELS = {
    baidu: '百度网盘', aliyun: '阿里云盘', quark: '夸克网盘', guangya: '光亚网盘',
    tianyi: '天翼云盘', uc: 'UC网盘', mobile: '移动云盘', '115': '115网盘',
    pikpak: 'PikPak', xunlei: '迅雷网盘', '123': '123网盘', magnet: '磁力链接', ed2k: '电驴'
  };

  // 后端地址归一化：去尾部斜杠；缺省协议时按 https 处理（避免误写 http 触发 400）
  function normalizeBase(v) {
    v = (v || DEFAULT_BASE).trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    return v;
  }
  // ── 多后端：每个后端是一条 profile（含认证信息），演示站默认且锁定不可删 ──
  function genId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function makeDemoProfile() {
    return { id: 'demo', name: '演示站', baseUrl: DEFAULT_BASE, locked: true,
             authUser: '', authPass: '', authToken: '', authExp: 0 };
  }
  function loadProfiles() {
    let arr;
    try { arr = JSON.parse(GM_getValue('pansou_profiles', 'null')); } catch (e) { arr = null; }
    if (!Array.isArray(arr) || !arr.length) {
      // 首次运行或数据损坏：迁移旧的单后端配置，并内置演示站
      const oldBase = GM_getValue('pansou_base', '');
      const selfBase = (oldBase && normalizeBase(oldBase) !== normalizeBase(DEFAULT_BASE)) ? normalizeBase(oldBase) : '';
      arr = [ makeDemoProfile() ];
      if (selfBase) {
        arr.push({
          id: genId(), name: '自建后端', baseUrl: selfBase, locked: false,
          authUser: GM_getValue('pansou_auth_user', ''),
          authPass: GM_getValue('pansou_auth_pass', ''),
          authToken: GM_getValue('pansou_auth_token', ''),
          authExp: Number(GM_getValue('pansou_auth_exp', 0)) || 0
        });
      }
      saveProfiles(arr);
    }
    if (!arr.some((p) => p.id === 'demo')) arr.unshift(makeDemoProfile());
    return arr;
  }
  function saveProfiles(arr) { try { GM_setValue('pansou_profiles', JSON.stringify(arr)); } catch (e) {} }
  function getActiveProfile() {
    const arr = loadProfiles();
    const id = GM_getValue('pansou_active', 'demo');
    return arr.find((p) => p.id === id) || arr[0];
  }
  function setActiveProfile(id) { GM_setValue('pansou_active', id); }
  function setActiveField(field, val) {
    const arr = loadProfiles();
    const id = GM_getValue('pansou_active', 'demo');
    const p = arr.find((x) => x.id === id) || arr[0];
    p[field] = val;
    saveProfiles(arr);
  }

  const cfg = {
    get baseUrl() { return normalizeBase(getActiveProfile().baseUrl || DEFAULT_BASE); },
    set baseUrl(v) { setActiveField('baseUrl', normalizeBase(v)); }
  };

  // ── 认证（Bearer token，可选；仅当后端开启 AUTH_ENABLED 时需要）──
  //   所有字段都代理到「当前活动后端」的 profile，切换后端即切换认证身份
  const auth = {
    get token() { return getActiveProfile().authToken || ''; },
    set token(v) { setActiveField('authToken', v || ''); },
    get exp() { return Number(getActiveProfile().authExp) || 0; },
    set exp(v) { setActiveField('authExp', v || 0); },
    get user() { return getActiveProfile().authUser || ''; },
    set user(v) { setActiveField('authUser', v || ''); },
    get pass() { return getActiveProfile().authPass || ''; },
    set pass(v) { setActiveField('authPass', v || ''); },
    isExpired() { const e = this.exp; return !e ? false : Date.now() >= e; },
    header() { const t = this.token; return t ? 'Bearer ' + t : ''; },
    clear() { setActiveField('authToken', ''); setActiveField('authExp', 0); }
  };

  /* ============================================================
   * 2. 工具
   * ============================================================ */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    const p = (n) => (n < 10 ? '0' : '') + n;
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // 把 GM 请求抛出的 HTTP/网络错误转成中文可读提示（去掉 nginx 原始 HTML）
  function friendlyError(e) {
    const m = (e && e.message) ? e.message : String(e || '');
    if (/HTTP 400/.test(m)) {
      if (/HTTPS port|plain HTTP/i.test(m)) {
        return '后端地址协议/端口不匹配（应使用 https://）。请检查设置里的后端地址，不要把 https 写成 http，也不要带多余端口';
      }
      return '请求被拒绝 (HTTP 400)：后端地址或请求格式可能有误';
    }
    if (/HTTP 429/.test(m)) {
      return '请求过于频繁，已被限流 (HTTP 429)。演示站约限 60 次/分钟，请稍候重试，或改用自建后端';
    }
    if (/HTTP 5\d\d/.test(m)) {
      const code = (m.match(/HTTP (\d+)/) || [,''])[1];
      return `服务器内部错误 (HTTP ${code})，后端可能临时不可用，请稍后重试`;
    }
    if (/网络错误/.test(m)) {
      return '网络错误：无法连接到后端，请检查后端地址与网络是否通畅';
    }
    if (/HTTP 401|未授权|AUTH_TOKEN/.test(m)) {
      return '认证失败 (HTTP 401)：后端已开启验证。请在设置「认证」分区用账号密码登录，或手动填入令牌';
    }
    return m;
  }

  function copyText(text, silent) {
    text = text || '';
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => { if (!silent) toast('已复制'); }).catch(() => fallbackCopy(text, silent));
    } else {
      fallbackCopy(text, silent);
    }
  }
  function fallbackCopy(text, silent) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.top = '-1000px';
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand('copy'); if (!silent) toast('已复制'); } catch (e) { if (!silent) toast('复制失败'); }
    ta.remove();
  }

  let toastTimer = null;
  function toast(msg) {
    let el = $('#ps-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ps-toast';
      el.className = 'ps-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('ps-toast-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('ps-toast-show'), 1800);
  }

  /* ============================================================
   * 3. API（基于 GM_xmlhttpRequest，天然可跨域）
   *    真实响应结构（已用演示站验证）：
   *    搜索: {code,message,data:{total,merged_by_type:{type:[{url,password,note,datetime,source,images}]}}}
   *    健康: {auth_enabled,channels_count,plugin_count,plugins,channels}
   *    检测: {results:[{disk_type,url,normalized_url,state,cache_hit,summary}]}
   * ============================================================ */
  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method || 'GET',
        url: options.url,
        headers: (function () { var h = Object.assign({}, options.headers || {}); var a = auth.header(); if (a) h['Authorization'] = a; return h; })(),
        data: options.data,
        timeout: options.timeout || 30000,
        responseType: 'json',
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) resolve(res);
          else reject(new Error('HTTP ' + res.status + (res.responseText ? ': ' + res.responseText.slice(0, 200) : '')));
        },
        onerror: (err) => reject(new Error('网络错误：' + (err && err.error ? err.error : '未知'))),
        ontimeout: () => reject(new Error('请求超时'))
      });
    });
  }

  function parseJson(res) {
    try {
      if (res.response && typeof res.response === 'object') return res.response;
      return JSON.parse(res.responseText);
    } catch (e) {
      throw new Error('响应解析失败');
    }
  }

  async function apiHealth(base) {
    const res = await gmRequest({ method: 'GET', url: base + '/api/health', timeout: 15000 });
    return parseJson(res);
  }

  async function apiSearch(base, params) {
    const body = {
      kw: params.kw,
      res: 'merge',
      src: params.src || 'all',
      refresh: !!params.refresh
    };
    if (params.cloud_types && params.cloud_types.length) body.cloud_types = params.cloud_types;
    const inc = String(params.include || '').split(',').map((s) => s.trim()).filter(Boolean);
    const exc = String(params.exclude || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (inc.length || exc.length) body.filter = { include: inc, exclude: exc };
    const res = await gmRequest({
      method: 'POST', url: base + '/api/search',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify(body), timeout: 60000
    });
    const json = parseJson(res);
    if (json.code !== undefined && json.code !== 0) {
      throw new Error(json.message || ('搜索失败 (code=' + json.code + ')'));
    }
    const data = json.data || {};
    return { total: data.total || 0, merged: data.merged_by_type || {} };
  }

  async function apiCheckLinks(base, items) {
    const results = [];
    const BATCH = 20;
    for (let i = 0; i < items.length; i += BATCH) {
      const slice = items.slice(i, i + BATCH);
      const res = await gmRequest({
        method: 'POST', url: base + '/api/check/links',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({ items: slice }), timeout: 60000
      });
      const json = parseJson(res);
      if (json.results && json.results.length) results.push(...json.results);
    }
    return results;
  }

  /* ============================================================
   * 3b. 认证（可选：后端开启 AUTH_ENABLED 时携带 Bearer token）
   * ============================================================ */
  async function apiLogin(base, username, password) {
    const res = await gmRequest({
      method: 'POST', url: base + '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ username, password }), timeout: 15000
    });
    const json = parseJson(res);
    if (!json || !json.token) throw new Error(json && json.error ? json.error : '登录失败（未返回 token）');
    return json; // {token, expires_at, username}
  }

  // 确保持有可用 token：已存且未过期直接返回；否则尝试用账号密码登录；都没有返回 ''
  async function ensureToken(base) {
    if (auth.token && !auth.isExpired()) return auth.token;
    if (auth.isExpired()) auth.clear(); // 过期则丢弃，避免带着失效令牌请求
    if (auth.user && auth.pass) {
      const r = await apiLogin(base, auth.user, auth.pass);
      auth.token = r.token;
      auth.exp = (r.expires_at ? r.expires_at * 1000 : 0);
      return auth.token;
    }
    return '';
  }

  // 自动登录 + 401 重试：包装一次需要认证的 API 调用
  async function withAuth(task) {
    await ensureToken(cfg.baseUrl);
    try { return await task(); }
    catch (e) {
      if (isAuthError(e) && auth.user && auth.pass) {
        auth.clear();
        await ensureToken(cfg.baseUrl);
        return await task();
      }
      throw e;
    }
  }

  function isAuthError(e) {
    const m = (e && e.message) ? e.message : '';
    return /未授权|AUTH_TOKEN|HTTP 401/.test(m);
  }

  /* ============================================================
   * 4. 全局状态 & UI 构建
   * ============================================================ */
  let panelBuilt = false;
  let lastMerged = {};          // 最近一次搜索结果（用于检测/重渲染/导出）
  let isSearching = false;
  let currentTabKey = 'all';    // 当前结果标签（用于导出/检测范围）
  let history = [];             // 搜索历史关键词
  const CACHE_TTL = 72 * 60 * 60 * 1000; // 本地缓存有效期：72 小时，超期后再次搜索走远程刷新

  /* ---- 触发条位置：默认贴视口右边缘、距顶 15%（只露左半球），可拖拽到左/右边缘吸附成竖立半球 ---- */
  const LAUNCHER_TOP_DEF_RATIO = 0.15;            // 默认距视口顶部 15%（dock:'right' 形态，左半球贴右边缘）
  function defaultLauncherTop() {                 // 15% 处，随视口高度自适应
    const vh = window.innerHeight || 800;
    return Math.round(vh * LAUNCHER_TOP_DEF_RATIO);
  }
  const LAUNCHER_SIZE = 25;                       // 整球直径(px)：约等于字体大小再多留一点余量给 🔍
  const LAUNCHER_HALF = LAUNCHER_SIZE / 2;        // 半球厚度 / 圆角半径
  const DRAG_THRESHOLD = 6;                       // 位移超过 6px 才算拖拽，否则视为点击
  const LAUNCHER_DEF = { dock: 'right', top: defaultLauncherTop() };   // {dock:'top'|'left'|'right', top:px}
  let launcherPos = LAUNCHER_DEF;
  let suppressLauncherClick = false;              // 吞掉拖拽结束时浏览器补发的 click

  function loadLauncherPos() {
    try {
      const v = GM_getValue('pansou_launcher_dock', '');
      const o = v ? JSON.parse(v) : null;
      if (o && (o.dock === 'left' || o.dock === 'right' || o.dock === 'top')) {
        return { dock: o.dock, top: Number(o.top) || 0 };
      }
    } catch (e) {}
    return { dock: 'right', top: defaultLauncherTop() };
  }
  function saveLauncherPos() {
    try { GM_setValue('pansou_launcher_dock', JSON.stringify(launcherPos)); } catch (e) {}
  }
  function clampTop(v) {
    const vh = window.innerHeight || 800;
    const pad = LAUNCHER_HALF;                     // 贴边时上下各留半个球，避免被视口裁掉
    return Math.min(Math.max(Number(v) || 0, pad), Math.max(pad, vh - LAUNCHER_SIZE - pad));
  }
  function applyLauncherPos() {
    const el = $('#ps-launcher');
    if (!el) return;
    el.classList.remove('ps-dock-top', 'ps-dock-left', 'ps-dock-right');
    el.style.top = ''; el.style.left = ''; el.style.right = '';
    if (launcherPos.dock === 'top') {
      el.classList.add('ps-dock-top');                   // 贴右边缘；top 由 inline 控制（默认 15% 处），仅露下半球
      el.style.top = clampTop(launcherPos.top) + 'px';
    } else {
      el.classList.add('ps-dock-' + launcherPos.dock);
      el.style.top = clampTop(launcherPos.top) + 'px';
      el.style[launcherPos.dock] = '0';            // left 或 right 贴边
    }
  }
  function resetLauncherPos() {
    launcherPos = { dock: 'right', top: defaultLauncherTop() };
    saveLauncherPos();
    applyLauncherPos();
    toast('已重置触发条位置');
  }

  // 拖拽与点击互不干扰：位移 <= 6px 视为点击（开面板），> 6px 进入拖拽，松手就近吸附边缘
  function attachLauncherDrag(el) {
    el.addEventListener('click', () => {
      if (suppressLauncherClick) { suppressLauncherClick = false; return; }
      openPanel();
    });
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      suppressLauncherClick = false;
      // 记录「抓取点」而不是元素左上角：后续只按相对位移算，不受 dock/半球尺寸变化影响
      const r = el.getBoundingClientRect();
      const rec = {
        id: e.pointerId, sx: e.clientX, sy: e.clientY,
        cx: r.left + r.width / 2, cy: r.top + r.height / 2,   // 按下瞬间的元素中心
        w: LAUNCHER_SIZE, h: LAUNCHER_SIZE, curLeft: r.left, curTop: r.top
      };
      let dragging = false;
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      el.classList.add('ps-grabbing');

      function onMove(ev) {
        if (ev.pointerId !== rec.id) return;
        const dx = ev.clientX - rec.sx, dy = ev.clientY - rec.sy;
        if (!dragging) {
          if (Math.sqrt(dx * dx + dy * dy) <= DRAG_THRESHOLD) return;  // 还没到阈值，继续等
          dragging = true;
          el.classList.remove('ps-grabbing');
          el.classList.remove('ps-dock-top', 'ps-dock-left', 'ps-dock-right'); // 回到自由态
          el.classList.add('ps-dragging', 'ps-floating');
        }
        rec.curLeft = Math.min(Math.max(rec.cx + dx - rec.w / 2, 0), window.innerWidth - rec.w);
        rec.curTop = Math.min(Math.max(rec.cy + dy - rec.h / 2, 0), window.innerHeight - rec.h);
        el.style.right = '';
        el.style.left = rec.curLeft + 'px';
        el.style.top = rec.curTop + 'px';
      }
      function onUp(ev) {
        if (ev.pointerId !== rec.id) return;
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        el.classList.remove('ps-grabbing', 'ps-dragging', 'ps-floating');
        if (!dragging) return;                      // 纯点击：交给上面的 click 打开面板
        suppressLauncherClick = true;               // 吞掉拖拽尾随的 click
        const centerX = rec.curLeft + rec.w / 2;
        const dock = centerX < window.innerWidth / 2 ? 'left' : 'right';
        launcherPos = { dock: dock, top: rec.curTop };
        saveLauncherPos();
        applyLauncherPos();                         // 带过渡回弹到吸附位置
      }
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    });
  }

  function buildLauncher() {
    const btn = document.createElement('div');
    btn.id = 'ps-launcher';
    btn.title = 'PanSou 网盘搜索（点击展开）';
    btn.innerHTML = '<span class="ps-launch-ico">🔍</span>';
    btn.draggable = false;
    launcherPos = loadLauncherPos();
    document.body.appendChild(btn);
    applyLauncherPos();                            // 先落位，再挂事件（避免拖到一半被 hover 变形影响 rect）
    attachLauncherDrag(btn);
  }

  function applyLauncherVisibility() {
    const show = GM_getValue('pansou_show_launcher', true);
    const existing = $('#ps-launcher');
    if (show) { if (!existing) buildLauncher(); }
    else if (existing) { existing.remove(); }
  }

  // 视口变化后把吸附位置夹回可视范围内
  window.addEventListener('resize', () => {
    launcherPos.top = (launcherPos.dock === 'top') ? defaultLauncherTop() : clampTop(launcherPos.top);
    applyLauncherPos();
  });

  function toggleLauncher() {
    const next = !GM_getValue('pansou_show_launcher', true);
    GM_setValue('pansou_show_launcher', next);
    applyLauncherVisibility();
    toast(next ? '已显示触发条' : '已隐藏触发条');
  }

  function buildPanel() {
    if (panelBuilt) return;
    panelBuilt = true;

    const backdrop = document.createElement('div');
    backdrop.id = 'ps-backdrop';
    backdrop.innerHTML = `
      <div id="ps-panel">
        <header id="ps-header">
          <span class="ps-title">PanSou 网盘搜索</span>
          <div class="ps-head-actions">
            <button id="ps-btn-settings" class="ps-icon-btn" title="设置">⚙</button>
            <button id="ps-btn-close" class="ps-icon-btn" title="关闭">✕</button>
          </div>
        </header>

        <div id="ps-settings" class="ps-hidden">
          <div class="ps-profiles-head">
            <span class="ps-profiles-title">后端服务</span>
            <button id="ps-btn-add-profile" class="ps-secondary ps-sm" title="新增一个后端链接">＋ 新增</button>
          </div>
          <div id="ps-profiles" class="ps-profiles"></div>

          <label>当前后端名称
            <input id="ps-base-name" type="text" placeholder="如：本地认证后端">
          </label>
          <label>后端地址（Base URL）
            <input id="ps-base-input" type="text" placeholder="https://so.252035.xyz">
          </label>
          <details class="ps-auth">
            <summary>认证（仅后端开启 AUTH_ENABLED 时需要）</summary>
            <div class="ps-auth-grid">
              <label>用户名
                <input id="ps-auth-user" type="text" placeholder="留空表示不自动登录" autocomplete="off">
              </label>
              <label>密码
                <input id="ps-auth-pass" type="password" placeholder="留空表示不自动登录" autocomplete="off">
              </label>
              <div class="ps-settings-row">
                <button id="ps-btn-login" class="ps-secondary">用账号登录获取令牌</button>
                <span id="ps-auth-msg" class="ps-settings-msg"></span>
              </div>
              <label>或手动填写 Bearer 令牌
                <input id="ps-auth-token" type="text" placeholder="粘贴后端返回的 token（不含 Bearer 前缀）" autocomplete="off">
              </label>
              <div class="ps-settings-row">
                <button id="ps-btn-save-token" class="ps-secondary">保存令牌</button>
              </div>
              <div id="ps-auth-state" class="ps-auth-state"></div>
            </div>
          </details>
          <div class="ps-settings-row">
            <button id="ps-btn-save" class="ps-primary">保存并测试连接</button>
            <span id="ps-settings-msg"></span>
          </div>
          <div class="ps-settings-row">
            <button id="ps-btn-del-profile" class="ps-danger">删除此后端</button>
          </div>
          <label class="ps-setting-toggle"><input type="checkbox" id="ps-show-launcher" checked> 显示触发条（右上角贴边半球；可拖到左/右边缘吸附。取消后可通过 Tampermonkey 菜单 / 命令弹出搜索框）</label>
          <div class="ps-settings-row">
            <button id="ps-btn-clear-cache" class="ps-secondary">清空本地缓存</button>
            <span id="ps-cache-msg" class="ps-settings-msg"></span>
          </div>
        </div>

        <div class="ps-controls">
          <div class="ps-kw-wrap">
            <input id="ps-kw" type="text" placeholder="输入关键词，如：速度与激情" autocomplete="off">
            <div id="ps-history" class="ps-history ps-hidden"></div>
          </div>
          <button id="ps-btn-search" class="ps-primary">搜索</button>
          <label class="ps-refresh-inline"><input type="checkbox" id="ps-refresh"> 强制刷新</label>
          <button id="ps-btn-export" class="ps-secondary">导出</button>
        </div>

        <details class="ps-filters">
          <summary>筛选 / 过滤</summary>
          <div class="ps-filter-grid">
            <label>包含关键词（逗号分隔，满足其一）
              <input id="ps-include" type="text" placeholder="合集,全集">
            </label>
            <label>排除关键词（逗号分隔，满足其一则过滤）
              <input id="ps-exclude" type="text" placeholder="预告,花絮">
            </label>
            <div class="ps-types">
              <label class="ps-chip ps-chip-all"><input type="checkbox" id="ps-type-all" checked> 全部</label>
              <span id="ps-type-box" class="ps-chip-box"></span>
            </div>
          </div>
        </details>

        <div id="ps-status"></div>
        <div class="ps-tabs-row ps-hidden">
          <div id="ps-tabs" class="ps-tabs ps-hidden"></div>
          <button id="ps-btn-check" class="ps-secondary ps-tabs-check ps-hidden">检测失效链接</button>
        </div>
        <div id="ps-results"></div>
      </div>`;
    document.body.appendChild(backdrop);

    // 类型复选框
    const box = $('#ps-type-box', backdrop);
    CLOUD_TYPES.forEach((t) => {
      const id = 'ps-ct-' + t;
      const lab = document.createElement('label');
      lab.className = 'ps-chip';
      lab.innerHTML = `<input type="checkbox" class="ps-ct" data-type="${t}" checked> ${esc(CLOUD_LABELS[t] || t)}`;
      box.appendChild(lab);
    });
    $('#ps-type-all', backdrop).addEventListener('change', (e) => {
      $$('.ps-ct', backdrop).forEach((c) => { c.checked = e.target.checked; });
    });

    // 事件绑定
    $('#ps-btn-close', backdrop).addEventListener('click', closePanel);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closePanel(); });
    $('#ps-btn-settings', backdrop).addEventListener('click', () => {
      const s = $('#ps-settings', backdrop);
      s.classList.toggle('ps-hidden');
      if (!s.classList.contains('ps-hidden')) {
        renderProfiles(backdrop);
        const p = getActiveProfile();
        $('#ps-base-name', backdrop).value = p.name || '';
        $('#ps-base-input', backdrop).value = p.baseUrl || '';
        $('#ps-show-launcher', backdrop).checked = GM_getValue('pansou_show_launcher', true);
        $('#ps-auth-user', backdrop).value = p.authUser || '';
        $('#ps-auth-pass', backdrop).value = p.authPass || '';
        $('#ps-auth-token', backdrop).value = p.authToken || '';
        const delBtn = $('#ps-btn-del-profile', backdrop);
        if (delBtn) delBtn.disabled = !!p.locked;
        refreshAuthState(backdrop);
        updateCacheCount();
      }
    });
    $('#ps-btn-save', backdrop).addEventListener('click', saveSettings);
    $('#ps-btn-clear-cache', backdrop).addEventListener('click', clearAllCache);
    $('#ps-btn-login', backdrop).addEventListener('click', () => doLogin(backdrop));
    $('#ps-btn-save-token', backdrop).addEventListener('click', () => saveManualToken(backdrop));
    $('#ps-btn-add-profile', backdrop).addEventListener('click', () => addProfile(backdrop));
    $('#ps-btn-del-profile', backdrop).addEventListener('click', () => deleteProfile(getActiveProfile().id, backdrop));
    // 编辑即写入当前活动后端，切换后端不会丢失正在改的内容
    $('#ps-base-name', backdrop).addEventListener('input', (e) => setActiveField('name', (e.target.value || '').trim()));
    $('#ps-base-input', backdrop).addEventListener('input', (e) => setActiveField('baseUrl', normalizeBase(e.target.value || '')));
    $('#ps-auth-user', backdrop).addEventListener('input', (e) => setActiveField('authUser', (e.target.value || '').trim()));
    $('#ps-auth-pass', backdrop).addEventListener('input', (e) => setActiveField('authPass', (e.target.value || '').trim()));
    $('#ps-show-launcher', backdrop).addEventListener('change', (e) => {
      GM_setValue('pansou_show_launcher', !!e.target.checked);
      applyLauncherVisibility();
    });
    $('#ps-btn-search', backdrop).addEventListener('click', doSearch);
    $('#ps-btn-check', backdrop).addEventListener('click', checkLinks);
    $('#ps-btn-export', backdrop).addEventListener('click', exportResults);
    $('#ps-kw', backdrop).addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    $('#ps-kw', backdrop).addEventListener('focus', showHistory);
    $('#ps-kw', backdrop).addEventListener('input', () => {
      const b = $('#ps-history', backdrop);
      b.classList.remove('ps-hidden');
      renderHistory($('#ps-kw', backdrop).value);
    });
    $('#ps-kw', backdrop).addEventListener('blur', () => setTimeout(hideHistory, 150));

    // 初始化后端字段（取自当前活动后端）
    const _p0 = getActiveProfile();
    $('#ps-base-name', backdrop).value = _p0.name || '';
    $('#ps-base-input', backdrop).value = _p0.baseUrl || '';
    $('#ps-show-launcher', backdrop).checked = GM_getValue('pansou_show_launcher', true);
    loadHistory();
  }

  function openPanel() {
    buildPanel();
    $('#ps-backdrop').classList.add('ps-open');
    setTimeout(() => { const kw = $('#ps-kw'); if (kw) kw.focus(); }, 50);
  }
  function closePanel() {
    const bd = $('#ps-backdrop');
    if (bd) bd.classList.remove('ps-open');
  }

  function setStatus(msg, isError) {
    const el = $('#ps-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = isError ? 'ps-status ps-status-err' : 'ps-status';
  }

  function setSettingsMsg(msg, isError) {
    const el = $('#ps-settings-msg');
    if (!el) return;
    el.textContent = msg || '';
    el.className = isError ? 'ps-settings-msg ps-err' : 'ps-settings-msg ps-ok';
  }

  /* ============================================================
   * 5. 搜索 / 渲染
   * ============================================================ */
  function getSelectedTypes() {
    const all = $('#ps-type-all');
    if (all && all.checked) return []; // 空数组表示全部
    return $$('.ps-ct').filter((c) => c.checked).map((c) => c.dataset.type);
  }

  async function doSearch() {
    if (isSearching) return;
    hideHistory();
    const kw = ($('#ps-kw').value || '').trim();
    if (!kw) { setStatus('请输入搜索关键词', true); toast('请输入关键词'); return; }

    const types = getSelectedTypes();
    const inc = $('#ps-include').value;
    const exc = $('#ps-exclude').value;
    const force = $('#ps-refresh') && $('#ps-refresh').checked;
    const key = cacheKey(kw, types, inc, exc);

    // 命中有效本地缓存：秒显，无需请求
    if (!force) {
      const cached = getCache(key);
      if (cached && cached.merged && (Date.now() - (cached.ts || 0)) < CACHE_TTL) {
        lastMerged = cached.merged;
        renderResults(cached.total, cached.merged);
        setStatus(`本地缓存（${fmtAgo(cached.ts)}，72 小时内有效）· 共 ${cached.total} 条 · 勾选「强制刷新」可获取最新`);
        saveHistory(kw);
        return;
      }
    }

    isSearching = true;
    const btn = $('#ps-btn-search');
    btn.disabled = true; btn.textContent = '搜索中…';
    setStatus('正在搜索「' + kw + '」…');
    $('#ps-results').innerHTML = '';

    try {
      const searchParams = {
        kw,
        cloud_types: types,
        include: inc,
        exclude: exc,
        src: 'all',
        refresh: false
      };
      const r = await withAuth(() => apiSearch(cfg.baseUrl, searchParams));
      lastMerged = r.merged;
      renderResults(r.total, r.merged);
      const typeCount = Object.keys(r.merged).length;
      const hasResults = r.total > 0 && typeCount > 0;
      // 仅在真实有结果时才写缓存；错误与“无结果”都不缓存，避免污染本地缓存
      if (hasResults) setCache(key, { ts: Date.now(), total: r.total, merged: r.merged });
      saveHistory(kw);
      setStatus(hasResults
        ? `共 ${r.total} 条结果，覆盖 ${typeCount} 种网盘类型`
        : `未找到「${kw}」的结果，换个关键词或减少过滤条件试试`);
    } catch (e) {
      setStatus('搜索失败：' + friendlyError(e), true);
    } finally {
      isSearching = false;
      btn.disabled = false; btn.textContent = '搜索';
    }
  }

  function renderResults(total, merged) {
    lastMerged = merged;
    const tabsEl = $('#ps-tabs');
    const checkBtn = $('#ps-btn-check');
    const tabsRow = $('#ps-tabs-row');
    const root = $('#ps-results');
    const types = Object.keys(merged);
    if (!types.length) {
      tabsEl.classList.add('ps-hidden');
      tabsEl.innerHTML = '';
      if (checkBtn) checkBtn.classList.add('ps-hidden');
      if (tabsRow) tabsRow.classList.add('ps-hidden');
      root.innerHTML = '<div class="ps-empty">没有找到结果，试试更换关键词或减少过滤条件</div>';
      return;
    }
    // 构建网盘类型标签栏（含「全部」）
    tabsEl.classList.remove('ps-hidden');
    if (checkBtn) checkBtn.classList.remove('ps-hidden');
    if (tabsRow) tabsRow.classList.remove('ps-hidden');
    tabsEl.innerHTML = '';
    const mkTab = (key, label, count, active) => {
      const b = document.createElement('button');
      b.className = 'ps-tab' + (active ? ' ps-tab-active' : '');
      b.dataset.key = key;
      b.innerHTML = `<span>${esc(label)}</span><span class="ps-tab-count">${count}</span>`;
      b.addEventListener('click', () => { setActiveTab(key); showType(key); });
      return b;
    };
    tabsEl.appendChild(mkTab('all', '全部', total, true));
    types.forEach((t) => tabsEl.appendChild(mkTab(t, CLOUD_LABELS[t] || t, merged[t].length, false)));
    showType('all');
  }

  function setActiveTab(key) {
    $$('.ps-tab').forEach((t) => t.classList.toggle('ps-tab-active', t.dataset.key === key));
  }

  function showType(key) {
    currentTabKey = key;
    const merged = lastMerged || {};
    const root = $('#ps-results');
    root.innerHTML = '';
    const types = key === 'all' ? Object.keys(merged) : [key];
    if (!types.length) {
      root.innerHTML = '<div class="ps-empty">没有结果</div>';
      return;
    }
    const frag = document.createDocumentFragment();
    types.forEach((type) => frag.appendChild(makeTypeSection(type, merged[type] || [])));
    root.appendChild(frag);
  }

  function makeTypeSection(type, list) {
    const section = document.createElement('div');
    section.className = 'ps-type';

    const head = document.createElement('div');
    head.className = 'ps-type-head';
    head.innerHTML = `<span class="ps-type-name">${esc(CLOUD_LABELS[type] || type)}</span><span class="ps-type-count">${list.length}</span>`;
    section.appendChild(head);

    const listEl = document.createElement('div');
    listEl.className = 'ps-list';
    const shown = Math.min(list.length, 20);
    for (let i = 0; i < shown; i++) listEl.appendChild(makeCard(type, list[i]));
    if (list.length > shown) {
      const more = document.createElement('button');
      more.className = 'ps-more';
      more.textContent = `展开剩余 ${list.length - shown} 条`;
      more.addEventListener('click', () => {
        for (let i = shown; i < list.length; i++) listEl.insertBefore(makeCard(type, list[i]), more);
        more.remove();
      });
      listEl.appendChild(more);
    }
    section.appendChild(listEl);
    return section;
  }

  function makeCard(type, item) {
    const card = document.createElement('div');
    card.className = 'ps-card';
    card.dataset.url = item.url || '';
    card.dataset.type = type;
    card.dataset.password = item.password || '';

    const img = (item.images && item.images[0])
      ? `<img class="ps-thumb" src="${esc(item.images[0])}" loading="lazy" alt="" onerror="this.style.display='none'">`
      : '';
    const pwd = item.password ? `<span class="ps-pwd">提取码：${esc(item.password)}</span>` : '';
    const src = item.source ? `<span class="ps-source">${esc(item.source)}</span>` : '';
    const dt = item.datetime ? `<span class="ps-date">${esc(fmtDate(item.datetime))}</span>` : '';
    const bothBtn = item.password
      ? `<button class="ps-copy-both">复制链接+码</button>`
      : '';

    card.innerHTML = `
      ${img}
      <div class="ps-card-body">
        <div class="ps-note">${esc(item.note || '(无标题)')}</div>
        <div class="ps-meta">${src}${dt}</div>
        <div class="ps-url" title="${esc(item.url || '')}">${esc(item.url || '')}</div>
        <div class="ps-pwdrow">${pwd}</div>
        <div class="ps-actions">
          <button class="ps-copy-url">复制链接</button>
          ${bothBtn}
          <a class="ps-open" href="${esc(item.url || '#')}" target="_blank" rel="noopener noreferrer">打开↗</a>
          <span class="ps-state"></span>
        </div>
      </div>`;

    card.querySelector('.ps-copy-url').addEventListener('click', () => copyText(item.url || ''));
    const both = card.querySelector('.ps-copy-both');
    if (both) both.addEventListener('click', () => copyText(`${item.url || ''} 提取码:${item.password || ''}`));
    return card;
  }

  /* ============================================================
   * 5b. 本地缓存 / 搜索历史 / 结果导出
   * ============================================================ */
  function cacheKey(kw, types, inc, exc) {
    return `pansou_cache::${encodeURIComponent(kw)}::${types.join(',')}::${encodeURIComponent(inc)}::${encodeURIComponent(exc)}`;
  }
  function getCache(key) {
    try { return JSON.parse(GM_getValue(key, 'null')); } catch (e) { return null; }
  }
  function setCache(key, data) {
    try { GM_setValue(key, JSON.stringify(data)); } catch (e) { /* 超出存储上限则忽略 */ }
  }
  function fmtAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return s + ' 秒前';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
    return fmtDate(new Date(ts).toISOString());
  }

  function loadHistory() {
    try {
      history = JSON.parse(GM_getValue('pansou_history', '[]'));
      if (!Array.isArray(history)) history = [];
    } catch (e) { history = []; }
  }
  function saveHistory(kw) {
    kw = (kw || '').trim(); if (!kw) return;
    history = history.filter((h) => h !== kw);
    history.unshift(kw);
    if (history.length > 10) history = history.slice(0, 10);
    try { GM_setValue('pansou_history', JSON.stringify(history)); } catch (e) {}
    pruneCache();
  }
  function pruneCache() {
    // 只保留历史列表中关键词的缓存，自动裁剪被挤出历史的旧缓存，防止长期膨胀
    if (typeof GM_listValues !== 'function') return;
    const keep = history.map((h) => 'pansou_cache::' + encodeURIComponent(h) + '::');
    GM_listValues().forEach((k) => {
      if (k.indexOf('pansou_cache::') === 0 && !keep.some((p) => k.indexOf(p) === 0)) GM_deleteValue(k);
    });
  }
  function deleteHistoryAndCache(kw) {
    // 删历史记录
    history = history.filter((x) => x !== kw);
    try { GM_setValue('pansou_history', JSON.stringify(history)); } catch (e) {}
    // 联动删除该关键词下的所有缓存变体（不同网盘类型 / 过滤组合都带 kw 前缀）
    const prefix = 'pansou_cache::' + encodeURIComponent(kw) + '::';
    if (typeof GM_listValues === 'function') {
      GM_listValues().forEach((k) => { if (k.indexOf(prefix) === 0) GM_deleteValue(k); });
    }
  }
  function clearAllCache() {
    let n = 0;
    if (typeof GM_listValues === 'function') {
      GM_listValues().forEach((k) => { if (k.indexOf('pansou_cache::') === 0) { GM_deleteValue(k); n++; } });
    }
    setSettingsMsg(`已清空 ${n} 条本地缓存`, false);
    updateCacheCount();
    toast(`已清空 ${n} 条本地缓存`);
  }
  function updateCacheCount() {
    let n = 0;
    if (typeof GM_listValues === 'function') {
      GM_listValues().forEach((k) => { if (k.indexOf('pansou_cache::') === 0) n++; });
    }
    const el = $('#ps-cache-msg');
    if (el) el.textContent = `当前本地缓存 ${n} 条`;
  }
  function renderHistory(filter) {
    const box = $('#ps-history');
    const f = (filter || '').trim().toLowerCase();
    const list = history.filter((h) => !f || h.toLowerCase().includes(f));
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = '<div class="ps-history-empty">' + (f ? '无匹配历史' : '暂无搜索历史') + '</div>';
      return;
    }
    list.forEach((h) => {
      const item = document.createElement('div');
      item.className = 'ps-history-item';
      item.innerHTML = `<span class="ps-hist-kw">${esc(h)}</span><span class="ps-history-del" title="删除该记录">✕</span>`;
      item.querySelector('.ps-hist-kw').addEventListener('click', () => {
        $('#ps-kw').value = h; hideHistory(); doSearch();
      });
      item.querySelector('.ps-history-del').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteHistoryAndCache(h);
        renderHistory($('#ps-kw').value);
      });
      box.appendChild(item);
    });
  }
  function showHistory() {
    const b = $('#ps-history');
    b.classList.remove('ps-hidden');
    renderHistory($('#ps-kw').value);
  }
  function hideHistory() {
    const b = $('#ps-history');
    if (b) b.classList.add('ps-hidden');
  }

  function exportResults() {
    const merged = lastMerged || {};
    const types = currentTabKey === 'all' ? Object.keys(merged) : [currentTabKey];
    if (!types.length) { toast('没有可导出的结果'); return; }
    const kw = ($('#ps-kw').value || '').trim() || '(未指定)';
    let md = `# PanSou 搜索：${kw}\n> 导出时间：${fmtDate(new Date().toISOString())} · 来源：${cfg.baseUrl}\n\n`;
    let count = 0;
    types.forEach((t) => {
      const list = merged[t] || [];
      if (!list.length) return;
      md += `## ${CLOUD_LABELS[t] || t} (${list.length})\n`;
      list.forEach((it) => {
        md += `- [${it.note || '(无标题)'}](${it.url || ''})`
          + `${it.password ? '  提取码:' + it.password : ''}`
          + `${it.source ? '  来源:' + it.source : ''}`
          + `${it.datetime ? '  时间:' + fmtDate(it.datetime) : ''}\n`;
        count++;
      });
      md += '\n';
    });
    copyText(md, true);
    toast(`已复制 ${count} 条结果为 Markdown`);
  }

  /* ============================================================
   * 6. 链接有效性检测
   * ============================================================ */
  function stateLabel(s) {
    if (s === 'ok') return '有效';
    if (s === 'bad') return '失效';
    if (s === 'locked') return '加密/锁定';
    if (s === 'uncertain') return '未知';
    return s || '';
  }

  async function checkLinks() {
    const cards = $$('#ps-results .ps-card');
    const items = [];
    cards.forEach((c) => {
      const url = c.dataset.url, pwd = c.dataset.password, type = c.dataset.type;
      if (url) items.push({ disk_type: type, url, password: pwd });
    });
    if (!items.length) { setStatus('当前没有可检测的链接，请先搜索', true); return; }

    const btn = $('#ps-btn-check');
    btn.disabled = true; btn.textContent = '检测中…';
    setStatus(`正在检测 ${items.length} 个链接（结果仅供参考）…`);

    let results;
    try {
      results = await withAuth(() => apiCheckLinks(cfg.baseUrl, items));
    } catch (e) {
      setStatus('检测失败：' + friendlyError(e), true);
      btn.disabled = false; btn.textContent = '检测失效链接';
      return;
    }

    const byUrl = {};
    results.forEach((r) => { byUrl[r.url] = r; });
    let ok = 0, bad = 0, locked = 0, uncertain = 0;
    cards.forEach((c) => {
      const r = byUrl[c.dataset.url];
      const stateEl = c.querySelector('.ps-state');
      if (!r) { stateEl.textContent = ''; return; }
      const s = r.state;
      if (s === 'ok') ok++; else if (s === 'bad') bad++; else if (s === 'locked') locked++; else uncertain++;
      stateEl.className = 'ps-state ps-state-' + s;
      stateEl.textContent = stateLabel(s);
      stateEl.title = r.summary || '';
      if (s === 'bad' || s === 'locked') c.classList.add('ps-dead');
    });

    setStatus(`检测完成：有效 ${ok} · 失效 ${bad} · 加密/锁定 ${locked} · 未知 ${uncertain}（结果仅供参考）`);
    btn.disabled = false; btn.textContent = '检测失效链接';
  }

  /* ============================================================
   * 7. 设置
   * ============================================================ */
  async function saveSettings() {
    const name = ($('#ps-base-name').value || '').trim();
    const v = ($('#ps-base-input').value || '').trim();
    if (!v) { setSettingsMsg('地址不能为空', true); return; }
    // 持久化到当前活动后端（含认证字段）
    const arr = loadProfiles();
    const id = GM_getValue('pansou_active', 'demo');
    const p = arr.find((x) => x.id === id) || arr[0];
    p.name = name || normalizeBase(v);
    p.baseUrl = normalizeBase(v);
    p.authUser = ($('#ps-auth-user').value || '').trim();
    p.authPass = ($('#ps-auth-pass').value || '').trim();
    const at = ($('#ps-auth-token').value || '').trim();
    if (at) { p.authToken = at; p.authExp = 0; }
    saveProfiles(arr);
    renderProfiles(document);
    setSettingsMsg('已保存，正在测试连接…', false);
    try {
      const h = await apiHealth(cfg.baseUrl);
      let msg = `✓ 可达 · 认证:${h.auth_enabled ? '开启' : '关闭'} · 频道:${h.channels_count} · 插件:${h.plugin_count}`;
      if (h.auth_enabled) {
        // 后端要求认证：保证持有令牌
        if (auth.token) {
          msg += '\n✓ 已配置令牌，将随请求携带 Authorization 头';
        } else if (auth.user && auth.pass) {
          try {
            const r = await apiLogin(cfg.baseUrl, auth.user, auth.pass);
            auth.token = r.token; auth.exp = (r.expires_at ? r.expires_at * 1000 : 0);
            msg += '\n✓ 已用填写的账号自动登录并获取令牌';
          } catch (e2) {
            msg += '\n⚠ 后端已开启认证但自动登录失败：' + friendlyError(e2) + '（请在“认证”分区手动登录或填令牌）';
          }
        } else {
          msg += '\n⚠ 后端已开启认证：请在“认证”分区填写账号密码或令牌后再搜索';
        }
      } else if (auth.token) {
        // 后端未开启认证：清掉可能残留的过期令牌，避免误导
        auth.clear();
        msg += '\n（已清除本地残留令牌，后端当前无需认证）';
      }
      setSettingsMsg(msg, false);
      toast('后端连接正常');
      refreshAuthState(document);
    } catch (e) {
      setSettingsMsg('✗ 无法连接：' + friendlyError(e), true);
    }
  }

  async function doLogin(scope) {
    const base = cfg.baseUrl;
    const user = ($('#ps-auth-user', scope).value || '').trim();
    const pass = ($('#ps-auth-pass', scope).value || '').trim();
    const msg = $('#ps-auth-msg', scope);
    if (!user || !pass) { msg.textContent = '请填写用户名和密码'; msg.className = 'ps-settings-msg ps-err'; return; }
    msg.textContent = '登录中…'; msg.className = 'ps-settings-msg';
    try {
      const r = await apiLogin(base, user, pass);
      auth.token = r.token; auth.exp = (r.expires_at ? r.expires_at * 1000 : 0);
      auth.user = user; auth.pass = pass;
      msg.textContent = '✓ 登录成功，令牌已保存'
        + (r.expires_at ? '（有效期至 ' + fmtDate(new Date(r.expires_at * 1000).toISOString()) + '）' : '');
      msg.className = 'ps-settings-msg ps-ok';
      refreshAuthState(scope);
    } catch (e) {
      msg.textContent = '✗ 登录失败：' + friendlyError(e); msg.className = 'ps-settings-msg ps-err';
    }
  }

  function saveManualToken(scope) {
    const t = ($('#ps-auth-token', scope).value || '').trim();
    const m = $('#ps-auth-msg', scope);
    if (!t) { m.textContent = '令牌不能为空'; m.className = 'ps-settings-msg ps-err'; return; }
    auth.token = t; auth.exp = 0; // 手动令牌不记过期
    m.textContent = '✓ 令牌已保存'; m.className = 'ps-settings-msg ps-ok';
    refreshAuthState(scope);
  }

  function refreshAuthState(scope) {
    const el = $('#ps-auth-state', scope); if (!el) return;
    if (!auth.token) {
      el.textContent = '当前状态：未携带令牌（后端若开启认证，搜索会被拒绝）';
      el.className = 'ps-auth-state';
      return;
    }
    const expTxt = auth.exp ? ('，约 ' + fmtAgo(auth.exp) + '过期') : '（手动令牌，不过期）';
    el.textContent = '当前状态：已携带令牌' + expTxt;
    el.className = 'ps-auth-state ps-auth-ok';
  }

  /* ============================================================
   * 7b. 多后端管理（profile 列表 / 选中 / 新增 / 删除）
   * ============================================================ */
  async function renderProfiles(scope) {
    const box = $('#ps-profiles', scope);
    if (!box) return;
    const arr = loadProfiles();
    const activeId = GM_getValue('pansou_active', 'demo');
    box.innerHTML = '';
    arr.forEach((p) => {
      const item = document.createElement('div');
      item.className = 'ps-profile-item' + (p.id === activeId ? ' ps-profile-active' : '');
      item.dataset.id = p.id;
      item.innerHTML = `
        <div class="ps-profile-main">
          <div class="ps-profile-name">${esc(p.name || '(未命名)')}</div>
          <div class="ps-profile-url">${esc(p.baseUrl || '')}</div>
        </div>`;
      if (p.locked) {
        const lock = document.createElement('span');
        lock.className = 'ps-profile-lock';
        lock.textContent = '🔒';
        lock.title = '默认演示站，不可删除';
        item.appendChild(lock);
      } else {
        const del = document.createElement('button');
        del.className = 'ps-profile-del';
        del.textContent = '✕';
        del.title = '删除此后端';
        del.addEventListener('click', (e) => { e.stopPropagation(); deleteProfile(p.id, scope); });
        item.appendChild(del);
      }
      item.addEventListener('click', () => selectProfile(p.id, scope));
      box.appendChild(item);
    });
  }

  function selectProfile(id, scope) {
    setActiveProfile(id);
    const p = getActiveProfile();
    $('#ps-base-name', scope).value = p.name || '';
    $('#ps-base-input', scope).value = p.baseUrl || '';
    $('#ps-auth-user', scope).value = p.authUser || '';
    $('#ps-auth-pass', scope).value = p.authPass || '';
    $('#ps-auth-token', scope).value = p.authToken || '';
    const delBtn = $('#ps-btn-del-profile', scope);
    if (delBtn) delBtn.disabled = !!p.locked;
    refreshAuthState(scope);
    renderProfiles(scope);
  }

  function addProfile(scope) {
    const arr = loadProfiles();
    const np = { id: genId(), name: '新建后端', baseUrl: DEFAULT_BASE, locked: false,
                 authUser: '', authPass: '', authToken: '', authExp: 0 };
    arr.push(np);
    saveProfiles(arr);
    setActiveProfile(np.id);
    renderProfiles(scope);
    $('#ps-base-name', scope).value = np.name;
    $('#ps-base-input', scope).value = np.baseUrl;
    $('#ps-auth-user', scope).value = '';
    $('#ps-auth-pass', scope).value = '';
    $('#ps-auth-token', scope).value = '';
    const delBtn = $('#ps-btn-del-profile', scope);
    if (delBtn) delBtn.disabled = false;
    refreshAuthState(scope);
    const nameInput = $('#ps-base-name', scope);
    if (nameInput) { nameInput.focus(); nameInput.select(); }
    toast('已新增后端，填写地址与认证后点「保存并测试连接」');
  }

  function deleteProfile(id, scope) {
    const arr = loadProfiles();
    const p = arr.find((x) => x.id === id);
    if (!p || p.locked) { toast('演示站不可删除'); return; }
    if (!confirm('确定删除后端「' + (p.name || p.baseUrl) + '」？此操作不可恢复')) return;
    const newArr = arr.filter((x) => x.id !== id);
    saveProfiles(newArr);
    if (GM_getValue('pansou_active', 'demo') === id) {
      setActiveProfile(newArr[0] ? newArr[0].id : 'demo');
    }
    const np = getActiveProfile();
    $('#ps-base-name', scope).value = np.name || '';
    $('#ps-base-input', scope).value = np.baseUrl || '';
    $('#ps-auth-user', scope).value = np.authUser || '';
    $('#ps-auth-pass', scope).value = np.authPass || '';
    $('#ps-auth-token', scope).value = np.authToken || '';
    const delBtn = $('#ps-btn-del-profile', scope);
    if (delBtn) delBtn.disabled = !!np.locked;
    refreshAuthState(scope);
    renderProfiles(scope);
    toast('已删除后端');
  }

  /* ============================================================
   * 8. 样式
   * ============================================================ */
  GM_addStyle(`
    /* 触发条：默认贴右上角、距顶 15%（半球），hover 鼓成整球；拖拽后吸附左/右边缘变成竖立半球 */
    /* 尺寸单点控制在 JS 常量 LAUNCHER_SIZE（整球直径）：半球 = 直径 × 半径，圆角 = 半径 */
    #ps-launcher{position:fixed;z-index:2147483646;cursor:pointer;
      display:flex;align-items:center;justify-content:center;
      background:#4169e1;color:#fff;font:13px/1 "Microsoft YaHei",sans-serif;
      user-select:none;-webkit-user-select:none;-webkit-user-drag:none;touch-action:none;
      box-shadow:0 1px 6px rgba(0,0,0,.28);overflow:hidden;white-space:nowrap;
      transition:width .22s ease,height .22s ease,border-radius .22s ease,
                 left .22s ease,right .22s ease,top .22s ease,box-shadow .2s ease;}
    #ps-launcher:hover{box-shadow:0 4px 14px rgba(65,105,225,.45);}
    #ps-launcher .ps-launch-ico{font-size:${Math.round(LAUNCHER_SIZE * 2 / 3)}px;line-height:1;
      opacity:0;transition:opacity .18s ease;}
    /* 半球只有半径那么高，图标留着会被裁成半截 → 静止只显示纯色凸起，hover / 整球时才淡入图标 */
    #ps-launcher:hover .ps-launch-ico{opacity:1;}
    /* 贴边半球：贴边方向两角直角，朝页面内侧两角圆化（半径） */
    .ps-dock-top{top:0;right:0;width:${LAUNCHER_SIZE}px;height:${LAUNCHER_HALF}px;border-radius:0 0 ${LAUNCHER_HALF}px ${LAUNCHER_HALF}px;}
    #ps-launcher.ps-dock-top:hover{height:${LAUNCHER_SIZE}px;border-radius:${LAUNCHER_HALF}px;}
    .ps-dock-left{top:0;left:0;width:${LAUNCHER_HALF}px;height:${LAUNCHER_SIZE}px;border-radius:0 ${LAUNCHER_HALF}px ${LAUNCHER_HALF}px 0;}
    #ps-launcher.ps-dock-left:hover{width:${LAUNCHER_SIZE}px;border-radius:${LAUNCHER_HALF}px;}
    .ps-dock-right{top:0;right:0;width:${LAUNCHER_HALF}px;height:${LAUNCHER_SIZE}px;border-radius:${LAUNCHER_HALF}px 0 0 ${LAUNCHER_HALF}px;}
    #ps-launcher.ps-dock-right:hover{width:${LAUNCHER_SIZE}px;border-radius:${LAUNCHER_HALF}px;}
    /* 拖拽中：自由跟随指针，不做位置过渡 */
    .ps-floating{width:${LAUNCHER_SIZE}px;height:${LAUNCHER_SIZE}px;border-radius:${LAUNCHER_HALF}px;}
    .ps-grabbing,.ps-dragging{transition:none;cursor:grabbing;}
    .ps-dragging{box-shadow:0 6px 18px rgba(65,105,225,.5);}
    #ps-backdrop{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);
      display:none;align-items:flex-start;justify-content:center;padding:24px 12px;overflow:auto;}
    #ps-backdrop.ps-open{display:flex;}
    #ps-panel{width:min(920px,100%);max-height:92vh;display:flex;flex-direction:column;
      background:#f2faff;border:1px solid #e4e4e4;border-radius:12px;overflow:hidden;
      font-family:"Microsoft YaHei",sans-serif;color:#222;box-shadow:0 12px 40px rgba(0,0,0,.3);}
    #ps-header{display:flex;align-items:center;justify-content:space-between;
      padding:12px 16px;background:#4169e1;color:#fff;}
    #ps-title{font-size:16px;font-weight:600;}
    .ps-head-actions{display:flex;gap:8px;}
    .ps-icon-btn{background:rgba(255,255,255,.18);border:none;color:#fff;width:30px;height:30px;
      border-radius:6px;cursor:pointer;font-size:15px;}
    .ps-icon-btn:hover{background:rgba(255,255,255,.32);}
    #ps-settings{padding:12px 16px;background:#eaf2ff;border-bottom:1px solid #e4e4e4;}
    #ps-settings.ps-hidden{display:none;}
    #ps-settings label{display:block;font-size:13px;color:#333;margin-bottom:8px;}
    .ps-setting-toggle{display:flex;align-items:center;gap:6px;font-size:13px;color:#333;cursor:pointer;user-select:none;line-height:1.4;}
    #ps-settings input{width:100%;box-sizing:border-box;padding:8px 10px;margin-top:4px;
      border:1px solid #c9d6f0;border-radius:6px;font-size:13px;}
    .ps-settings-row{display:flex;align-items:center;gap:10px;}
    .ps-settings-msg{font-size:12px;white-space:pre-wrap;word-break:break-word;}
    .ps-settings-msg.ps-ok{color:#1a8a3c;}
    .ps-settings-msg.ps-err{color:#d33;}
    .ps-auth{margin:10px 0 4px;font-size:13px;border-top:1px dashed #e4e4e4;padding-top:6px;}
    .ps-auth summary{cursor:pointer;color:#4169e1;user-select:none;padding:4px 0;}
    .ps-auth-grid{display:flex;flex-direction:column;gap:10px;padding:10px 0;}
    .ps-auth-grid label{display:block;color:#444;}
    .ps-auth-grid input{width:100%;box-sizing:border-box;padding:7px 10px;margin-top:4px;
      border:1px solid #c9d6f0;border-radius:6px;font-size:13px;}
    .ps-auth-state{font-size:12px;color:#888;white-space:pre-wrap;word-break:break-word;margin-top:4px;}
    .ps-auth-state.ps-auth-ok{color:#1a8a3c;}

    /* ===== 多后端列表 ===== */
    .ps-profiles-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
    .ps-profiles-title{font-size:13px;font-weight:600;color:#333;}
    .ps-sm{padding:4px 10px;font-size:12px;}
    .ps-profiles{display:flex;flex-direction:column;gap:6px;margin-bottom:12px;max-height:220px;overflow:auto;}
    .ps-profile-item{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#fff;
      border:1px solid #c9d6f0;border-radius:8px;cursor:pointer;user-select:none;}
    .ps-profile-item:hover{border-color:#4169e1;background:#eaf2ff;}
    .ps-profile-active{border-color:#4169e1;background:#eaf2ff;box-shadow:0 0 0 1px #4169e1 inset;}
    .ps-profile-main{flex:1;min-width:0;}
    .ps-profile-name{font-size:13px;font-weight:600;color:#222;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .ps-profile-url{font-size:11px;color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px;}
    .ps-profile-del{flex-shrink:0;background:none;border:none;color:#bbb;font-size:14px;cursor:pointer;
      padding:2px 5px;border-radius:4px;line-height:1;}
    .ps-profile-del:hover{color:#d33;background:#fde2e2;}
    .ps-profile-lock{flex-shrink:0;font-size:13px;opacity:.7;}
    .ps-danger{background:#d9534f;}
    .ps-danger:hover{background:#c9302c;}
    .ps-danger:disabled{background:#e0a8a6;cursor:default;}
    .ps-controls{display:flex;gap:8px;padding:14px 16px;background:#fff;border-bottom:1px solid #e4e4e4;flex-wrap:wrap;}
    .ps-kw-wrap{flex:1;position:relative;min-width:200px;}
    .ps-kw-wrap input{width:100%;box-sizing:border-box;padding:9px 12px;border:1px solid #c9d6f0;border-radius:6px;font-size:14px;}
    .ps-history{position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:20;background:#fff;
      border:1px solid #c9d6f0;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.15);max-height:260px;overflow:auto;}
    .ps-history.ps-hidden{display:none;}
    .ps-history-empty{padding:8px 12px;font-size:12px;color:#999;}
    .ps-history-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;
      font-size:13px;color:#333;cursor:pointer;border-bottom:1px solid #f0f0f0;}
    .ps-history-item:last-child{border-bottom:none;}
    .ps-history-item:hover{background:#eaf2ff;}
    .ps-hist-kw{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}
    .ps-history-del{color:#bbb;font-size:12px;padding:0 2px;flex-shrink:0;}
    .ps-history-del:hover{color:#d33;}
    .ps-controls button,.ps-tabs-check,#ps-btn-save,#ps-btn-clear-cache{padding:8px 14px;border:none;border-radius:6px;cursor:pointer;font-size:13px;color:#fff;font-family:inherit;transition:background .15s;}
    .ps-primary{background:#4169e1;}
    .ps-primary:hover{background:#3354b8;}
    .ps-primary:disabled{background:#9fb4e6;cursor:default;}
    .ps-secondary{background:#6c8ce0;}
    .ps-secondary:hover{background:#5a7bd0;}
    .ps-secondary:disabled{background:#aab9e6;cursor:default;}
    .ps-filters{padding:8px 16px;background:#fff;border-bottom:1px solid #e4e4e4;font-size:13px;}
    .ps-filters summary{cursor:pointer;color:#4169e1;user-select:none;padding:4px 0;}
    .ps-filter-grid{display:flex;flex-direction:column;gap:10px;padding:10px 0;}
    .ps-filter-grid label{display:block;color:#444;}
    .ps-filter-grid input{width:100%;box-sizing:border-box;padding:7px 10px;margin-top:4px;
      border:1px solid #c9d6f0;border-radius:6px;font-size:13px;}
    .ps-types{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}
    .ps-chip-box{display:contents;}
    .ps-chip{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:#333;
      background:#fff;border:1px solid #c9d6f0;border-radius:14px;padding:3px 10px;cursor:pointer;user-select:none;}
    .ps-chip:hover{border-color:#4169e1;background:#eaf2ff;}
    .ps-chip input{margin:0;vertical-align:middle;cursor:pointer;}
    .ps-refresh-inline{display:inline-flex;align-items:center;gap:5px;font-size:13px;color:#333;cursor:pointer;user-select:none;white-space:nowrap;
      background:#eaf2ff;border:1px solid #c9d6f0;border-radius:14px;padding:5px 10px;}
    .ps-refresh-inline input{margin:0;cursor:pointer;accent-color:#4169e1;}
    #ps-panel input[type=checkbox]{accent-color:#4169e1;}
    #ps-status{padding:8px 16px;font-size:13px;color:#555;min-height:18px;}
    .ps-status-err{color:#d33;}
    #ps-header,#ps-settings,.ps-controls,.ps-filters,#ps-status{flex-shrink:0;}
    .ps-tabs-row{display:flex;align-items:center;gap:10px;padding:10px 16px 8px;background:#f2faff;border-bottom:1px solid #e4e4e4;}
    .ps-tabs{display:flex;flex-wrap:wrap;gap:6px;flex:1;align-content:flex-start;min-width:0;}
    .ps-tabs.ps-hidden{display:none;}
    .ps-tabs-check{flex-shrink:0;white-space:nowrap;}
    .ps-tab{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border:1px solid #c9d6f0;background:#fff;
      border-radius:16px;cursor:pointer;font-size:13px;color:#333;user-select:none;}
    .ps-tab:hover{border-color:#4169e1;background:#eaf2ff;}
    .ps-tab-active{background:#4169e1;border-color:#4169e1;color:#fff;}
    .ps-tab-count{background:rgba(0,0,0,.08);color:inherit;font-size:11px;border-radius:9px;padding:0 6px;}
    .ps-tab-active .ps-tab-count{background:rgba(255,255,255,.28);}
    #ps-results{overflow:auto;padding:6px 16px 18px;background:#f2faff;flex:1 1 auto;min-height:0;}
    .ps-empty{padding:40px 0;text-align:center;color:#888;font-size:14px;}
    .ps-type{margin:12px 0;}
    .ps-type-head{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:2px solid #4169e1;margin-bottom:8px;}
    .ps-type-name{font-weight:700;color:#4169e1;font-size:15px;}
    .ps-type-count{background:#4169e1;color:#fff;font-size:12px;border-radius:10px;padding:1px 8px;}
    .ps-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;}
    .ps-card{display:flex;gap:10px;background:#fff;border:1px solid #e4e4e4;border-radius:8px;padding:10px;
      box-shadow:0 1px 3px rgba(0,0,0,.05);}
    .ps-card.ps-dead{opacity:.55;}
    .ps-thumb{width:64px;height:64px;object-fit:cover;border-radius:6px;flex-shrink:0;background:#eee;}
    .ps-card-body{flex:1;min-width:0;}
    .ps-note{font-size:14px;font-weight:600;color:#222;line-height:1.35;word-break:break-word;}
    .ps-meta{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:#999;margin:3px 0;}
    .ps-url{font-size:11px;color:#3a6;word-break:break-all;margin:2px 0;line-height:1.3;}
    .ps-pwdrow{font-size:12px;color:#d2691e;margin:2px 0;}
    .ps-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:4px;}
    .ps-actions button,.ps-open{padding:4px 9px;border:none;border-radius:5px;cursor:pointer;font-size:12px;
      background:#eaf2ff;color:#4169e1;text-decoration:none;}
    .ps-actions button:hover,.ps-open:hover{background:#d6e4ff;}
    /* 「打开↗」是 <a>，宿主站点的暗色主题常带 a{color:#fff}（含 !important），
       会把浅蓝底上的字刷成白色看不清；这里提权拉回与复制按钮一致的蓝字 */
    .ps-actions .ps-open{color:#4169e1 !important;}
    .ps-actions .ps-open:visited{color:#4169e1 !important;}   /* 访问过的链接也不许被刷白 */
    .ps-state{font-size:11px;padding:2px 7px;border-radius:9px;margin-left:auto;}
    .ps-state-ok{background:#e3f6e8;color:#1a8a3c;}
    .ps-state-bad{background:#fde2e2;color:#d33;}
    .ps-state-locked{background:#fff0d6;color:#b9770e;}
    .ps-state-uncertain{background:#eee;color:#888;}
    .ps-more{margin:10px auto;display:block;padding:6px 16px;border:1px dashed #4169e1;background:#fff;
      color:#4169e1;border-radius:6px;cursor:pointer;font-size:13px;}
    .ps-more:hover{background:#eaf2ff;}
    .ps-toast{position:fixed;left:50%;bottom:40px;transform:translateX(-50%) translateY(20px);
      background:rgba(0,0,0,.8);color:#fff;padding:8px 16px;border-radius:20px;font-size:13px;z-index:2147483647;
      opacity:0;transition:.25s;pointer-events:none;}
    .ps-toast-show{opacity:1;transform:translateX(-50%) translateY(0);}

    /* ===== 移动端适配（窄屏 / 无悬停的触屏设备） ===== */
    @media (max-width:768px), (hover:none) {
      /* 触发条：触屏无 hover，常驻 44×44 整球保证点按区（比桌面大一圈）、避开刘海 */
      #ps-launcher{top:env(safe-area-inset-top,0);width:44px;height:44px;border-radius:22px;}
      #ps-launcher.ps-dock-top{top:env(safe-area-inset-top,0);width:44px;height:44px;border-radius:22px;}
      #ps-launcher.ps-dock-left,#ps-launcher.ps-dock-right{width:44px;height:44px;border-radius:22px;}
      .ps-floating{width:44px;height:44px;border-radius:22px;}
      #ps-launcher .ps-launch-ico{font-size:20px;opacity:1;}
      /* 弹窗占满屏宽并让出安全区，移除圆角做成全屏面板 */
      #ps-backdrop{padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px);}
      #ps-panel{width:100%;border-radius:0;
        max-height:calc(100vh - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));}
      /* 输入框字号 >=16px，避免 iOS 聚焦时页面强制放大 */
      .ps-kw-wrap input,.ps-filter-grid input,#ps-settings input{font-size:16px;}
      /* 搜索栏：输入框独占一行，按钮换行排布，并放大点按区 */
      .ps-controls{padding:12px;gap:10px;}
      .ps-kw-wrap{flex:1 1 100%;min-width:0;order:-1;}
      .ps-controls button,.ps-tabs-check,#ps-btn-save,#ps-btn-clear-cache{padding:11px 16px;font-size:15px;}
      .ps-refresh-inline{font-size:14px;padding:8px 12px;}
      /* 卡片操作按钮与类型 chips 放大，手指更好点 */
      .ps-actions button,.ps-open{padding:9px 13px;font-size:14px;}
      .ps-chip{padding:7px 13px;font-size:14px;}
      .ps-tab{font-size:14px;padding:8px 14px;}
      /* 结果文字放大，更易读 */
      .ps-note{font-size:16px;}
      .ps-pwdrow{font-size:13px;}
      /* 内部滚动更跟手 */
      #ps-results{-webkit-overflow-scrolling:touch;}
      /* 窄屏卡片列表强制单列 */
      .ps-list{grid-template-columns:1fr;}
    }
  `);

  /* ============================================================
   * 9. 启动
   * ============================================================ */
  if (document.body) applyLauncherVisibility();
  else window.addEventListener('DOMContentLoaded', applyLauncherVisibility);

  // 在 Tampermonkey 脚本菜单中注册命令（点击扩展图标 → 脚本名 → 命令）
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('打开 PanSou 搜索框', openPanel);
    GM_registerMenuCommand('显示/隐藏触发条', toggleLauncher);
    GM_registerMenuCommand('重置触发条位置', resetLauncherPos);
  }

  // 暴露给控制台调试（可选）
  window.__panSou = { apiHealth, apiSearch, apiCheckLinks, apiLogin, ensureToken, auth, cfg,
                      loadProfiles, saveProfiles, getActiveProfile, renderProfiles,
                      resetLauncherPos, applyLauncherPos, openPanel };
})();
