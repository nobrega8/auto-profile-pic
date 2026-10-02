"use strict";

const FOUND_TTL = 30 * 24 * 3600 * 1000; // 30 dias
const MISSING_TTL = 7 * 24 * 3600 * 1000; // 7 dias
const MAX_PARALLEL = 4;
const SIZE = 128;

const LOGO_SOURCES = [
  domain =>
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${SIZE}`,
  domain => `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`,
];

let settings = { ...DEFAULT_SETTINGS };

// ---- Entrega ao experiment, agrupada ----

let outbox = {};
let flushTimer = null;

function deliver(email, url) {
  outbox[email] = url;
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      const batch = outbox;
      outbox = {};
      flushTimer = null;
      browser.profilePics.setAvatars(batch).catch(console.error);
    }, 50);
  }
}

browser.profilePics.onAvatarsNeeded.addListener(emails => {
  for (const email of emails) {
    limited(() => resolve(email))
      .then(url => deliver(email, url))
      .catch(e => {
        console.error("Avatar falhou:", email, e);
        deliver(email, null);
      });
  }
});

/** Gravatar > logo da empresa (a foto do contacto é tratada no experiment). */
async function resolve(email) {
  // Sem consentimento não se contacta nenhum serviço externo.
  if (!settings.remoteConsent) {
    return null;
  }
  if (settings.useGravatar) {
    const url = await cached(`gravatar:${email}`, () => fetchGravatar(email));
    if (url) {
      console.info("Auto Profile Pic:", email, "→ Gravatar");
      return url;
    }
  }
  const domain = normalizeDomain(email);
  if (
    settings.useCompanyLogo &&
    domain.includes(".") &&
    !settings.personalDomains.includes(domain)
  ) {
    const url = await cached(`logo:${domain}`, () => fetchLogo(domain));
    console.info("Auto Profile Pic:", email, url ? "→ company logo" : "→ nothing");
    return url;
  }
  console.info("Auto Profile Pic:", email, "→ nothing");
  return null;
}

/**
 * Resultado em storage.local, incluindo "não existe", com validade.
 * Erros (rede, servidor) não são guardados: tenta-se de novo mais tarde.
 */
async function cached(key, fetcher) {
  const entry = (await browser.storage.local.get(key))[key];
  const ttl = entry?.url ? FOUND_TTL : MISSING_TTL;
  if (entry && Date.now() - entry.time < ttl) {
    return entry.url;
  }
  try {
    const url = await fetcher();
    await browser.storage.local.set({ [key]: { url, time: Date.now() } });
    return url;
  } catch (e) {
    console.warn("Auto Profile Pic:", key, e);
    return null;
  }
}

async function fetchGravatar(email) {
  // O Gravatar aceita SHA-256 do email normalizado; d=404 = sem imagem;
  // r=pg para não esconder imagens classificadas acima de "G".
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  return fetchImage(`https://gravatar.com/avatar/${hash}?s=${SIZE}&d=404&r=pg`);
}

async function fetchLogo(domain) {
  let error = null;
  for (const source of LOGO_SOURCES) {
    try {
      const url = await fetchImage(source(domain));
      if (url) {
        return url;
      }
    } catch (e) {
      error = e;
    }
  }
  // Se alguma fonte falhou com erro, não fica guardado como "não existe".
  if (error) {
    throw error;
  }
  return null;
}

/** Data URL da imagem, null se não existir (404/não imagem); lança em erro. */
async function fetchImage(url) {
  const response = await fetch(url, { credentials: "omit" });
  if (response.status == 404 || response.status == 410) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const blob = await response.blob();
  if (!blob.size || !blob.type.startsWith("image/")) {
    return null;
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ---- Limite de pedidos em paralelo ----

let running = 0;
const waiting = [];

async function limited(task) {
  if (running >= MAX_PARALLEL) {
    await new Promise(go => waiting.push(go));
  }
  running++;
  try {
    return await task();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

// ---- Definições e cache ----

async function clearCache() {
  const all = await browser.storage.local.get(null);
  await browser.storage.local.remove(
    Object.keys(all).filter(k => /^(gravatar|logo):/.test(k))
  );
  await browser.profilePics.clearAvatars();
}

browser.storage.onChanged.addListener(async (changes, area) => {
  if (area == "local" && changes.settings) {
    settings = await loadSettings();
    // As regras mudaram: volta a resolver tudo (a cache de rede mantém-se).
    await browser.profilePics.clearAvatars();
  }
});

browser.runtime.onMessage.addListener(async message => {
  if (message?.type == "clearCache") {
    await clearCache();
    return true;
  }
  return undefined;
});

// ---- Consentimento (primeira execução) ----

browser.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason != "install" && reason != "update") {
    return;
  }
  const current = await loadSettings();
  if (!current.remoteConsentAnswered) {
    browser.tabs.create({ url: "consent/consent.html" });
  }
});

async function init() {
  settings = await loadSettings();
  await browser.profilePics.init();
}

init();
