const PANEL_ID = "focus-extension-panel";
const BORDER_ID = "focus-extension-border";
const OVERLAY_ID = "focus-extension-overlay";

let pageBlocked = false;
let temporaryMessageTimeout = null;
let driftOverlayTimeout = null;
let lastKnownScore = 100;
let auraBurstTimeout = null;
let auraActiveTimeout = null;
let panelDragState = null;
let driftDismissArmed = false;
let lowScorePopupTimeout = null;
let promptSequenceTimeouts = [];
let lastPromptBucket = null;

const DEFAULT_PROMPTS = {
  relaxed: [
    "Ease back in and return to the task.",
    "Your goal is still right here. Pick it back up.",
    "A calm reset can save the whole session."
  ],
  deepEncouraging: [
    "Stay with the commitment you made.",
    "You can recover this session right now.",
    "Hold the line for one more focused minute."
  ],
  deepAggressive: [
    "Lock in now.",
    "Stop drifting and finish the work.",
    "You do not need another distraction."
  ]
};

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds || 0));
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function createFocusOverlay() {
  if (document.getElementById(PANEL_ID)) return;

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.innerHTML = `
    <button id="focusToggleBtn" class="focus-toggle-btn" aria-label="Collapse focus bar">-</button>
    <div class="focus-panel">
      <div class="focus-kicker-row">
        <span class="focus-kicker">Focus Bar</span>
        <button id="focusOpenMenu" class="focus-open-menu" type="button">Dashboard</button>
      </div>
      <div class="focus-panel-title">Stay with the work</div>
      <div class="focus-metrics">
        <div class="focus-metric-card">
          <span>Timer</span>
          <strong id="focusTimer">25:00</strong>
        </div>
        <div class="focus-metric-card">
          <span>Score</span>
          <strong id="focusScore">100%</strong>
        </div>
      </div>
      <div class="focus-plant-shell">
        <div class="focus-plant-glow"></div>
        <div id="focusPlant" class="focus-plant">
          <span class="focus-plant-leaf focus-plant-leaf-left"></span>
          <span class="focus-plant-leaf focus-plant-leaf-right"></span>
          <span class="focus-plant-leaf focus-plant-leaf-top"></span>
        </div>
      </div>
      <div class="focus-status-row">
        <span class="focus-status-label">Status</span>
        <span id="focusStatus" class="focus-status">Ready</span>
      </div>
      <div class="focus-eye-row">
        <div class="focus-eye-header">
          <span>Eye focus</span>
          <span id="focusEyeText" class="focus-eye-text">Tracker off</span>
        </div>
        <div class="focus-eye-meter">
          <div id="focusEyeMeter" class="focus-eye-meter-fill"></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  const toggleButton = panel.querySelector("#focusToggleBtn");
  const dashboardButton = panel.querySelector("#focusOpenMenu");

  const border = document.createElement("div");
  border.id = BORDER_ID;
  document.body.appendChild(border);

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "focus-screen hidden";
  overlay.innerHTML = `
    <div class="focus-screen-card">
      <div id="focusOverlayBadge" class="focus-screen-badge">Focus</div>
      <h2 id="focusOverlayTitle">Off task</h2>
      <p id="focusOverlayBody">Return to your focus session.</p>
    </div>
  `;
  document.body.appendChild(overlay);

  function togglePanelCollapsed() {
    chrome.storage.local.get("focusPanelCollapsed", (data) => {
      const collapsed = !Boolean(data.focusPanelCollapsed);
      chrome.storage.local.set({ focusPanelCollapsed: collapsed }, refreshState);
    });
  }

  function handleMouseMove(event) {
    if (!panelDragState) return;

    const nextLeft = Math.min(
      Math.max(8, panelDragState.startLeft + (event.clientX - panelDragState.startX)),
      Math.max(8, window.innerWidth - panel.offsetWidth - 8)
    );
    const nextTop = Math.min(
      Math.max(8, panelDragState.startTop + (event.clientY - panelDragState.startY)),
      Math.max(8, window.innerHeight - panel.offsetHeight - 8)
    );

    panel.style.left = `${nextLeft}px`;
    panel.style.top = `${nextTop}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  function finishDrag(event) {
    if (!panelDragState) return;

    panel.classList.remove("focus-panel-dragging");
    panelDragState = null;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", finishDrag);

    const horizontal = event.clientX < window.innerWidth / 2 ? "left" : "right";
    const vertical = event.clientY < window.innerHeight / 2 ? "top" : "bottom";
    chrome.storage.local.set({ focusPanelPosition: `${vertical}-${horizontal}` }, refreshState);
  }

  if (!toggleButton || !dashboardButton) {
    return;
  }

  toggleButton.addEventListener("click", (event) => {
    event.stopPropagation();
    togglePanelCollapsed();
  });

  panel.addEventListener("click", (event) => {
    const isCollapsed = panel.classList.contains("focus-panel-collapsed");
    const clickedDashboard = event.target instanceof Element && event.target.closest("#focusOpenMenu");
    if (isCollapsed && !clickedDashboard) {
      togglePanelCollapsed();
    }
  });

  dashboardButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" }, () => {
      if (chrome.runtime.lastError) {
        showTemporaryMessage("Unable to open the dashboard right now.");
      }
    });
  });

  panel.addEventListener("mousedown", (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("button")) return;

    panelDragState = {
      startX: event.clientX,
      startY: event.clientY,
      startLeft: panel.getBoundingClientRect().left,
      startTop: panel.getBoundingClientRect().top
    };

    panel.classList.add("focus-panel-dragging");
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", finishDrag);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;

    chrome.storage.local.get(["focusSessionActive", "readingMode"], (data) => {
      if (!data.focusSessionActive || data.readingMode) return;

      showTemporaryMessage("Stay with this tab to protect your focus score.");
      chrome.runtime.sendMessage({ type: "DECREASE_SCORE", amount: 12, reason: "Tab switch" }, () => {});
    });
  });
}

