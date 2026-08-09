// The Manage Users UI, built into whatever container it is given. Shared by
// the in-app view (right pane of index.html) and the standalone page, so the
// two cannot drift apart.
//
// None of this enforces anything. set_user_role() re-checks the manage-users
// key, refuses a blank comment and refuses self-edits; the Edge Function does
// the same for invites. Role editing lives in the expanded row rather than the
// table body, which is what keeps the list narrow.

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const DEFAULT_ROLE = "volunteer";

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...children.filter(Boolean));
  return node;
}

function when(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) +
         " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export async function renderManageUsers(supabase, root, meId) {
  root.replaceChildren();

  let roles = [];
  let users = [];
  let history = [];
  const expanded = new Set();

  const roleNameById = new Map();
  const emailById = new Map();

  const inviteError = h("div", { class: "mu-error" });
  const inviteMsg = h("div", { class: "mu-msg" });
  const rowsEl = h("tbody");
  const countEl = h("span", { class: "mu-count" });

  // ---- add member (hidden until asked for) --------------------------------

  const emailInput = h("input", { type: "email", placeholder: "them@example.com", autocomplete: "off" });
  const roleSelect = h("select");
  const inviteBtn = h("button", { type: "button", class: "mu-btn mu-btn-primary", text: "Send invite" });
  const cancelAdd = h("button", { type: "button", class: "mu-btn", text: "Cancel" });

  const addPanel = h("div", { class: "mu-add" },
    h("div", { class: "mu-add-fields" },
      h("label", {}, h("span", { text: "Email" }), emailInput),
      h("label", {}, h("span", { text: "Role" }), roleSelect),
      h("div", { class: "mu-add-actions" }, inviteBtn, cancelAdd),
    ),
    inviteError,
    inviteMsg,
  );
  addPanel.hidden = true;

  const addToggle = h("button", { type: "button", class: "mu-btn mu-btn-primary", text: "+ Add member" });

  function showAdd(on) {
    addPanel.hidden = !on;
    addToggle.hidden = on;
    if (on) emailInput.focus();
    else { inviteError.textContent = ""; inviteMsg.textContent = ""; }
  }

  addToggle.addEventListener("click", () => showAdd(true));
  cancelAdd.addEventListener("click", () => { emailInput.value = ""; showAdd(false); });

  // ---- filters ------------------------------------------------------------

  const filterInput = h("input", { type: "search", placeholder: "Filter by email…" });
  const roleFilter = h("select", {}, h("option", { value: "", text: "All roles" }));
  const sortSelect = h("select", {},
    h("option", { value: "email", text: "Email" }),
    h("option", { value: "role", text: "Role" }),
    h("option", { value: "newest", text: "Newest" }),
    h("option", { value: "oldest", text: "Oldest" }),
  );

  const roleNameOf = (u) => (u.roles ? u.roles.name : null);

  // ---- data ---------------------------------------------------------------

  async function loadRoles() {
    const { data } = await supabase.from("roles").select("id, name").order("id");
    roles = data ?? [];
    roleNameById.clear();
    roleSelect.replaceChildren();
    roleFilter.replaceChildren(h("option", { value: "", text: "All roles" }));
    for (const r of roles) {
      roleNameById.set(r.id, r.name);
      const opt = h("option", { value: r.name, text: r.name });
      if (r.name === DEFAULT_ROLE) opt.selected = true;
      roleSelect.append(opt);
      roleFilter.append(h("option", { value: r.name, text: r.name }));
    }
  }

  async function loadUsers() {
    const { data, error } = await supabase
      .from("users")
      .select("id, email, created_at, role_id, roles(name)");
    if (error) {
      inviteError.textContent = "Could not load members: " + error.message;
      users = [];
      return;
    }
    users = data ?? [];
    emailById.clear();
    for (const u of users) emailById.set(u.id, u.email);
  }

  async function loadHistory() {
    // Resolved client-side against roles/users rather than embedded, since
    // user_role_changes has two foreign keys into roles and the embedding
    // hints get fragile.
    const { data } = await supabase
      .from("user_role_changes")
      .select("id, user_id, old_role_id, new_role_id, changed_by, comment, created_at")
      .order("created_at", { ascending: false });
    history = data ?? [];
  }

  const historyFor = (userId) => history.filter((c) => c.user_id === userId);

  // ---- rendering ----------------------------------------------------------

  function visible() {
    const needle = filterInput.value.trim().toLowerCase();
    const wantRole = roleFilter.value;

    const list = users.filter((u) => {
      const okText = !needle || (u.email ?? "").toLowerCase().includes(needle);
      const okRole = !wantRole || roleNameOf(u) === wantRole;
      return okText && okRole;
    });

    const by = sortSelect.value;
    return list.slice().sort((a, b) => {
      if (by === "email") return (a.email ?? "").localeCompare(b.email ?? "");
      if (by === "role") {
        return (roleNameOf(a) ?? "~").localeCompare(roleNameOf(b) ?? "~") ||
               (a.email ?? "").localeCompare(b.email ?? "");
      }
      const at = new Date(a.created_at ?? 0).getTime();
      const bt = new Date(b.created_at ?? 0).getTime();
      return by === "newest" ? bt - at : at - bt;
    });
  }

  function detailPanel(u) {
    const entries = historyFor(u.id);
    const created = entries.length ? entries[entries.length - 1] : null;

    const panel = h("div", { class: "mu-detail" });

    // Provenance
    const addedBy = created && created.changed_by
      ? (emailById.get(created.changed_by) ?? "another admin")
      : null;
    panel.append(h("div", { class: "mu-detail-line" },
      h("span", { class: "mu-label", text: "Added" }),
      h("span", { text: when(created ? created.created_at : u.created_at) + (addedBy ? ` by ${addedBy}` : "") }),
    ));

    // History
    panel.append(h("div", { class: "mu-label mu-detail-head", text: "History" }));
    if (entries.length === 0) {
      panel.append(h("p", { class: "mu-empty", text: "No recorded changes. This account predates the audit trail or was set up directly in the database." }));
    } else {
      const list = h("ul", { class: "mu-history" });
      for (const c of entries) {
        const from = c.old_role_id ? (roleNameById.get(c.old_role_id) ?? "?") : "new account";
        const to = c.new_role_id ? (roleNameById.get(c.new_role_id) ?? "?") : "no role";
        const actor = c.changed_by ? (emailById.get(c.changed_by) ?? "another admin") : "system";
        list.append(h("li", {},
          h("span", { class: "mu-hist-when", text: when(c.created_at) }),
          h("span", { class: "mu-hist-move", text: `${from} → ${to}` }),
          h("span", { class: "mu-hist-who", text: actor }),
          h("span", { class: "mu-hist-note", text: c.comment ?? "" }),
        ));
      }
      panel.append(list);
    }

    // Role editing lives here, not in the table row.
    if (u.id === meId) {
      panel.append(h("p", { class: "mu-empty", text: "That's you — someone else must change your role." }));
      return panel;
    }

    const sel = h("select");
    for (const r of roles) {
      const opt = h("option", { value: r.name, text: r.name });
      if (r.name === roleNameOf(u)) opt.selected = true;
      sel.append(opt);
    }
    const reason = h("input", { type: "text", placeholder: "Reason for the change (required)" });
    const save = h("button", { type: "button", class: "mu-btn mu-btn-primary", text: "Save" });
    const rowErr = h("div", { class: "mu-error" });

    save.addEventListener("click", async () => {
      rowErr.textContent = "";
      if (!reason.value.trim()) {
        rowErr.textContent = "A reason is required.";
        return;
      }
      save.disabled = true;
      const { error } = await supabase.rpc("set_user_role", {
        target_user: u.id,
        new_role: sel.value,
        change_comment: reason.value,
      });
      save.disabled = false;
      if (error) {
        rowErr.textContent = error.message;
        return;
      }
      await loadUsers();
      await loadHistory();
      renderRows();
    });

    panel.append(
      h("div", { class: "mu-label mu-detail-head", text: "Change role" }),
      h("div", { class: "mu-edit" }, sel, reason, save),
      rowErr,
    );

    return panel;
  }

  function renderRows() {
    rowsEl.replaceChildren();
    const list = visible();

    for (const u of list) {
      const current = roleNameOf(u);
      const isOpen = expanded.has(u.id);

      const chevron = h("button", {
        type: "button",
        class: "mu-chevron",
        "aria-expanded": isOpen ? "true" : "false",
        title: isOpen ? "Hide details" : "Show details",
        text: isOpen ? "▾" : "▸",
      });

      const tdRole = h("td", {}, h("span", {
        class: current === "banned" ? "mu-pill mu-pill-banned" : "mu-pill",
        text: current ?? "no role",
      }));

      const tr = h("tr", { class: isOpen ? "mu-row-open" : "" },
        h("td", { class: "mu-chev-cell" }, chevron),
        h("td", { class: "mu-email", text: u.email ?? "(no email)" }),
        tdRole,
        h("td", { class: "mu-when", text: u.created_at ? new Date(u.created_at).toLocaleDateString() : "—" }),
      );

      const toggle = () => {
        if (expanded.has(u.id)) expanded.delete(u.id);
        else expanded.add(u.id);
        renderRows();
      };
      chevron.addEventListener("click", toggle);
      tr.querySelector(".mu-email").addEventListener("click", toggle);

      rowsEl.append(tr);

      if (isOpen) {
        rowsEl.append(h("tr", { class: "mu-detail-row" },
          h("td", { colspan: "4" }, detailPanel(u)),
        ));
      }
    }

    countEl.textContent =
      `${list.length} of ${users.length} member${users.length === 1 ? "" : "s"}`;
  }

  // ---- invite -------------------------------------------------------------

  inviteBtn.addEventListener("click", async () => {
    inviteError.textContent = "";
    inviteMsg.textContent = "";
    inviteBtn.disabled = true;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_PUBLISHABLE_KEY,
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ email: emailInput.value, role: roleSelect.value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        inviteError.textContent = body.error || `Invite failed (${res.status})`;
        return;
      }
      inviteMsg.textContent = `Invite emailed to ${body.email} as ${body.role}.`;
      emailInput.value = "";
      await loadUsers();
      await loadHistory();
      renderRows();
    } catch (err) {
      inviteError.textContent = "Invite failed: " + err.message;
    } finally {
      inviteBtn.disabled = false;
    }
  });

  for (const el of [filterInput, roleFilter, sortSelect]) {
    el.addEventListener("input", renderRows);
  }

  // ---- assemble -----------------------------------------------------------

  root.append(
    h("div", { class: "mu-toolbar" },
      filterInput,
      roleFilter,
      sortSelect,
      h("span", { class: "mu-spacer" }),
      countEl,
      addToggle,
    ),
    addPanel,
    h("div", { class: "mu-scroll" },
      h("table", { class: "mu-table" },
        h("thead", {}, h("tr", {},
          h("th", { class: "mu-chev-cell" }),
          h("th", { text: "Email" }),
          h("th", { text: "Role" }),
          h("th", { text: "Added" }),
        )),
        rowsEl,
      ),
    ),
  );

  await loadRoles();
  await loadUsers();
  await loadHistory();
  renderRows();
}
