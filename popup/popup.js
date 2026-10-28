/* popup 控制页 */
async function getState() {
  const obj = await chrome.storage.local.get("zb_state");
  return obj.zb_state;
}
async function saveState(s) {
  await chrome.storage.local.set({ zb_state: s });
}

async function refresh() {
  const s = await getState();
  if (!s) return;
  const g = s.groups.find((x) => x.id === s.activeGroupId) || s.groups[0];
  document.getElementById("gname").textContent = g ? g.name : "—";
  document.getElementById("cnt").textContent = s.clips.filter((c) => c.groupId === g.id).length;
  document.getElementById("retention").value = s.settings?.retention || "session";
}

document.getElementById("toggle").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: "ZB_TOGGLE" }).catch(() => {
      alert("当前页面不支持（如 chrome:// 内置页），请在普通网页里使用。");
    });
  }
  window.close();
});

document.getElementById("retention").addEventListener("change", async (e) => {
  const s = await getState();
  if (!s) return;
  s.settings = s.settings || {};
  s.settings.retention = e.target.value;
  await saveState(s);
});

document.getElementById("clearGroup").addEventListener("click", async () => {
  const s = await getState();
  if (!s) return;
  const g = s.groups.find((x) => x.id === s.activeGroupId);
  if (!confirm(`清空分组「${g.name}」？`)) return;
  s.clips = s.clips.filter((c) => c.groupId !== g.id);
  await saveState(s);
  refresh();
});

document.getElementById("clearAll").addEventListener("click", async () => {
  if (!confirm("清空全部分组的全部摘录？此操作不可恢复。")) return;
  const s = await getState();
  if (!s) return;
  s.clips = [];
  await saveState(s);
  refresh();
});

refresh();