function showScreenOverlay({ title, body, badge, variant = "blocked", persist = false }) {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;

  if (pageBlocked && variant !== "blocked") {
    return;
  }

  overlay.className = `focus-screen focus-screen-${variant}`;
  overlay.classList.remove("hidden");
  document.getElementById("focusOverlayBadge").textContent = badge;
  document.getElementById("focusOverlayTitle").textContent = title;
  document.getElementById("focusOverlayBody").textContent = body;
  document.body.classList.add("focus-page-muted");
  driftDismissArmed = false;

  clearTimeout(driftOverlayTimeout);
  if (!persist) {
    driftOverlayTimeout = setTimeout(() => {
      if (!pageBlocked && !driftDismissArmed) {
        hideScreenOverlay();
      }
    }, 4200);
  }
}

function hideScreenOverlay() {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;

  overlay.classList.add("hidden");
  overlay.className = "focus-screen hidden";
  document.body.classList.remove("focus-page-muted");
  driftDismissArmed = false;
}

function showTemporaryMessage(text, className = "") {
  const existing = document.getElementById("focusTempMessage");
  if (existing) existing.remove();

  const message = document.createElement("div");
  message.id = "focusTempMessage";
  message.className = "focus-temp-message";
  if (className) {
    message.classList.add(className);
  }
  message.textContent = text;
  document.body.appendChild(message);

  clearTimeout(temporaryMessageTimeout);
  temporaryMessageTimeout = setTimeout(() => {
    message.remove();
  }, 3200);
}

function showLowScorePrompt(text, tone = "encouraging") {
  const existing = document.getElementById("focusLowScorePrompt");
  if (existing) existing.remove();

  const prompt = document.createElement("div");
  prompt.id = "focusLowScorePrompt";
  prompt.className = `focus-low-score-prompt ${tone === "aggressive" ? "aggressive" : "encouraging"}`;
  prompt.textContent = text;
  if (tone === "aggressive") {
    const left = 28 + Math.random() * 44;
    const top = 36 + Math.random() * 24;
    prompt.style.left = `${left}%`;
    prompt.style.top = `${top}%`;
    prompt.style.bottom = "auto";
    prompt.style.transform = `translate(-50%, -50%) rotate(${(Math.random() * 8 - 4).toFixed(1)}deg)`;
  }
  document.body.appendChild(prompt);

  clearTimeout(lowScorePopupTimeout);
  lowScorePopupTimeout = setTimeout(() => {
    prompt.remove();
  }, 2600);
}

function clearPromptSequence() {
  promptSequenceTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
  promptSequenceTimeouts = [];
}

function getPromptTone(data) {
  if (data.mode === "deep") {
    return data.messageTone || "encouraging";
  }
  return "encouraging";
}

function getPromptMessages(data) {
  if (data.mode === "deep") {
    if ((data.messageTone || "encouraging") === "aggressive") {
      return data.deepAggressiveMessages || DEFAULT_PROMPTS.deepAggressive;
    }
    return data.deepEncouragingMessages || DEFAULT_PROMPTS.deepEncouraging;
  }
  return data.relaxedMessages || DEFAULT_PROMPTS.relaxed;
}

function showPromptSequence(messages, tone) {
  clearPromptSequence();
  const promptMessages = messages.slice(0, 3);
  if (promptMessages.length === 0) return;

  showLowScorePrompt(promptMessages[0], tone);

  promptMessages.slice(1).forEach((message, index) => {
    const timeoutId = setTimeout(() => {
      showLowScorePrompt(message, tone);
    }, (index + 1) * 2800);
    promptSequenceTimeouts.push(timeoutId);
  });
}

