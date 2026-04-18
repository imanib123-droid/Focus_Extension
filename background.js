console.log("Background script loaded");

const DEFAULT_RELAXED_MESSAGES = [
  "Ease back in and return to the task.",
  "Your goal is still right here. Pick it back up.",
  "A calm reset can save the whole session."
];

const DEFAULT_DEEP_ENCOURAGING_MESSAGES = [
  "Stay with the commitment you made.",
  "You can recover this session right now.",
  "Hold the line for one more focused minute."
];

const DEFAULT_DEEP_AGGRESSIVE_MESSAGES = [
  "Lock in now.",
  "Stop drifting and finish the work.",
  "You do not need another distraction."
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    score: 100,
    blockedSites: ["youtube.com", "facebook.com"],
    workspaceSites: ["github.com", "docs.google.com"],
    focusSessionActive: false,
    sessionTimeLeft: 1500,
    sessionDuration: 1500,
    eyeTrackerEnabled: false,
    eyeTrackerScore: 100,
    readingMode: false,
    mode: "relaxed",
    messageTone: "encouraging",
    relaxedMessages: DEFAULT_RELAXED_MESSAGES,
    deepEncouragingMessages: DEFAULT_DEEP_ENCOURAGING_MESSAGES,
    deepAggressiveMessages: DEFAULT_DEEP_AGGRESSIVE_MESSAGES,
    focusPanelCollapsed: false,
    focusPanelPosition: "top-right",
    focusAura: false
  });
});

chrome.idle.onStateChanged.addListener((state) => {
  chrome.storage.local.get(["readingMode", "focusSessionActive"], (data) => {
    if (data.focusSessionActive && !data.readingMode && state === "idle") {
      decreaseScore(7, "Idle");
      broadcast("FOCUS_IDLE");
    }
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "focusTimer") return;
  chrome.storage.local.get(["sessionTimeLeft", "focusSessionActive", "score", "mode", "eyeTrackerEnabled", "eyeTrackerScore"], (data) => {
    if (!data.focusSessionActive) return;
    let time = Number(data.sessionTimeLeft || 0) - 1;
    let score = Number(data.score || 0);
    const replenishRate = data.mode === "relaxed" ? 2 : 1;
    const eyeWeight = data.eyeTrackerEnabled ? 0.1 : 0;
    const eyeBonus = data.eyeTrackerEnabled ? (Number(data.eyeTrackerScore || 100) / 100) * eyeWeight * 2 : 0;
    const passiveDrain = data.mode === "deep" ? 0.12 : 0;

    score = Math.max(0, score - passiveDrain);

    if (time >= 0 && time % 60 === 0) {
      score = Math.min(100, score + replenishRate + eyeBonus);
    }
    chrome.storage.local.set({ sessionTimeLeft: time, score });
    if (time <= 0) {
      chrome.alarms.clear("focusTimer");
      chrome.storage.local.set({ focusSessionActive: false, focusAura: false });
      broadcast("FOCUS_OFF");
    }
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START_SESSION") {
    const seconds = Math.min(60, Math.max(1, Number(msg.minutes || 25))) * 60;
    chrome.storage.local.set({ focusSessionActive: true, sessionTimeLeft: seconds, sessionDuration: seconds, focusAura: true }, () => {
      chrome.alarms.create("focusTimer", { periodInMinutes: 1 / 60 });
      broadcast("FOCUS_ON");
      sendResponse({ started: true });
    });
    return true;
  }
  if (msg.type === "STOP_SESSION") {
    chrome.alarms.clear("focusTimer");
    chrome.storage.local.set({ focusSessionActive: false, focusAura: false }, () => {
      broadcast("FOCUS_OFF");
      sendResponse({ stopped: true });
    });
    return true;
  }
  if (msg.type === "DECREASE_SCORE") {
    decreaseScore(msg.amount || 10, msg.reason || "Penalty");
    sendResponse({ penalized: true });
    return true;
  }
  if (msg.type === "EYE_TRACKER_DISTRACTED") {
    decreaseScore(15, "Eye tracker distracted");
    broadcast("FOCUS_DISTRACTED");
    sendResponse({ distracted: true });
    return true;
  }
  if (msg.type === "EYE_TRACKER_UPDATE") {
    const scoreValue = Math.min(100, Math.max(0, Number(msg.value || 100)));
    chrome.storage.local.set({ eyeTrackerScore: scoreValue });
    sendResponse({ updated: true });
    return true;
  }
  if (msg.type === "OPEN_DASHBOARD") {
    chrome.tabs.create({ url: chrome.runtime.getURL("popup.html?view=dashboard") }, () => {
      sendResponse({ opened: true });
    });
    return true;
  }
});

function decreaseScore(amount, reason = "Penalty") {
  chrome.storage.local.get(["score", "mode"], (data) => {
    const multiplier = data.mode === "deep" ? 1.5 : 1;
    const newScore = Math.max(0, Number(data.score || 100) - amount * multiplier);
    chrome.storage.local.set({ score: newScore });
    console.log(`Score decreased (${reason}) to`, newScore);
  });
}

function broadcast(type) {
  chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, { type }, () => {
        if (chrome.runtime.lastError) {
          // ignore tabs without a content listener
        }
      });
    });
  });
}
