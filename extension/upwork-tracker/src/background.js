const DEFAULT_SETTINGS = { enabled: true, backendUrl: "" };

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  await chrome.storage.local.set(settings);
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === "UPWORK_EVENTS") {
    forwardEvents(request.events).then(sendResponse);
    return true;
  }
  if (request.type === "TEST_BACKEND") {
    testBackend().then(sendResponse);
    return true;
  }
});

function endpoint(backendUrl) {
  return `${backendUrl.replace(/\/$/, "")}/api/upwork-events`;
}

async function settings() {
  return chrome.storage.local.get(DEFAULT_SETTINGS);
}

async function forwardEvents(events) {
  const config = await settings();
  if (!config.enabled || !config.backendUrl) return { ok: false, error: "NOT_CONFIGURED" };
  const results = [];
  for (const event of events) {
    try {
      const response = await fetch(endpoint(config.backendUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event)
      });
      results.push({ ok: response.ok, status: response.status });
    } catch (error) {
      results.push({ ok: false, error: error.message });
    }
  }
  return { ok: results.every((result) => result.ok), results };
}

async function testBackend() {
  const config = await settings();
  if (!config.backendUrl) return { ok: false, error: "Вкажіть URL backend." };
  try {
    const response = await fetch(endpoint(config.backendUrl));
    return response.ok ? { ok: true } : { ok: false, error: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
