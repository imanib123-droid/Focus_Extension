document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const isDashboardView = params.get("view") === "dashboard";
  if (isDashboardView) {
    document.documentElement.classList.add("dashboard-tab");
    document.body.classList.add("dashboard-tab");
    document.getElementById("popupContainer").classList.add("dashboard-tab");
  }

  const timerEl = document.getElementById("timer");
  const scoreEl = document.getElementById("score");
  const sessionStatusEl = document.getElementById("sessionStatus");
  const plantEl = document.getElementById("plant");
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const timeInput = document.getElementById("timeInput");
  const openSettingsBtn = document.getElementById("openSettingsBtn");
  const backBtn = document.getElementById("backBtn");
  const addSiteBtn = document.getElementById("addSiteBtn");
  const siteInput = document.getElementById("siteInput");
  const siteList = document.getElementById("siteList");
  const workspaceInput = document.getElementById("workspaceInput");
  const addWorkspaceBtn = document.getElementById("addWorkspaceBtn");
  const workspaceList = document.getElementById("workspaceList");
  const readingModeInput = document.getElementById("readingMode");
  const eyeTrackerToggle = document.getElementById("eyeTrackerToggle");
  const modeSelect = document.getElementById("modeSelect");
  const messageToneSelect = document.getElementById("messageToneSelect");
  const relaxedMessagesInput = document.getElementById("relaxedMessagesInput");
  const deepEncouragingMessagesInput = document.getElementById("deepEncouragingMessagesInput");
  const deepAggressiveMessagesInput = document.getElementById("deepAggressiveMessagesInput");
  const calibrationOverlay = document.getElementById("calibrationOverlay");
  const mainPage = document.getElementById("mainPage");
  const settingsPage = document.getElementById("settingsPage");
  const calibrateBtn = document.getElementById("calibrateBtn");

  function formatTime(totalSeconds) {
    const seconds = Math.max(0, Number(totalSeconds || 0));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${(seconds % 60).toString().padStart(2, "0")}`;
  }

  function updateUI() {
    chrome.storage.local.get(["sessionTimeLeft", "sessionDuration", "score", "focusSessionActive"], (data) => {
      const active = Boolean(data.focusSessionActive);
      const score = Math.max(0, Math.min(100, Number(data.score ?? 100)));
      const remainingTime = Number(data.sessionTimeLeft ?? 1500);
      const totalTime = Math.max(1, Number(data.sessionDuration ?? 1500));
      const progress = active ? Math.max(0, Math.min(1, 1 - remainingTime / totalTime)) : 0;
      const stemHeight = 24 + Math.round(progress * 86);
      const stemWidth = 12 + Math.round(progress * 8);
      const leafScale = 0.5 + progress * 0.9;
      const topLeafScale = Math.max(0, (progress - 0.18) / 0.82);
      const plantContainer = plantEl.parentElement;

      timerEl.textContent = formatTime(active ? remainingTime : (Number(timeInput.value || 25) * 60));
      scoreEl.textContent = Math.round(score);
      plantEl.style.height = `${stemHeight}px`;
      plantEl.style.width = `${stemWidth}px`;
      plantEl.style.setProperty("--leaf-scale", leafScale.toFixed(2));
      if (plantContainer) {
        plantContainer.style.setProperty("--top-leaf-scale", topLeafScale.toFixed(2));
        plantContainer.style.setProperty("--plant-height-offset", `${stemHeight - 24}px`);
      }

      if (active) {
        startBtn.classList.add("hidden");
        stopBtn.classList.remove("hidden");
        sessionStatusEl.textContent = score >= 75 ? "Locked in" : "Refocus and keep going";
      } else {
        startBtn.classList.remove("hidden");
        stopBtn.classList.add("hidden");
        sessionStatusEl.textContent = "Ready to focus";
      }
    });
  }

  function createSiteItem(item, tagText) {
    const li = document.createElement("li");
    const label = document.createElement("div");
    const tag = document.createElement("span");
    const name = document.createElement("span");
    const button = document.createElement("button");

    label.className = "site-label";
    tag.className = "site-tag";
    name.className = "site-name";
    button.className = "delete-btn";

    tag.textContent = tagText;
    name.textContent = item;
    button.textContent = "x";
    button.setAttribute("data-site", item);
    button.setAttribute("aria-label", `Remove ${item}`);

    label.append(tag, name);
    li.append(label, button);

    return li;
  }

  function renderList(listElement, items, tagText) {
    listElement.innerHTML = "";

    (items || []).forEach((item) => {
      listElement.appendChild(createSiteItem(item, tagText));
    });
  }

  function parseMessages(value, fallback) {
    const messages = value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    return messages.length ? messages : fallback;
  }

  function loadSettings() {
    chrome.storage.local.get(
      [
        "blockedSites",
        "workspaceSites",
        "eyeTrackerEnabled",
        "mode",
        "readingMode",
        "messageTone",
        "relaxedMessages",
        "deepEncouragingMessages",
        "deepAggressiveMessages"
      ],
      (data) => {
        renderList(siteList, data.blockedSites, "Blocked");
        renderList(workspaceList, data.workspaceSites, "Workspace");
        eyeTrackerToggle.checked = Boolean(data.eyeTrackerEnabled);
        modeSelect.value = data.mode || "relaxed";
        readingModeInput.checked = Boolean(data.readingMode);
        messageToneSelect.value = data.messageTone || "encouraging";
        relaxedMessagesInput.value = (data.relaxedMessages || []).join("\n");
        deepEncouragingMessagesInput.value = (data.deepEncouragingMessages || []).join("\n");
        deepAggressiveMessagesInput.value = (data.deepAggressiveMessages || []).join("\n");
      }
    );
  }

  function switchPage(page) {
    const showSettings = page === "settings";
    mainPage.classList.toggle("hidden", showSettings);
    settingsPage.classList.toggle("hidden", !showSettings);
  }

  function addSite(key, input, callback) {
    const site = input.value.trim().toLowerCase();
    if (!site) return;

    chrome.storage.local.get([key], (data) => {
      const items = data[key] || [];
      if (!items.includes(site)) {
        items.push(site);
        chrome.storage.local.set({ [key]: items }, callback);
      }
      input.value = "";
    });
  }

  function attachEnterHandler(input, action) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        action();
      }
    });
  }

  updateUI();
  loadSettings();

  chrome.storage.onChanged.addListener(() => {
    updateUI();
    loadSettings();
  });

  startBtn.addEventListener("click", () => {
    const minutes = parseInt(timeInput.value, 10) || 25;
    chrome.runtime.sendMessage({ type: "START_SESSION", minutes }, updateUI);
  });

  stopBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "STOP_SESSION" }, updateUI);
  });

  openSettingsBtn.addEventListener("click", () => {
    switchPage("settings");
    loadSettings();
  });

  backBtn.addEventListener("click", () => {
    switchPage("main");
  });

  addSiteBtn.addEventListener("click", () => {
    addSite("blockedSites", siteInput, loadSettings);
  });

  addWorkspaceBtn.addEventListener("click", () => {
    addSite("workspaceSites", workspaceInput, loadSettings);
  });

  attachEnterHandler(siteInput, () => addSite("blockedSites", siteInput, loadSettings));
  attachEnterHandler(workspaceInput, () => addSite("workspaceSites", workspaceInput, loadSettings));

  [siteList, workspaceList].forEach((listElement) => {
    listElement.addEventListener("click", (event) => {
      const button = event.target.closest(".delete-btn");
      if (!button) return;

      const site = button.dataset.site;
      const key = listElement === siteList ? "blockedSites" : "workspaceSites";

      chrome.storage.local.get([key], (data) => {
        const filtered = (data[key] || []).filter((item) => item !== site);
        chrome.storage.local.set({ [key]: filtered }, loadSettings);
      });
    });
  });

  readingModeInput.addEventListener("change", (event) => {
    chrome.storage.local.set({ readingMode: event.target.checked });
  });

  eyeTrackerToggle.addEventListener("change", (event) => {
    const enabled = event.target.checked;
    chrome.storage.local.set({ eyeTrackerEnabled: enabled });
    calibrationOverlay.classList.toggle("hidden", !enabled);
  });

  modeSelect.addEventListener("change", (event) => {
    chrome.storage.local.set({ mode: event.target.value });
  });

  messageToneSelect.addEventListener("change", (event) => {
    chrome.storage.local.set({ messageTone: event.target.value });
  });

  relaxedMessagesInput.addEventListener("change", () => {
    chrome.storage.local.set({
      relaxedMessages: parseMessages(relaxedMessagesInput.value, [
        "Ease back in and return to the task.",
        "Your goal is still right here. Pick it back up.",
        "A calm reset can save the whole session."
      ])
    });
  });

  deepEncouragingMessagesInput.addEventListener("change", () => {
    chrome.storage.local.set({
      deepEncouragingMessages: parseMessages(deepEncouragingMessagesInput.value, [
        "Stay with the commitment you made.",
        "You can recover this session right now.",
        "Hold the line for one more focused minute."
      ])
    });
  });

  deepAggressiveMessagesInput.addEventListener("change", () => {
    chrome.storage.local.set({
      deepAggressiveMessages: parseMessages(deepAggressiveMessagesInput.value, [
        "Lock in now.",
        "Stop drifting and finish the work.",
        "You do not need another distraction."
      ])
    });
  });

  calibrateBtn.addEventListener("click", () => {
    calibrationOverlay.classList.add("hidden");
    chrome.tabs.query({ active: true, currentWindow: true, url: ["http://*/*", "https://*/*"] }, (tabs) => {
      if (!tabs[0]) return;

      chrome.tabs.sendMessage(tabs[0].id, { type: "START_EYE_TRACKER" }, () => {
        if (chrome.runtime.lastError) {
          console.log("Eye tracker listener missing:", chrome.runtime.lastError.message);
        }
      });
    });
  });
});