function triggerFocusAuraBurst() {
  document.documentElement.classList.add("focus-aura-active");
  document.documentElement.classList.add("focus-aura-burst");
  clearTimeout(auraBurstTimeout);
  clearTimeout(auraActiveTimeout);
  auraBurstTimeout = setTimeout(() => {
    document.documentElement.classList.remove("focus-aura-burst");
  }, 1500);
  auraActiveTimeout = setTimeout(() => {
    document.documentElement.classList.remove("focus-aura-active");
  }, 2600);
}

function checkSiteBlock(data) {
  const currentHost = window.location.hostname.toLowerCase();
  const blockedMatch = (data.blockedSites || []).some((site) => currentHost.includes(site));
  const safeMatch = (data.workspaceSites || []).some((site) => currentHost.includes(site));
  return blockedMatch && !safeMatch;
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
  const toggleBtn = document.getElementById("focusToggleBtn");

  if (!panel || !border || !plant || !timerText || !scoreLabel || !status || !eyeMeter || !eyeText || !toggleBtn) {
    return;
  }

  const active = Boolean(data.focusSessionActive);
  const score = Math.max(0, Math.min(100, Number(data.score ?? 100)));
  const collapsed = Boolean(data.focusPanelCollapsed);
  const time = Number(data.sessionTimeLeft ?? 1500);
  const totalTime = Math.max(1, Number(data.sessionDuration ?? 1500));
  const eyeScore = Math.max(0, Math.min(100, Number(data.eyeTrackerScore ?? 100)));
  const eyeEnabled = Boolean(data.eyeTrackerEnabled);
  const panelPosition = data.focusPanelPosition || "top-right";

  panel.classList.remove("focus-panel-top-left", "focus-panel-top-right", "focus-panel-bottom-left", "focus-panel-bottom-right");
  panel.classList.add(`focus-panel-${panelPosition}`);
  panel.style.left = "";
  panel.style.top = "";
  panel.style.right = "";
  panel.style.bottom = "";
  panel.classList.toggle("focus-panel-collapsed", collapsed);
  panel.classList.toggle("focus-panel-active", active);
  border.classList.toggle("focus-border-active", active);
  border.classList.toggle("focus-border-strong", active && score >= 78);
  toggleBtn.textContent = collapsed ? "+" : "-";
  toggleBtn.setAttribute("aria-label", collapsed ? "Expand focus bar" : "Collapse focus bar");

  const progress = active ? Math.max(0, Math.min(1, 1 - time / totalTime)) : 0;
  const stemHeight = collapsed ? 12 : 18 + Math.round(progress * 74);
  const stemWidth = collapsed ? 10 : 12 + Math.round(progress * 8);
  const leafScale = collapsed ? 0.75 : 0.55 + progress * 0.95;
  const topLeafScale = collapsed ? 0.45 : Math.max(0, (progress - 0.2) / 0.8);

  plant.style.height = `${stemHeight}px`;
  plant.style.width = `${stemWidth}px`;
  plant.style.setProperty("--leaf-scale", leafScale.toFixed(2));
  plant.style.setProperty("--top-leaf-scale", topLeafScale.toFixed(2));
  timerText.textContent = formatTime(time);
  scoreLabel.textContent = `${score}%`;

  if (active) {
    if (score >= 78) {
      status.textContent = "Locked in";
      status.className = "focus-status good";
    } else if (score >= 55) {
      status.textContent = "Hold your line";
      status.className = "focus-status caution";
    } else {
      status.textContent = "Refocus now";
      status.className = "focus-status warning";
    }
  } else {
    status.textContent = "Ready";
    status.className = "focus-status";
  }

  eyeMeter.style.width = `${eyeEnabled ? eyeScore : 0}%`;
  eyeText.textContent = eyeEnabled ? `${eyeScore}% steady` : "Tracker off";
  eyeText.classList.toggle("active", eyeEnabled);

  document.body.classList.toggle("focus-session-live", active);

  if (!active) {
    pageBlocked = false;
    lastPromptBucket = null;
    document.documentElement.classList.remove("focus-aura-active");
    document.documentElement.classList.remove("focus-aura-burst");
    clearTimeout(auraActiveTimeout);
    hideScreenOverlay();
  }
}

function maybeShowDriftOverlay(newScore, previousScore, active) {
  if (!active) return;
  const scoreDrop = previousScore - newScore;
  const severeDecline = scoreDrop >= 15;
  const lowScore = newScore <= 50;

  if (severeDecline || lowScore) {
    showScreenOverlay({
      title: "Your focus is drifting",
      body: "Pause, breathe, and come back to the task in front of you.",
      badge: "Refocus",
      variant: "drift"
    });
  }
}

