/* Experiment API: mostra a foto do remetente em cada cartão da lista de
 * mensagens (about:3pane, vista de cartões). Prioridade: foto do contacto
 * (resolvida aqui), depois o que o background encontrar (Gravatar, logo da
 * empresa), e por fim a inicial. Corre com privilégios de chrome. */

"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);
var { setTimeout, clearTimeout } = ChromeUtils.importESModule(
  "resource://gre/modules/Timer.sys.mjs"
);

const AVATAR_CLASS = "ap-avatar";
const STYLE_ID = "ap-avatar-style";

// A grelha do cartão (estado de leitura | conteúdo) é definida num seletor
// aninhado muito específico, daí o !important e as colunas explícitas.
const CSS = `
  .card-container:has(> .${AVATAR_CLASS}:not([hidden])) {
    grid-template-columns: auto auto minmax(0, 1fr) !important;

    & > .read-status-column {
      grid-column: 1;
      grid-row: 1;
    }
    & > .${AVATAR_CLASS} {
      grid-column: 2;
      grid-row: 1;
    }
    & > .thread-card-column {
      grid-column: 3;
      grid-row: 1;
      min-width: 0;
    }
  }
  .${AVATAR_CLASS} {
    --ap-size: 32px;
    align-self: center;
    display: grid;
    place-items: center;
    width: var(--ap-size);
    height: var(--ap-size);
    margin-inline: 8px 8px;
    border-radius: 50%;
    overflow: hidden;
    color: white;
    font-size: calc(var(--ap-size) * 0.42);
    font-weight: 600;
    line-height: 1;
    user-select: none;
  }
  :root[uidensity="compact"] .${AVATAR_CLASS} {
    --ap-size: 26px;
  }
  :root[uidensity="touch"] .${AVATAR_CLASS} {
    --ap-size: 36px;
  }
  .${AVATAR_CLASS}[hidden] {
    display: none;
  }
  .${AVATAR_CLASS} > img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    background: white;
  }
`;

