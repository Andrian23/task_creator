chrome.storage.local.get({ enabled: true, backendUrl: "" }).then((settings) => {
  document.getElementById("state").textContent = !settings.backendUrl ? "Потрібне налаштування." : settings.enabled ? "Спостереження увімкнено." : "Спостереження вимкнено.";
});
document.getElementById("options").addEventListener("click", () => chrome.runtime.openOptionsPage());
