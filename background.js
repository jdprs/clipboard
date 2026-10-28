/* 摘板 ClipBoard — background service worker (MV3)
 * 职责：右键菜单注册 / 摘录落库 / 图片转 base64 / 跨标签通知 / 启动清理
 * 数据全部存在 chrome.storage.local 的 zb_state 里，不上传任何服务器。
 */

const MENU_SELECTION = "zb-add-selection";
const MENU_IMAGE = "zb-add-image";

const RETENTION_MS = {
  "1day": 24 * 60 * 60 * 1000,
  "7days": 7 * 24 * 60 * 60 * 1000
};

function defaultState() {
  const g0 = { id: "g-default", name: "默认分组", createdAt: Date.now() };
  return {
    groups: [g0],
    activeGroupId: g0.id,
    clips: [],
    panel: {
      x: 120,
      y: 100,
      w: 360,
      h: 440,
      visible: true,
      pinned: false,
      docked: null
    },
    settings: { retention: "session" } // session | 1day | 7days | forever
  };
}

async function getState() {
  const obj = await chrome.storage.local.get("zb_state");
  return obj.zb_state || defaultState();
}

async function saveState(state) {
  await chrome.storage.local.set({ zb_state: state });
}

/* ---------- 右键菜单 ---------- */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_SELECTION,
      title: "把选中文字加入摘板",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: MENU_IMAGE,
      title: "把图片加入摘板",
      contexts: ["image"]
    });
  });
});

/* ---------- 摘录落库 ---------- */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === MENU_SELECTION) {
      const text = (info.selectionText || "").trim();
      if (!text) return;
      await addClip({
        type: "text",
        content: text,
        sourceTitle: tab?.title || "",
        sourceUrl: info.pageUrl || tab?.url || ""
      }, tab);
    } else if (info.menuItemId === MENU_IMAGE) {
      const srcUrl = info.srcUrl || "";
      let content = srcUrl;
      try {
        content = await urlToDataUrl(srcUrl);
      } catch (_e) {
        // 跨域/失败时保留原始 URL，至少能在面板里显示
      }
      await addClip({
        type: "image",
        content,
        sourceTitle: tab?.title || "",
        sourceUrl: info.pageUrl || tab?.url || ""
      }, tab);
    }
  } catch (e) {
    console.warn("[摘板] 加入失败:", e);
  }
});

async function addClip(clip, tab) {
  const state = await getState();
  clip.id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  clip.groupId = state.activeGroupId;
  clip.tag = "";
  clip.createdAt = Date.now();
  state.clips.push(clip);
  await saveState(state);

  // 通知当前标签页刷新面板 + toast
  if (tab && typeof tab.id === "number") {
    chrome.tabs.sendMessage(tab.id, { type: "ZB_CLIP_ADDED", clip }).catch(() => {});
  }
}

async function urlToDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("fetch failed " + res.status);
  const blob = await res.blob();
  const buf = await blob.arrayBuffer();
  const base64 = arrayBufferToBase64(buf);
  const type = blob.type || "image/png";
  return `data:${type};base64,${base64}`;
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/* ---------- 启动时按保留策略清理 ---------- */
chrome.runtime.onStartup.addListener(async () => {
  const state = await getState();
  const retention = state.settings?.retention || "session";
  if (retention === "session") {
    state.clips = [];
    await saveState(state);
    return;
  }
  if (retention !== "forever" && RETENTION_MS[retention]) {
    const cutoff = Date.now() - RETENTION_MS[retention];
    state.clips = state.clips.filter((c) => c.createdAt >= cutoff);
    await saveState(state);
  }
});

/* ---------- 给 popup / content script 用的消息 ---------- */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "ZB_GET_STATE") {
    getState().then(sendResponse);
    return true; // async
  }
  if (msg?.type === "ZB_PURGE_ALL") {
    getState().then((s) => {
      s.clips = [];
      return saveState(s);
    }).then(() => sendResponse({ ok: true }));
    return true;
  }
});
