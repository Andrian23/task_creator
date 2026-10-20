chrome.storage.local.get({ enabled: true }).then((settings) => {
  document.getElementById("state").textContent = settings.enabled ? "Спостереження увімкнено." : "Спостереження вимкнено.";
});
document.getElementById("addRoom").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const room = await chrome.tabs.sendMessage(tab.id, { type: "GET_CURRENT_UPWORK_ROOM" });
    const result = await chrome.runtime.sendMessage({ type: "REGISTER_ROOM", room });
    document.getElementById("state").textContent = result.ok
      ? result.alreadyTracked ? "Цей чат уже додано." : "Чат додано. Оберіть проєкт у Telegram."
      : `Помилка: ${result.error}`;
  } catch {
    document.getElementById("state").textContent = "Відкрийте конкретний чат Upwork Messages.";
  }
});
document.getElementById("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
