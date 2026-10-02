"use strict";

const $ = id => document.getElementById(id);

async function initSettings() {
  const settings = await loadSettings();
  for (const el of document.querySelectorAll("[data-setting]")) {
    const key = el.dataset.setting;
    if (el.type == "checkbox") {
      el.checked = settings[key];
    } else {
      el.value = settings[key].join("\n");
    }
    el.addEventListener("change", saveSettings);
  }
}

async function saveSettings() {
  const settings = await loadSettings();
  for (const el of document.querySelectorAll("[data-setting]")) {
    const key = el.dataset.setting;
    if (el.type == "checkbox") {
      settings[key] = el.checked;
      if (key == "remoteConsent") {
        settings.remoteConsentAnswered = true;
      }
    } else {
      settings[key] = [
        ...new Set(el.value.split(/[\s,;]+/).map(normalizeDomain).filter(Boolean)),
      ].sort();
      el.value = settings[key].join("\n");
    }
  }
  await browser.storage.local.set({ settings });
  toast("Saved");
}

$("resetDomains").addEventListener("click", async () => {
  document.querySelector('[data-setting="personalDomains"]').value =
    DEFAULT_PERSONAL_DOMAINS.join("\n");
  await saveSettings();
});

$("clearCache").addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "clearCache" });
  toast("Cache cleared");
});

let toastTimer;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 1500);
}

initSettings();