this.profilePics = class extends ExtensionCommon.ExtensionAPI {
  constructor(extension) {
    super(extension);
    // email -> data URL | null (nada encontrado). Ausente = desconhecido.
    this.avatars = new Map();
    this.resolving = new Set();
    this.pending = new Set();
    this.requested = new Set();
    this.notifyTimer = null;
    this.listeners = new Set();
    this.listWindows = new Set();
    this.started = false;

    // about:3pane criados depois do arranque (novos separadores/janelas).
    this.documentObserver = doc => {
      if (doc.documentURI?.startsWith("about:3pane")) {
        this.patchListWindow(doc.defaultView);
      }
    };
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown || !this.started) {
      return;
    }
    Services.obs.removeObserver(
      this.documentObserver,
      "document-element-inserted"
    );
    clearTimeout(this.notifyTimer);
    for (const win of this.listWindows) {
      try {
        this.unpatchListWindow(win);
      } catch (e) {
        console.error(e);
      }
    }
    this.listWindows.clear();
  }

  getAPI(context) {
    return {
      profilePics: {
        init: async () => {
          if (this.started) {
            return;
          }
          this.started = true;
          Services.obs.addObserver(
            this.documentObserver,
            "document-element-inserted"
          );
          for (const win of Services.wm.getEnumerator("mail:3pane")) {
            for (const tabInfo of win.gTabmail?.tabInfo ?? []) {
              const inner = tabInfo.chromeBrowser?.contentWindow;
              if (inner?.location?.href.startsWith("about:3pane")) {
                this.patchListWindow(inner);
              }
            }
          }
        },

        setAvatars: async avatars => {
          for (const [email, url] of Object.entries(avatars)) {
            this.avatars.set(email, url);
          }
          this.refresh();
        },

        clearAvatars: async () => {
          this.avatars.clear();
          this.resolving.clear();
          this.pending.clear();
          this.requested.clear();
          this.refresh();
        },

        onAvatarsNeeded: new ExtensionCommon.EventManager({
          context,
          name: "profilePics.onAvatarsNeeded",
          register: fire => {
            this.listeners.add(fire);
            // Pedidos feitos antes de o background estar a ouvir.
            if (this.requested.size) {
              fire.async([...this.requested]);
            }
            return () => this.listeners.delete(fire);
          },
        }).api(),
      },
    };
  }

  // ---- Lista de mensagens ----

  patchListWindow(win) {
    if (!win || this.listWindows.has(win)) {
      return;
    }
    this.listWindows.add(win);
    win.addEventListener("unload", () => this.listWindows.delete(win), {
      once: true,
    });

    const apply = async () => {
      await win.customElements.whenDefined("thread-card");
      const proto = win.customElements.get("thread-card").prototype;
      this.patchMethod(proto, "fillRow", row => this.renderRow(row));
      // Substitui sempre o conteúdo: ao recarregar, a folha da versão
      // anterior pode ainda estar na página.
      const doc = win.document;
      let style = doc.getElementById(STYLE_ID);
      if (!style) {
        style = doc.createElement("style");
        style.id = STYLE_ID;
        (doc.head ?? doc.documentElement).appendChild(style);
      }
      style.textContent = CSS;
      win.threadTree?.invalidate();
    };
    if (win.document.readyState == "complete") {
      apply();
    } else {
      win.addEventListener("load", apply, { once: true });
    }
  }

  unpatchListWindow(win) {
    const proto = win.customElements.get("thread-card")?.prototype;
    if (!this.unpatchMethod(proto, "fillRow")) {
      return;
    }
    win.document.getElementById(STYLE_ID)?.remove();
    for (const el of win.document.querySelectorAll(`.${AVATAR_CLASS}`)) {
      el.remove();
    }
    win.threadTree?.invalidate();
  }

  refresh() {
    for (const win of this.listWindows) {
      win.threadTree?.invalidate();
    }
  }

  renderRow(row) {
    let avatar = row.querySelector(`.${AVATAR_CLASS}`);
    if (!avatar) {
      avatar = row.ownerDocument.createElement("div");
      avatar.className = AVATAR_CLASS;
      avatar.setAttribute("aria-hidden", "true");
      const statusColumn = row.querySelector(".read-status-column");
      if (statusColumn) {
        statusColumn.after(avatar);
      } else {
        row.querySelector(".card-container")?.prepend(avatar);
      }
    }
    avatar.replaceChildren();
    avatar.style.backgroundColor = "";
    avatar.removeAttribute("title");

    const properties = row.dataset.properties?.split(" ") ?? [];
    const person = properties.includes("dummy") ? null : this.personForRow(row);
    avatar.hidden = !person;
    if (!person) {
      return;
    }

    // O endereço usado, para se perceber de onde vem a imagem.
    avatar.title = person.name
      ? `${person.name} <${person.email}>`
      : person.email;
    const url = this.lookup(person.email);
    if (url) {
      const img = row.ownerDocument.createElement("img");
      img.src = url;
      img.alt = "";
      avatar.appendChild(img);
    } else {
      // Sem foto (ou ainda a carregar): inicial, como no cabeçalho.
      const name = person.name || person.email;
      avatar.textContent =
        Array.from(
          name.normalize().replaceAll(/[^\p{Letter}\p{Nd}]+/gu, "")
        )[0]?.toUpperCase() ?? "";
      avatar.style.backgroundColor = colorFor(person.email);
    }
  }

  /**
   * A pessoa cujo nome o cartão mostra. O Thunderbird usa a coluna do
   * remetente, exceto em pastas de saída (Enviados, Rascunhos...), onde usa
   * a do destinatário; seguimos exatamente a mesma escolha.
   */
  personForRow(row) {
    const view = row.list?.view ?? row.view;
    const index = row._index;
    if (!view || index == null || index < 0) {
      return null;
    }
    const hdr = view.getMsgHdrAt(index);
    if (!hdr) {
      return null;
    }
    const senderColumn = row.ownerDocument.defaultView?.threadPane?.cardColumns?.[1];
    if (senderColumn == "recipientCol") {
      return parseFirst(hdr.recipients) ?? parseFirst(hdr.author);
    }
    return parseFirst(hdr.author);
  }

  // ---- Resolução: contacto > background ----

  /** Data URL já conhecido, ou null (e começa a resolver se preciso). */
  lookup(email) {
    if (this.avatars.has(email)) {
      return this.avatars.get(email);
    }
    if (!this.resolving.has(email)) {
      this.resolving.add(email);
      this.resolve(email);
    }
    return null;
  }

  async resolve(email) {
    try {
      const card = MailServices.ab.cardForEmailAddress(email);
      const photo = card?.photoURL ? await loadAsDataURL(card.photoURL) : null;
      if (photo) {
        this.avatars.set(email, photo);
        this.refresh();
        return;
      }
    } catch (e) {
      console.error("Auto Profile Pic:", e);
    }
    this.request(email);
  }

  request(email) {
    if (this.requested.has(email)) {
      return;
    }
    this.requested.add(email);
    this.pending.add(email);
    if (!this.notifyTimer) {
      this.notifyTimer = setTimeout(() => {
        this.notifyTimer = null;
        if (!this.listeners.size) {
          return;
        }
        const emails = [...this.pending];
        this.pending.clear();
        for (const fire of this.listeners) {
          fire.async(emails);
        }
      }, 50);
    }
  }

  // ---- Patches ----

  /**
   * Envolve `proto[method]` para chamar `render(elemento)` depois do original.
   * O wrapper delega no renderer atual guardado no protótipo, por isso uma
   * nova instância do add-on (ao recarregar) toma conta do patch em vez de o
   * duplicar, e a instância antiga, ao desligar-se, já não o desfaz.
   */
  patchMethod(proto, method, render) {
    const key = `__ap_${method}`;
    if (!proto[key]) {
      const original = proto[method];
      const state = { original, render: null, owner: null, wrapper: null };
      proto[key] = state;
      state.wrapper = function (...args) {
        const result = state.original.apply(this, args);
        try {
          state.render?.(this);
        } catch (e) {
          console.error("Auto Profile Pic:", e);
        }
        return result;
      };
      proto[method] = state.wrapper;
    }
    proto[key].render = render;
    proto[key].owner = this;
  }

  /**
   * Desfaz o patch se esta instância for a dona; devolve se o fez.
   * Se outro add-on envolveu o método depois de nós, repor o original
   * apagaria o patch dele; nesse caso o nosso wrapper fica no lugar, inativo,
   * e é reaproveitado se o add-on voltar a ser carregado.
   */
  unpatchMethod(proto, method) {
    const key = `__ap_${method}`;
    const state = proto?.[key];
    if (!state || state.owner !== this) {
      return false;
    }
    if (proto[method] === state.wrapper) {
      proto[method] = state.original;
      delete proto[key];
    } else {
      state.render = null;
      state.owner = null;
    }
    return true;
  }
};

/** Primeiro endereço de um cabeçalho: { name, email } com email em minúsculas. */
function parseFirst(header) {
  if (!header) {
    return null;
  }
  try {
    const [addr] = MailServices.headerParser.parseEncodedHeaderW(header);
    if (addr?.email) {
      return { name: addr.name, email: addr.email.trim().toLowerCase() };
    }
  } catch (e) {
    // Cabeçalho mal formado.
  }
  return null;
}

/**
 * A lista só aceita imagens data: (CSP), por isso a foto do contacto, que
 * normalmente é um ficheiro na pasta Photos do perfil, é lida e convertida.
 */
async function loadAsDataURL(url) {
  if (url.startsWith("data:")) {
    return url;
  }
  if (!url.startsWith("file:")) {
    return null;
  }
  const file = Services.io.newURI(url).QueryInterface(Ci.nsIFileURL).file;
  const bytes = await IOUtils.read(file.path);
  const ext = file.leafName.split(".").pop().toLowerCase();
  const type =
    { png: "image/png", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" }[
      ext
    ] ?? "image/jpeg";
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${type};base64,${btoa(binary)}`;
}

function colorFor(text) {
  let hash = 0;
  for (const ch of text) {
    hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360} 45% 50%)`;
}
