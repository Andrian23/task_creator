const backendUrl = document.getElementById("backendUrl");
const enabled = document.getElementById("enabled");
const status = document.getElementById("status");

async function restore() {
  const saved = await chrome.storage.local.get({ enabled: true, backendUrl: "" });
  enabled.checked = saved.enabled;
  backendUrl.value = saved.backendUrl;
}
async function save() {
  await chrome.storage.local.set({ enabled: enabled.checked, backendUrl: backendUrl.value.trim().replace(/\/$/, "") });
  status.textContent = "Збережено.";
}
document.getElementById("save").addEventListener("click", save);
document.getElementById("test").addEventListener("click", async () => {
  await save();
  const result = await chrome.runtime.sendMessage({ type: "TEST_BACKEND" });
  status.textContent = result.ok ? "Backend доступний." : `Помилка: ${result.error}`;
});
restore();
