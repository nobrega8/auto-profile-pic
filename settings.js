"use strict";

/* Definições partilhadas pelo background e pela página de opções. */

// Domínios de email pessoal: o logo do fornecedor não identifica a pessoa.
const DEFAULT_PERSONAL_DOMAINS = [
  "aol.com",
  "gmail.com",
  "gmx.com",
  "gmx.net",
  "googlemail.com",
  "hotmail.com",
  "hotmail.pt",
  "icloud.com",
  "live.com",
  "live.com.pt",
  "mac.com",
  "mail.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "outlook.pt",
  "proton.me",
  "protonmail.com",
  "sapo.pt",
  "yahoo.com",
  "yandex.com",
  "zoho.com",
];

const DEFAULT_SETTINGS = {
  useGravatar: true,
  useCompanyLogo: true,
  personalDomains: DEFAULT_PERSONAL_DOMAINS,
  remoteConsent: false,
  remoteConsentAnswered: false,
};

async function loadSettings() {
  const { settings } = await browser.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...settings };
}

/** Aceita "joao@empresa.pt", "https://www.empresa.pt/x", etc. */
function normalizeDomain(input) {
  let domain = String(input ?? "").trim().toLowerCase();
  domain = domain.slice(domain.lastIndexOf("@") + 1);
  domain = domain.replace(/^[a-z]+:\/\//, "").split(/[/?#:]/)[0];
  return domain.replace(/^www\./, "").replace(/\.$/, "");
}
