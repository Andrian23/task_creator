const DEFAULT_BACKEND_URL = "https://task-creator-lp69.vercel.app";
const DEFAULT_SETTINGS = { enabled: true };

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
  if (request.type === "REGISTER_ROOM") {
    registerRoom(request.room).then(sendResponse);
    return true;
  }
});

function endpoint() {
  return `${DEFAULT_BACKEND_URL}/api/upwork-events`;
}

async function settings() {
  return chrome.storage.local.get(DEFAULT_SETTINGS);
}

async function forwardEvents(events) {
  const config = await settings();
  if (!config.enabled) return { ok: false, error: "DISABLED" };
  const stored = await chrome.storage.local.get(["roomFingerprints", "trackedRoomIds"]);
  const fingerprints = stored.roomFingerprints || {};
  const trackedRoomIds = new Set(stored.trackedRoomIds || []);
  const results = [];
  for (const event of events.filter((item) => trackedRoomIds.has(item.roomId))) {
    const fingerprint = [event.messageId, event.author, event.direction, event.message, event.timestamp].join("|");
    if (fingerprints[event.roomId] === fingerprint) continue;
    const discovery = !fingerprints[event.roomId];
    try {
      const response = await fetch(endpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...event, discovery })
      });
      results.push({ ok: response.ok, status: response.status });
      if (response.ok) fingerprints[event.roomId] = fingerprint;
    } catch (error) {
      results.push({ ok: false, error: error.message });
    }
  }
  await chrome.storage.local.set({ roomFingerprints: fingerprints });
  return { ok: results.every((result) => result.ok), results };
}

async function registerRoom(room) {
  if (!room?.roomId) return { ok: false, error: "Відкрийте конкретний Upwork-чат." };
  const stored = await chrome.storage.local.get(["trackedRoomIds", "roomFingerprints"]);
  const trackedRoomIds = new Set(stored.trackedRoomIds || []);
  if (trackedRoomIds.has(room.roomId)) return { ok: true, alreadyTracked: true };
  const response = await fetch(endpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...room, discovery: true, registration: true })
  });
  if (!response.ok) return { ok: false, error: `Backend HTTP ${response.status}` };
  trackedRoomIds.add(room.roomId);
  const fingerprints = stored.roomFingerprints || {};
  fingerprints[room.roomId] = [room.messageId, room.author, room.direction, room.message, room.timestamp].join("|");
  await chrome.storage.local.set({ trackedRoomIds: [...trackedRoomIds], roomFingerprints: fingerprints });
  return { ok: true };
}

async function testBackend() {
  try {
    const response = await fetch(endpoint());
    return response.ok ? { ok: true } : { ok: false, error: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
