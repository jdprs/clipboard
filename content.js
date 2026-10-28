/* 摘板 ClipBoard — content script
 * 注入一个 Shadow DOM 悬浮面板：跨标签页常驻、可拖拽/缩放/贴边隐藏/钉住，
 * 支持临时分组、卡片拖拽排序、单条打标记、来源跳转。
 * 所有状态从 chrome.storage.local.zb_state 读写，多标签页自动同步。
 */
(function () {
  if (window.__zb_injected) return;
  window.__zb_injected = true;

  const HOST_ID = "zhaiban-clipboard-host";

  const CSS = `
    :host, * { box-sizing: border-box; }
    .zb-wrap { all: initial; }
    .zb-panel {
      position: fixed; z-index: 2147483646;
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      background: #ffffff; color: #1f2329;
      border: 1px solid #dee0e3; border-radius: 10px;
      box-shadow: 0 8px 30px rgba(0,0,0,.18);
      display: flex; flex-direction: column; overflow: hidden;
      width: 360px; height: 440px;
    }
    .zb-panel.zb-pinned { z-index: 2147483647; border-color: #3370ff; }
    .zb-header {
      display: flex; align-items: center; gap: 6px;
      padding: 8px 10px; background: #f5f6f7; border-bottom: 1px solid #e5e6eb;
      cursor: grab; user-select: none; flex: 0 0 auto;
    }
    .zb-header:active { cursor: grabbing; }
    .zb-title { font-weight: 600; font-size: 13px; color: #1f2329; margin-right: 2px; }
    .zb-grip { color: #8a8f99; font-size: 12px; }
    .zb-group-select {
      flex: 1; min-width: 0; max-width: 140px;
      font-size: 12px; padding: 3px 4px; border: 1px solid #dee0e3;
      border-radius: 6px; background: #fff; color: #1f2329; cursor: pointer;
    }
    .zb-btn {
      width: 24px; height: 24px; border: none; background: transparent;
      border-radius: 6px; cursor: pointer; font-size: 13px; color: #4e5561;
    }
    .zb-btn:hover { background: #e5e6eb; }
    .zb-btn.zb-on { background: #3370ff; color: #fff; }
    .zb-clips { flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px; }
    .zb-empty { margin: auto; text-align: center; color: #8a8f99; font-size: 12px; line-height: 1.8; padding: 20px; }
    .zb-card {
      border: 1px solid #e5e6eb; border-radius: 8px; background: #fff;
      padding: 8px; font-size: 12.5px; line-height: 1.5; cursor: grab;
    }
    .zb-card:active { cursor: grabbing; }
    .zb-card.zb-over { border-color: #3370ff; box-shadow: 0 0 0 2px rgba(51,112,255,.15); }
    .zb-card.zb-mark-重点 { border-left: 3px solid #f53f3f; }
    .zb-card.zb-mark-待确认 { border-left: 3px solid #ff7d00; }
    .zb-text { white-space: pre-wrap; word-break: break-word; max-height: 220px; overflow-y: auto; }
    .zb-img { max-width: 100%; border-radius: 6px; display: block; }
    .zb-card-foot { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
    .zb-src { flex: 1; min-width: 0; font-size: 11px; color: #3370ff; text-decoration: none;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .zb-src:hover { text-decoration: underline; }
    .zb-tag { font-size: 10px; padding: 1px 6px; border-radius: 10px; cursor: pointer;
      background: #f2f3f5; color: #4e5561; }
    .zb-tag.zb-tag-重点 { background: #ffece8; color: #f53f3f; }
    .zb-tag.zb-tag-待确认 { background: #fff7e8; color: #ff7d00; }
    .zb-del { border: none; background: transparent; cursor: pointer; color: #8a8f99; font-size: 14px; width: 20px; height: 20px; }
    .zb-del:hover { color: #f53f3f; }
    .zb-resize { position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize; }
    .zb-dock-tab {
      position: fixed; z-index: 2147483646;
      writing-mode: vertical-rl; padding: 14px 6px;
      background: #3370ff; color: #fff; font-size: 12px; border-radius: 8px;
      cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,.2);
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .zb-reopen {
      position: fixed; z-index: 2147483646; right: 16px; bottom: 16px;
      width: 44px; height: 44px; border-radius: 50%; background: #3370ff; color: #fff;
      display: flex; align-items: center; justify-content: center; cursor: pointer;
      font-size: 18px; box-shadow: 0 6px 20px rgba(51,112,255,.4);
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .zb-toast {
      position: fixed; left: 50%; bottom: 40px; transform: translateX(-50%);
      background: rgba(0,0,0,.8); color: #fff; padding: 8px 14px; border-radius: 20px;
      font-size: 12px; z-index: 2147483647; font-family: -apple-system, "PingFang SC", sans-serif;
    }
  `;

  let state = null;
  let host, root, panelEl = null;

  function defaultState() {
    const g0 = { id: "g-default", name: "默认分组", createdAt: Date.now() };
    return {
      groups: [g0],
      activeGroupId: g0.id,
      clips: [],
      panel: { x: 120, y: 100, w: 360, h: 440, visible: true, pinned: false, docked: null },
      settings: { retention: "session" }
    };
  }

  async function init() {
    try {
      const obj = await chrome.storage.local.get("zb_state");
      state = obj.zb_state || defaultState();
    } catch (_e) {
      state = defaultState();
    }
    buildHost();
    render();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.zb_state) {
        state = changes.zb_state.newValue || defaultState();
        render();
      }
    });

    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "ZB_CLIP_ADDED") toast(`已加入「${currentGroup().name}」`);
      if (msg?.type === "ZB_TOGGLE") {
        state.panel.visible = !state.panel.visible;
        if (state.panel.visible) state.panel.docked = null;
        save();
        render();
      }
    });

    bindGlobalPointer();
  }

  function buildHost() {
    host = document.createElement("div");
    host.id = HOST_ID;
    host.style.all = "initial";
    (document.documentElement || document.body).appendChild(host);
    root = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);
  }

  function save() {
    chrome.storage.local.set({ zb_state: state });
  }

  function currentGroup() {
    return state.groups.find((g) => g.id === state.activeGroupId) || state.groups[0];
  }

  function render() {
    // 清空除 <style> 外的节点
    [...root.children].forEach((c) => { if (c.tagName !== "STYLE") c.remove(); });

    const p = state.panel;

    // 贴边隐藏 → 渲染一个竖条标签
    if (p.docked) {
      const tab = document.createElement("div");
      tab.className = "zb-dock-tab";
      tab.textContent = `摘板 · ${currentGroup().name}`;
      tab.style.top = "50%";
      tab.style.transform = "translateY(-50%)";
      if (p.docked === "left") tab.style.left = "0px";
      else tab.style.right = "0px";
      tab.addEventListener("click", () => { p.docked = null; p.visible = true; save(); render(); });
      root.appendChild(tab);
      return;
    }

    // 隐藏 → 渲染一个悬浮圆形重开按钮
    if (!p.visible) {
      const b = document.createElement("div");
      b.className = "zb-reopen";
      b.title = "打开摘板";
      b.textContent = "板";
      b.addEventListener("click", () => { p.visible = true; save(); render(); });
      root.appendChild(b);
      return;
    }

    renderPanel();
  }

  function renderPanel() {
    const p = state.panel;
    panelEl = document.createElement("div");
    panelEl.className = "zb-panel" + (p.pinned ? " zb-pinned" : "");
    panelEl.style.left = p.x + "px";
    panelEl.style.top = p.y + "px";
    panelEl.style.width = p.w + "px";
    panelEl.style.height = p.h + "px";

    panelEl.innerHTML = `
      <div class="zb-header" id="zb-header">
        <span class="zb-grip">⠿</span>
        <span class="zb-title">摘板</span>
        <select class="zb-group-select" id="zb-gsel"></select>
        <button class="zb-btn" id="zb-gadd" title="新建分组">＋</button>
        <button class="zb-btn" id="zb-gclear" title="清空当前分组">🗑</button>
        <button class="zb-btn" id="zb-pin" title="钉在最前">📌</button>
        <button class="zb-btn" id="zb-hide" title="贴边隐藏">—</button>
        <button class="zb-btn" id="zb-close" title="收起悬浮台">✕</button>
      </div>
      <div class="zb-clips" id="zb-clips"></div>
      <div class="zb-resize" id="zb-resize"></div>
    `;
    root.appendChild(panelEl);

    // 分组下拉
    const sel = panelEl.querySelector("#zb-gsel");
    state.groups.forEach((g) => {
      const opt = document.createElement("option");
      opt.value = g.id;
      opt.textContent = g.name;
      if (g.id === state.activeGroupId) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", () => { state.activeGroupId = sel.value; save(); render(); });

    panelEl.querySelector("#zb-gadd").addEventListener("click", onAddGroup);
    panelEl.querySelector("#zb-gclear").addEventListener("click", onClearGroup);
    const pinBtn = panelEl.querySelector("#zb-pin");
    if (p.pinned) pinBtn.classList.add("zb-on");
    pinBtn.addEventListener("click", () => { p.pinned = !p.pinned; save(); render(); });
    panelEl.querySelector("#zb-hide").addEventListener("click", () => {
      // 贴边：靠哪边近就贴哪边
      const nearLeft = p.x < window.innerWidth / 2;
      p.docked = nearLeft ? "left" : "right";
      save(); render();
    });
    panelEl.querySelector("#zb-close").addEventListener("click", () => { p.visible = false; save(); render(); });

    bindDragResize();
    renderClips();
  }

  function renderClips() {
    const list = panelEl.querySelector("#zb-clips");
    list.innerHTML = "";
    const g = currentGroup();
    const clips = state.clips.filter((c) => c.groupId === g.id);
    if (clips.length === 0) {
      list.innerHTML = `<div class="zb-empty">在网页里选中文字，或右键图片<br>选「加入摘板」<br>即可放到这里一起对照</div>`;
      return;
    }
    clips.forEach((clip) => list.appendChild(renderCard(clip)));
  }

  function renderCard(clip) {
    const card = document.createElement("div");
    card.className = "zb-card" + (clip.tag ? " zb-mark-" + clip.tag : "");
    card.draggable = true;
    card.dataset.id = clip.id;

    let bodyHtml;
    if (clip.type === "image") {
      bodyHtml = `<img class="zb-img" src="${clip.content}" alt="摘录图片">`;
    } else {
      bodyHtml = `<div class="zb-text"></div>`;
    }
    card.innerHTML = `
      <div class="zb-card-body">${bodyHtml}</div>
      <div class="zb-card-foot">
        <a class="zb-src" target="_blank" rel="noopener noreferrer"></a>
        <span class="zb-tag"></span>
        <button class="zb-del" title="删除本条">×</button>
      </div>
    `;
    if (clip.type === "text") card.querySelector(".zb-text").textContent = clip.content;
    const src = card.querySelector(".zb-src");
    src.textContent = clip.sourceTitle || clip.sourceUrl || "来源";
    src.href = clip.sourceUrl || "#";
    const tagEl = card.querySelector(".zb-tag");
    tagEl.textContent = clip.tag || "标记";
    if (clip.tag) tagEl.classList.add("zb-tag-" + clip.tag);
    tagEl.addEventListener("click", () => cycleTag(clip.id));
    card.querySelector(".zb-del").addEventListener("click", () => deleteClip(clip.id));

    card.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", clip.id));
    card.addEventListener("dragover", (e) => { e.preventDefault(); card.classList.add("zb-over"); });
    card.addEventListener("dragleave", () => card.classList.remove("zb-over"));
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      card.classList.remove("zb-over");
      const fromId = e.dataTransfer.getData("text/plain");
      if (fromId && fromId !== clip.id) reorderClip(fromId, clip.id);
    });
    return card;
  }

  /* ---------- 卡片操作 ---------- */
  function cycleTag(id) {
    const clip = state.clips.find((c) => c.id === id);
    if (!clip) return;
    clip.tag = clip.tag === "" ? "重点" : clip.tag === "重点" ? "待确认" : "";
    save(); render();
  }
  function deleteClip(id) {
    state.clips = state.clips.filter((c) => c.id !== id);
    save(); render();
  }
  function reorderClip(fromId, toId) {
    const g = currentGroup();
    const list = state.clips.filter((c) => c.groupId === g.id);
    const fromIdx = list.findIndex((c) => c.id === fromId);
    const toIdx = list.findIndex((c) => c.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    // 按 list 顺序重写该组 clips 在 state.clips 里的位置
    const others = state.clips.filter((c) => c.groupId !== g.id);
    state.clips = others.concat(list);
    save(); render();
  }
  function onAddGroup() {
    const name = prompt("新分组名称（例如：电脑参数对比 / 旅行酒店备选）：", "");
    if (!name || !name.trim()) return;
    const g = { id: "g" + Date.now().toString(36), name: name.trim(), createdAt: Date.now() };
    state.groups.push(g);
    state.activeGroupId = g.id;
    save(); render();
  }
  function onClearGroup() {
    const g = currentGroup();
    if (!confirm(`清空分组「${g.name}」的全部摘录？`)) return;
    state.clips = state.clips.filter((c) => c.groupId !== g.id);
    save(); render();
  }

  /* ---------- 拖拽 & 缩放（document 级指针事件只绑一次） ---------- */
  const ui = { mode: null, sx: 0, sy: 0, ox: 0, oy: 0, ow: 0, oh: 0 };
  function bindGlobalPointer() {
    document.addEventListener("mousemove", (e) => {
      if (!panelEl || !ui.mode) return;
      const p = state.panel;
      if (ui.mode === "move") {
        let nx = ui.ox + (e.clientX - ui.sx);
        let ny = ui.oy + (e.clientY - ui.sy);
        nx = Math.max(0, Math.min(window.innerWidth - 80, nx));
        ny = Math.max(0, Math.min(window.innerHeight - 40, ny));
        p.x = nx; p.y = ny;
        panelEl.style.left = nx + "px";
        panelEl.style.top = ny + "px";
      } else if (ui.mode === "resize") {
        p.w = Math.max(260, ui.ow + (e.clientX - ui.sx));
        p.h = Math.max(220, ui.oh + (e.clientY - ui.sy));
        panelEl.style.width = p.w + "px";
        panelEl.style.height = p.h + "px";
      }
    });
    document.addEventListener("mouseup", () => {
      if (ui.mode === "move" && panelEl) {
        // 拖到边缘附近 → 贴边隐藏
        const p = state.panel;
        const nearLeft = p.x < 40;
        const nearRight = window.innerWidth - (p.x + p.w) < 40;
        if (nearLeft || nearRight) {
          p.docked = nearLeft ? "left" : "right";
          save(); render();
          ui.mode = null;
          return;
        }
      }
      if (ui.mode) save();
      ui.mode = null;
    });
  }
  function bindDragResize() {
    const header = panelEl.querySelector("#zb-header");
    header.addEventListener("mousedown", (e) => {
      if (e.target.closest("select,button")) return;
      ui.mode = "move"; ui.sx = e.clientX; ui.sy = e.clientY;
      ui.ox = state.panel.x; ui.oy = state.panel.y;
    });
    panelEl.querySelector("#zb-resize").addEventListener("mousedown", (e) => {
      ui.mode = "resize"; ui.sx = e.clientX; ui.sy = e.clientY;
      ui.ow = state.panel.w; ui.oh = state.panel.h;
      e.preventDefault();
    });
  }

  function toast(text) {
    const t = document.createElement("div");
    t.className = "zb-toast";
    t.textContent = text;
    root.appendChild(t);
    setTimeout(() => t.remove(), 1600);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
