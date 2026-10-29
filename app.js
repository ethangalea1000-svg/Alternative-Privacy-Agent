(() => {
  "use strict";

  const STORAGE_KEY = "apa.aliases.v1";
  const categories = {
    achats: "Achats",
    projets: "Projets",
    public: "Public",
    personnel: "Personnel"
  };
  const statuses = {
    planned: "À configurer",
    active: "Actif",
    paused: "En pause"
  };
  const symbols = { achats: "◇", projets: "⌘", public: "↗", personnel: "⌁" };
  const elements = {
    list: document.querySelector("#alias-list"),
    empty: document.querySelector("#empty-state"),
    dialog: document.querySelector("#alias-dialog"),
    form: document.querySelector("#alias-form"),
    name: document.querySelector("#alias-name"),
    category: document.querySelector("#alias-category"),
    status: document.querySelector("#alias-status"),
    error: document.querySelector("#form-error"),
    search: document.querySelector("#search"),
    categoryFilter: document.querySelector("#category-filter"),
    statusFilter: document.querySelector("#status-filter"),
    toast: document.querySelector("#toast")
  };

  let aliases = loadAliases();
  let toastTimeout;

  function loadAliases() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item) =>
        item && typeof item.id === "string" &&
        typeof item.name === "string" && item.name.trim().length > 0 &&
        item.name.length <= 48 &&
        typeof item.label === "string" && /^[a-z0-9-]{1,40}$/.test(item.label) &&
        Object.hasOwn(categories, item.category) &&
        Object.hasOwn(statuses, item.status) &&
        typeof item.createdAt === "string" &&
        !Number.isNaN(Date.parse(item.createdAt))
      );
    } catch {
      return [];
    }
  }

  function persistAliases() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(aliases));
      return true;
    } catch {
      showToast("Le navigateur n’a pas pu enregistrer les changements. Vérifiez l’espace disponible ou les paramètres de stockage.");
      return false;
    }
  }

  function makeId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    return "apa-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function makeInternalLabel(name) {
    const slug = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
    const suffix = Math.random().toString(36).slice(2, 6);
    return (slug || "alias") + "-" + suffix;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date inconnue";
    return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" }).format(date);
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function createAliasCard(item) {
    const card = element("article", "alias-card");
    const symbol = element("div", "alias-symbol", symbols[item.category]);
    symbol.setAttribute("aria-hidden", "true");
    const main = element("div", "alias-main");
    const name = element("h3", "alias-name", item.name);
    const id = element("span", "alias-id", item.label);
    id.title = "Identifiant interne, pas une adresse e-mail";
    const meta = element("div", "alias-meta");
    meta.append(
      element("span", "category-pill", categories[item.category]),
      element("span", "status-pill status-" + item.status, statuses[item.status])
    );
    main.append(name, id, meta);
    const date = element("span", "alias-date", formatDate(item.createdAt));
    date.setAttribute("aria-label", "Créé le " + formatDate(item.createdAt));
    const actions = element("div", "alias-actions");

    const statusButton = element("button", "icon-button", item.status === "paused" ? "▶" : "Ⅱ");
    statusButton.type = "button";
    statusButton.title = item.status === "paused" ? "Réactiver le suivi" : "Mettre en pause";
    statusButton.setAttribute("aria-label", statusButton.title + " : " + item.name);
    statusButton.addEventListener("click", () => toggleStatus(item.id));

    const deleteButton = element("button", "icon-button danger", "×");
    deleteButton.type = "button";
    deleteButton.title = "Supprimer cet identifiant";
    deleteButton.setAttribute("aria-label", "Supprimer " + item.name);
    deleteButton.addEventListener("click", () => deleteAlias(item.id));

    actions.append(statusButton, deleteButton);
    card.append(symbol, main, date, actions);
    return card;
  }

  function render() {
    const query = elements.search.value.trim().toLocaleLowerCase("fr");
    const category = elements.categoryFilter.value;
    const status = elements.statusFilter.value;
    const filtered = aliases.filter((item) => {
      const matchesQuery = item.name.toLocaleLowerCase("fr").includes(query) ||
        item.label.toLocaleLowerCase("fr").includes(query);
      return matchesQuery &&
        (category === "all" || item.category === category) &&
        (status === "all" || item.status === status);
    });

    elements.list.replaceChildren(...filtered.map(createAliasCard));
    elements.empty.classList.toggle("is-visible", filtered.length === 0);
    const noAliases = aliases.length === 0;
    elements.empty.querySelector("h3").textContent = noAliases ? "Aucun alias pour le moment" : "Aucun résultat";
    elements.empty.querySelector("p").textContent = noAliases
      ? "Créez votre premier identifiant pour commencer à organiser vos usages."
      : "Essayez une autre recherche ou modifiez les filtres.";
    elements.empty.querySelector("button").hidden = !noAliases;

    document.querySelector("#stat-total").textContent = String(aliases.length);
    document.querySelector("#stat-active").textContent = String(aliases.filter((item) => item.status === "active").length);
    document.querySelector("#stat-paused").textContent = String(aliases.filter((item) => item.status === "paused").length);
    document.querySelector("#stat-planned").textContent = String(aliases.filter((item) => item.status === "planned").length);
    document.querySelector("#nav-count").textContent = String(aliases.length);
  }

  function showToast(message) {
    clearTimeout(toastTimeout);
    elements.toast.textContent = message;
    elements.toast.classList.add("is-visible");
    toastTimeout = setTimeout(() => elements.toast.classList.remove("is-visible"), 3500);
  }

  function openDialog() {
    elements.error.hidden = true;
    elements.error.textContent = "";
    elements.form.reset();
    if (typeof elements.dialog.showModal === "function") {
      elements.dialog.showModal();
      elements.name.focus();
    } else {
      showToast("Votre navigateur ne prend pas en charge cette fenêtre de création.");
    }
  }

  function closeDialog() {
    elements.dialog.close();
  }

  function toggleStatus(id) {
    const item = aliases.find((alias) => alias.id === id);
    if (!item) return;
    const previous = item.status;
    item.status = previous === "paused" ? "active" : "paused";
    if (!persistAliases()) {
      item.status = previous;
      return;
    }
    render();
    showToast(item.status === "paused" ? "Identifiant mis en pause." : "Suivi réactivé.");
  }

  function deleteAlias(id) {
    const item = aliases.find((alias) => alias.id === id);
    if (!item) return;
    const confirmed = window.confirm("Supprimer l’identifiant « " + item.name + " » de ce navigateur ? Cette action est irréversible.");
    if (!confirmed) return;
    const previous = aliases;
    aliases = aliases.filter((alias) => alias.id !== id);
    if (!persistAliases()) {
      aliases = previous;
      return;
    }
    render();
    showToast("Identifiant supprimé du stockage local.");
  }

  document.querySelector("#open-create").addEventListener("click", openDialog);
  document.querySelector("#empty-create").addEventListener("click", openDialog);
  document.querySelector("#close-dialog").addEventListener("click", closeDialog);
  document.querySelector("#cancel-create").addEventListener("click", closeDialog);
  elements.search.addEventListener("input", render);
  elements.categoryFilter.addEventListener("change", render);
  elements.statusFilter.addEventListener("change", render);

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = elements.name.value.trim();
    if (!name) {
      elements.error.textContent = "Saisissez un nom pour cet identifiant.";
      elements.error.hidden = false;
      elements.name.focus();
      return;
    }
    if (name.length > 48) {
      elements.error.textContent = "Le nom ne peut pas dépasser 48 caractères.";
      elements.error.hidden = false;
      elements.name.focus();
      return;
    }
    const item = {
      id: makeId(),
      name,
      label: makeInternalLabel(name),
      category: elements.category.value,
      status: elements.status.value,
      createdAt: new Date().toISOString()
    };
    if (!Object.hasOwn(categories, item.category) || !Object.hasOwn(statuses, item.status)) {
      elements.error.textContent = "Une valeur sélectionnée est invalide. Vérifiez les champs et réessayez.";
      elements.error.hidden = false;
      return;
    }
    aliases.unshift(item);
    if (!persistAliases()) {
      aliases.shift();
      return;
    }
    closeDialog();
    render();
    showToast("Identifiant créé dans ce navigateur.");
  });

  elements.dialog.addEventListener("click", (event) => {
    if (event.target === elements.dialog) closeDialog();
  });

  render();
})();