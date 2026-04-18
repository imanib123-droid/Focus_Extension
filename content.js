const PANEL_ID = "focus-extension-panel";
const BORDER_ID = "focus-extension-border";
const BLOCK_ID = "focus-extension-block";
let pageBlocked = false;
let unFocusTimeout = null;

function createFocusOverlay() {
  if (document.getElementById(PANEL_ID)) return;

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <button id="focusToggleBtn" class="focus-toggle-btn" title="Collapse / expand">☰</button>
    <div class="focus-panel">
      <div class="focus-panel-title">Focus Environment</div>
      <div class="focus-timer-line">Timer: <strong id="focusTimer">25:00</strong></div>
      <div class="focus-plant-shell">
        <div id="focusPlant" class="focus-plant"></div>
      </div>
      <div class="focus-status-row">
        <span class="focus-status-label">Status</span>
        <span id="focusStatus" class="focus-status">Ready</span>
      </div>
      <div class="focus-eye-row">
        <div class="focus-eye-label">Eye focus</div>
        <div class="focus-eye-meter"><div id="focusEyeMeter" class="focus-eye-meter-fill"></div></div>
        <div id="focusEyeText" class="focus-eye-text">Tracker off</div>
      </div>
      <button id="focusOpenMenu" class="focus-open-menu">Open dashboard</button>
    </div>
  `;
  document.body.appendChild(panel);

  const border = document.createElement("div");
  border.id = BORDER_ID;
  document.body.appendChild(border);

  const blocker = document.createElement("div");
  blocker.id = BLOCK_ID;
  blocker.className = "focus-blocker hidden";
  blocker.innerHTML = `<div class="focus-blocker-text" id="focusBlockMessage"></div>`;
  document.body.appendChild(blocker);

  document.getElementById("focusToggleBtn").addEventListener("click", () => {
    chrome.storage.local.get("focusPanelCollapsed", (data) => {
      const collapsed = !data.focusPanelCollapsed;
      chrome.storage.local.set({ focusPanelCollapsed: collapsed }, refreshState);
    });
  });

  document.getElementById("focusOpenMenu").addEventListener("click", () => {
    alert("Click the Focus Pro extension icon in your browser toolbar to open the dashboard.");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      chrome.storage.local.get(["focusSessionActive", "readingMode"], (data) => {
        if (data.focusSessionActive && !data.readingMode) {
          showTemporaryMessage("You are leaving the tab. Stay focused!");
          chrome.runtime.sendMessage({ type: "DECREASE_SCORE", amount: 12, reason: "Tab switch" }, () => {});
        }
      });
    }
  });
}

function updateOverlay(data) {
  const panel = document.getElementById(PANEL_ID);
  const border = document.getElementById(BORDER_ID);
  const plant = document.getElementById("focusPlant");
  const timerText = document.getElementById("focusTimer");
  const scoreLabel = document.getElementById("focusScore");
  const status = document.getElementById("focusStatus");
  const eyeMeter = document.getElementById("focusEyeMeter");
  const eyeText = document.getElementById("focusEyeText");

  if (!panel || !border || !plant || !timerText || !scoreLabel || !status || !eyeMeter || !eyeText) return;

  const active = Boolean(data.focusSessionActive);
  const score = Number(data.score || 100);
  const collapsed = Boolean(data.focusPanelCollapsed);
  const time = Number(data.sessionTimeLeft || 1500);
  const eyeScore = Number(data.eyeTrackerScore || 100);
  const eyeEnabled = Boolean(data.eyeTrackerEnabled);

  panel.classList.toggle("focus-panel-collapsed", collapsed);
  panel.classList.toggle("focus-panel-active", active);
  border.classList.toggle("focus-border-active", active);
  border.classList.toggle("focus-border-good", active && score >= 70);

  plant.style.height = `${collapsed ? 24 : 50 + (score / 100) * 120}px`;
  scoreLabel.textContent = score;
  timerText.textContent = `${Math.floor(time / 60)}:${(time % 60).toString().padStart(2, "0")}`;

  if (active) {
    status.textContent = score >= 70 ? "Deep focus" : "Stay on task";
    status.className = `focus-status ${score >= 70 ? "good" : "warning"}`;
  } else {
    status.textContent = "Idle";
    status.className = "focus-status";
  }

  eyeMeter.style.width = `${eyeEnabled ? eyeScore : 0}%`;
  eyeText.textContent = eyeEnabled ? `${eyeScore}% eye focus` : "Eye tracker off";
  eyeText.className = eyeEnabled ? "focus-eye-text active" : "focus-eye-text";

  if (!active) {
    pageBlocked = false;
    hideBlockOverlay();
  }
}

function checkSiteBlock(data) {
  const currentHost = window.location.hostname.toLowerCase();
  const blockedMatch = (data.blockedSites || []).some((site) => currentHost.includes(site));
  const safeMatch = (data.workspaceSites || []).some((site) => currentHost.includes(site));
  return blockedMatch && !safeMatch;
}

function showBlockOverlay(message) {
  const blocker = document.getElementById(BLOCK_ID);
  if (!blocker) return;
  blocker.classList.remove("hidden");
  blocker.querySelector("#focusBlockMessage").textContent = message;
  document.body.classList.add("focus-page-blocked");
}

function hideBlockOverlay() {
  const blocker = document.getElementById(BLOCK_ID);
  if (!blocker) return;
  blocker.classList.add("hidden");
  document.body.classList.remove("focus-page-blocked");
}

function showTemporaryMessage(text) {
  const existing = document.getElementById("focusTempMessage");
  if (existing) existing.remove();
  const message = document.createElement("div");
  message.id = "focusTempMessage";
  message.className = "focus-temp-message";
  message.textContent = text;
  document.body.appendChild(message);
  clearTimeout(unFocusTimeout);
  unFocusTimeout = setTimeout(() => {
    message.remove();
  }, 3600);
}

function refreshState() {
  chrome.storage.local.get(
    [
      "focusSessionActive",
      "score",
      "blockedSites",
      "workspaceSites",
      "mode",
      "focusPanelCollapsed",
      "eyeTrackerEnabled",
      "eyeTrackerScore"
    ],
    (data) => {
      createFocusOverlay();
      updateOverlay(data);

      if (data.focusSessionActive && checkSiteBlock(data)) {
        if (!pageBlocked) {
          pageBlocked = true;
          showBlockOverlay("Off task! Return to your focus session.");
          chrome.runtime.sendMessage({ type: "DECREASE_SCORE", amount: 20, reason: "Blocked site" }, () => {});
        }
      } else {
        hideBlockOverlay();
        pageBlocked = false;
      }
    }
  );
}

createFocusOverlay();
refreshState();

chrome.storage.onChanged.addListener((changes) => {
  if (
    changes.focusSessionActive ||
    changes.score ||
    changes.blockedSites ||
    changes.workspaceSites ||
    changes.mode ||
    changes.focusPanelCollapsed ||
    changes.eyeTrackerEnabled ||
    changes.eyeTrackerScore
  ) {
    refreshState();
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (["FOCUS_ON", "FOCUS_OFF", "FOCUS_IDLE", "FOCUS_DISTRACTED"].includes(msg.type)) {
    refreshState();
    if (msg.type === "FOCUS_IDLE") {
      showTemporaryMessage("Drifting: reconnect with the task.");
    }
    if (msg.type === "FOCUS_DISTRACTED") {
      showTemporaryMessage("Eye tracker noticed distraction.");
    }
  }
});