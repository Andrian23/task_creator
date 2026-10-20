const DOM_CHANGE_DEBOUNCE_MS = 600;
const MAX_MESSAGE_LENGTH = 4000;
let scanTimer;

function cleanText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function roomIdFromElement(element) {
  return element.id || element.getAttribute("href")?.match(/rooms\/(room_[^?]+)/)?.[1] || "";
}

function readRoomList() {
  return [...document.querySelectorAll('[data-test="room-list-item"]')].map((room) => {
    const messageElement = room.querySelector(".last-message .up-d-message");
    const message = cleanText(messageElement?.textContent);
    return {
      roomId: roomIdFromElement(room),
      messageId: messageElement?.closest("[data-message-id]")?.getAttribute("data-message-id") || "",
      author: cleanText(room.querySelector('[data-test="room-name"]')?.textContent),
      topic: cleanText(room.querySelector('[data-test="room-topic-or-subtitle"]')?.textContent),
      message: message.slice(0, MAX_MESSAGE_LENGTH),
      timestamp: cleanText(room.querySelector("time")?.getAttribute("datetime") || room.querySelector("time")?.textContent),
      unread: Boolean(room.querySelector('[data-test="unread-notification-badge"]')),
      url: new URL(room.getAttribute("href") || location.href, location.origin).href
    };
  }).filter((event) => event.roomId && event.message && !event.message.startsWith("You:"));
}

function readOpenConversation() {
  const roomId = location.pathname.match(/rooms\/(room_[^/?]+)/)?.[1];
  if (!roomId) return null;
  const stories = [...document.querySelectorAll('.up-d-story-item [data-test="story-container"]')];
  const latest = stories.at(-1);
  if (!latest) return null;
  const message = cleanText(latest.querySelector('[data-test="story-message"]')?.textContent);
  const outgoing = latest.matches('[data-test*="outgoing"], .is-self, .own-message')
    || Boolean(latest.querySelector('[data-test*="outgoing"], .is-self, .own-message'));
  if (!message || outgoing) return null;
  return {
    roomId,
    messageId: latest.getAttribute("data-message-id") || latest.id || "",
    author: cleanText(latest.querySelector(".user-name")?.textContent),
    topic: cleanText(document.querySelector('[data-test="room-subtitle"]')?.textContent),
    message: message.slice(0, MAX_MESSAGE_LENGTH),
    timestamp: cleanText(latest.querySelector("time")?.getAttribute("datetime") || latest.querySelector("time")?.textContent),
    unread: true,
    url: location.href
  };
}

function readCurrentRoomForRegistration() {
  const roomId = location.pathname.match(/rooms\/(room_[^/?]+)/)?.[1];
  if (!roomId) return null;
  const stories = [...document.querySelectorAll('.up-d-story-item [data-test="story-container"]')];
  const latest = stories.at(-1);
  return {
    roomId,
    messageId: latest?.getAttribute("data-message-id") || latest?.id || "",
    author: cleanText(latest?.querySelector(".user-name")?.textContent),
    topic: cleanText(document.querySelector('[data-test="room-subtitle"]')?.textContent
      || document.querySelector('[data-test="room-title"]')?.textContent),
    message: cleanText(latest?.querySelector('[data-test="story-message"]')?.textContent) || "Чат додано для привʼязки",
    timestamp: cleanText(latest?.querySelector("time")?.getAttribute("datetime") || latest?.querySelector("time")?.textContent),
    unread: false,
    url: location.href
  };
}

function scan() {
  const events = readRoomList();
  const openConversation = readOpenConversation();
  if (openConversation && !events.some((event) => event.roomId === openConversation.roomId && event.message === openConversation.message)) {
    events.push(openConversation);
  }
  if (events.length) chrome.runtime.sendMessage({ type: "UPWORK_EVENTS", events });
}

function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scan, DOM_CHANGE_DEBOUNCE_MS);
}

scan();
const observer = new MutationObserver(scheduleScan);
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === "GET_CURRENT_UPWORK_ROOM") sendResponse(readCurrentRoomForRegistration());
});
