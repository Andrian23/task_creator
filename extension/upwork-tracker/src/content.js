const DOM_CHANGE_DEBOUNCE_MS = 600;
const PERIODIC_SCAN_MS = 15_000;
const MAX_MESSAGE_LENGTH = 4000;
let scanTimer;

function cleanText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function roomIdFromElement(element) {
  const elementId = element.id?.match(/room_[a-z0-9]+/i)?.[0];
  return elementId || element.getAttribute("href")?.match(/rooms\/(room_[^?&#/]+)/)?.[1] || "";
}

function previewDetails(room) {
  const messageElement = room.querySelector(".last-message .up-d-message, .room-list-item-story .up-d-message");
  const preview = cleanText(messageElement?.textContent);
  const outgoingMatch = preview.match(/^(?:You|Ви):\s*(.*)$/i);
  if (outgoingMatch) {
    return { author: "You", message: outgoingMatch[1], direction: "outgoing" };
  }
  const incomingMatch = preview.match(/^([^:]{1,120}):\s*(.+)$/);
  if (incomingMatch) {
    return { author: cleanText(incomingMatch[1]), message: cleanText(incomingMatch[2]), direction: "incoming" };
  }
  return {
    author: cleanText(room.querySelector('[data-test="room-name"]')?.textContent),
    message: preview,
    direction: "incoming"
  };
}

function readRoomList() {
  return [...document.querySelectorAll('[data-test="room-list-item"]')].map((room) => {
    const preview = previewDetails(room);
    const unreadBadge = room.querySelector('[data-test="unread-notification-badge"]');
    const unreadCount = Number.parseInt(cleanText(unreadBadge?.textContent), 10);
    return {
      roomId: roomIdFromElement(room),
      messageId: "",
      author: preview.author,
      topic: cleanText(room.querySelector('[data-test="room-topic-or-subtitle"]')?.textContent),
      message: preview.message.slice(0, MAX_MESSAGE_LENGTH),
      direction: preview.direction,
      timestamp: cleanText(room.querySelector("time")?.getAttribute("datetime")
        || room.querySelector("time")?.textContent
        || room.querySelector(".timestamp")?.textContent),
      unread: Boolean(unreadBadge || room.querySelector(".right-content.unread")),
      unreadCount: Number.isFinite(unreadCount) ? unreadCount : 0,
      source: "room-list",
      url: new URL(room.getAttribute("href") || location.href, location.origin).href
    };
  }).filter((event) => event.roomId && event.message);
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
  if (!message) return null;
  return {
    roomId,
    messageId: latest.getAttribute("data-message-id") || latest.id || "",
    author: cleanText(latest.querySelector(".user-name")?.textContent),
    topic: cleanText(document.querySelector('[data-test="room-subtitle"]')?.textContent),
    message: message.slice(0, MAX_MESSAGE_LENGTH),
    direction: outgoing ? "outgoing" : "incoming",
    timestamp: cleanText(latest.querySelector("time")?.getAttribute("datetime") || latest.querySelector("time")?.textContent),
    unread: true,
    unreadCount: 1,
    source: "open-conversation",
    url: location.href
  };
}

function readCurrentRoomForRegistration() {
  const roomId = location.pathname.match(/rooms\/(room_[^/?]+)/)?.[1];
  if (!roomId) return null;
  const stories = [...document.querySelectorAll('.up-d-story-item [data-test="story-container"]')];
  const latest = stories.at(-1);
  const topic = cleanText(document.querySelector('[data-test="room-subtitle"]')?.textContent
    || document.querySelector('[data-test="room-title"]')?.textContent);
  const history = stories.slice(-200).map((story) => {
    const outgoing = story.matches('[data-test*="outgoing"], .is-self, .own-message')
      || Boolean(story.querySelector('[data-test*="outgoing"], .is-self, .own-message'));
    return {
      roomId,
      messageId: story.getAttribute("data-message-id") || story.id || "",
      author: cleanText(story.querySelector(".user-name")?.textContent),
      topic,
      message: cleanText(story.querySelector('[data-test="story-message"]')?.textContent).slice(0, MAX_MESSAGE_LENGTH),
      direction: outgoing ? "outgoing" : "incoming",
      timestamp: cleanText(story.querySelector("time")?.getAttribute("datetime") || story.querySelector("time")?.textContent),
      url: location.href
    };
  }).filter((event) => event.message);
  return {
    roomId,
    messageId: latest?.getAttribute("data-message-id") || latest?.id || "",
    author: cleanText(latest?.querySelector(".user-name")?.textContent),
    topic,
    message: cleanText(latest?.querySelector('[data-test="story-message"]')?.textContent) || "Чат додано для привʼязки",
    timestamp: cleanText(latest?.querySelector("time")?.getAttribute("datetime") || latest?.querySelector("time")?.textContent),
    direction: latest?.matches('[data-test*="outgoing"], .is-self, .own-message')
      || Boolean(latest?.querySelector('[data-test*="outgoing"], .is-self, .own-message')) ? "outgoing" : "incoming",
    unread: false,
    url: location.href,
    history
  };
}

function scan() {
  const events = readRoomList();
  const openConversation = readOpenConversation();
  if (openConversation) {
    const roomIndex = events.findIndex((event) => event.roomId === openConversation.roomId);
    if (roomIndex >= 0) events[roomIndex] = openConversation;
    else events.push(openConversation);
  }
  if (events.length) chrome.runtime.sendMessage({ type: "UPWORK_EVENTS", events });
}

function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scan, DOM_CHANGE_DEBOUNCE_MS);
}

scan();
setInterval(scan, PERIODIC_SCAN_MS);
const observer = new MutationObserver(scheduleScan);
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === "GET_CURRENT_UPWORK_ROOM") sendResponse(readCurrentRoomForRegistration());
});