function maybeShowLowScorePopup(score, data) {
  if (!data.focusSessionActive || score > 50) return;
  const nextBucket = score <= 25 ? "critical" : "warning";
  if (lastPromptBucket === nextBucket) return;

  const tone = getPromptTone(data);
  const promptSet = getPromptMessages(data);
  showPromptSequence(promptSet, tone);
  lastPromptBucket = nextBucket;
}

function showOffFocusPromptSequence(data) {
  const tone = getPromptTone(data);
  const promptSet = getPromptMessages(data);
  showPromptSequence(promptSet, tone);
}

function armDriftDismissOnMovement() {
  driftDismissArmed = true;

  const handleMovement = () => {
    hideScreenOverlay();
    window.removeEventListener("mousemove", handleMovement, { passive: true });
    window.removeEventListener("pointermove", handleMovement, { passive: true });
  };

  window.addEventListener("mousemove", handleMovement, { passive: true, once: true });
  window.addEventListener("pointermove", handleMovement, { passive: true, once: true });
}

function refreshState() {
  chrome.storage.local.get(
    [
      "focusSessionActive",
      "score",
      "blockedSites",
      "workspaceSites",
      "focusPanelCollapsed",
      "focusPanelPosition",
      "eyeTrackerEnabled",
      "eyeTrackerScore",
      "sessionTimeLeft",
      "sessionDuration",
      "focusAura"
    ],
    (data) => {
      createFocusOverlay();
      updateOverlay(data);

      if (data.focusSessionActive && checkSiteBlock(data)) {
        if (!pageBlocked) {
          pageBlocked = true;
          showScreenOverlay({
            title: "You are off task!",
            body: "This site is pulling you away. Return to your focus session now.",
            badge: "Blocked",
            variant: "blocked",
            persist: true
          });
          chrome.runtime.sendMessage({ type: "DECREASE_SCORE", amount: 20, reason: "Blocked site" }, () => {});
        }
      } else {
        pageBlocked = false;
        const overlay = document.getElementById(OVERLAY_ID);
        if (overlay && overlay.classList.contains("focus-screen-blocked")) {
          hideScreenOverlay();
        }
      }
    }
  );
}

createFocusOverlay();
refreshState();

chrome.storage.local.get("score", (data) => {
  lastKnownScore = Number(data.score ?? 100);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  if (
    changes.focusSessionActive ||
    changes.score ||
    changes.blockedSites ||
    changes.workspaceSites ||
    changes.focusPanelCollapsed ||
    changes.focusPanelPosition ||
    changes.eyeTrackerEnabled ||
    changes.eyeTrackerScore ||
    changes.sessionTimeLeft ||
    changes.sessionDuration ||
    changes.focusAura
  ) {
    refreshState();
  }

  if (changes.score) {
    chrome.storage.local.get(
      ["focusSessionActive", "mode", "messageTone", "relaxedMessages", "deepEncouragingMessages", "deepAggressiveMessages"],
      (data) => {
      const newScore = Number(changes.score.newValue ?? lastKnownScore);
      maybeShowDriftOverlay(newScore, lastKnownScore, Boolean(data.focusSessionActive));
      maybeShowLowScorePopup(newScore, data);
      if (newScore > 50) {
        lastPromptBucket = null;
      }
      lastKnownScore = newScore;
      }
    );
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!["FOCUS_ON", "FOCUS_OFF", "FOCUS_IDLE", "FOCUS_DISTRACTED"].includes(msg.type)) return;

  refreshState();

  if (msg.type === "FOCUS_ON") {
    triggerFocusAuraBurst();
    showScreenOverlay({
      title: "Focus mode is on",
      body: "Get ready to focus.",
      badge: "Focus",
      variant: "start"
    });
    showTemporaryMessage("Get ready to focus.", "focus-start-message");
  }

  if (msg.type === "FOCUS_IDLE" || msg.type === "FOCUS_DISTRACTED") {
    showScreenOverlay({
      title: "Your focus is drifting",
      body: "Idleness was detected. Bring your attention back before the session slips away.",
      badge: "Refocus",
      variant: "drift",
      persist: true
    });
    armDriftDismissOnMovement();
    chrome.storage.local.get(
      ["mode", "messageTone", "focusSessionActive", "relaxedMessages", "deepEncouragingMessages", "deepAggressiveMessages"],
      (data) => {
      showOffFocusPromptSequence(data);
      }
    );
  }

  if (msg.type === "FOCUS_OFF") {
    document.documentElement.classList.remove("focus-aura-active");
    document.documentElement.classList.remove("focus-aura-burst");
  }
});
