document.addEventListener("DOMContentLoaded", () => {
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
  const calibrationOverlay = document.getElementById("calibrationOverlay");

  function updateUI() {
    chrome.storage.local.get(["sessionTimeLeft", "score", "focusSessionActive"], (data) => {
      const time = Number(data.sessionTimeLeft || 1500);
      const minutes = Math.floor(time / 60);
      const seconds = time % 60;
      timerEl.textContent = `${minutes}:${seconds.toString().padStart(2, "0")}`;
      scoreEl.textContent = Number(data.score || 100);
      plantEl.style.height = `${60 + (Number(data.score || 100) / 100) * 110}px`;
      if (data.focusSessionActive) {
        startBtn.classList.add("hidden");
        stopBtn.classList.remove("hidden");
        sessionStatusEl.textContent = time > 0 ? "In focus session" : "Session complete";
      } else {
        startBtn.classList.remove("hidden");
        stopBtn.classList.add("hidden");
        sessionStatusEl.textContent = "Ready to grow";
      }
    });
  }

  function renderList(listElement, items, tagText) {
    listElement.innerHTML = "";
    (items || []).forEach((item) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <div class="site-label">
          <span class="site-tag">${tagText}</span>
          <span class="site-name">${item}</span>
        </div>
        <button class="delete-btn" data-site="${item}">×</button>`;
      listElement.appendChild(li);
    });
  }

  function loadSettings() {
    chrome.storage.local.get(["blockedSites", "workspaceSites", "eyeTrackerEnabled", "mode", "readingMode"], (data) => {
      renderList(siteList, data.blockedSites, "Blocked");
      renderList(workspaceList, data.workspaceSites, "Workspace");
      eyeTrackerToggle.checked = Boolean(data.eyeTrackerEnabled);
      modeSelect.value = data.mode || "relaxed";
      readingModeInput.checked = Boolean(data.readingMode);
    });
  }

  updateUI();
  loadSettings();
  setInterval(updateUI, 1000);

  startBtn.onclick = () => {
    const minutes = parseInt(timeInput.value, 10) || 25;
    chrome.runtime.sendMessage({ type: "START_SESSION", minutes });
    updateUI();
  };

  stopBtn.onclick = () => {
    chrome.runtime.sendMessage({ type: "STOP_SESSION" });
    updateUI();
  };

  openSettingsBtn.onclick = () => {
    document.getElementById("mainPage").classList.add("hidden");
    document.getElementById("settingsPage").classList.remove("hidden");
    loadSettings();
  };

  backBtn.onclick = () => {
    document.getElementById("settingsPage").classList.add("hidden");
    document.getElementById("mainPage").classList.remove("hidden");
  };

  addSiteBtn.onclick = () => {
    const site = siteInput.value.trim();
    if (!site) return;
    chrome.storage.local.get(["blockedSites"], (data) => {
      const sites = data.blockedSites || [];
      if (!sites.includes(site)) {
        sites.push(site);
        chrome.storage.local.set({ blockedSites: sites }, loadSettings);
        siteInput.value = "";
      }
    });
  };

  addWorkspaceBtn.onclick = () => {
    const site = workspaceInput.value.trim();
    if (!site) return;
    chrome.storage.local.get(["workspaceSites"], (data) => {
      const sites = data.workspaceSites || [];
      if (!sites.includes(site)) {
        sites.push(site);
        chrome.storage.local.set({ workspaceSites: sites }, loadSettings);
        workspaceInput.value = "";
      }
    });
  };

  [siteList, workspaceList].forEach((listElement) => {
    listElement.addEventListener("click", (event) => {
      if (!event.target.classList.contains("delete-btn")) return;
      const site = event.target.dataset.site;
      const key = listElement === siteList ? "blockedSites" : "workspaceSites";
      chrome.storage.local.get([key], (data) => {
        const sites = (data[key] || []).filter((item) => item !== site);
        chrome.storage.local.set({ [key]: sites }, loadSettings);
      });
    });
  });

  readingModeInput.onchange = (event) => {
    chrome.storage.local.set({ readingMode: event.target.checked });
  };

  eyeTrackerToggle.onchange = (event) => {
    chrome.storage.local.set({ eyeTrackerEnabled: event.target.checked });
    if (event.target.checked) {
      calibrationOverlay.classList.remove("hidden");
    }
  };

  modeSelect.onchange = (event) => {
    chrome.storage.local.set({ mode: event.target.value });
  };

  document.getElementById("calibrateBtn").onclick = () => {
    calibrationOverlay.classList.add("hidden");
    chrome.tabs.query({ active: true, currentWindow: true, url: ["http://*/*", "https://*/*"] }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: "START_EYE_TRACKER" }, () => {
        if (chrome.runtime.lastError) {
          console.log("Eye tracker listener missing:", chrome.runtime.lastError.message);
        }
      });
    });
  };
});