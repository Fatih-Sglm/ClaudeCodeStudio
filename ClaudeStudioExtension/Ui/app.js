console.log("Claude Code Studio loaded");

// Harden localStorage (issue #12). On some environments — certain file:// origins,
// or storage blocked by an enterprise/AV policy — even *accessing* window.localStorage
// throws a SecurityError. The first such access happens at load (restoreCompactLayout
// below), and because it is top-level and unguarded it would halt this whole script,
// leaving the static HTML shell with no wired handlers so every button is dead. Probe
// it once; if it is unavailable, shadow it with an in-memory store so the UI still
// works (settings just won't persist across sessions).
(function hardenLocalStorage() {
    try {
        const probe = "__cs_ls_probe__";
        window.localStorage.setItem(probe, "1");
        window.localStorage.removeItem(probe);
        return; // real localStorage works — nothing to do
    } catch (_) { /* fall through to the in-memory shim */ }

    const mem = new Map();
    const shim = {
        getItem(k) { return mem.has(String(k)) ? mem.get(String(k)) : null; },
        setItem(k, v) { mem.set(String(k), String(v)); },
        removeItem(k) { mem.delete(String(k)); },
        clear() { mem.clear(); },
        key(i) { return Array.from(mem.keys())[i] ?? null; },
        get length() { return mem.size; },
    };
    try {
        Object.defineProperty(window, "localStorage", { value: shim, configurable: true });
        console.warn("Claude Code Studio: localStorage unavailable, using an in-memory fallback (settings won't persist).");
    } catch (e) {
        console.error("Claude Code Studio: localStorage unavailable and could not be shimmed:", e);
    }
})();

// ── ⋯ menu (top bar) ─────────────────────────────────────────
// Everything but history and settings lives here. Items stop the click so
// a menu they open (⌘ commands) isn't shut by its own outside-click handler.
function toggleMoreMenu() {
    document.getElementById("more-menu").classList.toggle("open");
}
function moreAction(e, action) {
    e.stopPropagation();
    document.getElementById("more-menu").classList.remove("open");
    action();
}
document.addEventListener("click", e => {
    const wrap = document.getElementById("more-wrap");
    if (wrap && !wrap.contains(e.target))
        document.getElementById("more-menu")?.classList.remove("open");
});

// ── Layout toggle ────────────────────────────────────────────
function toggleLayout() {
    const app = document.querySelector(".app");
    const btn = document.getElementById("btn-layout");
    app.classList.toggle("compact");
    const compact = app.classList.contains("compact");
    btn.classList.toggle("active", compact);
    localStorage.setItem("compactLayout", compact ? "1" : "0");
}

(function restoreCompactLayout() {
    if (localStorage.getItem("compactLayout") === "1") {
        const app = document.querySelector(".app");
        const btn = document.getElementById("btn-layout");
        app.classList.add("compact");
        if (btn) btn.classList.add("active");
    }
})();

// ── Composer splitter ────────────────────────────────────────
// Sets the textarea's MIN height; CSS field-sizing grows it with the text.
(function initSplitter() {
    const splitter = document.getElementById("splitter");
    if (!splitter) return;

    const MIN_HEIGHT = 54;
    const MAX_HEIGHT = 400;
    const ta = document.querySelector(".composer textarea");

    const saved = parseInt(localStorage.getItem("composerTextareaHeight") || "0", 10);
    if (saved >= MIN_HEIGHT && saved <= MAX_HEIGHT && ta) {
        ta.style.minHeight = saved + "px";
    }

    let startY = 0;
    let startHeight = 0;

    function onMove(e) {
        const delta = startY - e.clientY;
        const next = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startHeight + delta));
        ta.style.minHeight = next + "px";
    }

    function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        splitter.classList.remove("dragging");
        document.body.classList.remove("splitter-dragging");
        const h = parseInt(ta.style.minHeight, 10);
        if (h) localStorage.setItem("composerTextareaHeight", String(h));
    }

    splitter.addEventListener("mousedown", e => {
        if (!ta) return;
        e.preventDefault();
        startY = e.clientY;
        startHeight = ta.getBoundingClientRect().height;
        splitter.classList.add("dragging");
        document.body.classList.add("splitter-dragging");
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });
})();

// Permission mode is selected via the composer-actions dropdown
// (.permission-select). The legacy topbar button + cycle/update helpers
// were removed once the inline dropdown carried that role.


// ── Settings panel ───────────────────────────────────────────
function toggleSettings() {
    const menu = document.getElementById("settings-menu");
    const opened = menu.classList.toggle("open");
    if (opened) {
        // Stale filters from the last visit would silently hide settings.
        const search = document.getElementById("settings-search");
        if (search) {
            if (search.value) { search.value = ""; filterSettings(); }
            search.focus();
        }
    }
}

function clearSettingsSearch() {
    const search = document.getElementById("settings-search");
    if (!search) return;
    search.value = "";
    filterSettings();
    search.focus();
}

// ── Settings search ──────────────────────────────────────────
// Filters ⚙ panel rows by name (label text + ⓘ tooltip). The menu is a flat
// list where control blocks (slider wraps, input wraps, timing options, cost
// limits) are SIBLINGS of the .settings-row that names them — they inherit
// the visibility of the row above. A section title that matches keeps its
// whole section; a section with no visible row hides its header. Dividers
// and the about block only show when no filter is active.
function filterSettings() {
    const menu = document.getElementById("settings-menu");
    if (!menu) return;
    const q = (document.getElementById("settings-search")?.value || "").trim().toLowerCase();
    const filtering = q.length > 0;

    let section = null;
    let sectionTitleHit = false;
    let sectionHasHit = false;
    let rowVisible = true;
    let anyHit = false;

    const flushSection = () => {
        if (section) section.style.display = (!filtering || sectionTitleHit || sectionHasHit) ? "" : "none";
        section = null;
        sectionTitleHit = false;
        sectionHasHit = false;
    };

    for (const el of menu.children) {
        const cl = el.classList;
        if (cl.contains("settings-search-wrap") || cl.contains("settings-search-empty")) continue;

        if (cl.contains("cmd-divider") || cl.contains("about-section")) {
            flushSection();
            el.style.display = filtering ? "none" : "";
            rowVisible = true;
            continue;
        }

        if (cl.contains("cmd-section")) {
            flushSection();
            section = el;
            sectionTitleHit = filtering && (el.textContent || "").toLowerCase().includes(q);
            if (sectionTitleHit) anyHit = true;
            continue;
        }

        if (cl.contains("settings-row")) {
            const label = el.querySelector(".settings-label");
            const name = ((label ? label.textContent : el.textContent) || "").toLowerCase();
            const hint = (label?.querySelector(".info-icon")?.title || "").toLowerCase();
            rowVisible = !filtering || sectionTitleHit || name.includes(q) || hint.includes(q);
            if (rowVisible) { sectionHasHit = true; anyHit = true; }
            el.style.display = rowVisible ? "" : "none";
            continue;
        }

        // Companion control block — follows the row that precedes it.
        el.style.display = rowVisible ? "" : "none";
    }
    flushSection();

    const empty = document.getElementById("settings-search-empty");
    if (empty) empty.hidden = !filtering || anyHit;
}

function openTrustedWorkspacesModal() {
    const overlay = document.getElementById("trusted-workspaces-overlay");
    if (!overlay) return;
    overlay.classList.add("open");
    try { window.chrome.webview.postMessage({ type: "get-trusted-workspaces" }); } catch (e) {}
}

function closeTrustedWorkspacesModal() {
    const overlay = document.getElementById("trusted-workspaces-overlay");
    if (overlay) overlay.classList.remove("open");
}

function renderTrustedWorkspacesList(paths) {
    const container = document.getElementById("trusted-workspaces-list");
    if (!container) return;
    if (!paths || paths.length === 0) {
        container.innerHTML = `<div class="trusted-workspaces-empty">${t("trusted.empty")}</div>`;
        return;
    }
    container.innerHTML = "";
    for (const path of paths) {
        const row = document.createElement("div");
        row.className = "trusted-workspace-row";

        const label = document.createElement("span");
        label.className = "trusted-workspace-path";
        label.textContent = shortenTrustedPath(path);
        label.title = path;

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "trusted-workspace-remove";
        remove.title = t("trusted.remove");
        remove.textContent = "✕";
        remove.onclick = () => removeTrustedWorkspace(path);

        row.appendChild(label);
        row.appendChild(remove);
        container.appendChild(row);
    }
}

function shortenTrustedPath(full) {
    if (!full) return "";
    const parts = full.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length <= 2) return full;
    return "…/" + parts.slice(-2).join("/");
}

function removeTrustedWorkspace(path) {
    try { window.chrome.webview.postMessage({ type: "remove-trusted-workspace", path }); } catch (e) {}
}

document.addEventListener("click", e => {
    const wrap = document.getElementById("settings-wrap");
    if (wrap && !wrap.contains(e.target))
        document.getElementById("settings-menu")?.classList.remove("open");
});

// ── Prompt history (Ctrl+Up / Ctrl+Down) ─────────────────────
let promptHistory = JSON.parse(localStorage.getItem("promptHistory") || "[]");
let historyIndex = -1;
let historyDraft = "";

function pushPromptHistory(text) {
    if (!text) return;
    if (promptHistory[0] === text) return;
    promptHistory.unshift(text);
    if (promptHistory.length > 50) promptHistory.pop();
    localStorage.setItem("promptHistory", JSON.stringify(promptHistory));
    historyIndex = -1;
    updateHistoryHint();
}

function updateHistoryHint() {
    const el = document.getElementById("history-hint");
    if (!el) return;
    if (historyIndex < 0) {
        el.hidden = true;
        el.textContent = "";
    } else {
        // Show 1-based "current/total" — older prompts have lower display index
        el.textContent = t("history.hint", { i: historyIndex + 1, n: promptHistory.length });
        el.hidden = false;
    }
}

// ── Session history ───────────────────────────────────────────
let historySessions = [];
let historyScope = "all";
let historyWorkspaceName = null;

function toggleHistory() {
    const menu = document.getElementById("history-menu");
    const isOpen = menu.classList.toggle("open");
    if (isOpen) {
        document.getElementById("history-search").value = "";
        document.getElementById("history-list").innerHTML =
            `<div class="cmd-item" style="color:#555;font-family:inherit">${t("common.loading")}</div>`;
        requestHistory();
    }
}

function requestHistory() {
    const showAll = document.getElementById("history-show-all")?.checked || false;
    window.chrome.webview.postMessage({ type: "get-history", showAll });
}

function onShowAllToggle() {
    document.getElementById("history-list").innerHTML =
        `<div class="cmd-item" style="color:#555;font-family:inherit">${t("common.loading")}</div>`;
    requestHistory();
}

function filterHistory() {
    const q = document.getElementById("history-search").value.trim().toLowerCase();
    const filtered = q
        ? historySessions.filter(s =>
            (s.preview || "").toLowerCase().includes(q) ||
            (s.title || "").toLowerCase().includes(q))
        : historySessions;
    renderHistoryList(filtered, q);
}

document.addEventListener("click", e => {
    const wrap = document.getElementById("history-wrap");
    if (wrap && !wrap.contains(e.target))
        document.getElementById("history-menu")?.classList.remove("open");
});

// ── Custom commands ──────────────────────────────────────────
let customCommands = JSON.parse(localStorage.getItem("customCommands") || "[]");

function saveCustomCommands() {
    localStorage.setItem("customCommands", JSON.stringify(customCommands));
}

function renderCustomCommands() {
    const list = document.getElementById("custom-cmd-list");
    list.innerHTML = "";
    customCommands.forEach((cmd, i) => {
        const row = document.createElement("div");
        row.className = "cmd-item cmd-custom-item";
        row.innerHTML = `<span onclick="runCommand('${escapeAttr(cmd.command)}')">${escapeHtml(cmd.name || cmd.command)}</span><button class="cmd-custom-remove" onclick="removeCommand(${i})" title="${t("common.remove")}">×</button>`;
        list.appendChild(row);
    });
}

function removeCommand(i) {
    customCommands.splice(i, 1);
    saveCustomCommands();
    renderCustomCommands();
}

function toggleCmdMenu() {
    const menu = document.getElementById("cmd-menu");
    menu.classList.toggle("open");
    // Refresh discovered slash commands on every open — picks up new
    // .claude/commands files without a watcher.
    if (menu.classList.contains("open")) {
        try { window.chrome.webview.postMessage({ type: "get-slash-commands" }); } catch (e) {}
    }
}

// Renders the discovered .claude/commands entries (project + user scope) into
// the ⌘ menu. Clicking forwards "/name" to claude, which expands the command.
// Discovered custom commands (V9) also feed the composer's "/" autocomplete —
// refreshed whenever the ⌘ menu opens or the workspace changes.
let discoveredSlashCommands = [];
// "/name" → { description, argumentHint } for the "/" list (CLI list when available).
let slashCommandInfo = new Map();

function renderSlashCommands(project, user, projectSkills, userSkills, cli) {
    // Skills invoke like commands (the CLI expands "/<name>" for both), so
    // they join the "/" autocomplete pool; a project and a user skill with the
    // same name dedupe to one entry (most-specific wins, like the CLI).
    const skillNames = new Map();
    [...(projectSkills || []), ...(userSkills || [])].forEach(s => {
        if (!skillNames.has(s.name)) skillNames.set(s.name, s);
    });
    const skills = [...skillNames.values()];
    // The CLI's own list (built-ins, plugins, skills) when the host has it;
    // otherwise what the folder scan found.
    const source = cli && cli.length ? cli : [...(project || []), ...(user || []), ...skills];
    discoveredSlashCommands = source.map(c => "/" + c.name);
    slashCommandInfo = new Map(source.map(c => ["/" + c.name, c]));
    const fill = (wrapId, listId, cmds) => {
        const wrap = document.getElementById(wrapId);
        const list = document.getElementById(listId);
        if (!cmds || cmds.length === 0) { wrap.style.display = "none"; list.innerHTML = ""; return; }
        list.innerHTML = cmds.map(c => {
            const name = "/" + c.name;
            return `<div class="cmd-item" title="${escapeAttrValue(c.description || "")}" onclick="runCommand('${escapeAttr(name)}')">${escapeHtml(name)}</div>`;
        }).join("");
        wrap.style.display = "";
    };
    fill("project-cmds", "project-cmd-list", project);
    fill("user-cmds", "user-cmd-list", user);
    fill("skill-cmds", "skill-cmd-list", skills);
}

// ── Context usage (V12) ───────────────────────────────────────
// Asks the live claude for its context breakdown via the agent's
// get_context_usage control_request and renders it as a card in the chat.
let _pendingCtxUsageCard = null;

function requestContextUsage() {
    document.getElementById("cmd-menu").classList.remove("open");
    if (welcome) { welcome.remove(); welcome = null; }

    const card = document.createElement("div");
    card.className = "question-card ctx-usage-card";
    card.innerHTML = `<div class="question-text">◔ ${t("cmd.contextUsage")}` +
        `<button type="button" class="pinned-close" title="${t("common.close")}">✕</button></div>` +
        `<div class="ctx-usage-body">${t("common.loading")}</div>`;
    card.querySelector(".pinned-close").onclick = () => dismissPinnedCard(card);
    pinCard(card, messages, "manual");
    _pendingCtxUsageCard = card;

    try { window.chrome.webview.postMessage({ type: "get-context-usage" }); }
    catch (e) { card.querySelector(".ctx-usage-body").textContent = t("common.failedReach"); }
}

// ── Side question (V19) ───────────────────────────────────────
// Answered with the session's context but kept out of the transcript — the
// card is UI-only; the session JSONL records nothing.
let _pendingSideQuestionCard = null;

function openSideQuestionCard() {
    document.getElementById("cmd-menu").classList.remove("open");
    if (welcome) { welcome.remove(); welcome = null; }

    const card = document.createElement("div");
    card.className = "question-card side-question-card";
    card.innerHTML = `<div class="question-text">💬 ${t("cmd.sideQuestion")} <span class="side-question-note">${t("sideq.note")}</span><button type="button" class="pinned-close" title="${t("common.close")}">✕</button></div>
        <div class="side-question-ask">
            <input type="text" placeholder="${t("sideq.placeholder")}"
                onkeydown="if(event.key==='Enter'){event.preventDefault();sendSideQuestion(this.closest('.side-question-card'));}" />
            <button type="button" onclick="sendSideQuestion(this.closest('.side-question-card'))">${t("sideq.ask")}</button>
        </div>
        <div class="side-question-answer" style="display:none"></div>`;
    card.querySelector(".pinned-close").onclick = () => dismissPinnedCard(card);
    pinCard(card, messages, "manual");
    card.querySelector("input").focus();
}

function sendSideQuestion(card) {
    const input = card.querySelector("input");
    const q = (input.value || "").trim();
    if (!q) return;

    input.disabled = true;
    card.querySelector(".side-question-ask button").disabled = true;
    const answerEl = card.querySelector(".side-question-answer");
    answerEl.style.display = "";
    answerEl.textContent = t("common.thinking");
    _pendingSideQuestionCard = card;

    try { window.chrome.webview.postMessage({ type: "side-question", text: q }); }
    catch (e) { answerEl.textContent = t("common.failedReach"); }
    autoScroll();
}

function renderSideQuestionAnswer(answer, error) {
    const card = _pendingSideQuestionCard;
    _pendingSideQuestionCard = null;
    if (!card || !document.body.contains(card)) return;
    const answerEl = card.querySelector(".side-question-answer");

    if (error) {
        const friendly = error.includes("no active session") || error.includes("agent not running")
            ? t("sideq.noSession")
            : t("common.failed", { error });
        answerEl.textContent = friendly;
    } else if (!answer) {
        answerEl.textContent = t("sideq.declined");
    } else {
        answerEl.innerHTML = renderMarkdown(answer);
    }
    autoScroll();
}

// ── MCP status + reconnect (V20) ──────────────────────────────
let _pendingMcpCard = null;

function requestMcpStatus() {
    document.getElementById("cmd-menu").classList.remove("open");
    if (welcome) { welcome.remove(); welcome = null; }

    // Reuse the open card when refreshing after a reconnect.
    let card = _pendingMcpCard && document.body.contains(_pendingMcpCard)
        ? _pendingMcpCard
        : null;
    if (!card) {
        card = document.createElement("div");
        card.className = "question-card mcp-status-card";
        card.innerHTML = `<div class="question-text">🔌 ${t("cmd.mcpStatus")}` +
            `<button type="button" class="pinned-close" title="${t("common.close")}">✕</button></div>` +
            `<div class="mcp-status-body">${t("common.loading")}</div>`;
        card.querySelector(".pinned-close").onclick = () => dismissPinnedCard(card);
        pinCard(card, messages, "manual");
    }
    _pendingMcpCard = card;

    try { window.chrome.webview.postMessage({ type: "get-mcp-status" }); }
    catch (e) { card.querySelector(".mcp-status-body").textContent = t("common.failedReach"); }
}

function reconnectMcpServer(name) {
    if (_pendingMcpCard) {
        const row = _pendingMcpCard.querySelector(`.mcp-status-row[data-server="${CSS.escape(name)}"] .mcp-reconnect-btn`);
        if (row) { row.disabled = true; row.textContent = t("mcp.reconnecting"); }
    }
    try { window.chrome.webview.postMessage({ type: "mcp-reconnect", text: name }); } catch (e) {}
}

function renderMcpStatusCard(serversJson, error) {
    const card = _pendingMcpCard;
    if (!card || !document.body.contains(card)) { _pendingMcpCard = null; return; }
    const body = card.querySelector(".mcp-status-body");

    if (error || !serversJson) {
        const friendly = (error || "").includes("no active session") || (error || "").includes("agent not running")
            ? t("common.noSessionCheck")
            : t("mcp.loadFailed", { error: error || t("common.emptyResponse") });
        body.textContent = friendly;
        return;
    }

    let servers;
    try { servers = JSON.parse(serversJson); }
    catch (e) { body.textContent = t("mcp.parseFailed"); return; }
    if (!Array.isArray(servers) || servers.length === 0) {
        body.textContent = t("mcp.none");
        return;
    }

    body.innerHTML = servers.map(s => {
        const name = s.name || "?";
        const status = String(s.status || s.state || "unknown");
        const ok = /connected|ready|ok/i.test(status);
        return `<div class="mcp-status-row" data-server="${escapeAttr(name)}">
  <span class="mcp-status-dot ${ok ? "mcp-ok" : "mcp-bad"}"></span>
  <span class="mcp-status-name">${escapeHtml(name)}</span>
  <span class="mcp-status-state">${escapeHtml(status)}</span>
  <button type="button" class="mcp-reconnect-btn" onclick="reconnectMcpServer('${escapeAttr(name)}')">${t("mcp.reconnect")}</button>
</div>`;
    }).join("");
    autoScroll();
}

// ── Doctor (#10) ────────────────────────────────────────────
let _pendingDoctorCard = null;

function requestDoctor() {
    document.getElementById("cmd-menu").classList.remove("open");
    if (welcome) { welcome.remove(); welcome = null; }

    const card = document.createElement("div");
    card.className = "question-card doctor-card";
    card.innerHTML = `<div class="question-text">🩺 ${t("cmd.doctor")}` +
        `<button type="button" class="pinned-close" title="${t("common.close")}">✕</button></div>` +
        `<div class="doctor-body">${t("doctor.running")}</div>`;
    card.querySelector(".pinned-close").onclick = () => dismissPinnedCard(card);
    pinCard(card, messages, "manual");
    _pendingDoctorCard = card;

    try { window.chrome.webview.postMessage({ type: "run-doctor" }); }
    catch (e) { card.querySelector(".doctor-body").textContent = t("common.failedReach"); }
}

function renderDoctorCard(output, error) {
    const card = _pendingDoctorCard;
    _pendingDoctorCard = null;
    if (!card || !document.body.contains(card)) return;
    const body = card.querySelector(".doctor-body");

    if (error) {
        body.textContent = error;
        return;
    }
    body.innerHTML = `<pre class="doctor-output"></pre>`;
    body.querySelector(".doctor-output").textContent = output || t("doctor.noOutput");
    autoScroll();
}

const _ctxPalette = ["#d97757", "#6a9bcc", "#8a7fd0", "#5faa8a", "#c9a75a", "#c47ba6", "#7fb6c9", "#a0a68a"];

function fmtTokens(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return String(n || 0);
}

function renderContextUsageCard(usageJson, error) {
    const card = _pendingCtxUsageCard;
    _pendingCtxUsageCard = null;
    if (!card) return;
    const body = card.querySelector(".ctx-usage-body");

    if (error || !usageJson) {
        const friendly = (error || "").includes("no active session") || (error || "").includes("agent not running")
            ? t("common.noSessionCheck")
            : t("ctx.loadFailed", { error: error || t("common.emptyResponse") });
        body.textContent = friendly;
        return;
    }

    let u;
    try { u = JSON.parse(usageJson); }
    catch (e) { body.textContent = t("ctx.parseFailed"); return; }

    const cats = (u.categories || []).filter(c => (c.tokens || 0) > 0 && !c.isDeferred);
    const segs = cats.filter(c => c.name !== "Free space");
    const max = u.rawMaxTokens || 1;

    let html = `<div class="ctx-usage-header"><span>${escapeHtml(u.model || "")}</span>` +
        `<span>${t("ctx.tokens", { used: fmtTokens(u.totalTokens), max: fmtTokens(u.rawMaxTokens), pct: u.percentage ?? "?" })}</span></div>`;

    html += `<div class="ctx-usage-track">` + segs.map(c =>
        `<div class="ctx-usage-seg" style="background:${_ctxPalette[cats.indexOf(c) % _ctxPalette.length]};width:${(c.tokens / max * 100).toFixed(2)}%" title="${escapeAttrValue(c.name)}: ${fmtTokens(c.tokens)}"></div>`
    ).join("") + `</div>`;

    html += `<div class="ctx-cat-list">` + cats.map((c, i) => {
        const swatch = c.name === "Free space" ? "" : `background:${_ctxPalette[i % _ctxPalette.length]}`;
        const pct = ((c.tokens / max) * 100).toFixed(1);
        return `<div class="ctx-cat-row"><span class="ctx-cat-swatch" style="${swatch}"></span>` +
            `<span class="ctx-cat-name">${escapeHtml(c.name)}</span>` +
            `<span class="ctx-cat-tokens">${fmtTokens(c.tokens)}</span>` +
            `<span class="ctx-cat-pct">${pct}%</span></div>`;
    }).join("") + `</div>`;

    const top = (arr, nameOf) => (arr || []).slice().sort((a, b) => (b.tokens || 0) - (a.tokens || 0)).slice(0, 5)
        .map(x => `<div class="ctx-cat-row"><span class="ctx-cat-swatch"></span>` +
            `<span class="ctx-cat-name">${escapeHtml(nameOf(x))}</span>` +
            `<span class="ctx-cat-tokens">${fmtTokens(x.tokens)}</span><span class="ctx-cat-pct"></span></div>`).join("");

    if ((u.memoryFiles || []).length > 0)
        html += `<div class="ctx-usage-subheader">${t("ctx.memoryFiles")}</div><div class="ctx-cat-list">${top(u.memoryFiles, x => x.path || "")}</div>`;
    if ((u.agents || []).length > 0)
        html += `<div class="ctx-usage-subheader">${t("ctx.customAgents")}</div><div class="ctx-cat-list">${top(u.agents, x => x.agentType || "")}</div>`;

    body.innerHTML = html;
    autoScroll();
}

function exportChatToMarkdown() {
    document.getElementById("cmd-menu").classList.remove("open");
    const messagesEl = document.getElementById("messages");
    const items = messagesEl.querySelectorAll(".message");
    if (items.length === 0) {
        window.chrome.webview.postMessage({ type: "export-markdown", content: "", empty: true });
        return;
    }

    const modelLabel = modelSelect.options[modelSelect.selectedIndex]?.text || modelSelect.value;
    const now = new Date();
    const pad = n => String(n).padStart(2, "0");
    const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    let md = `# Claude Code Studio — Chat Export\n\n_Exported ${ts}_\n_Model: ${modelLabel}_\n\n---\n\n`;
    let lastRole = null;
    for (const msg of items) {
        const bubble = msg.querySelector(".bubble");
        if (!bubble) continue;
        const isUser = msg.classList.contains("user");
        const isAssistant = msg.classList.contains("assistant");
        if (!isUser && !isAssistant) continue;
        // Synthetic replay hosts have no text of their own — their textContent
        // is chip labels, which would export as a garbage Claude turn.
        if (msg.classList.contains("replay-tool-host")) continue;
        const role = isUser ? "You" : "Claude";
        const raw = bubble.dataset.raw;
        let text = (raw && raw.length > 0) ? raw : (bubble.textContent || "").trim();
        if (!text) continue;
        if (lastRole !== null) md += "\n---\n\n";
        md += `## ${role}\n\n${text.trim()}\n\n`;
        lastRole = role;
    }

    window.chrome.webview.postMessage({ type: "export-markdown", content: md });
}

let isUsageCapture = false;
let usageBuffer = "";
let sessionIn = 0;
let sessionOut = 0;

function runCommand(cmd) {
    document.getElementById("cmd-menu").classList.remove("open");
    if (cmd === "/usage") {
        openUsageModal();
        isUsageCapture = true;
        usageBuffer = "";
        document.getElementById("usage-raw").innerHTML = `<span class="usage-loading">${t("usage.running")}</span>`;
        textarea.value = cmd;
        sendMessage();
        return;
    }
    textarea.value = cmd;
    sendMessage();
}

function openUsageModal() {
    document.getElementById("usage-modal-overlay").classList.add("open");
    updateUsageSessionValues();
}

function closeUsageModal() {
    document.getElementById("usage-modal-overlay").classList.remove("open");
}

function updateUsageSessionValues() {
    const fmt = n => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
    const el = document.getElementById("usage-session-values");
    if (sessionIn === 0 && sessionOut === 0) { el.textContent = "—"; return; }
    el.textContent = t("usage.session", { in: fmt(sessionIn), out: fmt(sessionOut) });
}

function openAddCommand() {
    document.getElementById("cmd-menu").classList.remove("open");
    document.getElementById("cmd-modal-overlay").classList.add("open");
    document.getElementById("cmd-modal-name").value = "";
    document.getElementById("cmd-modal-cmd").value = "";
    setTimeout(() => document.getElementById("cmd-modal-name").focus(), 50);
}

function closeAddCommand() {
    document.getElementById("cmd-modal-overlay").classList.remove("open");
}

function saveNewCommand() {
    const name = document.getElementById("cmd-modal-name").value.trim();
    const cmd = document.getElementById("cmd-modal-cmd").value.trim();
    if (!cmd) return;
    customCommands.push({ name: name || cmd, command: cmd });
    saveCustomCommands();
    renderCustomCommands();
    closeAddCommand();
}

function escapeAttr(s) {
    return s.replace(/'/g, "\\'");
}

document.addEventListener("click", e => {
    const wrap = document.getElementById("cmd-wrap");
    if (wrap && !wrap.contains(e.target))
        document.getElementById("cmd-menu").classList.remove("open");
});
// ────────────────────────────────────────────────────────────

const textarea = document.querySelector("textarea");
const sendButton = null; // replaced by btnSend with streaming toggle
const newChatButton = document.querySelector(".new-chat");
const modelSelect = document.querySelector(".model-select");
// Restore the last chosen model (survives VS restarts). A stored id that no
// longer exists in the list (renamed/removed model) is ignored — setting an
// unknown value would leave the select on the default anyway.
const ModelStorageKey = Object.freeze({ LastUsed: "chatModel", Default: "defaultModel" });
function isKnownModel(id) { return !!id && [...modelSelect.options].some(o => o.value === id); }
// What a new chat starts with: Settings → Default model, or the last pick
// when that's "Last used" (empty).
function startupModel() {
    try {
        const fixed = localStorage.getItem(ModelStorageKey.Default);
        if (isKnownModel(fixed)) return fixed;
        const last = localStorage.getItem(ModelStorageKey.LastUsed);
        return isKnownModel(last) ? last : null;
    } catch (_) { return null; }
}
function setDefaultModel(value) {
    try {
        if (value && isKnownModel(value)) localStorage.setItem(ModelStorageKey.Default, value);
        else localStorage.removeItem(ModelStorageKey.Default);
    } catch (_) { }
    // An empty chat switches now; a conversation in progress keeps its model.
    const id = startupModel();
    if (id && id !== modelSelect.value && !isStreaming && userMsgCounter === 0) {
        modelSelect.value = id;
        modelSelect.dispatchEvent(new Event("change"));
    }
}
(function restoreModelSelection() {
    const id = startupModel();
    if (id) modelSelect.value = id;
    const select = document.getElementById("default-model-select");
    if (!select) return;
    for (const o of modelSelect.options) select.appendChild(new Option(o.text, o.value));
    try { select.value = isKnownModel(localStorage.getItem(ModelStorageKey.Default)) ? localStorage.getItem(ModelStorageKey.Default) : ""; } catch (_) { }
})();
// Tracks which model is currently in effect, so noteModelSwitch() can tell a
// real change from a no-op and drop a divider in the transcript at the point
// the model changed. Seeded with the initial selection (no divider at startup).
let activeModelId = modelSelect.value;

// ── Trust MCP servers modal ────────────────────────────────
let _mcpTrustPending = [];  // [{name, scope, transport, summary, hash}]

function openMcpTrustModal(servers) {
    if (!servers || servers.length === 0) return;
    _mcpTrustPending = servers.slice();

    const overlay = document.getElementById("mcp-trust-modal-overlay");
    if (!overlay) return;

    mcpTrustRenderList();
    const selectAll = document.getElementById("mcp-trust-select-all");
    if (selectAll) selectAll.checked = true;
    overlay.classList.add("open");
}

function mergeMcpTrustModal(servers) {
    if (!servers || servers.length === 0) return;
    const seen = new Set(_mcpTrustPending.map(mcpTrustKey));
    for (const s of servers) {
        if (!seen.has(mcpTrustKey(s))) _mcpTrustPending.push(s);
    }
    mcpTrustRenderList();
    mcpTrustUpdateSelectAllState();
}

function mcpTrustKey(s) {
    return `${s.scope || "user"}\0${s.name || ""}\0${s.hash || ""}\0${s.projectPath || ""}`;
}

function mcpTrustRenderList() {
    const list = document.getElementById("mcp-trust-list");
    if (!list) return;
    list.innerHTML = "";
    _mcpTrustPending.forEach((s, idx) => {
        const item = document.createElement("label");
        item.className = "mcp-trust-item";

        const body = document.createElement("div");
        body.className = "mcp-trust-item-body";

        const head = document.createElement("div");
        head.className = "mcp-trust-item-head";

        const name = document.createElement("span");
        name.className = "mcp-trust-item-name";
        name.textContent = s.name;
        head.appendChild(name);

        const scopeChip = document.createElement("span");
        scopeChip.className = "mcp-trust-chip mcp-trust-chip-scope";
        scopeChip.textContent = s.scope || "user";
        head.appendChild(scopeChip);

        const transportChip = document.createElement("span");
        transportChip.className = "mcp-trust-chip mcp-trust-chip-transport";
        transportChip.textContent = s.transport || "stdio";
        head.appendChild(transportChip);

        body.appendChild(head);

        const summary = document.createElement("div");
        summary.className = "mcp-trust-item-summary";
        summary.textContent = s.summary || "";
        summary.title = s.summary || "";
        body.appendChild(summary);

        item.appendChild(body);

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = true;
        cb.dataset.idx = String(idx);
        cb.addEventListener("change", mcpTrustUpdateSelectAllState);
        item.appendChild(cb);

        list.appendChild(item);
    });
}

function closeMcpTrustModal() {
    const overlay = document.getElementById("mcp-trust-modal-overlay");
    if (overlay) overlay.classList.remove("open");
    _mcpTrustPending = [];
}

function mcpTrustToggleAll(checked) {
    const list = document.getElementById("mcp-trust-list");
    if (!list) return;
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = checked);
}

function mcpTrustUpdateSelectAllState() {
    const list = document.getElementById("mcp-trust-list");
    const selectAll = document.getElementById("mcp-trust-select-all");
    if (!list || !selectAll) return;
    const boxes = list.querySelectorAll('input[type="checkbox"]');
    const total = boxes.length;
    const checked = Array.from(boxes).filter(cb => cb.checked).length;
    selectAll.checked = checked === total;
    selectAll.indeterminate = checked > 0 && checked < total;
}

function mcpTrustSubmit() {
    const list = document.getElementById("mcp-trust-list");
    if (!list) return closeMcpTrustModal();
    const decisions = [];
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        const idx = parseInt(cb.dataset.idx, 10);
        const s = _mcpTrustPending[idx];
        if (!s) return;
        decisions.push({
            name: s.name,
            scope: s.scope,
            hash: s.hash,
            projectPath: s.projectPath || null,
            action: cb.checked ? "trust" : "skip"
        });
    });
    window.chrome.webview.postMessage({ type: "trust-mcp-servers", servers: decisions });
}

function mcpTrustCancel() {
    // Skip everything for this session — silences the prompt loop without trusting anything.
    const skips = _mcpTrustPending.map(s => ({
        name: s.name, scope: s.scope, hash: s.hash,
        projectPath: s.projectPath || null,
        action: "skip"
    }));
    if (skips.length > 0) {
        window.chrome.webview.postMessage({ type: "trust-mcp-servers", servers: skips });
    } else {
        closeMcpTrustModal();
    }
}
// ───────────────────────────────────────────────────────────

// ── Trust workspace modal ──────────────────────────────────
let _trustPendingPath = "";
let _trustPendingParent = "";

const TRUST_RISK_MESSAGES = {
    "drive-root": "trust.risk.driveRoot",
    "users-container": "trust.risk.usersContainer",
};

function openTrustModal(path, parent, parentIsBlocked, riskWarning) {
    if (!path) return;
    _trustPendingPath = path;
    _trustPendingParent = parent || "";

    const overlay = document.getElementById("trust-modal-overlay");
    const pathEl = document.getElementById("trust-modal-path");
    const parentRow = document.getElementById("trust-modal-parent-row");
    const parentPath = document.getElementById("trust-modal-parent-path");
    const parentBtn = document.getElementById("trust-parent-btn");
    const warningEl = document.getElementById("trust-modal-warning");
    const warningText = document.getElementById("trust-modal-warning-text");
    if (!overlay) return;

    pathEl.textContent = path;
    pathEl.title = path;

    // Hide "Trust parent" when the parent is a wide-trust trap (home, drive root,
    // C:\Users). Clicking it would prefix-trust an exponentially larger surface
    // via IsTrusted's prefix match — same reason home is blocked outright.
    const showParent = _trustPendingParent && _trustPendingParent !== path && !parentIsBlocked;
    if (showParent) {
        parentRow.hidden = false;
        parentPath.textContent = _trustPendingParent;
        const parentName = _trustPendingParent.split(/[\\/]+/).filter(Boolean).pop() || _trustPendingParent;
        parentBtn.textContent = t("trust.parentNamed", { name: parentName });
        parentBtn.title = t("trust.trustPath", { path: _trustPendingParent });
        parentBtn.style.display = "";
    } else {
        parentRow.hidden = true;
        parentBtn.style.display = "none";
    }

    // Surface a high-risk warning when the user is about to trust a drive root
    // or C:\Users — both legitimate choices in rare cases (test VMs, sysadmin)
    // but catastrophic in normal use. Decision stays with the user.
    if (warningEl && warningText) {
        const msg = riskWarning ? TRUST_RISK_MESSAGES[riskWarning] : null;
        if (msg) {
            warningText.textContent = t(msg);
            warningEl.hidden = false;
        } else {
            warningEl.hidden = true;
            warningText.textContent = "";
        }
    }

    overlay.classList.add("open");
}

function closeTrustModal() {
    const overlay = document.getElementById("trust-modal-overlay");
    if (overlay) overlay.classList.remove("open");
    _trustPendingPath = "";
    _trustPendingParent = "";
}

function trustAllow() {
    if (!_trustPendingPath) return closeTrustModal();
    window.chrome.webview.postMessage({ type: "trust-workspace", path: _trustPendingPath });
    closeTrustModal();
}

function trustParent() {
    if (!_trustPendingParent) return closeTrustModal();
    window.chrome.webview.postMessage({ type: "trust-workspace", path: _trustPendingParent });
    closeTrustModal();
}

function trustDeny() {
    if (_trustPendingPath) {
        window.chrome.webview.postMessage({ type: "untrust-workspace", path: _trustPendingPath });
    }
    closeTrustModal();
}
// ───────────────────────────────────────────────────────────

// ── Cwd bar ────────────────────────────────────────────────
let _cwdVsPath = "";    // resolved from VS (Solution / Open Folder), via C#
let _cwdFullPath = "";  // effective cwd shown / copied (override wins when set)
let _workspaceTrusted = true;  // updated by trust-required / workspace-trusted events

// ── Working directory overrides (D6: per solution) ─────────
// Overrides live in a map keyed by the VS-resolved workspace path, so switching
// solutions never carries another solution's override along. The old global
// "workingDirectory" key is migrated under the first workspace seen (cwd-info)
// and removed; until then it still answers as a fallback.
function workingDirKey() {
    const p = (_cwdVsPath || "").trim().replace(/[\\/]+$/, "").toLowerCase();
    return p || "(none)";
}

function loadWorkingDirOverrides() {
    try { return JSON.parse(localStorage.getItem("workingDirOverrides") || "{}") || {}; }
    catch (e) { return {}; }
}

function getWorkingDirOverride() {
    const map = loadWorkingDirOverrides();
    const val = map[workingDirKey()];
    if (val !== undefined) return val;
    return (localStorage.getItem("workingDirectory") || "").trim();
}

function setWorkingDirOverride(value) {
    const map = loadWorkingDirOverrides();
    const v = (value || "").trim();
    if (v) map[workingDirKey()] = v;
    else delete map[workingDirKey()];
    localStorage.setItem("workingDirOverrides", JSON.stringify(map));
    localStorage.removeItem("workingDirectory");
}

function migrateLegacyWorkingDir() {
    const legacy = localStorage.getItem("workingDirectory");
    if (legacy === null) return;
    const v = legacy.trim();
    const map = loadWorkingDirOverrides();
    if (v && map[workingDirKey()] === undefined) {
        map[workingDirKey()] = v;
        localStorage.setItem("workingDirOverrides", JSON.stringify(map));
    }
    localStorage.removeItem("workingDirectory");
}

function truncateCwdPath(full) {
    if (!full) return "";
    const parts = full.split(/[\\/]+/).filter(Boolean);
    if (parts.length === 0) return full;
    // Two last segments when available, single when not — matches IDE conventions.
    return parts.length >= 2
        ? parts[parts.length - 2] + "\\" + parts[parts.length - 1]
        : parts[parts.length - 1];
}

function renderCwd(vsPath) {
    if (vsPath !== undefined) _cwdVsPath = vsPath || "";
    const override = getWorkingDirOverride();

    const bar = document.getElementById("cwdbar");
    const pathEl = document.getElementById("cwdbar-path");
    if (!bar || !pathEl) return;

    // Override wins when set; otherwise the VS-resolved path.
    const effective = override || _cwdVsPath;
    _cwdFullPath = effective;

    bar.classList.remove("cwdbar-override");

    if (!effective) {
        bar.classList.add("cwdbar-empty");
        bar.title = t("cwd.noWorkspaceOpen");
        pathEl.innerHTML = "";
        pathEl.textContent = t("cwd.noWorkspace");
        return;
    }

    bar.classList.remove("cwdbar-empty");
    bar.classList.toggle("cwdbar-untrusted", !_workspaceTrusted);

    const isOverride = override && override !== _cwdVsPath;
    if (isOverride) bar.classList.add("cwdbar-override");

    let tooltip = effective;
    if (isOverride) tooltip += t("cwd.overrideTip", { path: _cwdVsPath || t("common.none") });
    if (!_workspaceTrusted) tooltip += " " + t("cwd.notTrusted");
    bar.title = tooltip;

    pathEl.innerHTML = "";
    pathEl.appendChild(document.createTextNode(truncateCwdPath(effective)));
    if (isOverride) {
        const tag = document.createElement("span");
        tag.className = "cwdbar-override-tag";
        tag.textContent = t("cwd.overrideTag");
        pathEl.appendChild(tag);
    }
    if (!_workspaceTrusted) {
        const tag = document.createElement("span");
        tag.className = "cwdbar-untrusted-tag";
        tag.textContent = t("cwd.notTrusted");
        pathEl.appendChild(tag);
    }
}

// ── Presence (U4) ──────────────────────────────────────────
// Live status from the CLI's presence file (~/.claude/sessions/<pid>.json).
// Only "waiting" states carry information the UI doesn't already show
// (streaming/pending are covered elsewhere), so that's all we render.
// Probed 2026-07-18 (2.1.205 and 2.1.214): the sdk-cli entrypoint never
// stamps status/waitingFor — the file watcher stays as future-proofing, and
// the waiting states are synthesized by the UI itself (modal/question open).
// Rotating verbs for the "thinking" indicator (mostly sober, plus a couple of
// in-jokes). The CLI emits only a start/stop signal (no summary text), so the
// word is ours; cycling it makes a long pause read as active work, not a freeze.
const THINKING_WORDS = [
    "Thinking", "Reasoning", "Analyzing", "Considering",
    "Working", "Processing", "Evaluating", "Reviewing",
    "Megabraining", "Skyneting",
];
let _thinkingTimer = null;
let _thinkingIdx = -1;

function renderPresence(status, waitingFor) {
    const el = document.getElementById("cwdbar-presence");
    if (!el) return;

    // #cwdbar-presence is shared with the compacting/waiting states, so any
    // non-thinking status must stop the word cycle or it would overwrite them.
    if (status !== "thinking" && _thinkingTimer) {
        clearInterval(_thinkingTimer);
        _thinkingTimer = null;
    }

    if (status === "waiting" && waitingFor) {
        el.textContent = "⏸ " + waitingFor;
        el.hidden = false;
    } else if (status === "thinking") {
        const tick = () => {
            let i;
            do { i = Math.floor(Math.random() * THINKING_WORDS.length); }
            while (i === _thinkingIdx && THINKING_WORDS.length > 1);
            _thinkingIdx = i;
            el.textContent = "✳ " + t("thinking." + THINKING_WORDS[i]) + "…";
        };
        tick(); // show a word immediately, don't wait for the first interval
        el.hidden = false;
        if (!_thinkingTimer) _thinkingTimer = setInterval(tick, 2500);
    } else if (status === "compacting") {
        el.textContent = t("presence.compacting");
        el.hidden = false;
    } else {
        el.textContent = "";
        el.hidden = true;
    }
}

function copyCwd() {
    if (!_cwdFullPath) return;
    // Untrusted workspace: reopen the trust prompt instead of copying — more useful
    // than silently copying a path the user can't actually act on yet. Round-trip
    // through the backend so parentIsHome is computed authoritatively (JS has no
    // access to %USERPROFILE%).
    if (!_workspaceTrusted) {
        try { window.chrome.webview.postMessage({ type: "refresh-cwd" }); } catch (e) {}
        return;
    }
    const bar = document.getElementById("cwdbar");
    const done = () => {
        if (!bar) return;
        bar.classList.add("cwdbar-copied");
        setTimeout(() => bar.classList.remove("cwdbar-copied"), 600);
    };
    try {
        navigator.clipboard.writeText(_cwdFullPath).then(done, done);
    } catch (e) {
        // Fallback for older WebView2 builds without async clipboard.
        const ta = document.createElement("textarea");
        ta.value = _cwdFullPath;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch (_) {}
        document.body.removeChild(ta);
        done();
    }
}
// ────────────────────────────────────────────────────────────

let _accountInfo = null;
function renderAccountInfo() {
    const el = document.getElementById("account-info");
    if (!el) return;
    el.classList.remove("account-info-loading");

    if (!_accountInfo || !_accountInfo.signedIn) {
        el.textContent = t("account.notSignedIn");
        el.title = t("account.clickToSignIn");
        el.classList.add("account-info-muted");
        el.classList.add("account-info-clickable");
        el.onclick = startClaudeLogin;
        return;
    }
    el.classList.remove("account-info-muted");
    el.classList.remove("account-info-clickable");
    el.onclick = null;

    const customName = (localStorage.getItem("displayName") || "").trim();
    const accountName = _accountInfo.accountDisplayName || "";
    const org = _accountInfo.organizationName || "";
    const email = _accountInfo.email || "";
    const source = localStorage.getItem("accountInfoSource") || "auto";

    let name = "";
    let tooltip = "";

    if (source === "account") {
        name = accountName || "—";
        tooltip = accountName ? (email ? `${accountName} (${email})` : accountName) : t("account.nameUnavailable");
    } else if (source === "organization") {
        name = org || "—";
        tooltip = org || t("account.orgUnavailable");
    } else if (source === "email") {
        name = email || "—";
        tooltip = email || t("account.emailUnavailable");
    } else if (source === "custom") {
        name = customName || "—";
        tooltip = customName || t("account.setCustomName");
    } else {
        // auto cascade: custom → account → organization → email → Anonymous
        if (customName) {
            name = customName;
            tooltip = email || customName;
        } else if (accountName) {
            name = accountName;
            tooltip = email ? `${accountName} (${email})` : accountName;
        } else if (org) {
            name = org;
            tooltip = email ? `${org} (${email})` : org;
        } else if (email) {
            name = email;
            tooltip = email;
        } else {
            name = t("account.anonymous");
            tooltip = "";
        }
    }

    const plan = _accountInfo.plan || "";
    el.innerHTML = "";
    const nameSpan = document.createElement("span");
    nameSpan.textContent = name;
    el.appendChild(nameSpan);
    if (plan) {
        const sep = document.createTextNode(" · ");
        el.appendChild(sep);
        const planSpan = document.createElement("span");
        planSpan.className = "account-info-plan";
        planSpan.textContent = plan;
        el.appendChild(planSpan);
    }
    el.title = tooltip;
}

// Tool-window caption attention markers (V13): "pending" while a permission
// modal or AskUserQuestion card waits on the user, "done" when a turn finishes
// while the tool window is hidden. The tab caption is the only surface that
// stays visible when the window is backgrounded — the in-chat .tool-pending
// chip isn't. Cleared on resolve / when the window regains visibility.
let _captionAttention = null;
let _toolWindowVisible = true;

function setCaptionAttention(state) {
    if (_captionAttention === state) return;
    _captionAttention = state;
    updateCaption();
    // Notification sounds (D3) ride the same transitions: "pending" fires
    // whenever claude blocks on the user; "done" is only ever set while the
    // window is hidden, matching the "turn ends unseen" semantics.
    if (state === "pending" && localStorage.getItem("soundOnInput") === "true") playSound("attention");
    if (state === "done" && localStorage.getItem("soundOnDone") === "true") playSound("done");
}

function playSound(sound) {
    try { window.chrome.webview.postMessage({ type: "play-sound", text: sound }); } catch (e) {}
}

function updateCaption() {
    const opt = modelSelect.options[modelSelect.selectedIndex];
    const label = opt?.text || modelSelect.value;
    modelSelect.title = opt?.title || modelSelect.value;
    const prefix = _captionAttention === "pending" ? "🔔 "
        : _captionAttention === "done" ? "✓ " : "";
    try {
        window.chrome.webview.postMessage({ type: "set-caption", text: `${prefix}Claude Code Studio — ${label}` });
    } catch (e) { /* webview not ready yet */ }
}
modelSelect.addEventListener("change", updateCaption);
window.addEventListener("DOMContentLoaded", updateCaption);
updateCaption();

// Drops (or updates in place, if the previous message is already a divider —
// consecutive changes with no message in between collapse into one) a marker
// into the transcript so it's clear which model produced the messages above
// vs below the line. No-op before the conversation has started (a divider
// above an empty chat is just noise). Shared by manual picks (noteModelSwitch)
// and automatic --fallback-model engagement/recovery (noteModelFallback, #14).
function insertOrUpdateModelDivider(text) {
    if (!messages.querySelector(".message")) return;
    const last = messages.lastElementChild;
    if (last && last.classList.contains("model-divider") && !last.classList.contains("resume-divider")) {
        last.querySelector(".model-divider-label").textContent = text;
        autoScroll();
        return;
    }
    const div = document.createElement("div");
    div.className = "model-divider";
    div.innerHTML = `<span class="model-divider-label"></span>`;
    div.querySelector(".model-divider-label").textContent = text;
    messages.appendChild(div);
    autoScroll();
}

// #21 backlog item 16: restoreSessionModel below flips this while it sets
// modelSelect programmatically, so a resume doesn't persist its (possibly
// one-off) model as the global default for new chats, nor drop the loud
// "Switched to" divider meant for a manual pick mid-conversation.
let _restoringSessionModel = false;

function noteModelSwitch() {
    const newId = modelSelect.value;
    if (newId === activeModelId) return;
    activeModelId = newId;
    // A manual pick resets what #14 considers "the primary" — otherwise a
    // fallback recovery notice could fire against the old selection.
    _lastReportedActiveModel = newId;
    if (_restoringSessionModel) return;
    localStorage.setItem(ModelStorageKey.LastUsed, newId);

    const label = modelSelect.options[modelSelect.selectedIndex]?.text || newId;
    insertOrUpdateModelDivider(t("model.switched", { label }));
}
modelSelect.addEventListener("change", noteModelSwitch);

// #21 backlog item 16: the model picker is a single global pick, so resuming
// a session that last ran on a different model silently stayed on whatever's
// currently selected — a guaranteed prompt-cache miss even inside the TTL
// window, on top of being surprising. Restore the session's own model
// instead, quietly: no write to the global default (a one-off resume
// shouldn't decide what new chats start with). Returns the model's label for
// showResumeNotice to report, or null if nothing changed (already current).
function restoreSessionModel(rawId) {
    if (!rawId) return null;
    const bareId = String(rawId).replace(/-\d{8}$/, "");
    const opt = [...modelSelect.options].find(o => o.value === bareId);
    if (!opt || modelSelect.value === bareId) return null;
    _restoringSessionModel = true;
    modelSelect.value = bareId;
    modelSelect.dispatchEvent(new Event("change"));
    _restoringSessionModel = false;
    return opt.text;
}

// #21 backlog item 16 (part 2): resuming a session whose prompt cache has
// almost certainly expired pays a full re-cache on the next reply. This is
// informational only — no action suggested, and deliberately rare: it only
// fires for a session that's both been idle past its own inferred cache TTL
// AND big enough (>50k tokens of context) that re-reading it is noticeable.
// cacheTtlMin comes from the session's own cache_creation breakdown
// (Program.cs/XAML.cs) rather than a hardcoded guess, since the TTL differs
// by plan; a session with no evidence either way defaults to the more
// conservative 1h tier so this stays rare rather than noisy. Returns the
// notice text, or null if the heuristic doesn't clear.
function cacheNoteText(lastTurnAt, contextTokens, cacheTtlMin) {
    if (!lastTurnAt || !(contextTokens > 50000)) return null;
    const idleMs = Date.now() - Date.parse(lastTurnAt);
    if (!(idleMs > 0)) return null;
    const ttlMs = (cacheTtlMin || 60) * 60000;
    if (idleMs <= ttlMs) return null;
    return t("model.cacheNote", { idle: formatIdleDuration(idleMs), tokens: formatApproxTokens(contextTokens) });
}

function formatIdleDuration(ms) {
    const hours = ms / 3600000;
    if (hours >= 1) return t("fmt.hours", { n: hours < 10 ? hours.toFixed(1) : Math.round(hours) });
    return t("fmt.minutes", { n: Math.max(1, Math.round(ms / 60000)) });
}

function formatApproxTokens(n) {
    return t("fmt.tokens", { n: n > 1000 ? `${(n / 1000).toFixed(1)}k` : n });
}

// #21 backlog item 16: both resume markers (model restored, cache likely
// expired) are dividers appended at the END of the replayed transcript, the
// point where the resumed conversation picks up and where the view sits after
// autoScroll. At the top they were invisible in a long session without
// scrolling all the way up. Same look as the "Switched to" divider, but
// tagged resume-divider so a manual switch right after appends its own
// divider instead of overwriting these (insertOrUpdateModelDivider).
function showResumeNotice(rawModelId, lastTurnAt, contextTokens, cacheTtlMin) {
    const modelLabel = restoreSessionModel(rawModelId);
    const cacheMsg = cacheNoteText(lastTurnAt, contextTokens, cacheTtlMin);
    if (modelLabel) appendResumeDivider(t("model.resumedOn", { label: modelLabel }));
    if (cacheMsg) appendResumeDivider(`⏳ ${cacheMsg}`);
    autoScroll();
}

function appendResumeDivider(text) {
    const div = document.createElement("div");
    div.className = "model-divider resume-divider";
    div.innerHTML = `<span class="model-divider-label"></span>`;
    div.querySelector(".model-divider-label").textContent = text;
    messages.appendChild(div);
}

// #14: assistant.message.model can silently differ from what was requested
// when --fallback-model engages. Server-authoritative signal (Program.cs),
// so this only reacts to it — it never decides on its own.
let _lastReportedActiveModel = null;

function noteModelFallback(actualModelId) {
    if (!actualModelId || actualModelId === _lastReportedActiveModel) return;
    const requestedId = modelSelect.value;
    const wasFallback = _lastReportedActiveModel && _lastReportedActiveModel !== requestedId;
    _lastReportedActiveModel = actualModelId;
    // Only the recovery case is worth a divider when we land back on the
    // primary — landing there for the first time (never having deviated) is
    // just the ordinary case and would be noise.
    if (actualModelId === requestedId && !wasFallback) return;

    const opt = [...modelSelect.options].find(o => o.value === actualModelId);
    const label = opt ? opt.text : actualModelId;
    insertOrUpdateModelDivider(actualModelId === requestedId
        ? t("model.backTo", { label })
        : t("model.fellBack", { label }));
}

// ── Model picker (titlebar) ──────────────────────────────────
// Effort-style button + popup replacing the OS-rendered <select> dropdown so
// the model pick matches the effort/permission controls (rounded popup, item
// highlight). The hidden native select stays the single source of truth;
// picking an item writes it and dispatches "change" so every existing
// listener (caption, transcript divider, this button's label) runs unchanged.
const modelControl = document.getElementById("model-control");
const modelPopup = document.getElementById("model-popup");
const modelBtn = document.getElementById("model-btn");
const modelBtnLabel = document.getElementById("model-btn-label");

function toggleModelPopup() {
    if (modelPopup.hidden) buildModelPopup();
    modelPopup.hidden = !modelPopup.hidden;
}

function buildModelPopup() {
    modelPopup.innerHTML = "";
    [...modelSelect.options].forEach(opt => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "permission-item" + (opt.value === modelSelect.value ? " active" : "");
        btn.title = opt.title || opt.value;
        const span = document.createElement("span");
        span.textContent = opt.text;
        btn.appendChild(span);
        btn.onclick = () => {
            modelPopup.hidden = true;
            if (opt.value === modelSelect.value) return;
            modelSelect.value = opt.value;
            modelSelect.dispatchEvent(new Event("change"));
        };
        modelPopup.appendChild(btn);
    });
}

function refreshModelButton() {
    const opt = modelSelect.options[modelSelect.selectedIndex];
    modelBtnLabel.textContent = opt?.text || modelSelect.value;
    modelBtn.title = opt?.title || modelSelect.value;
}
modelSelect.addEventListener("change", refreshModelButton);
refreshModelButton();

// Click outside closes; capture phase, same as the other popups.
document.addEventListener("click", (e) => {
    if (modelPopup.hidden) return;
    if (!modelControl.contains(e.target)) modelPopup.hidden = true;
}, true);

// Effort selector: compact button in the composer-actions row that opens a
// popup with a slider above it. Avoids the native <select> dropdown direction
// flipping (5 options need ~120px vertical and the composer sits at the
// bottom of the tool window, so the browser keeps wanting to open upward
// while the 3-option permission select stays downward — visual inconsistency).
const effortValues = ["", "low", "medium", "high", "xhigh", "max"];
const effortLabels = ["auto", "low", "med", "high", "xhigh", "max"];
const effortIcons  = ["🧭", "🪶", "⚙", "🧠", "🚀", "🔥"];
const effortBtn = document.getElementById("effort-btn");
const effortBtnIcon = document.getElementById("effort-btn-icon");
const effortBtnLabel = document.getElementById("effort-btn-label");
const effortPopup = document.getElementById("effort-popup");
const effortPopupSlider = document.getElementById("effort-popup-slider");
const effortControl = document.getElementById("effort-control");

// Shim so the existing send code (`effort: effortSelect.value || null`) still works.
const effortSelect = { get value() { return effortValues[+effortPopupSlider.value]; } };

(function initEffort() {
    // Migrate legacy index-based key (effortLevel) or string-based key (effortValue)
    // to the slider position.
    let idx = 0;
    const storedIdx = localStorage.getItem("effortLevel");
    const storedVal = localStorage.getItem("effortValue");
    if (storedIdx != null) {
        const n = parseInt(storedIdx, 10);
        if (!Number.isNaN(n) && n >= 0 && n < effortValues.length) idx = n;
    } else if (storedVal != null) {
        const found = effortValues.indexOf(storedVal);
        if (found >= 0) idx = found;
    }
    // "max" is session-only (D8) — a value persisted by pre-D8 builds would
    // otherwise keep max burning across restarts forever. Load as xhigh.
    if (effortValues[idx] === "max") {
        idx = effortValues.indexOf("xhigh");
        localStorage.setItem("effortLevel", idx);
    }
    effortPopupSlider.value = idx;
    updateEffortButton(idx);
})();

function updateEffortButton(idx) {
    effortBtnIcon.textContent = effortIcons[idx];
    effortBtnLabel.textContent = t("effort." + effortLabels[idx]);
}

function toggleEffortPopup() {
    effortPopup.hidden = !effortPopup.hidden;
}

effortPopupSlider.addEventListener("input", () => {
    const idx = +effortPopupSlider.value;
    updateEffortButton(idx);
    // "max" is session-only (D8, política do dliedke v43): it never persists,
    // so a VS restart falls back to the last durable level instead of
    // silently keeping max effort burning across sessions.
    if (effortValues[idx] !== "max") localStorage.setItem("effortLevel", idx);
});

// Click outside the effort control closes the popup. Capture phase so we
// catch the click before it lands on inner buttons.
document.addEventListener("click", (e) => {
    if (effortPopup.hidden) return;
    if (!effortControl.contains(e.target)) effortPopup.hidden = true;
}, true);
const autoSaveSlider = document.getElementById("autosave-slider");
const autoSaveLabel = document.getElementById("autosave-label");
const autoSaveValues = ["none", "active", "all"];
(function () {
    const saved = localStorage.getItem("autoSaveLevel") ?? "1";
    autoSaveSlider.value = saved;
    autoSaveLabel.textContent = t("autosave." + autoSaveValues[+saved]);
})();
autoSaveSlider.addEventListener("input", () => {
    const i = +autoSaveSlider.value;
    autoSaveLabel.textContent = t("autosave." + autoSaveValues[i]);
    localStorage.setItem("autoSaveLevel", i);
});

// Effort is now driven by the dropdown next to permission-select in the
// composer-actions row (see effortSelect setup above) — the old slider
// listener that used to live here was removed when the UI moved.

// Permission mode: same button+popup pattern as effort. Categorical (not a
// slider), so the popup is a list of clickable items. The send code reads
// `permissionSelect.value` — keep a shim so the existing call site doesn't
// have to change.
const StorageKey = Object.freeze({ RemoteControl: "remoteControl", DefaultPermissionMode: "defaultPermissionMode" });
// Wire values the agent's PermissionMode enum reads (case-insensitive).
const PermissionModeValue = Object.freeze({ Ask: "ask", AcceptEdits: "acceptEdits", Plan: "plan", Auto: "auto", Bypass: "bypassPermissions" });
// What the panel starts in (Settings → Default mode). Bypass is not offered:
// starting every session with no approvals must stay a deliberate, per-session pick.
const DEFAULT_MODE_CHOICES = [PermissionModeValue.Ask, PermissionModeValue.AcceptEdits, PermissionModeValue.Plan, PermissionModeValue.Auto];
function defaultPermissionMode() {
    try {
        const v = localStorage.getItem(StorageKey.DefaultPermissionMode);
        return DEFAULT_MODE_CHOICES.includes(v) ? v : PermissionModeValue.Ask;
    } catch (_) { return PermissionModeValue.Ask; }
}
// A new chat (✎, solution change) keeps the mode in use — except Bypass,
// which never carries over silently into a fresh conversation.
function applyNewChatPermissionMode() {
    if (_permissionValue === PermissionModeValue.Bypass) setPermission(defaultPermissionMode());
}
function setDefaultPermissionMode(value) {
    if (!DEFAULT_MODE_CHOICES.includes(value)) return;
    try { localStorage.setItem(StorageKey.DefaultPermissionMode, value); } catch (_) { }
    if (!isStreaming) setPermission(value); // show it right away; a running turn keeps its mode
}

// Same four modes as the official VS Code extension. Keys are the wire values
// the agent's PermissionMode enum reads (case-insensitive).
const PERMISSION_MODES = {
    ask: { icon: "✋", label: "permMode.ask" },
    acceptEdits: { icon: "✏️", label: "permMode.acceptEdits" },
    plan: { icon: "📋", label: "permMode.plan" },
    auto: { icon: "⚡", label: "permMode.auto" },
    // Not in VS Code's menu; kept for those who want it, marked dangerous.
    bypassPermissions: { icon: "⚠️", label: "permMode.bypassShort", danger: true }
};
let _permissionValue = defaultPermissionMode();
const defaultModeSelect = document.getElementById("default-mode-select");
if (defaultModeSelect) defaultModeSelect.value = _permissionValue;
const permissionSelect = {
    get value() { return _permissionValue; },
    set value(v) { _permissionValue = v; updatePermissionButton(); updatePermissionItems(); }
};
const permissionBtnIcon = document.getElementById("permission-btn-icon");
const permissionBtnLabel = document.getElementById("permission-btn-label");
const permissionPopup = document.getElementById("permission-popup");
const permissionControl = document.getElementById("permission-control");

function togglePermissionPopup() {
    permissionPopup.hidden = !permissionPopup.hidden;
}

function setPermission(value) {
    _permissionValue = value;
    updatePermissionButton();
    updatePermissionItems();
    permissionPopup.hidden = true;
}

function updatePermissionButton() {
    const mode = PERMISSION_MODES[_permissionValue] || PERMISSION_MODES.ask;
    permissionBtnIcon.textContent = mode.icon;
    permissionBtnLabel.textContent = t(mode.label);
    // Stays red for as long as the dangerous mode is active.
    document.getElementById("permission-btn").classList.toggle("mode-danger-active", !!mode.danger);
}

function updatePermissionItems() {
    permissionPopup.querySelectorAll(".permission-item").forEach(el => {
        el.classList.toggle("active", el.dataset.value === _permissionValue);
    });
}

updatePermissionButton();
updatePermissionItems();

document.addEventListener("click", (e) => {
    if (permissionPopup.hidden) return;
    if (!permissionControl.contains(e.target)) permissionPopup.hidden = true;
}, true);
// ── Composer toolbar (VS Code-style): + menu, /, context ring, Remote Control ──
// Message types introduced here; the rest of the page still uses literals until
// the constants refactor moves them all into one table.
const MsgType = Object.freeze({
    GetContextUsage: "get-context-usage",
    ToolUse: "tool_use",
    ToolResult: "tool_result",
    ToolError: "tool_error",
    RemoteControl: "remote-control",
    RemoteControlResult: "remote-control-result",
    RemoteState: "remote-state"
});
const RemoteState = Object.freeze({ Off: "off", Pending: "pending", Connecting: "connecting", Connected: "connected", Error: "error" });
// The CLI's own bridge_state values (its vocabulary, not ours).
const BridgeState = Object.freeze({ Ready: "ready", Connected: "connected", Disconnected: "disconnected", Failed: "failed" });

const attachControl = document.getElementById("attach-control");
const attachPopup = document.getElementById("attach-popup");
function toggleAttachMenu() { attachPopup.hidden = !attachPopup.hidden; }
attachPopup.addEventListener("click", () => { attachPopup.hidden = true; }); // items keep their own handlers
document.addEventListener("click", e => {
    if (!attachPopup.hidden && !attachControl.contains(e.target)) attachPopup.hidden = true;
}, true);

// "/" opens the slash-command list on an empty composer. Picking a command
// replaces the composer text, so with a draft present it only prefixes "/"
// and leaves the draft intact.
function openSlashCommands() {
    textarea.focus();
    if (!textarea.value.trim()) {
        textarea.value = "/";
        textarea.setSelectionRange(1, 1);
        textarea.dispatchEvent(new Event("input"));
    } else if (!textarea.value.startsWith("/")) {
        textarea.value = "/" + textarea.value;
        textarea.setSelectionRange(1, 1);
    }
}

// Context ring: how full the session's context window is (always shown, empty
// until the first reply). Fed by the same "context-usage" reply as the ⌘ card,
// refreshed after every completed turn. Click = compact now (VS Code-like);
// the detailed breakdown stays in the ⌘ menu.
const ctxRing = document.getElementById("ctx-ring");
const CTX_RING_CIRCUMFERENCE = 2 * Math.PI * 8;
const COMPACT_COMMAND = "/compact";
let _ctxKnown = false;
function paintContextRing(pct) {
    document.getElementById("ctx-ring-fill").style.strokeDasharray = `${(pct / 100) * CTX_RING_CIRCUMFERENCE} ${CTX_RING_CIRCUMFERENCE}`;
    ctxRing.classList.toggle("ctx-high", pct >= 80);
}
function updateContextRing(usageJson) {
    let u;
    try { u = JSON.parse(usageJson || ""); } catch (_) { return; }
    const pct = Number(u && u.percentage);
    if (!Number.isFinite(pct)) return;
    const clamped = Math.max(0, Math.min(100, pct));
    _ctxKnown = true;
    paintContextRing(clamped);
    ctxRing.title = t("composer.contextTitle", { pct: Math.round(clamped), used: fmtTokens(u.totalTokens || 0), max: fmtTokens(u.rawMaxTokens || 0) });
}
function refreshContextRing() {
    try { window.chrome.webview.postMessage({ type: MsgType.GetContextUsage }); } catch (_) { }
}
function resetContextRing() {
    _ctxKnown = false;
    paintContextRing(0);
    ctxRing.title = t("composer.contextUnknown");
}
// Goes through the send queue (never the composer), so a draft or attachment
// isn't swept into it, and it waits its turn if one is running.
function compactNow() {
    if (!_ctxKnown) return; // nothing to compact before the first reply
    _sendQueue.push({ text: COMPACT_COMMAND, attachments: [], fullMessage: COMPACT_COMMAND });
    drainSendQueue();
}

// Running subagents (Task/Agent tool calls between tool_use and their result):
// a pill with the count, and a popover listing them — click a row to jump to
// its chip in the transcript.
const AGENT_TOOLS = new Set(["Task", "Agent"]);
const _runningAgents = new Map(); // tool id → { type, description, startedAt }
const agentsControl = document.getElementById("agents-control");
const agentsPopup = document.getElementById("agents-popup");
function trackAgentTool(kind, name, inputJson, id) {
    if (!id) return;
    if (kind === MsgType.ToolUse && AGENT_TOOLS.has(name)) {
        if (_runningAgents.has(id)) return; // stream + transcript both report it
        let input = {};
        try { input = JSON.parse(inputJson || "{}") || {}; } catch (_) { }
        _runningAgents.set(id, { type: input.subagent_type || name, description: input.description || "", startedAt: Date.now() });
    } else if ((kind === MsgType.ToolResult || kind === MsgType.ToolError) && _runningAgents.has(id)) {
        _runningAgents.delete(id);
    } else return;
    renderAgentsPill();
}
function clearRunningAgents() {
    _runningAgents.clear();
    renderAgentsPill();
}
function renderAgentsPill() {
    const n = _runningAgents.size;
    agentsControl.hidden = n === 0;
    if (n === 0) agentsPopup.hidden = true;
    document.getElementById("agents-label").textContent = t(n === 1 ? "agents.one" : "agents.many", { n });
    if (!agentsPopup.hidden) renderAgentsPopup();
}
function renderAgentsPopup() {
    const header = document.createElement("div");
    header.className = "mode-popup-header";
    header.textContent = t("agents.header");
    const rows = [..._runningAgents].map(([id, a]) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "permission-item agents-row";
        const secs = Math.max(0, Math.round((Date.now() - a.startedAt) / 1000));
        const title = document.createElement("span");
        title.className = "agents-row-type";
        title.textContent = a.type;
        const desc = document.createElement("span");
        desc.className = "agents-row-desc";
        desc.textContent = a.description;
        const time = document.createElement("span");
        time.className = "agents-row-time";
        time.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
        row.append(title, desc, time);
        row.addEventListener("click", () => {
            agentsPopup.hidden = true;
            messages.querySelector(`.tool-chip[data-tool-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
        });
        return row;
    });
    agentsPopup.replaceChildren(header, ...rows);
}
function toggleAgentsPopup() {
    agentsPopup.hidden = !agentsPopup.hidden;
    if (!agentsPopup.hidden) renderAgentsPopup();
}
document.addEventListener("click", e => {
    if (!agentsPopup.hidden && !agentsControl.contains(e.target)) agentsPopup.hidden = true;
}, true);

// Remote Control: continue this session from claude.ai/code or the Claude app.
// The choice persists; it is applied to the live claude right away, or at the
// next message when none is running yet.
let _remote = { state: RemoteState.Off, url: null };
function remoteControlEnabled() {
    try { return localStorage.getItem(StorageKey.RemoteControl) === "true"; } catch (_) { return false; }
}
function toggleRemoteControl() {
    const on = !remoteControlEnabled();
    try { localStorage.setItem(StorageKey.RemoteControl, String(on)); } catch (_) { }
    _remote = { state: on ? RemoteState.Connecting : RemoteState.Off, url: null };
    renderRemoteControl();
    try { window.chrome.webview.postMessage({ type: MsgType.RemoteControl, enabled: on }); } catch (_) { }
}
function onRemoteControlResult(text, error) {
    let r = null;
    try { r = JSON.parse(text || "null"); } catch (_) { }
    if (error || !r || r.error) {
        _remote = { state: RemoteState.Error, url: null };
        showToast(t("rc.failed"));
    } else if (!r.enabled) {
        _remote = { state: RemoteState.Off, url: null };
    } else {
        _remote = { state: r.pending ? RemoteState.Pending : RemoteState.Connected, url: r.url || _remote.url };
    }
    renderRemoteControl();
}
function onRemoteState(bridgeState) {
    if (!remoteControlEnabled()) return;
    if (bridgeState === BridgeState.Connected) _remote.state = RemoteState.Connected;
    else if (bridgeState === BridgeState.Ready && _remote.state !== RemoteState.Connected) _remote.state = RemoteState.Connecting;
    else if (bridgeState === BridgeState.Disconnected || bridgeState === BridgeState.Failed) _remote.state = RemoteState.Error;
    renderRemoteControl();
}
// A cleared/reset chat kills claude; the switch survives and reconnects with
// the next message.
function remoteControlSessionEnded() {
    _remote = { state: remoteControlEnabled() ? RemoteState.Pending : RemoteState.Off, url: null };
    renderRemoteControl();
}
function renderRemoteControl() {
    const btn = document.getElementById("rc-btn");
    btn.dataset.state = _remote.state;
    btn.title = t("rc." + _remote.state) + (_remote.url ? "\n" + _remote.url : "");
    btn.querySelector(".rc-open")?.remove();
    if (_remote.state === RemoteState.Connected && _remote.url) {
        const a = document.createElement("a");
        a.className = "rc-open";
        a.href = _remote.url;
        a.target = "_blank"; // NewWindowRequested → default browser
        a.textContent = "↗";
        a.title = t("rc.open");
        a.addEventListener("click", e => e.stopPropagation());
        btn.appendChild(a);
    }
}
remoteControlSessionEnded(); // initial: pending if the switch was left on

const timingSelect = document.getElementById("timing-select");
(function () {
    const saved = localStorage.getItem("timingMode") || "simple";
    timingSelect.value = saved;
    document.querySelectorAll(".timing-opt").forEach(el => {
        if (el.dataset.value === saved) el.classList.add("timing-opt-active");
    });
})();

function setTimingMode(el) {
    timingSelect.value = el.dataset.value;
    localStorage.setItem("timingMode", el.dataset.value);
    document.querySelectorAll(".timing-opt").forEach(o => o.classList.remove("timing-opt-active"));
    el.classList.add("timing-opt-active");
}
const messages = document.querySelector("#messages");
const attachmentsEl = document.getElementById("attachments");
let welcome = document.querySelector(".welcome");

// ── Pinned dock ───────────────────────────────────────────────
// Active interactive cards (a pending AskUserQuestion, the context-usage
// panel) live between the chat and the composer so they can't scroll away
// with the transcript (validation 2026-07-18 — the sticky-bottom approach
// stops working once new content streams in below the card). A hidden
// placeholder marks where the card re-enters the transcript once resolved.
const pinnedDock = document.getElementById("pinned-dock");

function pinCard(card, flowParent, scope) {
    const ph = document.createElement("span");
    ph.className = "pin-placeholder";
    ph.hidden = true;
    flowParent.appendChild(ph);
    card._pinPlaceholder = ph;
    card.dataset.pinScope = scope; // "turn" flushes at stream-done; "manual" waits for ✕
    pinnedDock.appendChild(card);
    pinnedDock.hidden = false;
}

function unpinCard(card) {
    const ph = card._pinPlaceholder;
    card._pinPlaceholder = null;
    delete card.dataset.pinScope;
    // Neutralize the sticky-bottom rule once back in the flow: the "answered"
    // class names it excludes don't match these cards (ask-question-answered,
    // ctx-usage-card), so without this the resolved card floats translucently
    // over the transcript while scrolling (rodada 3 screenshots).
    card.classList.add("pin-resolved");
    if (ph && ph.parentNode) ph.parentNode.replaceChild(card, ph);
    else if (!messages.contains(card)) messages.appendChild(card);
    if (!pinnedDock.firstElementChild) pinnedDock.hidden = true;
    autoScroll();
}

// Ephemeral info panels (context usage, MCP status, Doctor, side question) are
// point-in-time snapshots — the ✕ discards them entirely instead of dropping
// them into the transcript like unpinCard, which would just clutter the chat
// (and, for the side question, contradict its "not added to the transcript" note).
function dismissPinnedCard(card) {
    const ph = card._pinPlaceholder;
    if (ph && ph.parentNode) ph.parentNode.removeChild(ph);
    card._pinPlaceholder = null;
    card.remove();
    if (!pinnedDock.firstElementChild) pinnedDock.hidden = true;
}

// Turn-scoped cards still docked when the turn ends (cancel, error — the pick
// never came) fall back into the transcript instead of lingering.
function flushPinnedDock() {
    for (const card of [...pinnedDock.children])
        if (card.dataset.pinScope === "turn") unpinCard(card);
}

let _userScrolledUp = false;
const btnScrollBottom = document.getElementById("btn-scroll-bottom");

messages.addEventListener("scroll", () => {
    _userScrolledUp = messages.scrollTop + messages.clientHeight < messages.scrollHeight - 24;
    btnScrollBottom.classList.toggle("visible", _userScrolledUp);
});

messages.addEventListener("click", e => {
    const copyBtn = e.target.closest(".copy-btn");
    if (copyBtn) {
        const pre = copyBtn.closest("pre");
        const codeEl = pre?.querySelector("code");
        if (!codeEl) return;
        const code = codeEl.innerText.replace(/\r\n/g, "\n");
        const flash = () => {
            copyBtn.textContent = t("code.copied");
            copyBtn.classList.add("copied");
            setTimeout(() => { copyBtn.textContent = t("code.copy"); copyBtn.classList.remove("copied"); }, 1200);
        };
        try {
            navigator.clipboard.writeText(code).then(flash, flash);
        } catch (err) {
            // Fallback for older WebView2 builds without async clipboard,
            // same approach as the cwdbar copy above.
            const ta = document.createElement("textarea");
            ta.value = code;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand("copy"); } catch (_) {}
            document.body.removeChild(ta);
            flash();
        }
        return;
    }

    const btn = e.target.closest(".apply-btn");
    if (!btn) return;
    const pre = btn.closest("pre");
    const codeEl = pre?.querySelector("code");
    if (!codeEl) return;
    const code = codeEl.innerText.replace(/\r\n/g, "\n");
    const langMatch = (codeEl.className || "").match(/language-([\w-]+)/);
    const language = langMatch ? langMatch[1] : "";
    window.chrome.webview.postMessage({ type: "apply-to-editor", code, language });
    const orig = btn.textContent;
    btn.textContent = t("code.applied");
    btn.classList.add("applied");
    setTimeout(() => { btn.textContent = orig; btn.classList.remove("applied"); }, 1200);
});

function scrollToBottom() {
    _userScrolledUp = false;
    btnScrollBottom.classList.remove("visible");
    messages.scrollTop = messages.scrollHeight;
}

let _toastTimer = null;
function showToast(text) {
    if (!text) return;
    let el = document.getElementById("toast");
    if (!el) {
        el = document.createElement("div");
        el.id = "toast";
        el.className = "toast";
        document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add("visible");
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove("visible"), 2400);
}

function autoScroll() {
    if (!_userScrolledUp) messages.scrollTop = messages.scrollHeight;
}

let attachments = new Map();
let attachmentIdCounter = 0;
let msgCounter = 0;
// Counts only user messages (rewind targets the Nth user message, which maps
// 1:1 to user JSONL entries — unlike msgCounter, which mixes in assistant
// bubbles and drifts vs the transcript).
let userMsgCounter = 0;
let currentSessionId = null;
// First user-bubble ordinal still reachable by ⟲ in the CURRENT session's
// JSONL. A mid-chat session change WITHOUT resume starts an empty transcript,
// so bubbles from before that turn have no JSONL entry to rewind to (rodada 3:
// "user ordinal N out of range"). Resumed sessions fork the history and keep
// the base. The ordinal sent to the backend is relative to this base.
let _rewindBaseUserIdx = 0;
// userIndex of the user message that opened the in-flight turn.
let _turnUserIdx = 0;
// #7: the user bubble awaiting a --replay-user-messages delivery ack.
let _pendingUserAckBubble = null;
// #9: last rate-limit status shown, so repeats of the same status (fires
// every turn) don't spam a toast each time.
let _lastRateLimitStatus = null;

function decorateMessage(msgEl) {
    const idx = msgCounter++;
    msgEl.dataset.msgIndex = idx;
    const btn = document.createElement("button");
    btn.className = "msg-branch";
    btn.title = t("msg.branch");
    btn.textContent = "⎇";
    btn.addEventListener("click", () => branchFromMessage(idx));
    msgEl.appendChild(btn);

    // Rewind affordance only on user messages — it reverts files to the state
    // before that message (native checkpointing). Conversation is kept.
    if (msgEl.classList.contains("user")) {
        const uidx = userMsgCounter++;
        msgEl.dataset.userIndex = uidx;
        const rb = document.createElement("button");
        rb.className = "msg-rewind";
        rb.title = t("msg.rewind");
        rb.textContent = "⟲";
        rb.addEventListener("click", () => rewindFromMessage(uidx));
        msgEl.appendChild(rb);
    }
}

function branchFromMessage(idx) {
    if (!currentSessionId) return;
    // Send the session THIS transcript belongs to — the backend's live-agent
    // session id goes stale after a History replay (rodada 12: ⎇ kept forking
    // the last live conversation instead of the one on screen).
    window.chrome.webview.postMessage({ type: "branch", msgIndex: idx, sessionId: currentSessionId });
}

function rewindFromMessage(idx) {
    if (!currentSessionId) return;
    if (idx < _rewindBaseUserIdx) {
        showToast(t("rewind.prevSession"));
        return;
    }
    // dry run first → preview stats → confirm → apply. The backend indexes into
    // the current session's JSONL, so send the ordinal relative to the base.
    // sessionId guards against rewinding a replayed (not yet live) session.
    window.chrome.webview.postMessage({ type: "rewind", msgIndex: idx - _rewindBaseUserIdx, dryRun: true, sessionId: currentSessionId });
}

function showRewindConfirm(idx, result) {
    const files = (result && result.filesChanged) || [];
    if (!result || !result.canRewind || files.length === 0) {
        showToast(t("rewind.nothing"));
        return;
    }
    const ins = result.insertions || 0;
    const del = result.deletions || 0;
    const card = document.createElement("div");
    card.className = "question-card rewind-confirm-card";
    card.innerHTML = `
<div class="question-text">⟲ <strong>${t("rewind.confirmTitle")}</strong> ${t("rewind.confirmBody", { del, delS: del === 1 ? "" : "s", ins, files: files.length, filesS: files.length === 1 ? "" : "s" })}</div>
<ul class="rewind-file-list">${files.map(f => `<li>${escapeHtml(f)}</li>`).join("")}</ul>
<div class="question-buttons">
<button class="q-btn q-yes">${t("rewind.button")}</button>
<button class="q-btn">${t("common.cancel")}</button>
</div>`;
    const btns = card.querySelectorAll("button");
    btns[0].addEventListener("click", () => {
        card.classList.add("question-answered");
        btns[0].disabled = true; btns[1].disabled = true;
        window.chrome.webview.postMessage({ type: "rewind", msgIndex: idx, dryRun: false, sessionId: currentSessionId });
    });
    btns[1].addEventListener("click", () => card.remove());
    messages.appendChild(card);
    autoScroll();
}
let imageCounter = 0;
let currentStreamBubble = null;
let isStreaming = false;
const btnSend = document.getElementById("btn-send");

function setStreaming(on) {
    isStreaming = on;
    btnSend.textContent = on ? "■" : "↑";
    btnSend.classList.toggle("stop", on);
}

btnSend.addEventListener("click", () => {
    if (isStreaming) {
        window.chrome.webview.postMessage({ type: "cancel", turnSeq: _turnSeq });
        setStreaming(false);
        _awaitingCancelDone = true;
        removeLoading();
        removeLiveTimer();
        if (currentStreamBubble) {
            finalizeBubbleStream(currentStreamBubble);
            const cancelled = document.createElement("span");
            cancelled.className = "cancelled";
            cancelled.textContent = t("msg.cancelled");
            currentStreamBubble.appendChild(cancelled);
            currentStreamBubble = null;
        } else {
            const msg = document.createElement("div");
            msg.className = "message assistant";
            msg.innerHTML = `<div class="bubble"><span class="cancelled">${t("msg.cancelled")}</span></div>`;
            messages.appendChild(msg);
            autoScroll();
        }
    } else {
        sendMessage();
    }
});

// send handled by btnSend listener above
newChatButton.addEventListener("click", clearChat);

document.getElementById("btn-paste").addEventListener("click", async () => {
    window.chrome.webview.postMessage({ type: "get-clipboard-files" });
});

document.getElementById("btn-file").addEventListener("click", () => {
    window.chrome.webview.postMessage({ type: "add-file" });
});

document.getElementById("btn-selection").addEventListener("click", () => {
    window.chrome.webview.postMessage({ type: "get-selection" });
});

// ── Command autocomplete ──────────────────────────────────────
const autocompleteEl = document.getElementById("cmd-autocomplete");
let acIndex = -1;

const builtinCommands = ["/model", "/usage", "/compact", "/review", "/clear", "/plugin"];

// Contains-match on the name ("/grill" finds "/mattpocock-skills:grilling"),
// ranked: name starts with it, then a ":"-segment starts with it, then anywhere.
function getMatchingCommands(query) {
    const all = [...new Set([...builtinCommands, ...customCommands.map(c => c.command), ...discoveredSlashCommands])];
    const q = query.replace(/^\//, "").toLowerCase();
    if (!q) return all;
    const rank = cmd => {
        const name = cmd.replace(/^\//, "").toLowerCase();
        if (name.startsWith(q)) return 0;
        if (name.split(":").some(part => part.startsWith(q))) return 1;
        return name.includes(q) ? 2 : -1;
    };
    return all
        .map((cmd, i) => ({ cmd, i, r: rank(cmd) }))
        .filter(x => x.r >= 0)
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .map(x => x.cmd);
}

function showAutocomplete(query) {
    const cmds = getMatchingCommands(query);
    if (cmds.length === 0) { hideAutocomplete(); return; }
    acIndex = -1;
    autocompleteEl.innerHTML = cmds.map(c => {
        const info = slashCommandInfo.get(c);
        const desc = info && info.description ? `<span class="cmd-ac-desc">${escapeHtml(info.description)}</span>` : "";
        const title = info && info.description ? ` title="${escapeAttrValue(info.description)}"` : "";
        return `<div class="cmd-autocomplete-item" data-cmd="${escapeAttrValue(c)}"${title}><span class="cmd-ac-name">${escapeHtml(c)}</span>${desc}</div>`;
    }).join("");
    autocompleteEl.querySelectorAll(".cmd-autocomplete-item").forEach(el =>
        el.addEventListener("mousedown", e => { e.preventDefault(); fillAutocomplete(el.dataset.cmd); })
    );
    autocompleteEl.classList.add("open");
}

function hideAutocomplete() {
    autocompleteEl.classList.remove("open");
    acIndex = -1;
}

function fillAutocomplete(cmd) {
    textarea.value = cmd;
    hideAutocomplete();
    textarea.focus();
}

// ── "@" file picker (D2) ──────────────────────────────────────
// Typing "@" at the start of a word opens a popup listing workspace files and
// folders; typing filters, ↑/↓ + Enter/Tab (or click) inserts the
// workspace-relative path. Picking a folder keeps the popup open (drill-down).
// The inserted @path is plain text — in stream-json the CLI doesn't expand
// mentions, the model resolves the relative path with its Read tool.
const atAutocompleteEl = document.getElementById("at-autocomplete");
let atIndex = -1;
let atMentionStart = -1;   // index of the triggering '@' in the textarea
let atEntries = null;      // workspace-relative paths ('/'-separated, folders end with '/')
let atEntriesBuiltAt = 0;
let atEntriesLoading = false;
const AT_TTL_MS = 30000;
const AT_MAX_RESULTS = 60;

// An '@' token is an '@' at the start of the text or after whitespace,
// followed by non-whitespace up to the caret.
function findAtToken() {
    const text = textarea.value;
    const caret = textarea.selectionStart;
    for (let i = caret - 1; i >= 0; i--) {
        const c = text[i];
        if (c === "@") {
            if (i === 0 || /\s/.test(text[i - 1])) return { start: i, query: text.slice(i + 1, caret) };
            return null;
        }
        if (/\s/.test(c)) return null;
    }
    return null;
}

function updateAtMention() {
    const tok = findAtToken();
    if (!tok) { hideAtAutocomplete(); return; }
    atMentionStart = tok.start;

    if (!atEntries) {
        showAtIndexing();
        requestWorkspaceFiles();
        return;
    }
    // Stale index: show current results immediately, refresh in background.
    if (Date.now() - atEntriesBuiltAt > AT_TTL_MS && !atEntriesLoading) requestWorkspaceFiles();
    renderAtList(rankAtEntries(tok.query));
}

let _atLoadingTimeout = null;
function requestWorkspaceFiles() {
    if (atEntriesLoading) return;
    atEntriesLoading = true;
    // Safety valve (audit 2026-07-10 #3): if the workspace-files reply never
    // arrives, don't leave the picker stuck on "Indexing…" forever — allow a
    // fresh request on the next keystroke.
    clearTimeout(_atLoadingTimeout);
    _atLoadingTimeout = setTimeout(() => { atEntriesLoading = false; }, 10000);
    try { window.chrome.webview.postMessage({ type: "get-workspace-files" }); }
    catch (e) { atEntriesLoading = false; }
}

// Query may contain "/" (folder drill-down): the part after the last slash
// matches the entry name, the prefix constrains to that subtree. Name
// prefix-matches rank above name/path substring matches.
function rankAtEntries(query) {
    const q = (query || "").replace(/\\/g, "/").toLowerCase();
    const ls = q.lastIndexOf("/");
    const prefix = ls >= 0 ? q.slice(0, ls + 1) : "";
    const namePart = ls >= 0 ? q.slice(ls + 1) : q;

    const startsWith = [], contains = [];
    for (const p of atEntries) {
        const pl = p.toLowerCase();
        if (prefix && !pl.startsWith(prefix)) continue;

        if (!namePart) {
            startsWith.push(p);
        } else {
            const nm = atNameOf(pl);
            if (nm.startsWith(namePart)) startsWith.push(p);
            else if (nm.includes(namePart)) contains.push(p);
            else if (pl.includes(namePart)) contains.push(p);
        }
        if (startsWith.length >= AT_MAX_RESULTS) break;
    }
    return startsWith.concat(contains).slice(0, AT_MAX_RESULTS);
}

function atNameOf(relPath) {
    const t = relPath.replace(/\/+$/, "");
    const s = t.lastIndexOf("/");
    return s >= 0 ? t.slice(s + 1) : t;
}

function renderAtList(items) {
    if (items.length === 0) { hideAtAutocomplete(); return; }
    atIndex = 0;
    atAutocompleteEl.innerHTML = items.map((p, i) => {
        const isDir = p.endsWith("/");
        // title = full path — long entries ellipsize, the tooltip shows the rest
        // (dliedke v58, issue #103). escapeAttrValue, not escapeAttr: the value
        // is read back via dataset, and the JS-string escaper would corrupt
        // paths containing an apostrophe.
        return `<div class="cmd-autocomplete-item at-item${i === 0 ? " ac-selected" : ""}" data-path="${escapeAttrValue(p)}" title="${escapeAttrValue(p)}">${isDir ? "📁" : "📄"} ${escapeHtml(p)}</div>`;
    }).join("");
    atAutocompleteEl.querySelectorAll(".at-item").forEach(el =>
        el.addEventListener("mousedown", e => { e.preventDefault(); commitAtSelection(el.dataset.path); })
    );
    atAutocompleteEl.classList.add("open");
}

function showAtIndexing() {
    atIndex = -1;
    atAutocompleteEl.innerHTML = `<div class="cmd-autocomplete-item at-loading">${t("at.indexing")}</div>`;
    atAutocompleteEl.classList.add("open");
}

function hideAtAutocomplete() {
    atAutocompleteEl.classList.remove("open");
    atMentionStart = -1;
    atIndex = -1;
}

function moveAtSelection(delta) {
    const items = atAutocompleteEl.querySelectorAll(".at-item");
    if (items.length === 0) return;
    atIndex = Math.max(0, Math.min(items.length - 1, atIndex + delta));
    items.forEach((el, i) => el.classList.toggle("ac-selected", i === atIndex));
    items[atIndex].scrollIntoView({ block: "nearest" });
}

// Replaces the typed "@query" with "@<relative-path>". A file gets a trailing
// space and closes the popup; a folder stays open so the user keeps drilling.
function commitAtSelection(path) {
    if (!path) { hideAtAutocomplete(); return; }
    const caret = textarea.selectionStart;
    if (atMentionStart < 0 || caret < atMentionStart) { hideAtAutocomplete(); return; }

    const isDir = path.endsWith("/");
    const insert = "@" + path + (isDir ? "" : " ");
    const val = textarea.value;
    textarea.value = val.slice(0, atMentionStart) + insert + val.slice(caret);
    const pos = atMentionStart + insert.length;
    textarea.setSelectionRange(pos, pos);
    textarea.focus();
    updateTokenEstimate();

    if (isDir) updateAtMention();
    else hideAtAutocomplete();
}

// Any mousedown inside the popup (scrollbar, padding — not just the items)
// must not steal focus from the textarea: the blur handler below would close
// the picker mid-scroll (audit 2026-07-10 #2; same class as dliedke v58/#103).
atAutocompleteEl.addEventListener("mousedown", e => e.preventDefault());

// Clicking away from the composer closes the picker (mousedown inside the
// popup prevents default, so commits still land before this fires).
textarea.addEventListener("blur", () => setTimeout(hideAtAutocomplete, 150));

textarea.addEventListener("input", () => {
    const val = textarea.value;
    if (val.startsWith("/") && !val.includes(" ")) {
        showAutocomplete(val);
    } else {
        hideAutocomplete();
    }
    updateAtMention();
    updateTokenEstimate();
});

textarea.addEventListener("keydown", (e) => {
    // "@" file picker steals navigation/commit keys while open — before the
    // slash autocomplete and before Enter-sends.
    if (atAutocompleteEl.classList.contains("open")) {
        if (e.key === "ArrowDown") { e.preventDefault(); moveAtSelection(1); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); moveAtSelection(-1); return; }
        if (e.key === "Enter" || e.key === "Tab") {
            // Swallow the key regardless; only insert when entries are ready
            // (while "Indexing…" shows there is nothing to commit yet).
            e.preventDefault();
            const sel = atAutocompleteEl.querySelectorAll(".at-item")[atIndex >= 0 ? atIndex : 0];
            if (sel) commitAtSelection(sel.dataset.path);
            return;
        }
        if (e.key === "Escape") { hideAtAutocomplete(); return; }
    }

    const isOpen = autocompleteEl.classList.contains("open");
    const items = autocompleteEl.querySelectorAll(".cmd-autocomplete-item");

    if (isOpen) {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            acIndex = Math.min(acIndex + 1, items.length - 1);
            items.forEach((el, i) => el.classList.toggle("ac-selected", i === acIndex));
            items[acIndex]?.scrollIntoView({ block: "nearest" });
            return;
        }
        if (e.key === "ArrowUp") {
            e.preventDefault();
            acIndex = Math.max(acIndex - 1, 0);
            items.forEach((el, i) => el.classList.toggle("ac-selected", i === acIndex));
            items[acIndex]?.scrollIntoView({ block: "nearest" });
            return;
        }
        if (e.key === "Tab") {
            e.preventDefault();
            const el = items[acIndex >= 0 ? acIndex : 0];
            if (el) fillAutocomplete(el.dataset.cmd);
            return;
        }
        if (e.key === "Enter" && acIndex >= 0) {
            e.preventDefault();
            fillAutocomplete(items[acIndex].dataset.cmd);
            return;
        }
        if (e.key === "Escape") {
            hideAutocomplete();
            return;
        }
    }

    if (e.key === "Escape") {
        textarea.blur();
        window.chrome.webview.postMessage({ type: "unfocus" });
        return;
    }

    if (e.key === "ArrowUp" && e.ctrlKey && !isOpen) {
        e.preventDefault();
        if (historyIndex === -1) historyDraft = textarea.value;
        if (historyIndex < promptHistory.length - 1) {
            historyIndex++;
            textarea.value = promptHistory[historyIndex];
            updateTokenEstimate();
            updateHistoryHint();
        }
        return;
    }
    if (e.key === "ArrowDown" && e.ctrlKey && !isOpen) {
        e.preventDefault();
        if (historyIndex > 0) {
            historyIndex--;
            textarea.value = promptHistory[historyIndex];
        } else if (historyIndex === 0) {
            historyIndex = -1;
            textarea.value = historyDraft;
        }
        updateTokenEstimate();
        updateHistoryHint();
        return;
    }

    if (e.key === "Enter") {
        if (e.shiftKey) {
            if (sendEnterToggle.checked) return; // Shift+Enter = newline when send-on-enter is on
            e.preventDefault();
            sendMessage();
            return;
        }
        if (!sendEnterToggle.checked) return; // Enter = newline when send-on-enter is off
        e.preventDefault();
        hideAutocomplete();
        hideAtAutocomplete();
        sendMessage();
    }

    if (e.ctrlKey && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        clearChat();
    }
});

// ── /model picker ─────────────────────────────────────────────
const modelList = [
    { id: "claude-sonnet-5-5",         label: "Sonnet 5.5" },
    { id: "claude-sonnet-5",           label: "Sonnet 5" },
    { id: "claude-sonnet-4-6",         label: "Sonnet 4.6" },
    { id: "claude-opus-5-5",           label: "Opus 5.5" },
    { id: "claude-opus-5",             label: "Opus 5" },
    { id: "claude-opus-4-8",           label: "Opus 4.8" },
    { id: "opusplan",                  label: "Opus Plan" },
    { id: "claude-fable-5-2",          label: "Fable 5.2" },
    { id: "claude-fable-5-1",          label: "Fable 5.1" },
    { id: "claude-fable-5",            label: "Fable 5" },
    { id: "claude-haiku-4-5",          label: "Haiku 4.5" },
];

function showModelPicker() {
    if (welcome) { welcome.remove(); welcome = null; }
    const current = modelSelect.value;
    const card = document.createElement("div");
    card.className = "question-card";
    card.innerHTML = `<div class="question-text">${t("model.choose")}</div>
        <div class="question-buttons" style="flex-wrap:wrap;gap:6px">
        ${modelList.map(m =>
            `<button class="q-btn${m.id === current ? " q-yes" : ""}" onclick="selectModel('${m.id}',this.closest('.question-card'))">${escapeHtml(m.label)}</button>`
        ).join("")}
        </div>`;
    messages.appendChild(card);
    autoScroll();
}

function selectModel(id, card) {
    modelSelect.value = id;
    const label = modelSelect.options[modelSelect.selectedIndex]?.text || id;
    card.innerHTML = `<div class="question-text">🤖 Model: <strong>${escapeHtml(label)}</strong></div>`;
    card.classList.add("question-answered");
    // Setting .value programmatically doesn't fire the change event — dispatch
    // it so caption, transcript divider and the titlebar button all update.
    modelSelect.dispatchEvent(new Event("change"));
}

// ── Drag & drop ───────────────────────────────────────────────
const binaryExts = new Set(["png","jpg","jpeg","gif","bmp","ico","webp","tiff",
    "pdf","zip","rar","7z","tar","gz","exe","dll","bin","dat","pdb","mp3","mp4","wav","avi","mov"]);

const composerEl = document.querySelector(".composer");

composerEl.addEventListener("dragover", e => {
    e.preventDefault();
    composerEl.classList.add("drag-over");
});

composerEl.addEventListener("dragleave", e => {
    if (!composerEl.contains(e.relatedTarget))
        composerEl.classList.remove("drag-over");
});

composerEl.addEventListener("drop", e => {
    e.preventDefault();
    composerEl.classList.remove("drag-over");
    for (const file of e.dataTransfer.files) handleDroppedFile(file);
});

function handleDroppedFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    if (binaryExts.has(ext)) {
        const reader = new FileReader();
        reader.onload = ev => {
            const base64 = ev.target.result.split(",")[1];
            window.chrome.webview.postMessage({ type: "save-dropped-file", filename: file.name, data: base64 });
        };
        reader.readAsDataURL(file);
    } else {
        const reader = new FileReader();
        reader.onload = ev => {
            const content = `[${file.name}]\n\`\`\`\n${ev.target.result}\n\`\`\``;
            addAttachment(file.name, content, false, null);
        };
        reader.readAsText(file);
    }
}

// ── Clipboard paste (Ctrl+V) ─────────────────────────────────
// Always routes through C# — it decides whether it's a file, image, or text
textarea.addEventListener("paste", e => {
    e.preventDefault();
    window.chrome.webview.postMessage({ type: "get-clipboard-files" });
});

function sendMessage() {
    // A send while a turn is in flight goes to _sendQueue and waits for that
    // turn's stream-done: firing it straight at the agent would trample the
    // transcript (D7 validation 2026-07-16).
    _userScrolledUp = false;
    const text = textarea.value.trim();
    pushPromptHistory(text);
    historyIndex = -1;
    updateHistoryHint();
    const activeAttachments = [...attachments.values()];

    if (text === "/model") {
        textarea.value = "";
        showModelPicker();
        return;
    }

    if (text === "/plugin" || text === "/plugins") {
        textarea.value = "";
        openPluginsModal();
        return;
    }

    if (!text && activeAttachments.length === 0)
        return;

    let fullMessage = text;
    const filePaths = [];

    for (const att of activeAttachments) {
        if (!att.includeFile) continue;
        if (att.content) {
            fullMessage += "\n\n" + att.content;
        } else if (att.filePath) {
            filePaths.push(att.filePath);
        }
    }

    if (filePaths.length > 0)
        fullMessage += "\n\nFiles attached:\n" + filePaths.map(p => `  - ${p}`).join("\n");

    // Close pending unconfirmed cards
    for (const [id, att] of attachments) {
        if (!att.includeFile) {
            const card = document.getElementById(`q-card-${id}`);
            if (card) {
                card.innerHTML = `<div class="question-text">📎 <strong>${escapeHtml(att.displayName)}</strong> — ${t("msg.notSent")}</div>`;
                card.classList.add("question-answered");
            }
        }
    }

    attachments.clear();
    attachmentsEl.innerHTML = "";
    textarea.value = "";
    updateTokenEstimate();

    // Every send goes through the queue; it leaves at once unless a turn runs.
    _sendQueue.push({ text, attachments: activeAttachments, fullMessage });
    drainSendQueue();
}

// ── Send queue: messages sent while a turn is in flight ──────────────────
// Held here and sent one per turn after stream-done, so each still runs the
// host's pre-flight gates + ide_selection capture and lands in the JSONL as a
// real user entry. (The CLI can fold a mid-turn message into the running turn
// itself, but stores it as a queued_command attachment — invisible to History
// replay and the ⎇/⟲ ordinals.)
const _sendQueue = [];
// Set by ■ until the cancel's own stream-done arrives. Meanwhile sends wait in
// the queue (that late stream-done would otherwise end the turn just started);
// when it lands, the next queued message goes out (VS Code behaviour).
let _awaitingCancelDone = false;
// Numbers each chat sent to the host; stream-done echoes it. A cancel racing
// the natural end of a turn yields two stream-dones for that turn — the second
// must not end the queued turn sent in between.
let _turnSeq = 0;
const sendQueueEl = document.getElementById("send-queue");

function renderSendQueue() {
    sendQueueEl.replaceChildren(..._sendQueue.map(item => {
        const chip = document.createElement("div");
        chip.className = "attachment-chip send-queue-item";
        const label = document.createElement("span");
        label.className = "send-queue-label";
        label.textContent = t("queue.label");
        const body = document.createElement("span");
        body.className = "send-queue-text";
        body.textContent = body.title = item.text || item.attachments.map(a => a.displayName).join(", ");
        const rm = document.createElement("button");
        rm.className = "attachment-remove";
        rm.title = t("queue.remove");
        rm.textContent = "×";
        rm.addEventListener("click", () => {
            const i = _sendQueue.indexOf(item);
            if (i >= 0) _sendQueue.splice(i, 1);
            renderSendQueue();
        });
        chip.append(label, body, rm);
        return chip;
    }));
}

function drainSendQueue() {
    if (isStreaming || _awaitingCancelDone || !_sendQueue.length) { renderSendQueue(); return; }
    const next = _sendQueue.shift();
    renderSendQueue();
    dispatchMessage(next.text, next.attachments, next.fullMessage);
}

// The turn ended without completing (■ cancel, a pre-flight gate) or the view
// moved to another session: hand queued messages back to the composer rather
// than sending them somewhere the user did not expect. Nothing is lost.
function restoreSendQueue() {
    if (!_sendQueue.length) return;
    const items = _sendQueue.splice(0);
    renderSendQueue();
    textarea.value = [...items.map(q => q.text), textarea.value.trim()].filter(Boolean).join("\n\n");
    for (const q of items)
        for (const a of q.attachments)
            if (a.includeFile) addAttachment(a.displayName, a.content, a.content == null, a.filePath);
    updateTokenEstimate();
    showToast(t("queue.restored"));
}

function dispatchMessage(text, activeAttachments, fullMessage) {
    // #7: only one turn is ever in flight (later sends wait in _sendQueue),
    // so a single pending reference is enough.
    _pendingUserAckBubble = addMessage("user", text || `(${activeAttachments.map(a => a.displayName).join(", ")})`);
    // Remember which user bubble opened this turn — if the turn spawns a fresh
    // (non-resumed) session, it becomes the new rewind base.
    _turnUserIdx = userMsgCounter - 1;

    if (window.chrome?.webview) {
        setStreaming(true);
        addLoading();
        perfStartTurn();
        window.chrome.webview.postMessage({
            type: "chat",
            turnSeq: ++_turnSeq,
            perfMetrics: _perfEnabled,
            remoteControl: remoteControlEnabled(),
            text: fullMessage,
            model: modelSelect.value,
            effort: effortSelect.value || null,
            permissionMode: permissionSelect.value,
            workingDirectory: getWorkingDirOverride() || null,
            cliPath: getCliPath(),
            maxBudgetUsd: getMaxBudget(),
            fallbackModel: getFallbackModel(),
            // After clearChat / reset-chat, the next send must NOT resume. Otherwise
            // claude.exe gets --continue and reuses the previous session instead of
            // creating a fresh one (turn count keeps going up in the old row).
            autoResume: _suppressNextAutoResume ? false : localStorage.getItem("autoResume") === "true",
            autoSave: autoSaveValues[+autoSaveSlider.value],
            // V7 claude settings (default ON; only deviations affect the spawn).
            coAuthoredBy: localStorage.getItem("coAuthoredBy") !== "false",
            autoCompact: localStorage.getItem("autoCompact") !== "false",
            cleanupPeriodDays: (() => { const v = parseInt(localStorage.getItem("cleanupPeriodDays") || "", 10); return Number.isNaN(v) || v < 1 ? null : v; })(),
            // V6 permission rules — evaluated per-turn by the agent's pipe and
            // written to the generated settings.json for new sessions.
            permissionAllow: getPermRules().allow,
            permissionAsk: getPermRules().ask,
            permissionDeny: getPermRules().deny,
            // 0 = wait for the answer (default). A stored value only exists once
            // the user picks a finite timeout in ⚙ → Permissions.
            permissionTimeoutMinutes: (() => { const v = parseInt(localStorage.getItem("permissionTimeoutMinutes") || "0", 10); return Number.isNaN(v) || v < 0 ? 0 : v; })()
        });
        _suppressNextAutoResume = false;
    }
}

function addMessage(role, text) {

    if (welcome) {
        welcome.remove();
    }

    const message = document.createElement("div");
    message.className = `message ${role}`;

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    message.appendChild(bubble);

    // If the message contains a code fence (e.g. snippets inserted via Send
    // Selection, or pasted markdown), render it so the user sees a real code
    // block instead of raw backticks. Plain text falls back to escapeHtml.
    if (text && text.includes("```")) {
        applyMarkdown(bubble, text);
        // Apply only makes sense for the assistant's own suggestion, so it's
        // stripped on the user side. Copy stays on both: a snippet the user
        // pasted into their own message is just as often what they want back.
        if (role === "user") {
            bubble.querySelectorAll(".apply-btn").forEach(b => b.remove());
        }
    } else {
        bubble.innerHTML = escapeHtml(text);
    }

    messages.appendChild(message);
    decorateMessage(message);

    autoScroll();
    return message;
}

// ── Perf metrics (⚙ toggle, default off) ────────────────────────────────────
// Per turn: send→first chunk, message counts, time spent in the message
// handler, long tasks and janky frames. Durations and counts only — no text.
let _perfEnabled = localStorage.getItem("perfMetrics") === "true";
const perfToggle = document.getElementById("perfmetrics-toggle");
if (perfToggle) perfToggle.checked = _perfEnabled;
function setPerfMetrics(checked) {
    _perfEnabled = !!checked;
    localStorage.setItem("perfMetrics", _perfEnabled);
    if (_perfEnabled && _agentEndpoint && !_agentSocket) connectAgentSocket(_agentEndpoint.port, _agentEndpoint.token, _agentEndpoint.epoch);
    if (!_perfEnabled && _agentSocket) { const ws = _agentSocket; _agentSocket = null; try { ws.close(); } catch (_) { } }
}
let _perf = null;

function perfStartTurn() {
    if (!_perfEnabled) { _perf = null; return; }
    const p = _perf = { t0: performance.now(), ttfcMs: 0, msgs: 0, wsMsgs: 0, chunkMsgs: 0, chunkChars: 0,
        handlerMs: 0, handlerMaxMs: 0, slowHandlers: 0, longTasks: 0, longTaskMs: 0,
        frames: 0, jankFrames: 0, maxFrameGapMs: 0, lastFrame: 0 };
    // Frame gaps are where-the-work-happens agnostic (handler, rAF, layout),
    // so they stay comparable after rendering moves into rAF (step 6).
    const frame = ts => {
        if (_perf !== p) return;
        if (p.lastFrame) {
            const gap = ts - p.lastFrame;
            p.frames++;
            if (gap > 33) p.jankFrames++;
            if (gap > p.maxFrameGapMs) p.maxFrameGapMs = gap;
        }
        p.lastFrame = ts;
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
}

function perfNote(data, ms, viaSocket) {
    const p = _perf;
    if (!p) return;
    p.msgs++;
    if (viaSocket) p.wsMsgs++;
    p.handlerMs += ms;
    if (ms > p.handlerMaxMs) p.handlerMaxMs = ms;
    if (ms > 16) p.slowHandlers++;
    if (data.type === "chunk") {
        p.chunkMsgs++;
        p.chunkChars += (data.text || "").length;
        if (!p.ttfcMs) p.ttfcMs = performance.now() - p.t0;
    }
    if (data.type === "stream-done" && (data.turnSeq == null || data.turnSeq === _turnSeq)) {
        _perf = null;
        const { t0, lastFrame, ...metrics } = p;
        metrics.turnMs = performance.now() - t0;
        try { window.chrome.webview.postMessage({ type: "perf-ui", metrics }); } catch (_) { }
    }
}

try {
    new PerformanceObserver(list => {
        if (!_perf) return;
        for (const e of list.getEntries()) { _perf.longTasks++; _perf.longTaskMs += e.duration; }
    }).observe({ type: "longtask" });
} catch (_) { /* longtask unsupported */ }

// ── Direct agent socket (WebSocket transport) ───────────────────────────────
// Step 1 prototype: connect, authenticate, ping round trip. Streaming moves
// here in step 2. Until then it only runs with ⚙ Performance metrics on (it
// measures the round trip). The token is never logged.
let _agentSocket = null;
let _agentEpoch = 0;
let _agentEndpoint = null; // last agent-endpoint, so switching metrics on can connect

function connectAgentSocket(port, token, epoch) {
    if (!_perfEnabled) return;
    if (epoch < _agentEpoch || (epoch === _agentEpoch && _agentSocket)) return; // stale or duplicate
    _agentEpoch = epoch;
    if (_agentSocket) { try { _agentSocket.close(); } catch (_) { } }
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    _agentSocket = ws;
    let pingAt = 0;
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token }));
    ws.onmessage = ev => {
        if (ws !== _agentSocket) return; // an older epoch's socket
        let data;
        try { data = JSON.parse(ev.data); } catch (_) { return; }
        if (data.type === "ws-hello") { pingAt = performance.now(); ws.send(JSON.stringify({ type: "ping" })); return; }
        if (data.type === "pong") { console.log(`[ws] epoch ${epoch}: connected, round trip ${(performance.now() - pingAt).toFixed(1)} ms`); return; }
    };
    ws.onclose = ev => {
        if (ws !== _agentSocket) return;
        _agentSocket = null;
        console.log(`[ws] epoch ${epoch}: closed (code ${ev.code})`);
    };
}

window.chrome.webview.addEventListener("message", event => {
    if (!_perf) return handleHostMessage(event);
    const t = performance.now();
    handleHostMessage(event);
    perfNote(event.data, performance.now() - t, false);
});

function handleHostMessage(event) {

    if (event.data.type === "agent-endpoint") {
        _agentEndpoint = { port: event.data.port, token: event.data.token, epoch: event.data.epoch };
        connectAgentSocket(_agentEndpoint.port, _agentEndpoint.token, _agentEndpoint.epoch);
        return;
    }

    if (event.data.type === "focus") {
        textarea.focus();
        textarea.select();
        return;
    }

    if (event.data.type === "version") {
        const el = document.querySelector(".about-meta");
        if (el) el.textContent = `v${event.data.text} · wluisdev`;
        return;
    }

    if (event.data.type === "theme") {
        // Remember the VS-detected theme; override (if not "auto") wins via
        // applyThemeOverride, but we keep _lastVsIsDark so switching back to
        // "auto" later snaps to the current VS palette without waiting for a
        // new VS theme event.
        _lastVsIsDark = event.data.isDark;
        applyThemeOverride();
        return;
    }

    if (event.data.type === "account-info") {
        _accountInfo = event.data;
        renderAccountInfo();
        return;
    }

    if (event.data.type === "cwd-info") {
        const prevVsPath = _cwdVsPath;
        renderCwd(event.data.path || "");
        // Workspace identity is now known: migrate the legacy global override
        // (one-shot) and point the settings input at this workspace's entry.
        migrateLegacyWorkingDir();
        syncWorkingDirInput();
        // Workspace changed → the @ picker's file index belongs to the old one,
        // and the "/" autocomplete's discovered commands too.
        if (_cwdVsPath !== prevVsPath) atEntries = null;
        try { window.chrome.webview.postMessage({ type: "get-slash-commands" }); } catch (e) {}
        return;
    }

    if (event.data.type === "trust-required") {
        _workspaceTrusted = false;
        renderCwd();
        openTrustModal(
            event.data.path || "",
            event.data.parent || "",
            event.data.parentIsBlocked === true,
            event.data.riskWarning || null);
        return;
    }

    if (event.data.type === "no-workspace") {
        showNoWorkspaceCard(event.data.path || "");
        return;
    }

    if (event.data.type === "auth-required") {
        showAuthRequiredCard(event.data.detail || "");
        return;
    }

    if (event.data.type === "context-full") {
        showContextFullCard(event.data.detail || "");
        return;
    }

    if (event.data.type === "credits-required") {
        showCreditsRequiredCard(event.data.detail || "");
        return;
    }

    if (event.data.type === "claude-not-found") {
        showClaudeNotFoundCard(event.data.detail || "");
        return;
    }

    if (event.data.type === "claude-login-started") {
        openSigninOverlay();
        return;
    }

    if (event.data.type === "claude-login-completed") {
        closeSigninOverlay();
        return;
    }

    if (event.data.type === "workspace-trusted") {
        _workspaceTrusted = true;
        renderCwd();
        closeTrustModal();
        return;
    }

    if (event.data.type === "workspace-untrusted") {
        _workspaceTrusted = false;
        renderCwd();
        return;
    }

    if (event.data.type === "trusted-workspaces-list") {
        renderTrustedWorkspacesList(event.data.paths || []);
        return;
    }

    if (event.data.type === "open-trusted-workspaces-modal") {
        openTrustedWorkspacesModal();
        return;
    }

    if (event.data.type === "mcp-trust-required") {
        const overlay = document.getElementById("mcp-trust-modal-overlay");
        if (overlay && overlay.classList.contains("open")) {
            // Modal already open from an earlier scan — merge new servers in
            // (e.g. project scope that resolved later than user scope) instead
            // of nuking the current state.
            mergeMcpTrustModal(event.data.servers || []);
        } else {
            openMcpTrustModal(event.data.servers || []);
        }
        return;
    }

    if (event.data.type === "mcp-trust-completed") {
        closeMcpTrustModal();
        return;
    }

    // (renderCwd also picks up changes from setWorkingDirectory/clearWorkingDirectory
    // below; those handlers call renderCwd() with no argument so the cached vsPath
    // is preserved and only the override layer flips.)

    if (event.data.type === "toast") {
        showToast(event.data.text || "");
        return;
    }

    if (event.data.type === "history") {
        renderHistory(event.data.sessions, event.data.scope, event.data.workspace);
        return;
    }

    if (event.data.type === "session-deleted") {
        const item = document.querySelector(`.history-item[data-session-id="${event.data.sessionId}"]`);
        if (item) item.remove();
        return;
    }

    if (event.data.type === "session-info") {
        const newId = event.data.sessionId;
        // Fresh session mid-chat (no resume/--continue): everything above the
        // current turn is unreachable for ⟲ — anchor the rewind base at the
        // message that opened this session.
        if (currentSessionId && newId !== currentSessionId && !event.data.resumed)
            _rewindBaseUserIdx = _turnUserIdx;
        currentSessionId = newId;
        return;
    }

    if (event.data.type === "branched") {
        renderBranchedMessages(event.data.sessionId, event.data.messages || [], event.data.model,
            event.data.lastTurnAt, event.data.contextTokens, event.data.cacheTtlMin);
        hideResumeOverlay();
        return;
    }

    if (event.data.type === "diff") {
        renderDiff(event.data.stat, event.data.diff);
        return;
    }

    if (event.data.type === "rewind-preview") {
        showRewindConfirm(event.data.msgIndex, event.data.result || {});
        return;
    }

    if (event.data.type === "rewind-done") {
        showToast(t("rewind.done"));
        return;
    }

    if (event.data.type === "rewind-error") {
        showToast(event.data.message || t("rewind.failed"));
        return;
    }

    if (event.data.type === "attach-file") {
        addAttachment(event.data.filename, event.data.content, event.data.isBinary, event.data.filePath);
        return;
    }

    if (event.data.type === "insert-text") {
        insertAtCursor(event.data.text);
        return;
    }

    if (event.data.type === "editor-action") {
        runEditorAction(event.data.instruction, event.data.text);
        return;
    }

    if (event.data.type === "chunk") {
        if (isUsageCapture) {
            usageBuffer += event.data.text;
            document.getElementById("usage-raw").textContent = usageBuffer;
        } else {
            appendChunk(event.data.text);
        }
        return;
    }

    if (event.data.type === "tokens") {
        appendTokens(event.data.text);
        return;
    }

    if (event.data.type === "cost-warning") {
        showCostWarning(event.data.text, event.data.blocked === true);
        return;
    }

    if (event.data.type === "cost-limits") {
        const s = event.data.sessionLimit;
        const d = event.data.dailyLimit;
        if (s != null) document.getElementById("cost-session-input").value = formatCost(s);
        if (d != null) document.getElementById("cost-daily-input").value = formatCost(d);
        document.getElementById("cost-block-toggle").checked = !!event.data.block;
        localStorage.setItem("costBlock", !!event.data.block);
        return;
    }

    if (event.data.type === "timing") {
        appendTiming(event.data.text);
        return;
    }

    if (event.data.type === "stream-done") {
        if (event.data.turnSeq != null && event.data.turnSeq !== _turnSeq) return; // an older turn's
        // Turn over: clear any stale pending marker (cancel/dismiss paths skip
        // the modal close hooks); flag "done" only when the window is hidden.
        setCaptionAttention(_toolWindowVisible ? null : "done");
        refreshStatusLine();
        if (isUsageCapture) isUsageCapture = false;
        removeLoading();
        removeLiveTimer();
        if (currentStreamBubble) {
            finalizeBubbleStream(currentStreamBubble);
            currentStreamBubble = null;
        }
        flushPinnedDock();
        renderPresence("", ""); // safety: no waiting state can outlive the turn
        // Queued permission requests die with the turn (their hooks are gone) —
        // popping one later would show a modal nobody is listening to.
        permissionQueue = [];
        setStreaming(false);
        // #7 safety: no ack can outlive the turn either (cancel, or an older
        // CLI that silently ignores --replay-user-messages).
        _pendingUserAckBubble = null;
        // Queued sends: a completed turn — or a ■ with messages waiting — hands
        // over to the next queued one; a pre-flight gate returns them to the
        // composer. Deferred so perfNote closes THIS turn's metrics first.
        clearRunningAgents();
        if (event.data.completed || _awaitingCancelDone) {
            if (event.data.completed) refreshContextRing();
            _awaitingCancelDone = false;
            setTimeout(drainSendQueue, 0);
        } else restoreSendQueue();
        return;
    }

    if (event.data.type === "tool_use" || event.data.type === "tool_result" || event.data.type === "tool_error") {
        appendToolEvent(event.data.type, event.data.name || "", event.data.input, event.data.text || "", event.data.id);
        trackAgentTool(event.data.type, event.data.name || "", event.data.input, event.data.id);
        return;
    }

    if (event.data.type === "tool_files") {
        renderToolFiles(event.data.id, event.data.text || "", event.data.name);
        return;
    }

    if (event.data.type === "tokens-live") {
        updateLiveTokens(event.data.text || "");
        return;
    }

    if (event.data.type === "thinking-status") {
        renderPresence(event.data.status === "start" ? "thinking" : "", "");
        return;
    }

    if (event.data.type === "user-ack") {
        if (_pendingUserAckBubble && document.body.contains(_pendingUserAckBubble)) {
            _pendingUserAckBubble.classList.add("msg-delivered");
        }
        _pendingUserAckBubble = null;
        return;
    }

    if (event.data.type === "rate-limit") {
        try {
            const info = JSON.parse(event.data.text || "{}");
            const status = info.status || "unknown";
            if (status !== _lastRateLimitStatus) {
                _lastRateLimitStatus = status;
                const resetStr = info.resetsAt ? new Date(info.resetsAt * 1000).toLocaleString() : "";
                const overage = info.isUsingOverage ? t("rateLimit.overage") : "";
                showToast(t("rateLimit.toast", { status, overage, reset: resetStr ? t("rateLimit.resets", { time: resetStr }) : "" }));
            }
        } catch (e) { /* unexpected shape — skip rather than show garbage */ }
        return;
    }

    if (event.data.type === "model-used") {
        noteModelFallback(event.data.text || "");
        return;
    }

    if (event.data.type === "compacting") {
        renderPresence(event.data.text === "start" ? "compacting" : "", "");
        return;
    }

    if (event.data.type === "compact-boundary") {
        try {
            const meta = JSON.parse(event.data.text || "{}");
            const pre = fmtTokens(meta.pre_tokens || 0);
            const post = fmtTokens(meta.post_tokens || 0);
            insertOrUpdateModelDivider(t("compact.done", { pre, post }));
        } catch (e) { /* unexpected shape — skip rather than show garbage */ }
        return;
    }

    if (event.data.type === "subagent-thinking" || event.data.type === "subagent-text" ||
        event.data.type === "subagent-tool_use" || event.data.type === "subagent-tool_result" ||
        event.data.type === "subagent-tool_error") {
        renderSubagentEvent(event.data);
        return;
    }

    if (event.data.type === "budget-exceeded") {
        showToast(`💸 ${event.data.detail || t("budget.reached")}`);
        return;
    }

    if (event.data.type === "system-info") {
        appendSystemInfo(event.data.text || "");
        return;
    }

    if (event.data.type === "permission_request") {
        queuePermissionRequest(event.data.tool || "", event.data.input || "", event.data.id || "", event.data.cwd || "");
        return;
    }

    if (event.data.type === "permission_resolved") {
        retractPermissionRequest(event.data.id || "", event.data.reason || "");
        return;
    }

    if (event.data.type === "visibility-changed") {
        _toolWindowVisible = !!event.data.visible;
        if (_toolWindowVisible && _captionAttention === "done") setCaptionAttention(null);
        return;
    }

    if (event.data.type === "context-usage") {
        updateContextRing(event.data.usage);
        renderContextUsageCard(event.data.usage || null, event.data.error || null);
        return;
    }

    if (event.data.type === MsgType.RemoteControlResult) {
        onRemoteControlResult(event.data.text, event.data.error);
        return;
    }

    if (event.data.type === MsgType.RemoteState) {
        onRemoteState(event.data.text);
        return;
    }

    if (event.data.type === "doctor-result") {
        renderDoctorCard(event.data.output || "", event.data.error || null);
        return;
    }

    if (event.data.type === "mcp-status") {
        renderMcpStatusCard(event.data.servers || null, event.data.error || null);
        return;
    }

    if (event.data.type === "side-question-answer") {
        renderSideQuestionAnswer(event.data.answer || null, event.data.error || null);
        return;
    }

    if (event.data.type === "build-errors") {
        onBuildErrors(event.data);
        return;
    }

    if (event.data.type === "mcp-reconnect-done") {
        // Refresh the open card so the row reflects the post-reconnect state.
        if (event.data.error && _pendingMcpCard) {
            const btn = _pendingMcpCard.querySelector(`.mcp-status-row[data-server="${CSS.escape(event.data.server || "")}"] .mcp-reconnect-btn`);
            if (btn) { btn.disabled = false; btn.textContent = t("mcp.reconnect"); }
        }
        try { window.chrome.webview.postMessage({ type: "get-mcp-status" }); } catch (e) {}
        return;
    }

    if (event.data.type === PluginMsg.Data) { onPluginsData(event.data); return; }
    if (event.data.type === PluginMsg.Result) { onPluginsResult(event.data); return; }

    if (event.data.type === "slash-commands") {
        renderSlashCommands(event.data.project || [], event.data.user || [],
            event.data.projectSkills || [], event.data.userSkills || [], event.data.cli || null);
        return;
    }

    if (event.data.type === "presence-status") {
        renderPresence(event.data.status || "", event.data.waitingFor || "");
        return;
    }

    if (event.data.type === "workspace-files") {
        atEntries = event.data.files || [];
        atEntriesBuiltAt = Date.now();
        atEntriesLoading = false;
        clearTimeout(_atLoadingTimeout);
        // If the picker is waiting ("Indexing workspace…") or open on a stale
        // list, re-render for the token currently under the caret.
        if (atMentionStart >= 0) updateAtMention();
        return;
    }

    if (event.data.type === "status-line") {
        const bar = document.getElementById("statusbar");
        const full = (event.data.text || "").trim();
        if (!full || !(localStorage.getItem("statusLineCommand") || "").trim()) {
            bar.style.display = "none";
            return;
        }
        document.getElementById("statusbar-text").textContent = full.split("\n")[0];
        bar.title = full;
        bar.style.display = "";
        return;
    }

    if (event.data.type === "reset-chat") {
        // Triggered by solution open/close from C# side. Same UX as the user
        // clicking the ✎ button, minus posting "clear" back (backend already reset).
        resetContextRing();
        clearRunningAgents();
        remoteControlSessionEnded();
        applyNewChatPermissionMode();
        messages.innerHTML = `
            <div class="welcome">
                <div class="hero"><span class="logo">✺</span> Claude Code Studio</div>
                <div class="bot">🤖</div>
            </div>`;
        welcome = messages.querySelector(".welcome");
        textarea.value = "";
        sessionIn = 0;
        sessionOut = 0;
        msgCounter = 0;
        userMsgCounter = 0;
        currentSessionId = null;
        _rewindBaseUserIdx = 0;
        _turnUserIdx = 0;
        updateUsageSessionValues();
        _suppressNextAutoResume = true;
        permissionQueue = [];
        _sendQueue.length = 0;
        renderSendQueue();
        return;
    }

    if (event.data.type === "git-baseline-response") {
        const pending = pendingGitBaselineRequests.get(event.data.requestId);
        if (pending) {
            pendingGitBaselineRequests.delete(event.data.requestId);
            pending({ content: event.data.content || null, error: event.data.error || null });
        }
        return;
    }
}

let pendingPermissionToolId = null;
let pendingPermissionToolName = null;
// Parallel tool calls fire overlapping permission_requests; the modal is
// single, and the second used to clobber the first — whose hook then blocked
// claude until the 3-minute pipe timeout (rodada 12). FIFO: one modal at a
// time, the rest wait; each answered/dismissed request pops the next.
let permissionQueue = [];

function queuePermissionRequest(tool, input, id, cwd) {
    if (pendingPermissionToolId) {
        permissionQueue.push({ tool, input, id, cwd });
        // Mark the chip as pending right away so the wait is visible.
        if (id) {
            const chip = messages.querySelector(`.tool-chip[data-tool-id="${CSS.escape(id)}"]`);
            if (chip) chip.classList.add("tool-pending");
        }
        return;
    }
    openPermissionModal(tool, input, id, cwd);
}

function openPermissionModal(tool, input, id, cwd) {
    pendingPermissionToolId = id;
    pendingPermissionToolName = tool;
    setCaptionAttention("pending");
    document.getElementById("perm-modal-tool").textContent = tool;

    if (id) {
        const chip = messages.querySelector(`.tool-chip[data-tool-id="${CSS.escape(id)}"]`);
        if (chip) chip.classList.add("tool-pending");
    }

    const cwdRow = document.getElementById("perm-modal-cwd");
    const cwdPath = document.getElementById("perm-modal-cwd-path");
    if (cwd) {
        cwdPath.textContent = cwd;
        cwdRow.hidden = false;
    } else {
        cwdPath.textContent = "";
        cwdRow.hidden = true;
    }

    const inputContainer = document.getElementById("perm-modal-input");
    let formatted = input;
    let isPlan = false;
    if (tool === "ExitPlanMode") {
        // Plan approval gate: show the plan markdown itself, not escaped JSON.
        // Render it as Markdown for proper formatting and readability.
        document.getElementById("perm-modal-tool").textContent = t("perm.approvePlan");
        try { formatted = JSON.parse(input).plan || input; } catch (_) { /* leave as-is */ }
        isPlan = true;
    } else if (tool === "Skill") {
        // Skill gate: title the modal with the skill being invoked (official
        // extension pattern: "Use skill /name?").
        try {
            const parsed = JSON.parse(input);
            const s = String(parsed.skill || "").replace(/^\//, "");
            if (s) document.getElementById("perm-modal-tool").textContent = t("perm.useSkill", { skill: s });
            formatted = JSON.stringify(parsed, null, 2);
        } catch (_) { /* leave as-is */ }
    } else if (input) {
        try { formatted = JSON.stringify(JSON.parse(input), null, 2); }
        catch (_) { /* leave as-is */ }
    }
    if (isPlan && typeof marked !== "undefined") {
        inputContainer.innerHTML = marked.parse(formatted || t("perm.noInput"));
        // marked emits plain <a href>; rewire them like the chat does so a click
        // opens in the VS editor (workspace file refs) or the browser (external
        // links), never navigating the WebView away from the app to a dead page.
        inputContainer.querySelectorAll("a[href]").forEach(a => {
            const href = a.getAttribute("href") || "";
            if (/^(https?:|mailto:)/i.test(href)) {
                a.setAttribute("target", "_blank");
            } else {
                const fm = href.match(/^(.*?)(?:#L(\d+)(?:-L?(\d+))?)?$/);
                a.className = "file-link";
                a.dataset.path = fm[1] || href;
                a.dataset.start = fm[2] || "0";
                a.dataset.end = fm[3] || fm[2] || "0";
                a.setAttribute("href", "#");
                a.addEventListener("click", ev => { ev.preventDefault(); openFileLink(a); });
            }
        });
    } else {
        inputContainer.textContent = formatted || t("perm.noInput");
    }

    // A plan or a long input can be widened (drag handle on the right edge); a
    // plain permission with a short input stays a fixed width. Clear any width
    // dragged on a prior modal so each opens at its own default.
    const permModal = document.querySelector(".perm-modal");
    if (permModal) {
        const longInput = (formatted || "").length > 400;
        permModal.style.width = "";
        permModal.classList.toggle("perm-modal-plan", isPlan);
        permModal.classList.toggle("perm-modal-resizable", isPlan || longInput);
    }

    document.getElementById("perm-modal-overlay").classList.add("open");
    renderPresence("waiting", t("presence.permission"));
    // claude is blocked on our PreToolUse hook response — same as an
    // AskUserQuestion card, this shouldn't count as "working" time.
    pauseLiveTimer();
}

// The agent decided without us — timeout, cancel or shutdown. The request is
// already closed on its side, so answering it now would only earn a "no pending
// permission request for tool_use_id" on the next send (rodada 15, item 43.5).
// Take the modal down (or drop the queued entry) and say what happened.
function retractPermissionRequest(id, reason) {
    if (!id) return;

    if (pendingPermissionToolId === id) {
        closePermissionModal();
    } else {
        const i = permissionQueue.findIndex(p => p.id === id);
        if (i >= 0) permissionQueue.splice(i, 1);
    }

    const chip = messages.querySelector(`.tool-chip[data-tool-id="${CSS.escape(id)}"]`);
    if (chip) { chip.classList.remove("tool-pending"); chip.classList.add("tool-error"); }

    const div = document.createElement("div");
    div.className = "model-divider";
    div.innerHTML = `<span class="model-divider-label"></span>`;
    div.querySelector(".model-divider-label").textContent = t("perm.closed", { reason: reason || t("perm.closedNoAnswer") });
    messages.appendChild(div);
    autoScroll();
}

// Leaving a turn from an open permission modal is Deny + Cancel, deliberately:
// denying executes nothing and closes the overlay, which puts the composer's
// Cancel back within reach. A dedicated "stop the turn" button was tried and
// removed (rodada 17) — it had to clear the queue, abandon a pending request
// and lean on FailPending to clean up, all to save one click on paths that were
// already proven.
function closePermissionModal() {
    if (_captionAttention === "pending") setCaptionAttention(null);
    renderPresence("", "");
    document.getElementById("perm-modal-overlay").classList.remove("open");
    document.querySelector("#perm-modal-overlay .perm-modal")?.classList.remove("perm-modal-nudge");
    if (pendingPermissionToolId) {
        const chip = messages.querySelector(`.tool-chip[data-tool-id="${CSS.escape(pendingPermissionToolId)}"]`);
        if (chip) chip.classList.remove("tool-pending");
    }
    pendingPermissionToolId = null;
    pendingPermissionToolName = null;
    const next = permissionQueue.shift();
    if (next) {
        // Another request is already queued — still blocked, so re-pause
        // immediately instead of letting the timer tick between modals.
        openPermissionModal(next.tool, next.input, next.id, next.cwd);
    } else {
        resumeLiveTimer();
    }
}

function permissionAllow() {
    if (!pendingPermissionToolId) { closePermissionModal(); return; }
    const wasPlanApproval = pendingPermissionToolName === "ExitPlanMode";
    window.chrome.webview.postMessage({
        type: "permission-response",
        toolUseId: pendingPermissionToolId,
        allow: true,
        reason: null
    });
    closePermissionModal();

    // Approving a plan makes the CLI leave plan mode (it does NOT return to
    // planning on its own) — mirror that on the composer pill, or the next
    // send claims perm=plan while the session is really in default mode
    // (bloco 20 desync, validation 2026-07-18). Deny keeps everything in plan.
    if (wasPlanApproval && _permissionValue === PermissionModeValue.Plan) {
        setPermission(PermissionModeValue.Ask);
        const div = document.createElement("div");
        div.className = "model-divider";
        div.innerHTML = `<span class="model-divider-label"></span>`;
        div.querySelector(".model-divider-label").textContent = t("perm.planApproved");
        messages.appendChild(div);
        autoScroll();
    }
}

function permissionAllowSession() {
    if (!pendingPermissionToolId) { closePermissionModal(); return; }
    window.chrome.webview.postMessage({
        type: "permission-response",
        toolUseId: pendingPermissionToolId,
        allow: true,
        reason: null,
        allowSession: pendingPermissionToolName
    });
    closePermissionModal();
}

function permissionDeny(reason) {
    if (!pendingPermissionToolId) { closePermissionModal(); return; }
    // Plan rejection needs a message claude can act on, not "dismissed".
    if (pendingPermissionToolName === "ExitPlanMode")
        reason = "User rejected the plan — keep planning.";
    window.chrome.webview.postMessage({
        type: "permission-response",
        toolUseId: pendingPermissionToolId,
        allow: false,
        reason: reason || "denied by user"
    });
    closePermissionModal();
}

// A drag that starts inside a modal and is released over its overlay (the
// resize grip of the plan modal, a text selection) fires `click` on the
// overlay, their common ancestor, so `event.target === this` alone closed the
// modal mid-resize. Overlays only honour a click that also started on them.
let _overlayPressTarget = null;
document.addEventListener("mousedown", e => { _overlayPressTarget = e.target; }, true);

function overlayClicked(e, overlay) {
    return e.target === overlay && _overlayPressTarget === overlay;
}

// A click outside the permission modal used to deny the tool, so a slip next
// to the resize grip threw the plan away. It now only nudges the modal: the
// decision stays on the buttons (and Esc).
function nudgePermissionModal() {
    const modal = document.querySelector("#perm-modal-overlay .perm-modal");
    if (!modal) return;
    modal.classList.remove("perm-modal-nudge");
    void modal.offsetWidth; // restart the animation on repeated clicks
    modal.classList.add("perm-modal-nudge");
}

document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!document.getElementById("perm-modal-overlay").classList.contains("open")) return;
    e.stopPropagation();
    permissionDeny("dismissed");
}, true);

const tokensToggle = document.getElementById("tokens-toggle");
tokensToggle.checked = localStorage.getItem("showTokens") !== "false";

function setShowTokens(checked) {
    localStorage.setItem("showTokens", checked);
}

const cwdbarToggle = document.getElementById("cwdbar-toggle");
const _cwdbarVisible = localStorage.getItem("showCwdbar") !== "false";
cwdbarToggle.checked = _cwdbarVisible;
applyCwdbarVisibility(_cwdbarVisible);

function setShowCwdbar(checked) {
    localStorage.setItem("showCwdbar", checked);
    applyCwdbarVisibility(checked);
}

function applyCwdbarVisibility(visible) {
    const bar = document.getElementById("cwdbar");
    if (bar) bar.style.display = visible ? "" : "none";
}

// ── Token estimate ────────────────────────────────────────────
const tokenEstimateToggle = document.getElementById("token-estimate-toggle");
const tokenEstimateEl = document.getElementById("token-estimate");
tokenEstimateToggle.checked = localStorage.getItem("showTokenEstimate") === "true";

function setShowTokenEstimate(checked) {
    localStorage.setItem("showTokenEstimate", checked);
    updateTokenEstimate();
}

function estimateTokens(text) {
    if (!text) return 0;
    // Heuristic: if predominantly code (high symbol/whitespace ratio), use /3.5;
    // otherwise natural text, use /5
    const codeLike = (text.match(/[{}\[\]<>()=;:\/\\|@#$%^&*+\-_`"']/g) || []).length;
    const ratio = codeLike / text.length;
    const divisor = ratio > 0.08 ? 3.5 : 5;
    return Math.ceil(text.length / divisor);
}

function updateTokenEstimate() {
    if (!tokenEstimateToggle.checked) {
        tokenEstimateEl.textContent = "";
        return;
    }
    const tokens = estimateTokens(textarea.value);
    if (tokens === 0) { tokenEstimateEl.textContent = ""; return; }
    tokenEstimateEl.textContent = tokens >= 1000
        ? `~${(tokens / 1000).toFixed(1)}k tok`
        : `~${tokens} tok`;
}

const sendEnterToggle = document.getElementById("send-enter-toggle");
sendEnterToggle.checked = localStorage.getItem("sendWithEnter") !== "false";

function setSendWithEnter(checked) {
    localStorage.setItem("sendWithEnter", checked);
}

// Auto-resume
const autoResumeToggle = document.getElementById("auto-resume-toggle");
autoResumeToggle.checked = localStorage.getItem("autoResume") === "true";

function setAutoResume(checked) {
    localStorage.setItem("autoResume", checked);
}

// Auto-include attachments: skip the per-file "read this file?" card and send
// attached files straight through (opt-in — the user attached them).
const autoAttachToggle = document.getElementById("auto-attach-toggle");
if (autoAttachToggle) autoAttachToggle.checked = localStorage.getItem("autoIncludeAttachments") === "true";

function setAutoIncludeAttachments(checked) {
    localStorage.setItem("autoIncludeAttachments", checked);
}

// ── V17 status line ────────────────────────────────────────────
// User-configured command whose output shows in a slim bar under the header.
// Runs in the working directory; refreshed on boot, setting change, and after
// each turn (the turn may have changed git state).
const statusLineInput = document.getElementById("status-line-input");
if (statusLineInput) statusLineInput.value = localStorage.getItem("statusLineCommand") || "";

let _statusLineDebounce = null;
function setStatusLineCommand(value) {
    localStorage.setItem("statusLineCommand", value || "");
    clearTimeout(_statusLineDebounce);
    _statusLineDebounce = setTimeout(refreshStatusLine, 600);
}

function clearStatusLineCommand() {
    statusLineInput.value = "";
    setStatusLineCommand("");
}

function refreshStatusLine() {
    const command = (localStorage.getItem("statusLineCommand") || "").trim();
    if (!command) {
        document.getElementById("statusbar").style.display = "none";
        return;
    }
    try { window.chrome.webview.postMessage({ type: "run-status-line", text: command }); } catch (e) {}
}

window.addEventListener("DOMContentLoaded", refreshStatusLine);

// ── V6 permission rules ────────────────────────────────────────
// {allow:[], ask:[], deny:[]} of claude-style rule strings, persisted in
// localStorage and sent with every chat payload.
function getPermRules() {
    try {
        const r = JSON.parse(localStorage.getItem("permissionRules") || "{}");
        return { allow: r.allow || [], ask: r.ask || [], deny: r.deny || [] };
    } catch (e) { return { allow: [], ask: [], deny: [] }; }
}

function savePermRules(rules) {
    localStorage.setItem("permissionRules", JSON.stringify(rules));
}

function openPermRulesModal() {
    document.getElementById("settings-menu")?.classList.remove("open");
    const ex = document.getElementById("perm-rules-examples");
    if (ex) ex.open = localStorage.getItem("permRulesExamplesOpen") !== "false";
    for (const b of ["allow", "ask", "deny"]) showPermRuleError(b, null);
    renderPermRules();
    document.getElementById("perm-rules-overlay").classList.add("open");
}

function closePermRulesModal() {
    document.getElementById("perm-rules-overlay").classList.remove("open");
}

function renderPermRules() {
    const rules = getPermRules();
    for (const bucket of ["allow", "ask", "deny"]) {
        const list = document.getElementById(`perm-rules-${bucket}`);
        const items = rules[bucket];
        list.innerHTML = items.length === 0
            ? `<div class="perm-rules-empty">${t("rules.empty")}</div>`
            : items.map((r, i) =>
                `<div class="perm-rule-row"><span class="perm-rule-text">${escapeHtml(r)}</span>` +
                `<button type="button" class="perm-rule-remove" title="${t("common.remove")}" onclick="removePermRule('${bucket}',${i})">✕</button></div>`
            ).join("");
    }
}

// Examples fill the box instead of adding straight away: the interesting part of
// a rule is usually the specifier, and the user almost always wants to edit the
// command before committing it.
function fillPermRule(bucket, rule) {
    const input = document.getElementById(`perm-rules-input-${bucket}`);
    if (!input) return;
    showPermRuleError(bucket, null);
    input.value = rule;
    input.focus();
    input.select();
}

// Collapsed once the format is known — the examples are onboarding, not
// something to scroll past every visit. Kept open by default so a first-timer
// sees them without hunting.
function togglePermExamples(open) {
    localStorage.setItem("permRulesExamplesOpen", open ? "true" : "false");
}

// Mirrors the parser in PermissionPipeServer.SetRules. That parser only keeps
// rules whose regex matches, so anything malformed used to be accepted here,
// shown as a chip, and then silently dropped by the agent — a rule that looks
// active and does nothing. `PowerShell *` is the trap that surfaced it (rodada
// 18): the bare `*` is neither a specifier nor the end of the string.
// Hyphens and dots are legal in MCP server names (mcp__github-tools__search), so
// the tool part accepts them. Must stay in step with the parser in
// PermissionPipeServer.SetRules — a rule this accepts and that one rejects is a
// chip in the list that decides nothing.
const PERM_RULE_RE = /^[A-Za-z_][A-Za-z0-9_.-]*\s*(\(.*\))?$/;

function permRuleError(rule) {
    if (PERM_RULE_RE.test(rule)) return null;
    if (/^[A-Za-z_][A-Za-z0-9_.-]*\s+\S/.test(rule)) {
        const tool = rule.split(/\s+/)[0];
        return t("rules.errSpecifier", { fixed: `${tool}(${rule.slice(tool.length).trim()})`, tool });
    }
    return t("rules.errFormat");
}

function showPermRuleError(bucket, message) {
    const el = document.getElementById(`perm-rules-error-${bucket}`);
    if (!el) return;
    el.textContent = message || "";
    el.hidden = !message;
}

function addPermRule(bucket) {
    const input = document.getElementById(`perm-rules-input-${bucket}`);
    const rule = (input.value || "").trim();
    if (!rule) return;

    const problem = permRuleError(rule);
    if (problem) { showPermRuleError(bucket, problem); input.focus(); return; }
    showPermRuleError(bucket, null);
    const rules = getPermRules();
    if (!rules[bucket].includes(rule)) rules[bucket].push(rule);
    savePermRules(rules);
    input.value = "";
    renderPermRules();
}

function removePermRule(bucket, idx) {
    const rules = getPermRules();
    rules[bucket].splice(idx, 1);
    savePermRules(rules);
    renderPermRules();
}

// ── D3 notification sounds ─────────────────────────────────────
const soundInputToggle = document.getElementById("sound-input-toggle");
if (soundInputToggle) soundInputToggle.checked = localStorage.getItem("soundOnInput") === "true";
function setSoundOnInput(checked) { localStorage.setItem("soundOnInput", checked); }

const soundDoneToggle = document.getElementById("sound-done-toggle");
if (soundDoneToggle) soundDoneToggle.checked = localStorage.getItem("soundOnDone") === "true";
function setSoundOnDone(checked) { localStorage.setItem("soundOnDone", checked); }

// ── Build errors → agent (D11) ─────────────────────────────────
// The ⌘ item asks C# for the current Error List; a failing VS build posts the
// same build-errors message with auto:true. All policy lives here: the opt-in
// auto-send setting, a "same error set twice in a row" dedupe (breaks builds
// looping without progress), and never stepping on a turn in flight.
let _lastBuildErrorsSig = null;

const buildErrorsToggle = document.getElementById("build-errors-toggle");
if (buildErrorsToggle) buildErrorsToggle.checked = localStorage.getItem("autoSendBuildErrors") === "true";
function setAutoSendBuildErrors(checked) { localStorage.setItem("autoSendBuildErrors", checked); }

function requestBuildErrors() {
    document.getElementById("cmd-menu").classList.remove("open");
    window.chrome.webview?.postMessage({ type: "get-build-errors" });
}

function onBuildErrors(msg) {
    if (msg.auto) {
        if (!msg.errorCount) { _lastBuildErrorsSig = null; return; } // green build resets dedupe
        if (localStorage.getItem("autoSendBuildErrors") !== "true") return;
        if (msg.prompt === _lastBuildErrorsSig) return;
        if (isStreaming) return;
    } else {
        if (!msg.errorCount) { showToast(t("build.none")); return; }
        if (isStreaming) { showToast(t("turn.busyRetry")); return; }
    }
    _lastBuildErrorsSig = msg.prompt;
    textarea.value = msg.prompt;
    sendMessage();
}

// ── Editor context-menu actions (issue #6) ────────────────────
// C# captures the selection and prefixes a fixed instruction; the action sends
// it as one turn (Send Selection stays insert-only via its own path). A turn in
// flight can't take a second send, so keep the prompt in the composer instead of
// dropping it and let the user send when the turn finishes.
function runEditorAction(instruction, block) {
    if (!block) return;
    const composed = instruction + "\n\n" + block;
    if (isStreaming) {
        insertAtCursor(composed);
        showToast(t("turn.busySend"));
        return;
    }
    textarea.value = composed;
    sendMessage();
}

// ── Background tasks (issue #5) ───────────────────────────────
// The CLI fires no push event when a background shell finishes, so there is
// nothing to auto-notify from. This is a manual, on-demand check: the ⌘ item
// injects a follow-up that asks Claude to poll and report its background tasks.
// (An auto-check-every-N-seconds setting existed but was removed 2026-08-16:
// with no completion signal the arm stayed sticky and kept firing after the
// task had finished, which read as noise. Manual only is the accepted model.)
const BG_CHECK_PROMPT = "Check on any background tasks or shells you started earlier in this session and report their current status. If any have finished, summarize their output; if any are still running, say so.";

function sendBackgroundCheck() {
    textarea.value = BG_CHECK_PROMPT;
    sendMessage();
}

// ⌘ menu: on-demand check.
function checkBackgroundTasks() {
    document.getElementById("cmd-menu").classList.remove("open");
    if (isStreaming) { showToast(t("turn.busyRetry")); return; }
    sendBackgroundCheck();
}

// ── V7 claude settings (apply to new/restarted sessions) ──────
const coAuthoredToggle = document.getElementById("coauthored-toggle");
if (coAuthoredToggle) coAuthoredToggle.checked = localStorage.getItem("coAuthoredBy") !== "false";
function setCoAuthoredBy(checked) { localStorage.setItem("coAuthoredBy", checked); }

const autoCompactToggle = document.getElementById("autocompact-toggle");
if (autoCompactToggle) autoCompactToggle.checked = localStorage.getItem("autoCompact") !== "false";
function setAutoCompact(checked) { localStorage.setItem("autoCompact", checked); }

const cleanupDaysInput = document.getElementById("cleanup-days-input");
if (cleanupDaysInput) cleanupDaysInput.value = localStorage.getItem("cleanupPeriodDays") || "";
function setCleanupDays(value) {
    const v = parseInt(value, 10);
    if (Number.isNaN(v) || v < 1) localStorage.removeItem("cleanupPeriodDays");
    else localStorage.setItem("cleanupPeriodDays", String(v));
}

// Minutes before an unanswered permission modal is denied on the user's behalf;
// "0" waits for the answer and is the default, so nothing is stored until a
// finite timeout is picked.
const permTimeoutSelect = document.getElementById("perm-timeout-select");
if (permTimeoutSelect) permTimeoutSelect.value = localStorage.getItem("permissionTimeoutMinutes") || "0";
function setPermissionTimeout(value) {
    const v = parseInt(value, 10);
    if (Number.isNaN(v) || v <= 0) localStorage.removeItem("permissionTimeoutMinutes");
    else localStorage.setItem("permissionTimeoutMinutes", String(v));
}

// Theme override: "auto" follows VS (default), "dark" / "light" force regardless
// of VS theme. Persists across sessions in localStorage.
let _lastVsIsDark = true; // assume dark until C# reports otherwise
const themeOverrideSelect = document.getElementById("theme-override");
themeOverrideSelect.value = localStorage.getItem("themeOverride") || "auto";

function setThemeOverride(value) {
    localStorage.setItem("themeOverride", value);
    applyThemeOverride();
    syncAppearanceToHost();
}

// Mirror the Appearance choice (theme override + custom accent) to the C# host so
// the native WPF tool windows (MCP, Usage, and future ones) follow the same
// choice. They read a small on-disk copy, so this also seeds it on first load.
function syncAppearanceToHost() {
    try {
        window.chrome.webview.postMessage({
            type: "set-appearance",
            themeMode: localStorage.getItem("themeOverride") || "auto",
            accent: currentAccentOverride(),
            uiLanguage: getUiLanguagePref()
        });
    } catch (_) { }
}

function applyThemeOverride() {
    const mode = localStorage.getItem("themeOverride") || "auto";
    let isDark;
    if (mode === "dark") isDark = true;
    else if (mode === "light") isDark = false;
    else isDark = _lastVsIsDark;
    document.documentElement.classList.toggle("light-theme", !isDark);
    updateOnAccent(); // the default accent differs per theme
}

// Apply on load so the choice is visible even before the first VS theme event.
applyThemeOverride();

// UI language (i18n.js): the select mirrors localStorage "uiLanguage". Static
// markup is re-filled by applyI18n; labels app.js owns are re-rendered here.
document.getElementById("ui-language").value = getUiLanguagePref();
function onUiLanguageChanged() {
    updatePermissionButton();
    updateEffortButton(+effortPopupSlider.value);
    autoSaveLabel.textContent = t("autosave." + autoSaveValues[+autoSaveSlider.value]);
    renderCwd();
    if (_accountInfo) renderAccountInfo();
    updateUsageSessionValues();
    updateHistoryHint();
    renderRemoteControl();
    if (_ctxKnown) refreshContextRing(); else resetContextRing(); // tooltip text is built from the reply
    renderAgentsPill();
}

// Issue #10: how the AskUserQuestion picker submits — "instant" (default,
// send on click) or "always" (always show Submit; options toggle and combine
// with Other). Persists across sessions in localStorage.
const askModeSelect = document.getElementById("ask-mode");
if (askModeSelect) askModeSelect.value = getAskMode();
function setAskMode(value) { localStorage.setItem("askMode", value); }
// Only "always" and "instant" exist; anything else (e.g. a stale "hybrid" from
// an earlier build) falls back to the default.
function getAskMode() { return localStorage.getItem("askMode") === "always" ? "always" : "instant"; }

// Accent color — user picks a HEX via color input. Persists across sessions.
// Empty localStorage = default (CSS cascade: #d88763 dark, #b05c35 light).
// Reset button clears the override and snaps back to the brand default.
const ACCENT_DEFAULT = "#d88763";
// "Colored accents" off: one mid gray that reads both as a fill under white
// text (user bubble, send button) and as text on the dark/light backgrounds.
const ACCENT_NEUTRAL = "#707070";
const accentCustomInput = document.getElementById("accent-custom");
const accentEnabledToggle = document.getElementById("accent-enabled-toggle");
accentCustomInput.value = localStorage.getItem("accentCustom") || ACCENT_DEFAULT;

function accentEnabled() { return localStorage.getItem("accentOff") !== "true"; }

// The --accent override in effect, or "" for the theme's brand default.
function currentAccentOverride() {
    return accentEnabled() ? (localStorage.getItem("accentCustom") || "") : ACCENT_NEUTRAL;
}

function setAccentEnabled(checked) {
    if (checked) localStorage.removeItem("accentOff");
    else localStorage.setItem("accentOff", "true");
    applyAccent();
    syncAppearanceToHost();
}

function setAccentCustom(value) {
    localStorage.setItem("accentCustom", value);
    applyAccent();
    syncAppearanceToHost();
}

function resetAccent() {
    localStorage.removeItem("accentCustom");
    localStorage.removeItem("accentOff");
    accentCustomInput.value = ACCENT_DEFAULT;
    applyAccent();
    syncAppearanceToHost();
}

function applyAccent() {
    const color = currentAccentOverride();
    if (color) document.documentElement.style.setProperty("--accent", color);
    else document.documentElement.style.removeProperty("--accent");
    if (accentEnabledToggle) accentEnabledToggle.checked = accentEnabled();
    accentCustomInput.disabled = !accentEnabled();
    updateOnAccent();
}

// Text drawn ON an accent fill (your message bubble, send button, primary
// buttons) used to be fixed white — a white or pale custom accent made it
// vanish. Switch to dark text once white gets hard to read on the accent.
// ponytail: fixed threshold (white contrast < 2.5:1) keeps the default orange's
// white text as designed; a full AA rule would flip the default orange too.
function updateOnAccent() {
    const root = document.documentElement;
    const hex = getComputedStyle(root).getPropertyValue("--accent").trim();
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
    if (!m) { root.style.removeProperty("--on-accent"); return; }
    const h = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1];
    const lin = i => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const luminance = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
    const whiteContrast = 1.05 / (luminance + 0.05);
    root.style.setProperty("--on-accent", whiteContrast < 2.5 ? "#1e1e1e" : "#ffffff");
}

applyAccent();

// Seed the host's on-disk appearance copy from whatever is already in
// localStorage, so a native window opened without touching the settings still
// follows the current choice.
syncAppearanceToHost();

// Working directory (per-solution overrides — see workingDirKey above)
const workingDirInput = document.getElementById("working-dir-input");
workingDirInput.value = getWorkingDirOverride();

function setWorkingDirectory(value) {
    setWorkingDirOverride(value);
    renderCwd();
    requestCwdRefresh();
}

function clearWorkingDirectory() {
    workingDirInput.value = "";
    setWorkingDirOverride("");
    renderCwd();
    requestCwdRefresh();
    workingDirInput.focus();
}

function syncWorkingDirInput() {
    // Don't clobber the field mid-typing; cwd-info can arrive at any time.
    if (workingDirInput && document.activeElement !== workingDirInput)
        workingDirInput.value = getWorkingDirOverride();
}

// Claude CLI path (D7): explicit claude.exe for installs not on PATH.
const cliPathInput = document.getElementById("cli-path-input");
cliPathInput.value = localStorage.getItem("claudeCliPath") || "";

function getCliPath() {
    return (localStorage.getItem("claudeCliPath") || "").trim() || null;
}

function setCliPath(value) {
    localStorage.setItem("claudeCliPath", value.trim());
}

function clearCliPath() {
    cliPathInput.value = "";
    localStorage.setItem("claudeCliPath", "");
    cliPathInput.focus();
}

// #14: automatic --fallback-model when the primary model is overloaded.
const fallbackModelSelect = document.getElementById("fallback-model-select");
fallbackModelSelect.value = localStorage.getItem("fallbackModel") || "";

function getFallbackModel() {
    return localStorage.getItem("fallbackModel") || null;
}

function setFallbackModel(value) {
    localStorage.setItem("fallbackModel", value);
}

// #13: --forward-subagent-text is always on in the spawn; this only decides
// how much of it to render (purely client-side, no respawn needed to change).
const subagentDetailSelect = document.getElementById("subagent-detail-select");
subagentDetailSelect.value = localStorage.getItem("subagentDetail") || "simple";

function getSubagentDetail() {
    return localStorage.getItem("subagentDetail") || "simple";
}

function setSubagentDetail(value) {
    localStorage.setItem("subagentDetail", value);
}

// #11: hard, CLI-enforced budget cap (--max-budget-usd) — distinct from the
// Cost limits section above, which is a client-side estimate/warning only.
const maxBudgetInput = document.getElementById("max-budget-input");
maxBudgetInput.value = localStorage.getItem("maxBudgetUsd") || "";

function getMaxBudget() {
    const n = parseFloat(localStorage.getItem("maxBudgetUsd") || "");
    return Number.isFinite(n) && n > 0 ? n : null;
}

function setMaxBudget(value) {
    localStorage.setItem("maxBudgetUsd", value.trim());
}

function clearMaxBudget() {
    maxBudgetInput.value = "";
    localStorage.setItem("maxBudgetUsd", "");
    maxBudgetInput.focus();
}

function requestCwdRefresh() {
    try { window.chrome.webview.postMessage({ type: "refresh-cwd" }); } catch (e) {}
}

// Display name (override shown in titlebar)
const displayNameInput = document.getElementById("display-name-input");
displayNameInput.value = localStorage.getItem("displayName") || "";

const accountInfoSourceSelect = document.getElementById("account-info-source");
accountInfoSourceSelect.value = localStorage.getItem("accountInfoSource") || "auto";

function setDisplayName(value) {
    localStorage.setItem("displayName", value.trim());
    renderAccountInfo();
}

function clearDisplayName() {
    displayNameInput.value = "";
    localStorage.setItem("displayName", "");
    renderAccountInfo();
    displayNameInput.focus();
}

function setAccountInfoSource(value) {
    localStorage.setItem("accountInfoSource", value);
    renderAccountInfo();
}

// ── Cost limits ────────────────────────────────────────────────
function parseCost(value) {
    const n = parseFloat(String(value).replace(",", "."));
    return isFinite(n) && n > 0 ? n : null;
}

function formatCost(value) {
    const n = typeof value === "number" ? value : parseCost(value);
    if (n == null) return "";
    return n.toFixed(2).replace(".", ",");
}

function formatCostLimitInput(el) {
    el.value = formatCost(el.value);
}

let _costLimitSaveTimer = null;
function saveCostLimits() {
    clearTimeout(_costLimitSaveTimer);
    _costLimitSaveTimer = setTimeout(() => {
        const sl = parseCost(localStorage.getItem("costSessionLimit"));
        const dl = parseCost(localStorage.getItem("costDailyLimit"));
        const block = localStorage.getItem("costBlock") === "true";
        window.chrome.webview.postMessage({
            type: "set-cost-limits",
            sessionLimit: sl,
            dailyLimit: dl,
            block
        });
    }, 400);
}

function setCostLimit(which, value) {
    const v = parseCost(value);
    if (which === "session") localStorage.setItem("costSessionLimit", v ?? "");
    else localStorage.setItem("costDailyLimit", v ?? "");
    dismissCostWarning();
    saveCostLimits();
}

function setCostBlock(checked) {
    localStorage.setItem("costBlock", !!checked);
    dismissCostWarning();
    saveCostLimits();
}

function clearCostLimit(which) {
    const id = which === "session" ? "cost-session-input" : "cost-daily-input";
    const inp = document.getElementById(id);
    inp.value = "";
    setCostLimit(which, "");
    inp.focus();
}

(function loadCostLimitsFromStorage() {
    const s = localStorage.getItem("costSessionLimit");
    const d = localStorage.getItem("costDailyLimit");
    const block = localStorage.getItem("costBlock") === "true";
    if (s) document.getElementById("cost-session-input").value = formatCost(s);
    if (d) document.getElementById("cost-daily-input").value = formatCost(d);
    document.getElementById("cost-block-toggle").checked = block;
    // Sync with disk to handle edits from other VS instances
    try { window.chrome.webview.postMessage({ type: "get-cost-limits" }); } catch (_) { }
})();

// Reset to defaults (D10): clears every settings key and reloads the webview.
// Non-setting data (prompt history, custom commands, sessions) is kept.
const SETTINGS_KEYS = [
    // Appearance
    "themeOverride", "accentCustom", "accentOff", "uiLanguage",
    // Chat
    "sendWithEnter", "autoResume", "autoSaveLevel", "soundOnInput", "soundOnDone", "autoIncludeAttachments", "askMode",
    // Display / layout
    "showTokens", "showTokenEstimate", "timingMode", "timeUnit", "compactLayout",
    "composerFontSize", "composerTextareaHeight",
    // Claude Code
    "coAuthoredBy", "autoCompact", "cleanupPeriodDays", "permissionRules", "claudeCliPath", "fallbackModel", "subagentDetail", "perfMetrics", "defaultPermissionMode", "remoteControl",
    // Workspace
    "workingDirOverrides", "workingDirectory", "showCwdbar", "statusLineCommand",
    "displayName", "accountInfoSource",
    // Cost limits (localStorage cache; disk copy cleared via set-cost-limits)
    "costSessionLimit", "costDailyLimit", "costBlock", "maxBudgetUsd",
    // Composer selectors (incl. legacy effort key)
    "effortLevel", "effortValue", "chatModel", "defaultModel"
];

function resetSettingsToDefaults() {
    if (!confirm(t("settings.reset.confirm"))) return;
    for (const k of SETTINGS_KEYS) localStorage.removeItem(k);
    // Cost limits also live on disk (cost_limits.json) — clear them there too,
    // or the reload would just sync the old values straight back.
    try {
        window.chrome.webview.postMessage({ type: "set-cost-limits", sessionLimit: null, dailyLimit: null, block: false });
    } catch (e) {}
    // Small delay so the host receives the message before navigation.
    setTimeout(() => location.reload(), 150);
}

function showCostWarning(text, blocked) {
    const el = document.getElementById("cost-warning");
    const prefix = blocked ? t("cost.blocked") : t("cost.reached");
    document.getElementById("cost-warning-text").textContent = prefix + text;
    el.classList.toggle("blocked", !!blocked);
    el.style.display = "flex";

    if (blocked) {
        const userMsgs = messages.querySelectorAll(".message.user");
        const last = userMsgs[userMsgs.length - 1];
        if (last && !last.classList.contains("blocked")) {
            last.classList.add("blocked");
            const badge = document.createElement("div");
            badge.className = "blocked-badge";
            badge.textContent = t("cost.blockedBadge");
            last.appendChild(badge);
        }
    }
}

function dismissCostWarning() {
    document.getElementById("cost-warning").style.display = "none";
}

// Ctrl+Scroll to resize chat font (bubbles, code blocks, composer — all driven
// by the --chat-font-size CSS var). Composer keeps its inline style so the
// textarea matches even when CSS var inheritance gets weird. Same localStorage
// key as before for backward compat with users who already set a custom size.
let composerFontSize = parseFloat(localStorage.getItem("composerFontSize") || "13");

function applyChatFontSize(px) {
    document.documentElement.style.setProperty("--chat-font-size", px + "px");
    textarea.style.fontSize = px + "px";
}
applyChatFontSize(composerFontSize);

document.addEventListener("wheel", e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    composerFontSize = Math.max(8, Math.min(24, composerFontSize + (e.deltaY < 0 ? 1 : -1)));
    applyChatFontSize(composerFontSize);
    localStorage.setItem("composerFontSize", composerFontSize);
}, { passive: false });

let timeUnit = localStorage.getItem("timeUnit") || "s";
(function () {
    document.getElementById("unit-" + timeUnit).classList.add("active");
})();

function setTimeUnit(unit) {
    timeUnit = unit;
    localStorage.setItem("timeUnit", unit);
    document.querySelectorAll(".unit-btn").forEach(b => b.classList.remove("active"));
    document.getElementById("unit-" + unit).classList.add("active");
}

function formatMs(ms) {
    if (timeUnit === "ms") return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60000);
    const s = ((ms % 60000) / 1000).toFixed(0);
    return `${m}m ${s}s`;
}

function appendTokens(text) {
    const parts = text.split("/").map(Number);
    const inp = parts[0] || 0;
    const out = parts[1] || 0;
    const cacheRead = parts[2] || 0;
    sessionIn += inp;
    sessionOut += out;
    updateUsageSessionValues();
    if (!tokensToggle.checked) return;
    const fmt = n => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
    const el = document.createElement("div");
    el.className = "timing";
    const cachePart = cacheRead > 0 ? t("tokens.cached", { n: fmt(cacheRead) }) : "";
    el.textContent = t("tokens.line", { in: fmt(inp), cache: cachePart, out: fmt(out) });
    messages.appendChild(el);
    autoScroll();
}

function appendTiming(text) {
    const mode = timingSelect.value;
    if (mode === "none") return;
    if (mode === "simple" && !text.startsWith("total:")) return;
    const formatted = text.replace(/(\d+)ms/g, (_, n) => formatMs(Number(n)));
    const el = document.createElement("div");
    el.className = "timing";
    el.textContent = `⏱ ${formatted}`;
    messages.appendChild(el);
    autoScroll();
}

// CLI informational notices ("Unknown command: /x") — muted line in the
// transcript so the turn doesn't read as a silent 0-token no-op.
function appendSystemInfo(text) {
    if (!text) return;
    if (welcome) { welcome.remove(); welcome = null; }
    const el = document.createElement("div");
    el.className = "system-info-line";
    el.textContent = `ⓘ ${text}`;
    messages.appendChild(el);
    autoScroll();
}

function applyMarkdown(bubble, raw) {
    bubble.innerHTML = renderMarkdown(raw);
    bubble.querySelectorAll("pre code").forEach(el => {
        if (typeof hljs !== "undefined") {
            try { hljs.highlightElement(el); } catch (_) { /* unknown language */ }
        }
        // Ensure the .hljs class is present even when the language isn't bundled
        // (dart, dockerfile, etc.). Without it the GitHub Dark theme's background
        // rule (pre code.hljs) doesn't apply and the block bleeds into the bubble.
        if (!el.classList.contains("hljs")) el.classList.add("hljs");
    });
    bubble.querySelectorAll("pre").forEach(pre => {
        if (pre.querySelector(".code-actions")) return;
        const actions = document.createElement("div");
        actions.className = "code-actions";

        // Copy stays on both sides (a pasted snippet in the user's own message
        // is just as often what someone wants back out); Apply is stripped for
        // user bubbles right after this by the role === "user" check below.
        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "copy-btn";
        copyBtn.textContent = t("code.copy");
        copyBtn.title = t("code.copyTitle");
        actions.appendChild(copyBtn);

        const applyBtn = document.createElement("button");
        applyBtn.type = "button";
        applyBtn.className = "apply-btn";
        applyBtn.textContent = t("code.apply");
        applyBtn.title = t("code.applyTitle");
        actions.appendChild(applyBtn);

        pre.appendChild(actions);
    });
}

function escapeHtmlRaw(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMarkdown(raw) {
    // Protect fenced code blocks
    const blocks = [];
    let text = raw.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        const i = blocks.length;
        const cls = lang ? ` class="language-${lang}"` : '';
        blocks.push(`<pre><code${cls}>${escapeHtmlRaw(code.trimEnd())}</code></pre>`);
        return `\x00B${i}\x00`;
    });

    // Protect inline code
    const inlines = [];
    text = text.replace(/`([^`\n]+)`/g, (_, code) => {
        const i = inlines.length;
        inlines.push(`<code>${escapeHtml(code)}</code>`);
        return `\x00I${i}\x00`;
    });

    // Headers
    text = text.replace(/^#{3} (.+)$/gm, '<h3>$1</h3>');
    text = text.replace(/^#{2} (.+)$/gm, '<h2>$1</h2>');
    text = text.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Bold / italic
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*([^\s*][^*\n]*?)\*/g, '<em>$1</em>');

    // Unordered lists
    text = text.replace(/((?:^[ \t]*[-*+] .+\n?)+)/gm, m => {
        const items = m.trim().split('\n').map(l => `<li>${l.replace(/^[ \t]*[-*+] /, '')}</li>`).join('');
        return `<ul>${items}</ul>`;
    });

    // Ordered lists
    text = text.replace(/((?:^\d+\. .+\n?)+)/gm, m => {
        const items = m.trim().split('\n').map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
        return `<ol>${items}</ol>`;
    });

    // Tables
    text = text.replace(/((?:^[ \t]*\|.+\|[ \t]*\n?){2,})/gm, m => {
        const lines = m.split('\n').filter(l => l.trim().startsWith('|'));
        if (lines.length < 2) return m;
        const sepInner = lines[1].trim().replace(/^\||\|$/g, '');
        if (!/^[\s\-:|]+$/.test(sepInner) || !/-/.test(sepInner)) return m;

        const splitCells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const header = splitCells(lines[0]);
        const aligns = splitCells(lines[1]).map(c => {
            const t = c.trim();
            if (t.startsWith(':') && t.endsWith(':')) return 'center';
            if (t.endsWith(':')) return 'right';
            return 'left';
        });
        const rows = lines.slice(2).map(splitCells);

        const cellAlign = i => aligns[i] || 'left';
        const thead = '<thead><tr>' + header.map((h, i) =>
            `<th style="text-align:${cellAlign(i)}">${h}</th>`).join('') + '</tr></thead>';
        const tbody = '<tbody>' + rows.map(r =>
            '<tr>' + r.map((c, i) =>
                `<td style="text-align:${cellAlign(i)}">${c}</td>`).join('') + '</tr>'
        ).join('') + '</tbody>';

        return `<table class="md-table">${thead}${tbody}</table>\n`;
    });

    // Links. External URLs keep target=_blank; anything else is treated as a
    // workspace file reference (the appended system prompt instructs claude to
    // emit [file.cs:42](path/file.cs#L42)) and becomes a file-link that opens
    // in the VS editor at the referenced line.
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, href) => {
        if (/^(https?:|mailto:)/i.test(href))
            return `<a href="${href}" target="_blank">${label}</a>`;
        const fm = href.match(/^(.*?)(?:#L(\d+)(?:-L?(\d+))?)?$/);
        const path = (fm[1] || href).replace(/"/g, "&quot;");
        const start = fm[2] || "0";
        const end = fm[3] || fm[2] || "0";
        return `<a href="#" class="file-link" data-path="${path}" data-start="${start}" data-end="${end}" onclick="openFileLink(this);return false;">${label}</a>`;
    });

    // Bare URLs (no markdown syntax) — linkify too. The leading [\s(] guard
    // skips URLs already inside href="..." (preceded by a quote) and anchor
    // labels (preceded by >).
    text = text.replace(/(^|[\s(])(https?:\/\/[^\s<>"')\]]+)/g, '$1<a href="$2" target="_blank">$2</a>');

    // Paragraphs
    text = text.split(/\n{2,}/).map(block => {
        block = block.trim();
        if (!block) return '';
        if (/^(<(h[1-3]|ul|ol|pre|table)|\x00B)/.test(block)) return block;
        return `<p>${block.replace(/\n/g, '<br>')}</p>`;
    }).join('');

    // Restore
    text = text.replace(/\x00B(\d+)\x00/g, (_, i) => blocks[+i]);
    text = text.replace(/\x00I(\d+)\x00/g, (_, i) => inlines[+i]);

    return text;
}

function ensureStreamBubble() {
    if (currentStreamBubble) return currentStreamBubble;
    const msg = document.createElement("div");
    msg.className = "message assistant";
    msg.innerHTML = `<div class="bubble"></div>`;
    messages.appendChild(msg);
    decorateMessage(msg);
    currentStreamBubble = msg.querySelector(".bubble");
    return currentStreamBubble;
}

function getActiveTextSeg(bubble) {
    const last = bubble.lastElementChild;
    if (last && last.classList.contains("bubble-text") && last.dataset.finalized !== "1")
        return last;
    const seg = document.createElement("div");
    seg.className = "bubble-text";
    seg.dataset.raw = "";
    bubble.appendChild(seg);
    return seg;
}

function finalizeActiveSeg(bubble) {
    const last = bubble.lastElementChild;
    if (!last || !last.classList.contains("bubble-text") || last.dataset.finalized === "1") return;
    const raw = last.dataset.raw || "";
    if (raw) applyMarkdown(last, raw);
    last.dataset.finalized = "1";
}

function finalizeBubbleStream(bubble) {
    // Finalize any unfinished text segment AND legacy bubbles that used dataset.raw on the bubble itself
    if (bubble.dataset.raw && !bubble.querySelector(".bubble-text")) {
        applyMarkdown(bubble, bubble.dataset.raw);
        bubble.dataset.finalized = "1";
        return;
    }
    finalizeActiveSeg(bubble);
}

function appendChunk(text) {
    removeLoading();
    const bubble = ensureStreamBubble();
    const seg = getActiveTextSeg(bubble);
    seg.dataset.raw = (seg.dataset.raw || "") + text;
    seg.textContent = seg.dataset.raw;
    if (isStreaming) {
        ensureLiveTimer();
        bumpEstimatedOut(text.length);
    }
    autoScroll();
}

function summarizeToolInput(name, inputJson) {
    if (!inputJson) return "";
    let input;
    try { input = JSON.parse(inputJson); } catch { return ""; }
    if (!input || typeof input !== "object") return "";
    // Skill invocations carry {skill, args} — show "/name args" instead of the
    // generic first-key fallback (which would just print "skill").
    if (name === "Skill" && input.skill) {
        const s = "/" + String(input.skill).replace(/^\//, "") + (input.args ? " " + String(input.args) : "");
        return s.length > 80 ? s.slice(0, 79) + "…" : s;
    }
    // #13: subagent launchers (Agent/Task tool) key off subagent_type being
    // present rather than a hardcoded tool name — more robust if it's ever
    // renamed, and this environment already has a *different*, unrelated
    // "Task" tool (TaskCreate/TaskGet/...) that this must not match.
    if (input.subagent_type) {
        const s = String(input.subagent_type) + (input.description ? ": " + input.description : "");
        return s.length > 80 ? s.slice(0, 79) + "…" : s;
    }
    const arg = input.file_path || input.path || input.command || input.pattern || input.url || input.notebook_path || input.query;
    if (arg) {
        const s = String(arg);
        return s.length > 80 ? "…" + s.slice(-79) : s;
    }
    const keys = Object.keys(input);
    return keys.length ? keys[0] : "";
}

// ---- diff viewer state ----
const DIFF_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);
const toolInputData = new Map();      // toolId → parsed input object
const askUserQuestionIds = new Set(); // toolIds rendered as a question card — suppress their tool_result chip (the card shows the answer)
const todoWriteIds = new Set();       // toolIds rendered in the todo card — suppress their "Todos modified" tool_result chip
const gitBaselineCache = new Map();   // filePath → { content|null, error|null }
const pendingGitBaselineRequests = new Map(); // requestId → resolve()
const PREVIEW_MAX_LINES = 30;

// ── Files changed by a shell/subagent tool ──────────────────────────────────
// The agent diffs git snapshots taken around Bash/PowerShell/Task calls and
// sends the unified diff ("tool_files"). Each file becomes a row under the
// tool chip; clicking it opens the same inline diff Edit/Write chips use.
// Git C-quotes paths with special characters: "a/x\303\274 \"y\".txt" (octal
// UTF-8 bytes, \" \\ \t \n). Unquoted input comes back as is.
const GIT_PATH_ESCAPES = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11 };
function unquoteGitPath(s) {
    if (s.length < 2 || !s.startsWith('"') || !s.endsWith('"')) return s;
    const bytes = [];
    const enc = new TextEncoder();
    for (const m of s.slice(1, -1).matchAll(/\\([0-7]{3}|[\s\S])|[^\\]+/g)) {
        if (m[1] === undefined) bytes.push(...enc.encode(m[0]));
        else if (/^[0-7]{3}$/.test(m[1])) bytes.push(parseInt(m[1], 8));
        else bytes.push(GIT_PATH_ESCAPES[m[1]] ?? m[1].charCodeAt(0));
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
}

// The file's path from a part's header lines: "+++ b/…" (or "--- a/…" for a
// deletion), "rename to …", else the "diff --git a/X b/X" line itself —
// split by symmetry, since an unquoted X may itself contain " b/".
function diffPartPath(headerLines) {
    const strip = p => unquoteGitPath(p.replace(/\t$/, "")).replace(/^[ab]\//, "");
    let minus = null;
    for (const ln of headerLines) {
        if (ln.startsWith("rename to ")) return unquoteGitPath(ln.slice(10));
        if (ln.startsWith("+++ ") && ln !== "+++ /dev/null") return strip(ln.slice(4));
        if (ln.startsWith("--- ") && ln !== "--- /dev/null") minus = strip(ln.slice(4));
    }
    if (minus !== null) return minus;
    const rest = headerLines[0].slice("diff --git ".length);
    if (rest.endsWith('"')) {
        const tokens = [...rest.matchAll(/"(?:[^"\\]|\\.)*"|\S+/g)].map(m => m[0]);
        return strip(tokens[tokens.length - 1]);
    }
    const half = (rest.length - 1) / 2;
    if (Number.isInteger(half) && rest.slice(2, half) === rest.slice(half + 3)) return rest.slice(half + 3);
    return strip(rest.slice(rest.lastIndexOf(" b/") + 1));
}

function parseUnifiedDiff(text) {
    const files = [];
    for (const part of text.split(/(?=^diff --git )/m)) {
        if (!part.startsWith("diff --git ")) continue;
        const lines = [];
        const header = [];
        let adds = 0, dels = 0, oldNum = 0, newNum = 0, inHunk = false, binary = false;
        for (const ln of part.split("\n")) {
            const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(ln);
            if (hunk) {
                if (inHunk) lines.push({ type: "gap" });
                oldNum = +hunk[1]; newNum = +hunk[2]; inHunk = true;
                continue;
            }
            if (!inHunk) { header.push(ln); if (ln.startsWith("Binary files ")) binary = true; continue; }
            if (ln.startsWith("+")) { lines.push({ type: "+", line: ln.slice(1), newNum: newNum++ }); adds++; }
            else if (ln.startsWith("-")) { lines.push({ type: "-", line: ln.slice(1), oldNum: oldNum++ }); dels++; }
            else if (ln.startsWith(" ")) lines.push({ type: " ", line: ln.slice(1), oldNum: oldNum++, newNum: newNum++ });
        }
        files.push({ path: diffPartPath(header), adds, dels, binary, lines });
    }
    return files;
}

// tool_files "name" when the diff covers several tools that ran at once
// (agent: ClaudeSession.ToolFilesParallel).
const TOOL_FILES_PARALLEL = "parallel";

function renderToolFiles(id, diffText, scope) {
    const chip = id ? messages.querySelector(`.tool-chip[data-tool-id="${CSS.escape(id)}"]`) : null;
    const files = parseUnifiedDiff(diffText);
    if (!chip || files.length === 0) return;
    chip.querySelector(".tool-files")?.remove();

    const box = document.createElement("div");
    box.className = "tool-files";
    if (scope === TOOL_FILES_PARALLEL) {
        const note = document.createElement("div");
        note.className = "tool-files-note";
        note.textContent = t("tool.parallelChanges");
        box.appendChild(note);
    }
    for (const f of files) {
        const row = document.createElement("div");
        row.className = "tool-file-row";
        row.innerHTML = '<span class="tool-file-caret">▸</span><span class="tool-file-path"></span>' +
            (f.binary ? `<span class="tool-file-stat">${t("tool.binary")}</span>`
                      : `<span class="tool-file-add">+${f.adds}</span><span class="tool-file-del">−${f.dels}</span>`);
        row.querySelector(".tool-file-path").textContent = f.path;
        row.addEventListener("click", e => {
            e.stopPropagation(); // the chip itself toggles its own diff
            const open = row.nextElementSibling;
            if (open && open.classList.contains("tool-file-diff")) {
                open.remove();
                row.classList.remove("open");
                return;
            }
            const body = document.createElement("div");
            body.className = "tool-diff-body tool-file-diff";
            const shown = f.lines.slice(0, PREVIEW_MAX_LINES * 4);
            body.innerHTML = shown.length
                ? renderDiffHtml(shown) + (f.lines.length > shown.length ? `<div class="diff-line diff-gap">${t("tool.moreLines", { n: f.lines.length - shown.length })}</div>` : "")
                : `<div class="tool-diff-note">${t("tool.noTextChanges")}</div>`;
            body.addEventListener("click", ev => ev.stopPropagation());
            row.after(body);
            row.classList.add("open");
        });
        box.appendChild(row);
    }
    chip.appendChild(box);
    autoScroll();
}

function requestGitBaseline(filePath) {
    if (!filePath) return Promise.resolve({ content: null, error: "no path" });
    const cached = gitBaselineCache.get(filePath);
    if (cached) return Promise.resolve(cached);
    return new Promise(resolve => {
        const requestId = "gb-" + Math.random().toString(36).slice(2);
        pendingGitBaselineRequests.set(requestId, result => {
            gitBaselineCache.set(filePath, result);
            resolve(result);
        });
        window.chrome.webview.postMessage({
            type: "request-git-baseline",
            requestId,
            path: filePath
        });
    });
}

function computeLineDiff(oldText, newText) {
    const oldLines = (oldText || "").split("\n");
    const newLines = (newText || "").split("\n");
    const m = oldLines.length, n = newLines.length;

    // Guard against huge inputs (DP table too big)
    if (m * n > 2_000_000) {
        const out = [];
        for (let i = 0; i < m; i++) out.push({ type: "-", line: oldLines[i], oldNum: i + 1, newNum: null });
        for (let j = 0; j < n; j++) out.push({ type: "+", line: newLines[j], oldNum: null, newNum: j + 1 });
        return out;
    }

    const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
    for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
            dp[i][j] = oldLines[i] === newLines[j]
                ? dp[i + 1][j + 1] + 1
                : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }

    const out = [];
    let i = 0, j = 0;
    while (i < m && j < n) {
        if (oldLines[i] === newLines[j]) {
            out.push({ type: " ", line: oldLines[i], oldNum: i + 1, newNum: j + 1 });
            i++; j++;
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            out.push({ type: "-", line: oldLines[i], oldNum: i + 1, newNum: null });
            i++;
        } else {
            out.push({ type: "+", line: newLines[j], oldNum: null, newNum: j + 1 });
            j++;
        }
    }
    while (i < m) { out.push({ type: "-", line: oldLines[i], oldNum: i + 1, newNum: null }); i++; }
    while (j < n) { out.push({ type: "+", line: newLines[j], oldNum: null, newNum: j + 1 }); j++; }
    return out;
}

function trimDiffToChangedHunks(lines, contextSize) {
    // Keep changed lines and `contextSize` of surrounding context. Insert gap markers.
    const ctx = contextSize ?? 3;
    const keep = new Array(lines.length).fill(false);
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].type !== " ") {
            for (let k = Math.max(0, i - ctx); k <= Math.min(lines.length - 1, i + ctx); k++) keep[k] = true;
        }
    }
    const out = [];
    let lastKept = -2;
    for (let i = 0; i < lines.length; i++) {
        if (!keep[i]) continue;
        if (lastKept >= 0 && i > lastKept + 1) out.push({ type: "gap" });
        out.push(lines[i]);
        lastKept = i;
    }
    return out;
}

function renderDiffHtml(diffLines) {
    const html = [];
    for (const ln of diffLines) {
        if (ln.type === "gap") {
            html.push('<div class="diff-line diff-gap">⋯</div>');
            continue;
        }
        const cls = ln.type === "+" ? "diff-add" : ln.type === "-" ? "diff-del" : "diff-ctx";
        const oldNum = ln.oldNum != null ? String(ln.oldNum) : "";
        const newNum = ln.newNum != null ? String(ln.newNum) : "";
        const indicator = ln.type;
        const safe = escapeHtml(ln.line ?? "");
        html.push(`<div class="diff-line ${cls}"><span class="diff-lineno">${oldNum}</span><span class="diff-lineno">${newNum}</span><span class="diff-indicator">${indicator}</span><span class="diff-text">${safe}</span></div>`);
    }
    return html.join("");
}

// HTML *attribute* escaper — quotes included, unlike escapeHtml (the DOM-based
// one below wins by hoisting and does NOT escape quotes) and unlike escapeAttr
// (which is a JS-string escaper for onclick contexts and would corrupt values
// read back via dataset). Audit 2026-07-10 #6: this was a dead duplicate
// declaration of escapeHtml; renamed and repurposed.
function escapeAttrValue(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function buildDiffForTool(toolName, input) {
    // Returns { filePath, diffLines, hasBaseline, error }
    if (toolName === "Edit") {
        const lines = computeLineDiff(input.old_string || "", input.new_string || "");
        return { filePath: input.file_path || "", diffLines: lines };
    }
    if (toolName === "MultiEdit") {
        const edits = Array.isArray(input.edits) ? input.edits : [];
        const all = [];
        edits.forEach((e, idx) => {
            if (idx > 0) all.push({ type: "gap" });
            const lines = computeLineDiff(e.old_string || "", e.new_string || "");
            all.push(...lines);
        });
        return { filePath: input.file_path || "", diffLines: all };
    }
    if (toolName === "Write") {
        const filePath = input.file_path || "";
        const newContent = input.content || "";
        const { content: baseline, error } = await requestGitBaseline(filePath);
        if (baseline == null) {
            // New file (or git unavailable) — show all as +
            const lines = newContent.split("\n").map((line, idx) => ({ type: "+", line, oldNum: null, newNum: idx + 1 }));
            return { filePath, diffLines: lines, hasBaseline: false, error };
        }
        const lines = computeLineDiff(baseline, newContent);
        return { filePath, diffLines: lines, hasBaseline: true };
    }
    return { filePath: "", diffLines: [], error: "unsupported tool" };
}

async function toggleToolDiff(chip) {
    const existing = chip.querySelector(".tool-diff-inline");
    if (existing) {
        existing.remove();
        chip.classList.remove("tool-chip-expanded");
        return;
    }
    const id = chip.dataset.toolId;
    const data = id ? toolInputData.get(id) : null;
    if (!data) return;

    const container = document.createElement("div");
    container.className = "tool-diff-inline";
    container.innerHTML = `<div class="tool-diff-loading">${t("diff.computing")}</div>`;
    chip.appendChild(container);
    chip.classList.add("tool-chip-expanded");

    try {
        const { filePath, diffLines, hasBaseline, error } = await buildDiffForTool(data.name, data.input);
        if (error && (!diffLines || diffLines.length === 0)) {
            container.innerHTML = `<div class="tool-diff-error">${escapeHtml(error)}</div>`;
            return;
        }
        const trimmed = trimDiffToChangedHunks(diffLines, 3);
        const preview = trimmed.slice(0, PREVIEW_MAX_LINES);
        const truncated = trimmed.length > PREVIEW_MAX_LINES;
        const noteHtml = (data.name === "Write" && hasBaseline === false)
            ? `<div class="tool-diff-note">${t("diff.newFileNoBaseline")}</div>`
            : "";
        const vsBtnHtml = filePath ? `<button class="tool-diff-vs-btn">${t("diff.openInVsInline")}</button>` : "";
        container.innerHTML =
            noteHtml +
            `<div class="tool-diff-body">${renderDiffHtml(preview)}</div>` +
            `<div class="tool-diff-actions">
                ${truncated ? `<span class="tool-diff-truncated">${t("diff.more", { n: trimmed.length - PREVIEW_MAX_LINES })}</span>` : ""}
                ${vsBtnHtml}
                <button class="tool-diff-full-btn">${t("diff.viewFull")}</button>
            </div>`;
        const btn = container.querySelector(".tool-diff-full-btn");
        btn.addEventListener("click", e => {
            e.stopPropagation();
            openDiffModal(filePath, diffLines, data.name, hasBaseline);
        });
        const vsBtn = container.querySelector(".tool-diff-vs-btn");
        if (vsBtn) vsBtn.addEventListener("click", e => {
            e.stopPropagation();
            openVsDiff(filePath, data.name);
        });
    } catch (ex) {
        container.innerHTML = `<div class="tool-diff-error">${escapeHtml(String(ex))}</div>`;
    }
    autoScroll();
}

// Posts a request to C# to open the native VS side-by-side diff tab (git HEAD
// baseline vs current file). Read-only review.
function openVsDiff(filePath, toolName) {
    if (!filePath) return;
    try {
        window.chrome.webview.postMessage({ type: "open-vs-diff", path: filePath, toolName: toolName || "" });
    } catch (e) { console.warn("open-vs-diff post failed:", e); }
}

// File/tool of the per-tool diff modal currently open, so its "abrir no VS"
// header button knows what to compare.
let toolDiffModalFile = "";
let toolDiffModalTool = "";

function openDiffModal(filePath, diffLines, toolName, hasBaseline) {
    const overlay = document.getElementById("tool-diff-modal-overlay");
    document.getElementById("diff-modal-path").textContent = filePath || t("diff.noPath");
    const subtitle = document.getElementById("diff-modal-subtitle");
    const added = diffLines.filter(l => l.type === "+").length;
    const removed = diffLines.filter(l => l.type === "-").length;
    let sub = `${toolName} • +${added} -${removed}`;
    if (toolName === "Write" && hasBaseline === false) sub += t("diff.newFile");
    subtitle.textContent = sub;
    document.getElementById("diff-modal-body").innerHTML = renderDiffHtml(diffLines);
    toolDiffModalFile = filePath || "";
    toolDiffModalTool = toolName || "";
    const vsBtn = document.getElementById("tool-diff-modal-vs");
    if (vsBtn) vsBtn.style.display = filePath ? "" : "none";
    overlay.classList.add("open");
}

function closeToolDiffModal() {
    document.getElementById("tool-diff-modal-overlay").classList.remove("open");
}

function closeDiffModal() {
    document.getElementById("diff-modal-overlay").classList.remove("open");
}

document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    const tool = document.getElementById("tool-diff-modal-overlay");
    const git = document.getElementById("diff-modal-overlay");
    const openOne = (tool && tool.classList.contains("open")) ? tool
                  : (git && git.classList.contains("open")) ? git : null;
    if (!openOne) return;
    e.stopPropagation();
    openOne.classList.remove("open");
}, true);

function appendToolEvent(kind, name, inputJson, text, id) {
    removeLoading();
    const bubble = ensureStreamBubble();

    // AskUserQuestion is a meta tool whose entire purpose is interactive UI.
    // Render a question card with selectable options + write-in. The user's pick
    // is sent back as a control_response (the agent runs claude with
    // --permission-prompt-tool stdio), which becomes the tool's real tool_result.
    if (kind === "tool_use" && name === "AskUserQuestion" && id && inputJson) {
        // Dedupe: JSONL watcher may re-emit the same tool_use after stream-json.
        // While pending the card lives in the dock, not the bubble — check both.
        if (bubble.querySelector(`.ask-question-card[data-tool-id="${CSS.escape(id)}"]`) ||
            pinnedDock.querySelector(`.ask-question-card[data-tool-id="${CSS.escape(id)}"]`)) {
            autoScroll();
            return;
        }
        try {
            renderAskUserQuestionCard(bubble, id, inputJson);
            askUserQuestionIds.add(id);  // suppress the real tool_result chip (card shows the answer)
            // claude is now blocked waiting for the answer — freeze the timer.
            pauseLiveTimer();
            autoScroll();
            return;
        } catch (err) {
            console.warn("AskUserQuestion render failed, falling back to chip:", err);
            // fall through to generic tool_chip path below
        }
    }

    // The AskUserQuestion answer comes back as a real tool_result ("User has
    // answered your questions: ..."). The card already shows the choice, so skip
    // rendering a redundant chip (and avoid the generic branch mislabeling the
    // "last chip" when it can't find one with this id).
    if ((kind === "tool_error" || kind === "tool_result") && id && askUserQuestionIds.has(id)) {
        return;
    }

    // TodoWrite (V21): render the task list as a live card that updates in
    // place as claude progresses through the plan, instead of a generic chip.
    if (kind === "tool_use" && name === "TodoWrite" && inputJson) {
        try {
            renderTodoCard(bubble, inputJson);
            if (id) todoWriteIds.add(id);
            autoScroll();
            return;
        } catch (err) {
            console.warn("TodoWrite render failed, falling back to chip:", err);
            // fall through to the generic chip path below
        }
    }

    // The TodoWrite tool_result is boilerplate ("Todos have been modified
    // successfully") — the card already shows the state, skip the chip.
    if ((kind === "tool_error" || kind === "tool_result") && id && todoWriteIds.has(id)) {
        return;
    }

    if (kind === "tool_use") {
        // Dedupe by id — JSONL watcher may emit the same tool_use after stream-json already did
        if (id) {
            const existing = bubble.querySelector(`.tool-chip[data-tool-id="${CSS.escape(id)}"]`);
            if (existing) {
                // Refresh the arg in case the watcher has richer input
                const arg = summarizeToolInput(name, inputJson);
                let argEl = existing.querySelector(".tool-arg");
                if (arg) {
                    if (!argEl) {
                        argEl = document.createElement("span");
                        argEl.className = "tool-arg";
                        // Insert before caret if present so caret stays at the end
                        const caret = existing.querySelector(".tool-diff-caret");
                        if (caret) existing.insertBefore(argEl, caret);
                        else existing.appendChild(argEl);
                    }
                    argEl.textContent = `(${arg})`;
                }
                // Refresh stored input — JSONL watcher payload is authoritative (full content)
                if (DIFF_TOOLS.has(name) && inputJson) {
                    try {
                        const parsed = JSON.parse(inputJson);
                        if (parsed && typeof parsed === "object") {
                            toolInputData.set(id, { name, input: parsed });
                            if (!existing.classList.contains("tool-chip-diffable")) {
                                existing.classList.add("tool-chip-diffable");
                                const caret = document.createElement("span");
                                caret.className = "tool-diff-caret";
                                caret.textContent = "▸";
                                existing.appendChild(caret);
                                existing.addEventListener("click", e => {
                                    if (e.target.closest(".tool-diff-inline")) return;
                                    toggleToolDiff(existing);
                                });
                            }
                        }
                    } catch { /* ignore */ }
                }
                if (isStreaming) ensureLiveTimer();
                autoScroll();
                return;
            }
        }

        finalizeActiveSeg(bubble);
        const chip = document.createElement("div");
        chip.className = "tool-chip";
        if (id) {
            chip.dataset.toolId = id;
            if (id === pendingPermissionToolId) chip.classList.add("tool-pending");
        }

        // For diff-supported tools, parse and store input + mark chip clickable
        let diffable = false;
        if (id && DIFF_TOOLS.has(name) && inputJson) {
            try {
                const parsed = JSON.parse(inputJson);
                if (parsed && typeof parsed === "object") {
                    toolInputData.set(id, { name, input: parsed });
                    diffable = true;
                    chip.classList.add("tool-chip-diffable");
                }
            } catch { /* leave unclickable */ }
        }

        const dot = document.createElement("span");
        dot.className = "tool-dot";
        dot.textContent = "●";

        const label = document.createElement("span");
        label.className = "tool-name";
        label.textContent = name || "tool";

        chip.appendChild(dot);
        chip.appendChild(label);

        const arg = summarizeToolInput(name, inputJson);
        if (arg) {
            const argEl = document.createElement("span");
            argEl.className = "tool-arg";
            argEl.textContent = `(${arg})`;
            chip.appendChild(argEl);
        }

        if (diffable) {
            const caret = document.createElement("span");
            caret.className = "tool-diff-caret";
            caret.textContent = "▸";
            chip.appendChild(caret);
            chip.addEventListener("click", e => {
                // Ignore clicks on the inline diff body (so user can select text)
                if (e.target.closest(".tool-diff-inline")) return;
                toggleToolDiff(chip);
            });
        }

        bubble.appendChild(chip);
    } else if (kind === "tool_result" || kind === "tool_error") {
        let chip = null;
        if (id) chip = bubble.querySelector(`.tool-chip[data-tool-id="${CSS.escape(id)}"]`);
        if (!chip) {
            // fall back to last chip if no id match
            const chips = bubble.querySelectorAll(".tool-chip");
            chip = chips[chips.length - 1] || null;
        }
        if (!chip) return;
        if (kind === "tool_error") chip.classList.add("tool-error");

        if (text && text.trim()) {
            const firstLine = text.split(/\r?\n/)[0];
            const summaryText = "↳ " + (firstLine.length > 160 ? firstLine.slice(0, 160) + "…" : firstLine);
            let summary = chip.querySelector(".tool-summary");
            if (!summary) {
                summary = document.createElement("div");
                summary.className = "tool-summary";
                chip.appendChild(summary);
            }
            summary.textContent = summaryText;
        }
    }
    if (isStreaming) ensureLiveTimer();
    autoScroll();
}

// ── Subagent live trace (#13) ────────────────────────────────
// Program.cs always forwards --forward-subagent-text data; getSubagentDetail()
// (off/simple/full) purely decides how much of it gets rendered here.
const subagentTraces = new Map(); // parentToolId -> { el, toolChips: Map<subToolId, chipEl> }

function getOrCreateSubagentTrace(parentId, subagentType, taskDescription) {
    const existing = subagentTraces.get(parentId);
    if (existing && document.body.contains(existing.el)) return existing;

    // The parent Task/Agent tool_use chip is rendered first (it's what
    // launches the subagent) — if it's not in the DOM yet, there's nowhere
    // to anchor the trace.
    const parentChip = messages.querySelector(`.tool-chip[data-tool-id="${CSS.escape(parentId)}"]`);
    if (!parentChip) return null;

    const el = document.createElement("div");
    el.className = "subagent-trace";
    const header = document.createElement("div");
    header.className = "subagent-header";
    header.textContent = "🤖 " + (subagentType || t("subagent.default")) + (taskDescription ? ": " + taskDescription : "");
    el.appendChild(header);
    parentChip.insertAdjacentElement("afterend", el);

    const entry = { el, toolChips: new Map() };
    subagentTraces.set(parentId, entry);
    return entry;
}

function renderSubagentEvent(evt) {
    const level = getSubagentDetail();
    if (level === "off" || !evt.parentId) return;

    const entry = getOrCreateSubagentTrace(evt.parentId, evt.subagentType, evt.taskDescription);
    if (!entry) return;

    if (level === "simple") {
        // Only the narration text is worth a glance in simple mode — thinking
        // and tool calls stay silent, and the status line replaces itself
        // rather than growing into a second transcript.
        if (evt.type !== "subagent-text" || !evt.text) return;
        let status = entry.el.querySelector(".subagent-status");
        if (!status) {
            status = document.createElement("div");
            status.className = "subagent-status";
            entry.el.appendChild(status);
        }
        const oneLine = evt.text.split(/\r?\n/)[0];
        status.textContent = oneLine.length > 160 ? oneLine.slice(0, 160) + "…" : oneLine;
        autoScroll();
        return;
    }

    // level === "full"
    if (evt.type === "subagent-thinking" && evt.text) {
        const toggle = document.createElement("div");
        toggle.className = "subagent-thinking-toggle";
        toggle.textContent = t("subagent.thought") + " ▸";
        const body = document.createElement("div");
        body.className = "subagent-thinking-body";
        body.textContent = evt.text;
        toggle.addEventListener("click", () => {
            const expanded = toggle.classList.toggle("expanded");
            toggle.textContent = t("subagent.thought") + (expanded ? " ▾" : " ▸");
        });
        entry.el.appendChild(toggle);
        entry.el.appendChild(body);
    } else if (evt.type === "subagent-text" && evt.text) {
        const p = document.createElement("div");
        p.className = "subagent-text";
        p.textContent = evt.text;
        entry.el.appendChild(p);
    } else if (evt.type === "subagent-tool_use") {
        const chip = document.createElement("div");
        chip.className = "tool-chip";
        const dot = document.createElement("span");
        dot.className = "tool-dot";
        dot.textContent = "●";
        const nameEl = document.createElement("span");
        nameEl.className = "tool-name";
        nameEl.textContent = evt.tool || "tool";
        chip.appendChild(dot);
        chip.appendChild(nameEl);
        const arg = summarizeToolInput(evt.tool || "", evt.input);
        if (arg) {
            const argEl = document.createElement("span");
            argEl.className = "tool-arg";
            argEl.textContent = `(${arg})`;
            chip.appendChild(argEl);
        }
        entry.el.appendChild(chip);
        if (evt.id) entry.toolChips.set(evt.id, chip);
    } else if (evt.type === "subagent-tool_result" || evt.type === "subagent-tool_error") {
        const chip = evt.id ? entry.toolChips.get(evt.id) : null;
        if (chip && evt.text && evt.text.trim()) {
            if (evt.type === "subagent-tool_error") chip.classList.add("tool-error");
            const firstLine = evt.text.split(/\r?\n/)[0];
            const summary = document.createElement("div");
            summary.className = "tool-summary";
            summary.textContent = "↳ " + (firstLine.length > 160 ? firstLine.slice(0, 160) + "…" : firstLine);
            chip.appendChild(summary);
        }
    }
    autoScroll();
}

// Renders (or updates in place) the TodoWrite task list. One card per bubble:
// each TodoWrite call carries the FULL current list, so the latest call simply
// replaces the card's contents — the reader sees a live checklist.
function renderTodoCard(bubble, inputJson) {
    const input = JSON.parse(inputJson || "{}");
    const todos = Array.isArray(input.todos) ? input.todos : [];
    if (todos.length === 0) throw new Error("no todos in payload");

    let card = bubble.querySelector(".todo-card");
    if (!card) {
        finalizeActiveSeg(bubble);
        card = document.createElement("div");
        card.className = "todo-card";
        bubble.appendChild(card);
    }

    const done = todos.filter(t => t.status === "completed").length;
    const rows = todos.map(t => {
        if (t.status === "completed")
            return `<div class="todo-item todo-completed">✓ ${escapeHtml(t.content || "")}</div>`;
        if (t.status === "in_progress")
            return `<div class="todo-item todo-inprogress">◔ ${escapeHtml(t.activeForm || t.content || "")}</div>`;
        return `<div class="todo-item todo-pending">○ ${escapeHtml(t.content || "")}</div>`;
    }).join("");

    card.innerHTML = `<div class="todo-card-title">${t("todo.title")} <span class="todo-progress">${done}/${todos.length}</span></div>` +
        `<div class="todo-list">${rows}</div>`;
}

function renderAskUserQuestionCard(bubble, toolId, inputJson) {
    const input = JSON.parse(inputJson || "{}");
    const questions = Array.isArray(input.questions) ? input.questions : [];
    if (questions.length === 0) throw new Error("no questions in payload");

    finalizeActiveSeg(bubble);

    const card = document.createElement("div");
    card.className = "question-card ask-question-card";
    card.dataset.toolId = toolId;
    setCaptionAttention("pending");

    const answers = {};
    // Multi-select answers are tracked as arrays internally so we can join
    // them in the final payload (claude harness expects a single string per q).
    const multiSelectMap = {};

    // Issue #10: the picker's submit behavior is configurable (default "instant").
    //   instant  — current behavior: a lone single-choice question sends on click,
    //              picking an option and typing "Other" are mutually exclusive.
    //   always   — never sends on click; Submit is always shown; options toggle
    //              and combine with "Other" ("Option (write-in)").
    const askMode = getAskMode();
    const alwaysSubmit = askMode === "always";
    const enableToggleCombine = alwaysSubmit;
    const baseNeedsConfirm = questions.length > 1 || questions.some(q => q && q.multiSelect);

    // Rebuilds a row's answer from its current selection plus any "Other" text.
    // A selected option combined with a write-in becomes "Option (write-in)".
    function recomputeAnswer(q, row, opts) {
        const wi = row.querySelector(".ask-question-other");
        const note = wi ? wi.value.trim() : "";
        let base;
        if (q.multiSelect) {
            base = Array.from(multiSelectMap[q.question] || []).join(", ");
        } else {
            const sel = opts.querySelector(".ask-question-btn.selected");
            base = sel ? (sel.dataset.label || sel.textContent) : "";
        }
        const combined = base && note ? `${base} (${note})` : (base || note);
        if (combined) answers[q.question] = combined;
        else delete answers[q.question];
    }

    // Whether the Submit button is visible. When it is not (a lone single-choice
    // question in "instant" mode) a pick sends immediately.
    function submitShown() {
        return alwaysSubmit || baseNeedsConfirm;
    }

    questions.forEach((q, qIdx) => {
        const row = document.createElement("div");
        row.className = "ask-question-row";

        if (q.header) {
            const header = document.createElement("div");
            header.className = "ask-question-header";
            header.textContent = q.header;
            row.appendChild(header);
        }

        const text = document.createElement("div");
        text.className = "ask-question-text";
        text.textContent = q.question || "";
        row.appendChild(text);

        const opts = document.createElement("div");
        opts.className = q.multiSelect ? "ask-question-checkboxes" : "ask-question-options";
        const options = Array.isArray(q.options) ? q.options : [];

        options.forEach(opt => {
            if (!opt || !opt.label) return;
            const titleParts = [];
            if (opt.description) titleParts.push(opt.description);
            if (opt.preview) titleParts.push(opt.preview);
            const tooltip = titleParts.join("\n\n");

            if (q.multiSelect) {
                multiSelectMap[q.question] = multiSelectMap[q.question] || new Set();
                const lbl = document.createElement("label");
                lbl.className = "ask-question-check";
                if (tooltip) lbl.title = tooltip;
                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.value = opt.label;
                cb.onchange = () => {
                    const set = multiSelectMap[q.question];
                    if (cb.checked) set.add(opt.label); else set.delete(opt.label);
                    if (enableToggleCombine) {
                        // Checked boxes combine with any "Other" write-in.
                        recomputeAnswer(q, row, opts);
                    } else {
                        answers[q.question] = Array.from(set).join(", ");
                        if (set.size === 0) delete answers[q.question];
                        // Multi-select clears any write-in for this row
                        const wi = row.querySelector(".ask-question-other");
                        if (wi) wi.value = "";
                    }
                    updateConfirmState();
                };
                lbl.appendChild(cb);
                const span = document.createElement("span");
                span.textContent = opt.label;
                lbl.appendChild(span);
                opts.appendChild(lbl);
            } else {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "q-btn ask-question-btn";
                btn.textContent = opt.label;
                btn.dataset.label = opt.label;
                if (tooltip) btn.title = tooltip;
                btn.onclick = () => {
                    if (enableToggleCombine) {
                        // Toggle: clicking the selected option again clears it, and
                        // any "Other" write-in is kept and combined.
                        const wasSelected = btn.classList.contains("selected");
                        opts.querySelectorAll(".ask-question-btn").forEach(b => b.classList.remove("selected"));
                        if (!wasSelected) btn.classList.add("selected");
                        recomputeAnswer(q, row, opts);
                    } else {
                        opts.querySelectorAll(".ask-question-btn").forEach(b => b.classList.remove("selected"));
                        btn.classList.add("selected");
                        answers[q.question] = opt.label;
                        const wi = row.querySelector(".ask-question-other");
                        if (wi) wi.value = "";
                    }
                    maybeAutoSubmit();
                };
                opts.appendChild(btn);
            }
        });

        row.appendChild(opts);

        const otherInput = document.createElement("input");
        otherInput.type = "text";
        otherInput.className = "ask-question-other";
        otherInput.placeholder = t("ask.otherPlaceholder");
        otherInput.oninput = () => {
            if (enableToggleCombine) {
                // Keep the current selection; the write-in combines with it.
                recomputeAnswer(q, row, opts);
            } else {
                const val = otherInput.value.trim();
                if (val) {
                    // Write-in overrides any clicked option for this row
                    opts.querySelectorAll(".ask-question-btn").forEach(b => b.classList.remove("selected"));
                    if (q.multiSelect) {
                        opts.querySelectorAll("input[type=checkbox]").forEach(c => c.checked = false);
                        multiSelectMap[q.question]?.clear();
                    }
                    answers[q.question] = val;
                } else {
                    delete answers[q.question];
                }
            }
            updateConfirmState();
        };
        otherInput.onkeydown = e => {
            if (e.key === "Enter") {
                e.preventDefault();
                submitAnswers();
            }
        };
        row.appendChild(otherInput);

        card.appendChild(row);
    });

    const footer = document.createElement("div");
    footer.className = "ask-question-footer";

    // Always create the Submit button; submitShown() controls when it is visible
    // (in "always" mode or when a confirm is inherently needed; never for a lone
    // single-choice question in "instant").
    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "q-btn q-yes ask-question-confirm";
    confirmBtn.textContent = t("ask.submit");
    confirmBtn.disabled = true;
    confirmBtn.onclick = submitAnswers;
    footer.appendChild(confirmBtn);
    card.appendChild(footer);

    // Pending picks dock above the composer so streaming can't scroll them
    // away; submitAnswers moves the card back into the bubble.
    pinCard(card, bubble, "turn");
    renderPresence("waiting", t("presence.question"));
    updateConfirmState();

    function updateConfirmState() {
        const show = submitShown();
        confirmBtn.style.display = show ? "" : "none";
        if (!show) { confirmBtn.disabled = true; return; }
        const allAnswered = questions.every(q => {
            const v = answers[q.question];
            return v && String(v).trim().length > 0;
        });
        confirmBtn.disabled = !allAnswered;
    }

    function maybeAutoSubmit() {
        // When Submit isn't shown (a lone single-choice question in "instant") a
        // pick sends immediately; otherwise it just refreshes the Submit button.
        if (!submitShown()) submitAnswers();
        else updateConfirmState();
    }

    function submitAnswers() {
        if (card.classList.contains("ask-question-answered")) return;

        // `answers` is already keyed by question text → chosen label (multi-select
        // joined with ", "), which is exactly the shape claude expects in the
        // control_response. Require every question answered before sending.
        const allAnswered = questions.every(q => {
            const v = answers[q.question];
            return v && String(v).trim().length > 0;
        });
        if (!allAnswered) return;

        card.classList.add("ask-question-answered");
        card.querySelectorAll("button, input").forEach(el => el.disabled = true);
        unpinCard(card); // answered — back into the transcript flow
        renderPresence("", "");

        // claude resumes working as soon as it gets the answer — unfreeze the timer.
        resumeLiveTimer();

        // Send the picks back as a control_response (agent forwards to
        // claude.stdin via --permission-prompt-tool stdio). claude unblocks and
        // emits the real tool_result, continuing the SAME turn — no cancel, no
        // new user message, no concurrent-stream juggling.
        try {
            window.chrome.webview.postMessage({
                type: "ask-answer",
                toolUseId: toolId,
                answers: JSON.stringify(answers)
            });
        } catch (e) {
            console.warn("AskUserQuestion answer send failed:", e);
        }
        if (_captionAttention === "pending") setCaptionAttention(null);
    }
}

let _loadingTimer = null;
let _loadingStart = 0;

function addLoading() {
    const el = document.createElement("div");
    el.className = "message assistant loading";
    el.innerHTML = `<div class="bubble"><span class="dots"><span>.</span><span>.</span><span>.</span></span><span class="live-timer">0.0s</span></div>`;
    messages.appendChild(el);
    autoScroll();
    _loadingStart = Date.now();
    _loadingTimer = setInterval(() => {
        const timerEl = messages.querySelector(".live-timer");
        if (!timerEl) return;
        const ms = Date.now() - _loadingStart;
        timerEl.textContent = ms < 60000
            ? `${(ms / 1000).toFixed(1)}s`
            : `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(0)}s`;
    }, 100);
}

function removeLoading() {
    clearInterval(_loadingTimer);
    _loadingTimer = null;
    const el = messages.querySelector(".loading");
    if (el) el.remove();
    if (isStreaming) ensureLiveTimer();
}

let _liveTimerStart = 0;
let _liveTimerInterval = null;
// While an AskUserQuestion card awaits the user's pick, claude is blocked on our
// control_response — the elapsed time shouldn't count as "working" time. Freeze
// the timer between pause and resume and shift the start forward so the waited
// span is excluded from the displayed elapsed.
let _liveTimerPausedAt = 0;
let _liveTokens = { in: 0, out: 0, cached: 0 };
let _estimatedOutChars = 0;
let _realOutTokens = 0;

function renderLiveTimer() {
    const el = messages.querySelector(".stream-timer");
    if (!el) return;
    const ms = Date.now() - _liveTimerStart;
    const fmt = n => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
    const time = ms < 60000
        ? `${(ms / 1000).toFixed(1)}s`
        : `${Math.floor(ms / 60000)}m ${((ms % 60000) / 1000).toFixed(0)}s`;
    let txt = `⏱ ${time}`;

    const estOut = Math.floor(_estimatedOutChars / 3.7);
    const outShown = Math.max(_realOutTokens, estOut);
    const isEstimate = estOut > _realOutTokens;

    const parts = [];
    if (_liveTokens.in) parts.push(`↑ ${fmt(_liveTokens.in)}`);
    if (_liveTokens.cached) parts.push(`↻ ${fmt(_liveTokens.cached)}`);
    if (outShown) parts.push(`↓ ${isEstimate ? "~" : ""}${fmt(outShown)}`);
    if (parts.length) txt += " · " + parts.join(" · ");

    el.textContent = txt;
}

function ensureLiveTimer() {
    let el = messages.querySelector(".stream-timer");
    if (!el) {
        // Inherit elapsed from loading bubble if it was up; do NOT kill the bubble.
        // The loading dots stay as visual cue until real content arrives.
        const inheritedStart = _loadingStart || Date.now();
        _liveTimerStart = inheritedStart;
        el = document.createElement("div");
        el.className = "stream-timer";
        messages.appendChild(el);
        renderLiveTimer();

        // Hide the inner live-timer of the loading bubble to avoid duplicate time display
        const innerTimer = messages.querySelector(".loading .live-timer");
        if (innerTimer) innerTimer.style.display = "none";
    }
    // Don't restart the ticking interval while paused (awaiting a question answer).
    if (!_liveTimerInterval && !_liveTimerPausedAt) {
        _liveTimerInterval = setInterval(renderLiveTimer, 100);
    }
    messages.appendChild(el);
    autoScroll();
}

// Freeze the live timer while an AskUserQuestion card or the permission modal
// is pending. No claude events arrive during the wait (it's blocked on our
// reply), so simply stopping the interval freezes the display at its last value.
function pauseLiveTimer() {
    if (_liveTimerPausedAt) return;
    _liveTimerPausedAt = Date.now();
    if (_liveTimerInterval) { clearInterval(_liveTimerInterval); _liveTimerInterval = null; }
}

// Resume after the user answers: push the start forward by the paused span so
// the displayed elapsed continues from where it froze.
function resumeLiveTimer() {
    if (!_liveTimerPausedAt) return;
    _liveTimerStart += Date.now() - _liveTimerPausedAt;
    _liveTimerPausedAt = 0;
    if (isStreaming && !_liveTimerInterval && messages.querySelector(".stream-timer")) {
        _liveTimerInterval = setInterval(renderLiveTimer, 100);
    }
}

function updateLiveTokens(text) {
    const parts = (text || "").split("/").map(Number);
    const newIn = parts[0] || 0;
    const newOut = parts[1] || 0;
    const newCached = parts[2] || 0;
    // Don't overwrite in/cached with zeros — message_delta events carry partial
    // usage (output only); message_start carries the real input numbers.
    if (newIn > 0) _liveTokens.in = newIn;
    if (newCached > 0) _liveTokens.cached = newCached;
    // Only recalibrate output when it grows. Duplicate events with the same
    // cumulative usage would otherwise wipe out chars accumulated by
    // bumpEstimatedOut between events.
    if (newOut > _realOutTokens) {
        _realOutTokens = newOut;
        _estimatedOutChars = Math.max(_estimatedOutChars, _realOutTokens * 3.7);
    }
    _liveTokens.out = _realOutTokens;
    if (isStreaming) ensureLiveTimer();
    renderLiveTimer();
}

function bumpEstimatedOut(chars) {
    _estimatedOutChars += chars;
    renderLiveTimer();
}

function removeLiveTimer() {
    if (_liveTimerInterval) { clearInterval(_liveTimerInterval); _liveTimerInterval = null; }
    _liveTimerPausedAt = 0;
    const el = messages.querySelector(".stream-timer");
    if (el) el.remove();
    _liveTokens = { in: 0, out: 0, cached: 0 };
    _estimatedOutChars = 0;
    _realOutTokens = 0;
}

let _suppressNextAutoResume = false;

function clearChat() {
    pinnedDock.innerHTML = "";
    pinnedDock.hidden = true;
    messages.innerHTML = `
        <div class="welcome">
            <div class="hero"><span class="logo">✺</span> Claude Code Studio</div>
            <div class="bot">🤖</div>
        </div>`;

    welcome = messages.querySelector(".welcome");
    textarea.value = "";
    sessionIn = 0;
    sessionOut = 0;
    msgCounter = 0;
    userMsgCounter = 0;
    currentSessionId = null;
    _rewindBaseUserIdx = 0;
    _turnUserIdx = 0;

    // #21 backlog item 16: a resumed session may have silently switched the
    // picker to its own model (restoreSessionModel, no localStorage write) —
    // without this, a fresh chat right after would carry that model forward
    // instead of the one the user actually picked last. Bring the picker back
    // to the persisted default; the divider no-ops on this empty transcript.
    const storedModel = startupModel();
    if (storedModel && modelSelect.value !== storedModel) {
        modelSelect.value = storedModel;
        modelSelect.dispatchEvent(new Event("change"));
    }
    _lastReportedActiveModel = modelSelect.value; // #14: fresh chat, fresh fallback tracking
    subagentTraces.clear(); // #13: old entries would point at now-removed DOM nodes
    updateUsageSessionValues();
    // User explicitly asked for a fresh chat — suppress --continue on the next
    // outbound message even if the "Auto-resume" setting is on.
    _suppressNextAutoResume = true;
    permissionQueue = [];
    _sendQueue.length = 0;
    renderSendQueue();

    resetContextRing();
    clearRunningAgents();
    remoteControlSessionEnded();
    applyNewChatPermissionMode();
    window.chrome.webview.postMessage({ type: "clear" });
}

function renderBranchedMessages(newSessionId, msgs, sessionModel, lastTurnAt, contextTokens, cacheTtlMin) {
    restoreSendQueue(); // queued for the old view's session — don't send them into this one
    if (welcome) { welcome.remove(); welcome = null; }
    messages.innerHTML = "";
    msgCounter = 0;
    userMsgCounter = 0;
    currentSessionId = newSessionId;
    // Bubbles are re-rendered 1:1 from this session's JSONL — full range rewindable.
    _rewindBaseUserIdx = 0;
    _turnUserIdx = 0;

    // Replayed chips attach to the preceding assistant bubble, mirroring the
    // live layout (appendToolEvent appends chips inside the stream bubble —
    // rodada 11: as bare siblings they looked "loose" between text bubbles).
    // A turn that opens with tools before any text gets a bare UNdecorated
    // host bubble: it maps to no JSONL text line, so it must not consume a
    // ⎇ ordinal (msgIndex counts DOM text bubbles 1:1 with visible JSONL
    // lines). When the turn's first text line then arrives, the host's chips
    // are folded into that bubble's top — live they shared one bubble
    // (rodada 12, image_1 vs image_2); a tools-only turn keeps its bare host.
    // TodoWrite keeps the live behavior of ONE card per user turn: it pins to
    // its first host bubble and updates in place (last call wins).
    let hostBubble = null;
    let hostSynthetic = false;
    let todoBubble = null;

    // Consecutive assistant bubbles are one live turn split across JSONL text
    // lines (1 bubble = 1 line keeps ⎇ ordinals exact) — tag the followers so
    // CSS glues the run into a single visual block like the live stream
    // bubble. DOM-based: after a host fold the removed host no longer counts.
    const markContinuation = (msg) => {
        const prev = msg.previousElementSibling;
        if (prev && prev.classList.contains("message") && prev.classList.contains("assistant"))
            msg.classList.add("msg-cont");
    };

    const ensureHostBubble = () => {
        if (hostBubble) return hostBubble;
        const msg = document.createElement("div");
        msg.className = "message assistant replay-tool-host";
        const bubble = document.createElement("div");
        bubble.className = "bubble";
        msg.appendChild(bubble);
        messages.appendChild(msg);
        markContinuation(msg);
        hostBubble = bubble;
        hostSynthetic = true;
        return bubble;
    };

    for (const m of msgs) {
        if (m.role === "user") {
            addMessage("user", m.text || "");
            hostBubble = null;
            hostSynthetic = false;
            todoBubble = null;
        } else if (m.role === "command") {
            // Slash-command / skill invocation (Bug 2). Styled like an ordinary
            // user message (user's request) rather than a distinct chip — goes
            // through addMessage, so it's a decorated, counted .user bubble that
            // keeps ⎇/⟲ ordinals aligned with SessionOrdinals. The ⌘ prefix is a
            // subtle "this was a command" marker.
            addMessage("user", "⌘ " + (m.text || ""));
            hostBubble = null;
            hostSynthetic = false;
            todoBubble = null;
        } else if (m.role === "compact") {
            // Rebuild the "🗜️ Compacted: X → Y" divider from the JSONL
            // compact_boundary line — a divider, not a counted message, so it
            // doesn't touch ⎇/⟲ ordinals.
            insertOrUpdateModelDivider(t("compact.done", { pre: fmtTokens(m.pre), post: fmtTokens(m.post) }));
            hostBubble = null;
            hostSynthetic = false;
            todoBubble = null;
        } else if (m.role === "assistant") {
            const msg = document.createElement("div");
            msg.className = "message assistant";
            const bubble = document.createElement("div");
            bubble.className = "bubble";
            bubble.dataset.raw = m.text || "";
            messages.appendChild(msg);
            msg.appendChild(bubble);
            applyMarkdown(bubble, m.text || "");
            if (hostSynthetic && hostBubble) {
                // Turn opened with tools: fold the chips-only host into this
                // text bubble, chips on top (their live streaming order).
                const hostMsg = hostBubble.parentElement;
                const anchor = bubble.firstChild;
                while (hostBubble.firstChild) bubble.insertBefore(hostBubble.firstChild, anchor);
                if (todoBubble === hostBubble) todoBubble = bubble;
                if (hostMsg) hostMsg.remove();
            }
            markContinuation(msg);
            decorateMessage(msg);
            hostBubble = bubble;
            hostSynthetic = false;
        } else if (m.role === "ask") {
            renderReplayAskCard(m.input, m.answers);
            // The card is a flow sibling — chips appended to the pre-ask
            // bubble would land visually ABOVE it, so start a fresh host
            // (and never fold across the card).
            hostBubble = null;
            hostSynthetic = false;
        } else if (m.role === "tool") {
            if (m.name === "TodoWrite") {
                if (!todoBubble) todoBubble = ensureHostBubble();
                try { renderTodoCard(todoBubble, m.input); } catch (e) { /* malformed payload — skip */ }
            } else {
                renderReplayToolChip(ensureHostBubble(), m);
            }
        }
    }
    autoScroll();
    // History resume/fork only — HandleBranchAsync's payload carries none of
    // these fields, so a mid-conversation ⎇ branch shows no notice at all.
    showResumeNotice(sessionModel, lastTurnAt, contextTokens, cacheTtlMin);
}

// Re-renders a tool call from a session transcript (History resume / branch)
// as an inert chip inside its assistant host bubble — same look as the live
// chips, including the ↳ result summary and error tint. Edit/Write/MultiEdit keep the inline diff:
// the JSONL input carries the full old/new content, so toggleToolDiff works
// unchanged via toolInputData.
function renderReplayToolChip(container, m) {
    const chip = document.createElement("div");
    chip.className = "tool-chip";
    if (m.error) chip.classList.add("tool-error");

    const dot = document.createElement("span");
    dot.className = "tool-dot";
    dot.textContent = "●";
    chip.appendChild(dot);

    const label = document.createElement("span");
    label.className = "tool-name";
    label.textContent = m.name || "tool";
    chip.appendChild(label);

    const arg = summarizeToolInput(m.name, m.input);
    if (arg) {
        const argEl = document.createElement("span");
        argEl.className = "tool-arg";
        argEl.textContent = `(${arg})`;
        chip.appendChild(argEl);
    }

    if (m.id && DIFF_TOOLS.has(m.name) && m.input) {
        try {
            const parsed = JSON.parse(m.input);
            if (parsed && typeof parsed === "object") {
                toolInputData.set(m.id, { name: m.name, input: parsed });
                chip.dataset.toolId = m.id;
                chip.classList.add("tool-chip-diffable");
                const caret = document.createElement("span");
                caret.className = "tool-diff-caret";
                caret.textContent = "▸";
                chip.appendChild(caret);
                chip.addEventListener("click", e => {
                    if (e.target.closest(".tool-diff-inline")) return;
                    toggleToolDiff(chip);
                });
            }
        } catch { /* leave unclickable */ }
    }

    if (m.result) {
        const summary = document.createElement("div");
        summary.className = "tool-summary";
        const firstLine = String(m.result).split(/\r?\n/)[0];
        summary.textContent = "↳ " + (firstLine.length > 160 ? firstLine.slice(0, 160) + "…" : firstLine);
        chip.appendChild(summary);
    }

    container.appendChild(chip);
}

// Re-renders an AskUserQuestion from a session transcript (History resume /
// branch) as an inert, already-answered card. `answersJson` is the CLI's
// toolUseResult.answers map ({question: label}, multi-select joined ", ") —
// null when the question was dismissed or the session ended unanswered.
// Appended as bare flow content, outside addMessage/decorateMessage, so
// replayed cards never shift branch/rewind ordinals (text bubbles only).
function renderReplayAskCard(inputJson, answersJson) {
    let input;
    try { input = JSON.parse(inputJson || "{}"); } catch (e) { return; }
    const questions = Array.isArray(input.questions) ? input.questions : [];
    if (questions.length === 0) return;
    let answers = {};
    try { answers = JSON.parse(answersJson || "{}") || {}; } catch (e) {}

    const card = document.createElement("div");
    card.className = "question-card ask-question-card ask-question-answered pin-resolved";

    questions.forEach(q => {
        const row = document.createElement("div");
        row.className = "ask-question-row";

        if (q.header) {
            const header = document.createElement("div");
            header.className = "ask-question-header";
            header.textContent = q.header;
            row.appendChild(header);
        }

        const text = document.createElement("div");
        text.className = "ask-question-text";
        text.textContent = q.question || "";
        row.appendChild(text);

        const answer = String(answers[q.question] ?? "");
        // Multi-select answers were joined with ", " on submit; a label can
        // itself contain ", ", so exact match doubles as the fallback.
        const picked = new Set(answer ? answer.split(", ") : []);
        const isPicked = lbl => lbl === answer || picked.has(lbl);

        const opts = document.createElement("div");
        opts.className = q.multiSelect ? "ask-question-checkboxes" : "ask-question-options";
        const options = Array.isArray(q.options) ? q.options : [];
        let anyMatch = false;

        options.forEach(opt => {
            if (!opt || !opt.label) return;
            const hit = isPicked(opt.label);
            anyMatch = anyMatch || hit;
            if (q.multiSelect) {
                const lbl = document.createElement("label");
                lbl.className = "ask-question-check";
                if (opt.description) lbl.title = opt.description;
                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.checked = hit;
                cb.disabled = true;
                lbl.appendChild(cb);
                const span = document.createElement("span");
                span.textContent = opt.label;
                lbl.appendChild(span);
                opts.appendChild(lbl);
            } else {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "q-btn ask-question-btn" + (hit ? " selected" : "");
                btn.textContent = opt.label;
                if (opt.description) btn.title = opt.description;
                btn.disabled = true;
                opts.appendChild(btn);
            }
        });

        row.appendChild(opts);

        // A write-in answer matches no option label — surface it where the
        // live card's "Other" input sits.
        if (answer && !anyMatch) {
            const other = document.createElement("input");
            other.type = "text";
            other.className = "ask-question-other";
            other.value = answer;
            other.disabled = true;
            row.appendChild(other);
        }

        card.appendChild(row);
    });

    messages.appendChild(card);
}

// Click handler for file-links rendered by renderMarkdown. Path may be
// relative (resolved against the working directory on the C# side) or
// absolute; startLine/endLine are 1-based, 0 = plain open.
function openFileLink(el) {
    window.chrome.webview.postMessage({
        type: "open-file",
        path: el.dataset.path || "",
        startLine: parseInt(el.dataset.start || "0", 10) || 0,
        endLine: parseInt(el.dataset.end || "0", 10) || 0
    });
}

function addAttachment(filename, content, isBinary, filePath) {
    const imageExts = ["png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "tiff"];
    const ext = filename.split(".").pop().toLowerCase();
    const isImage = imageExts.includes(ext);

    const displayName = isImage ? `image${++imageCounter}.${ext}` : filename;

    const id = attachmentIdCounter++;
    attachments.set(id, { displayName, content: isBinary ? null : content, filePath: filePath || null, includeFile: false });

    const chip = document.createElement("div");
    chip.className = "attachment-chip attachment-binary";
    chip.dataset.attId = id;
    const nameClass = filePath ? "attachment-name clickable" : "attachment-name";
    chip.innerHTML = `<span class="${nameClass}" title="${filePath ? t("file.clickToOpen") : ""}">${displayName}</span><button class="attachment-remove" title="${t("common.remove")}">×</button>`;
    if (filePath) {
        chip.querySelector(".attachment-name").addEventListener("click", () => {
            window.chrome.webview.postMessage({ type: "open-file", path: filePath });
        });
    }
    chip.querySelector(".attachment-remove").addEventListener("click", () => {
        attachments.delete(id);
        chip.remove();
        document.getElementById(`q-card-${id}`)?.remove();
    });
    attachmentsEl.appendChild(chip);

    // Opt-in: skip the per-file confirmation and include it straight away — the
    // user explicitly attached it. confirmFile clears the pending chip styling;
    // they can still remove it via the × before sending.
    if (localStorage.getItem("autoIncludeAttachments") === "true") {
        confirmFile(id, true);
    } else {
        showFileQuestion(id, displayName);
    }
}

function showNoWorkspaceCard(path) {
    if (welcome) { welcome.remove(); welcome = null; }
    const card = document.createElement("div");
    card.className = "question-card";
    card.innerHTML = `
<div class="question-text">⚠️ ${t("card.noWorkspace", { path: escapeHtml(path) })}</div>`;
    messages.appendChild(card);
    autoScroll();
}

// detail is set only when the CLI rejected a turn already in flight (expired
// session): the pre-flight check can't see that coming, because ~/.claude.json
// keeps the account object with no token and no expiry in it. Showing the CLI's
// own wording matters — if the match in IsAuthFailure ever catches something
// that isn't an expiry, the real message is still on screen.
function showAuthRequiredCard(detail) {
    if (welcome) { welcome.remove(); welcome = null; }
    // Avoid stacking duplicate cards when several sends fail in a row.
    const last = messages.lastElementChild;
    if (last && last.classList && last.classList.contains("auth-required-card")) return;
    const expired = !!(detail && detail.trim());
    const card = document.createElement("div");
    card.className = "question-card auth-required-card";
    card.innerHTML = `
<div class="question-text">🔑 <strong>${expired ? t("card.sessionExpired") : t("card.notSignedIn")}</strong> ${expired
        ? t("card.expiredBody")
        : t("card.notSignedInBody")}</div>
${expired ? `<div class="claude-install-hint">${escapeHtml(detail.trim())}</div>` : ""}
<div class="question-buttons">
<button class="q-btn q-yes" onclick="startClaudeLogin(this.closest('.question-card'))">${expired ? t("card.signInAgain") : t("card.signIn")}</button>
</div>`;
    messages.appendChild(card);
    autoScroll();
}

function startClaudeLogin(card) {
    try { window.chrome.webview.postMessage({ type: "start-claude-login", cliPath: getCliPath() }); } catch (e) {}
    if (card && card.classList) card.classList.add("question-answered");
}

// The manual counterpart to the card above, for when nothing has failed yet:
// switching accounts, or recovering from an expiry whose wording slipped past
// IsAuthFailure. This is what `/login` would do in the CLI — that slash command
// is interactive-only and never reaches us, so the menu is the way in.
function reauthenticate() {
    document.getElementById("cmd-menu").classList.remove("open");
    startClaudeLogin(null);
}

function showClaudeNotFoundCard(detail) {
    if (welcome) { welcome.remove(); welcome = null; }
    // Avoid stacking duplicate cards when several sends fail in a row.
    const last = messages.lastElementChild;
    if (last && last.classList && last.classList.contains("claude-not-found-card")) return;
    const card = document.createElement("div");
    card.className = "question-card claude-not-found-card";
    card.innerHTML = `
<div class="question-text">🧩 ${t("card.notFound")}</div>
<div class="claude-install-hint">${t("card.notFoundHint")}</div>
<div class="question-buttons">
<button class="q-btn q-yes" onclick="startClaudeInstall(this.closest('.question-card'))">${t("card.installNpm")}</button>
</div>`;
    messages.appendChild(card);
    autoScroll();
}

function startClaudeInstall(card) {
    try { window.chrome.webview.postMessage({ type: "start-claude-install" }); } catch (e) {}
    if (card && card.classList) card.classList.add("question-answered");
}

// The session's context window is full: it can no longer be resumed, so every
// path that carries its transcript forward (a normal next turn, auto-resume, or
// an explicit resume) refails with "Prompt is too long" before doing any work.
// A fresh session is the only reliable way out. Suppress auto-resume right away
// so that even if the user ignores the card and just types, the next send won't
// drag the dead session back into the refail loop.
function showContextFullCard(detail) {
    _suppressNextAutoResume = true;
    if (welcome) { welcome.remove(); welcome = null; }
    // Avoid stacking duplicate cards when several sends fail in a row.
    const last = messages.lastElementChild;
    if (last && last.classList && last.classList.contains("context-full-card")) return;
    const card = document.createElement("div");
    card.className = "question-card context-full-card";
    card.innerHTML = `
<div class="question-text">🧠 ${t("card.contextFull")}</div>
${detail && detail.trim() ? `<div class="claude-install-hint">${escapeHtml(detail.trim())}</div>` : ""}
<div class="question-buttons">
<button class="q-btn q-yes" onclick="startNewSessionFromCard(this.closest('.question-card'))">${t("card.startNewSession")}</button>
</div>`;
    messages.appendChild(card);
    autoScroll();
}

function startNewSessionFromCard(card) {
    if (card && card.classList) card.classList.add("question-answered");
    clearChat();
}

// The selected model isn't on the account's plan and needs paid usage credits,
// so the turn failed on the way in. Unlike a full session, the conversation is
// still alive: the fix is to pick a model that is included (or add credits), so
// this card offers the model picker and a link to manage credits. Auto-resume is
// left alone on purpose — switching models and continuing the session is fine.
function showCreditsRequiredCard(detail) {
    if (welcome) { welcome.remove(); welcome = null; }
    // Avoid stacking duplicate cards when several sends fail in a row.
    const last = messages.lastElementChild;
    if (last && last.classList && last.classList.contains("credits-required-card")) return;
    const card = document.createElement("div");
    card.className = "question-card credits-required-card";
    card.innerHTML = `
<div class="question-text">💳 ${t("card.credits")}</div>
${detail && detail.trim() ? `<div class="claude-install-hint">${escapeHtml(detail.trim())}</div>` : ""}
<div class="question-buttons">
<button class="q-btn q-yes" onclick="chooseAnotherModelFromCard(this.closest('.question-card'))">${t("card.chooseModel")}</button>
<a class="q-btn" href="https://claude.ai/settings/usage" rel="noopener noreferrer">${t("card.manageCredits")}</a>
</div>`;
    messages.appendChild(card);
    autoScroll();
}

function chooseAnotherModelFromCard(card) {
    if (card && card.classList) card.classList.add("question-answered");
    showModelPicker();
}

function openSigninOverlay() {
    const overlay = document.getElementById("signin-overlay");
    if (overlay) overlay.classList.add("open");
}

function closeSigninOverlay() {
    const overlay = document.getElementById("signin-overlay");
    if (overlay) overlay.classList.remove("open");
}

function showFileQuestion(id, displayName) {
    if (welcome) {
        welcome.remove();
        welcome = null;
    }

    const card = document.createElement("div");
    card.className = "question-card";
    card.id = `q-card-${id}`;
    card.innerHTML = `
<div class="question-text">📎 <strong>${escapeHtml(displayName)}</strong> — ${t("file.question")}</div>
<div class="question-buttons">
<button class="q-btn q-yes" onclick="confirmFile(${id}, true)">${t("common.yes")}</button>
<button class="q-btn q-no" onclick="confirmFile(${id}, false)">${t("common.no")}</button>
</div>`;
    messages.appendChild(card);
    autoScroll();
}

function confirmFile(id, include) {
    const att = attachments.get(id);
    if (att) att.includeFile = include;

    const card = document.getElementById(`q-card-${id}`);
    if (card) {
        card.innerHTML = `<div class="question-text">📎 <strong>${escapeHtml(att?.displayName || "")}</strong> — ${include ? t("file.willSend") : t("file.ignored")}</div>`;
        card.classList.add("question-answered");
    }

    const chip = document.querySelector(`[data-att-id="${id}"]`);
    if (!include) {
        attachments.delete(id);
        chip?.remove();
    } else {
        chip?.classList.remove("attachment-binary");
    }
}

function insertAtCursor(text) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    textarea.value = textarea.value.substring(0, start) + text + textarea.value.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
    textarea.focus();
    updateTokenEstimate();
}

function renderHistory(sessions, scope, workspace) {
    historySessions = sessions || [];
    historyScope = scope || "all";
    historyWorkspaceName = workspace || null;

    const footer = document.getElementById("history-footer");
    if (footer) {
        if (historyScope === "workspace" && historyWorkspaceName) {
            footer.innerHTML = `📂 ${escapeHtml(historyWorkspaceName)}`;
        } else if (historyScope === "workspace") {
            footer.innerHTML = escapeHtml(t("history.footerWorkspace"));
        } else {
            footer.innerHTML = escapeHtml(t("history.footerAll"));
        }
    }

    renderHistoryList(historySessions, "");
}

function renderHistoryList(sessions, query) {
    const list = document.getElementById("history-list");
    const countEl = document.getElementById("history-count");
    if (countEl) countEl.textContent = (sessions && sessions.length) ? String(sessions.length) : "";
    if (!sessions || sessions.length === 0) {
        if (query) {
            list.innerHTML = `<div class="cmd-item" style="color:#555;font-family:inherit">${t("history.noMatches", { query: escapeHtml(query) })}</div>`;
        } else if (historyScope === "workspace") {
            list.innerHTML = `<div class="cmd-item history-empty">${t("history.noSessionsWorkspace")}<a href="#" onclick="event.preventDefault();document.getElementById('history-show-all').checked=true;onShowAllToggle();">${t("history.seeAll")}</a></div>`;
        } else {
            list.innerHTML = `<div class="cmd-item" style="color:#555;font-family:inherit">${t("history.noSessions")}</div>`;
        }
        return;
    }
    list.innerHTML = sessions.map(s => {
        const tok = s.tokens > 1000 ? `${(s.tokens / 1000).toFixed(1)}k tok` : `${s.tokens} tok`;
        const msgs = (s.messages != null) ? t("history.msgs", { n: s.messages, s: s.messages === 1 ? "" : "s" }) : "";
        const model = s.model
            ? `<span title="${t("history.lastModel", { model: escapeAttr(s.model) })}">${escapeHtml(historyModelLabel(s.model))}</span> · `
            : "";
        // Generated/custom title (V18) leads when present; the raw preview
        // stays reachable via tooltip.
        const label = s.title || s.preview;
        const tooltip = s.title ? ` title="${escapeAttr(s.preview)}"` : "";
        return `<div class="cmd-item history-item" data-session-id="${escapeAttr(s.id)}">
  <div class="history-header">
    <div class="history-preview"${tooltip} onclick="resumeSession('${escapeAttr(s.id)}')">${escapeHtml(label)}</div>
    <button class="history-action" onclick="startRenameSession('${escapeAttr(s.id)}')" title="${t("history.rename")}">✎</button>
    <button class="history-action" onclick="forkSession('${escapeAttr(s.id)}')" title="${t("history.fork")}">↳</button>
    <button class="history-action" onclick="viewSession('${escapeAttr(s.id)}')" title="${t("history.view")}">⤢</button>
    <button class="history-delete" onclick="deleteSession('${escapeAttr(s.id)}')" title="${t("history.delete")}">×</button>
  </div>
  <div class="history-date">${escapeHtml(s.date)} · ${model}${msgs}${tok}</div>
</div>`;
    }).join("");
}

// #21: the transcript stores the API id, often with a snapshot date
// (claude-haiku-4-5-20251001). Map it to the picker label; unknown ids fall
// back to the bare id without the "claude-" prefix.
function historyModelLabel(id) {
    const bare = String(id).replace(/-\d{8}$/, "");
    const known = modelList.find(m => m.id === bare);
    return known ? known.label : bare.replace(/^claude-/, "");
}

// D4: opens the past session's transcript as readable markdown in the editor.
function viewSession(sessionId) {
    try { window.chrome.webview.postMessage({ type: "view-session", sessionId }); } catch (e) {}
}

// D4: swaps the row's title for an inline input. Enter saves (empty clears the
// custom title, falling back to the generated one), Esc cancels.
function startRenameSession(sessionId) {
    const item = document.querySelector(`.history-item[data-session-id="${CSS.escape(sessionId)}"]`);
    if (!item) return;
    const previewEl = item.querySelector(".history-preview");
    const entry = historySessions.find(s => s.id === sessionId);
    if (!previewEl || !entry) return;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "history-rename-input";
    input.value = entry.title || "";
    input.placeholder = entry.preview || "";
    previewEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = save => {
        if (done) return;
        done = true;
        if (save) {
            const title = input.value.trim();
            entry.title = title || null;
            try { window.chrome.webview.postMessage({ type: "rename-session", sessionId, title }); } catch (e) {}
        }
        filterHistory(); // re-render with current search applied
    };
    input.addEventListener("keydown", e => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", () => finish(false));
    input.addEventListener("click", e => e.stopPropagation());
}

function resumeSession(sessionId) {
    document.getElementById("history-menu").classList.remove("open");
    showResumeOverlay();
    window.chrome.webview.postMessage({ type: "resume-session", sessionId });
}

// #12: same replay as resumeSession, but the extension resumes with
// --fork-session so claude mints a new session id instead of continuing to
// write into this one — the original stays exactly as it is on disk.
function forkSession(sessionId) {
    document.getElementById("history-menu").classList.remove("open");
    showResumeOverlay();
    window.chrome.webview.postMessage({ type: "resume-session", sessionId, fork: true });
}

function showResumeOverlay() {
    let ov = document.getElementById("resume-overlay");
    if (!ov) {
        ov = document.createElement("div");
        ov.id = "resume-overlay";
        ov.className = "resume-overlay";
        ov.innerHTML = `<div class="resume-overlay-inner"><span class="dots"><span>.</span><span>.</span><span>.</span></span><span>${t("history.loadingSession")}</span></div>`;
        document.body.appendChild(ov);
    }
    ov.classList.add("visible");
}

function hideResumeOverlay() {
    const ov = document.getElementById("resume-overlay");
    if (ov) ov.classList.remove("visible");
}

function escapeHtml(text) {

    const div = document.createElement("div");

    div.innerText = text;

    return div.innerHTML;
}

function deleteSession(sessionId) {
    if (!confirm(t("history.confirmDelete"))) return;
    window.chrome.webview.postMessage({ type: "delete-session", sessionId });
}

// ── Open usage window ─────────────────────────────────────────
function openUsageWindow() {
    window.chrome.webview.postMessage({ type: "open-usage" });
}

// ── Open MCP servers window ───────────────────────────────────
function openMcpWindow() {
    window.chrome.webview.postMessage({ type: "open-mcp" });
}

// ── Find in chat (Ctrl+F) ─────────────────────────────────────
let _findMatches = [];
let _findIndex = -1;

document.addEventListener("keydown", e => {
    if (e.ctrlKey && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        openFindBar();
        return;
    }
    if (e.key === "Escape" && document.getElementById("find-bar").classList.contains("open")) {
        e.preventDefault();
        closeFindBar();
    }
});

function openFindBar() {
    const bar = document.getElementById("find-bar");
    bar.classList.add("open");
    const input = document.getElementById("find-input");
    input.focus();
    input.select();
    if (input.value) runFind(input.value);
}

function closeFindBar() {
    document.getElementById("find-bar").classList.remove("open");
    clearFindHighlights();
    if (typeof textarea !== "undefined") textarea.focus();
}

function clearFindHighlights() {
    document.querySelectorAll(".find-match").forEach(m => {
        const text = document.createTextNode(m.textContent);
        m.parentNode.replaceChild(text, m);
    });
    document.querySelectorAll(".bubble").forEach(b => b.normalize());
    _findMatches = [];
    _findIndex = -1;
}

function runFind(query) {
    clearFindHighlights();
    if (!query) { updateFindCount(); return; }
    const q = query.toLowerCase();
    document.querySelectorAll(".bubble").forEach(b => highlightInNode(b, q));
    _findMatches = Array.from(document.querySelectorAll(".find-match"));
    _findIndex = _findMatches.length > 0 ? 0 : -1;
    setCurrentMatch();
    updateFindCount();
    if (_findIndex >= 0) scrollToMatch();
}

function highlightInNode(node, q) {
    if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue;
        const lower = text.toLowerCase();
        let idx = lower.indexOf(q);
        if (idx === -1) return;
        const frag = document.createDocumentFragment();
        let cursor = 0;
        while (idx !== -1) {
            if (idx > cursor) frag.appendChild(document.createTextNode(text.substring(cursor, idx)));
            const mark = document.createElement("span");
            mark.className = "find-match";
            mark.textContent = text.substring(idx, idx + q.length);
            frag.appendChild(mark);
            cursor = idx + q.length;
            idx = lower.indexOf(q, cursor);
        }
        if (cursor < text.length) frag.appendChild(document.createTextNode(text.substring(cursor)));
        node.parentNode.replaceChild(frag, node);
    } else if (node.nodeType === Node.ELEMENT_NODE && !node.classList.contains("find-match")) {
        Array.from(node.childNodes).forEach(c => highlightInNode(c, q));
    }
}

function setCurrentMatch() {
    _findMatches.forEach((m, i) => m.classList.toggle("current", i === _findIndex));
}

function updateFindCount() {
    document.getElementById("find-count").textContent =
        _findMatches.length === 0 ? "0/0" : `${_findIndex + 1}/${_findMatches.length}`;
}

function scrollToMatch() {
    if (_findIndex < 0) return;
    _findMatches[_findIndex].scrollIntoView({ block: "center", behavior: "smooth" });
}

function findNext() {
    if (_findMatches.length === 0) return;
    _findIndex = (_findIndex + 1) % _findMatches.length;
    setCurrentMatch();
    updateFindCount();
    scrollToMatch();
}

function findPrev() {
    if (_findMatches.length === 0) return;
    _findIndex = (_findIndex - 1 + _findMatches.length) % _findMatches.length;
    setCurrentMatch();
    updateFindCount();
    scrollToMatch();
}

document.getElementById("find-input").addEventListener("input", e => runFind(e.target.value));
document.getElementById("find-input").addEventListener("keydown", e => {
    if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) findPrev();
        else findNext();
    }
});

// ── Diff viewer ───────────────────────────────────────────────
function openDiffModal() {
    document.getElementById("diff-modal-overlay").classList.add("open");
    document.getElementById("diff-stat").textContent = "";
    document.getElementById("diff-body").innerHTML = `<span class="usage-loading">${t("diff.running")}</span>`;
    window.chrome.webview.postMessage({
        type: "get-diff",
        autoSave: autoSaveValues[+autoSaveSlider.value]
    });
}

function closeDiffModal() {
    document.getElementById("diff-modal-overlay").classList.remove("open");
}

let _diffFiles = [];
let _diffStat = "";
let _diffActive = null;

let _diffRawText = "";

function renderDiff(stat, diff) {
    _diffStat = stat || "";
    _diffRawText = diff || "";
    _diffFiles = parseDiffFiles(diff || "");
    _diffActive = null;
    paintDiffStat();
    paintDiffBody();
}

function parseDiffFiles(diff) {
    if (!diff) return [];
    const out = [];
    const parts = diff.split(/(?=^diff --git )/m);
    for (const part of parts) {
        if (!part.trim()) continue;
        const m = part.match(/^diff --git a\/(\S+) b\/\S+/m);
        if (m) out.push({ name: m[1], body: part.trimEnd() });
    }
    return out;
}

function paintDiffStat() {
    const el = document.getElementById("diff-stat");
    el.innerHTML = "";
    if (!_diffStat) return;
    const lines = _diffStat.split("\n");
    for (const raw of lines) {
        const line = raw.replace(/^\s+/, "");
        if (!line) continue;
        const m = line.match(/^([^\s|]+)\s*\|/);
        const file = m && _diffFiles.find(f => f.name === m[1]);
        if (file) {
            const btn = document.createElement("div");
            btn.className = "diff-file-link" + (_diffActive === m[1] ? " active" : "");
            btn.textContent = line;
            btn.onclick = () => toggleDiffFilter(m[1]);
            el.appendChild(btn);
        } else {
            const span = document.createElement("div");
            span.className = "diff-stat-line";
            span.textContent = line;
            el.appendChild(span);
        }
    }
}

function toggleDiffFilter(name) {
    _diffActive = (_diffActive === name) ? null : name;
    paintDiffStat();
    paintDiffBody();
}

function paintDiffBody() {
    const body = document.getElementById("diff-body");
    body.innerHTML = "";
    if (_diffFiles.length === 0) {
        // No parseable `diff --git` blocks. Show whatever diff text we got
        // (e.g. "Not a git repository. ... Initialize a repository in VS to
        // enable diffs.") instead of leaving the body empty. Wrap in a div
        // with pre-wrap so backend-supplied newlines (\n\n) actually break.
        if (_diffRawText) {
            const msg = document.createElement("div");
            msg.className = "diff-empty-message";
            msg.textContent = _diffRawText;
            body.appendChild(msg);
        } else if (!_diffStat) {
            body.textContent = t("diff.noChanges");
        }
        return;
    }
    const list = _diffActive ? _diffFiles.filter(f => f.name === _diffActive) : _diffFiles;
    for (let i = 0; i < list.length; i++) {
        if (i > 0) {
            const sep = document.createElement("div");
            sep.className = "diff-separator";
            body.appendChild(sep);
        }
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.className = "language-diff";
        code.textContent = list[i].body;
        pre.appendChild(code);
        body.appendChild(pre);
        if (typeof hljs !== "undefined") hljs.highlightElement(code);
    }
}

renderCustomCommands();
// ── Plugins panel (/plugin) ───────────────────────────────────
// Installed plugins, the marketplaces' catalog and the marketplaces themselves,
// all read and changed through `claude plugin …` on the host. One action at a time.
const PluginMsg = { List: "plugins-list", Action: "plugin-action", Data: "plugins-data", Result: "plugins-result" };
const PluginAction = {
    Install: "Install", Uninstall: "Uninstall", Enable: "Enable", Disable: "Disable", Update: "Update",
    MarketplaceAdd: "MarketplaceAdd", MarketplaceRemove: "MarketplaceRemove", MarketplaceUpdate: "MarketplaceUpdate"
};
const PluginsTab = { Installed: "installed", Discover: "discover", Marketplaces: "marketplaces" };
const PLUGIN_SCOPES = ["user", "project", "local"];   // what the host's PluginScope enum accepts
const PLUGINS_MAX_ROWS = 200;                          // the catalog has thousands; search narrows it

let _plugins = null;          // { installed, available, marketplaces } from the host
let _pluginsTab = PluginsTab.Installed;
let _pluginsBusy = null;      // target of the action in flight
let _pluginsStatusIsLoading = false;   // status line shows "Loading…" (cleared when data lands)

function openPluginsModal() {
    document.getElementById("plugins-modal-overlay").classList.add("open");
    setPluginsTab(_pluginsTab);
    requestPlugins();
}

function closePluginsModal() {
    document.getElementById("plugins-modal-overlay").classList.remove("open");
}

// keepStatus: refresh behind an action's "Done…" line instead of replacing it.
function requestPlugins(keepStatus) {
    if (!keepStatus) {
        setPluginsStatus(t("common.loading"));
        _pluginsStatusIsLoading = true;
    }
    window.chrome.webview.postMessage({ type: PluginMsg.List });
}

function setPluginsStatus(text, isError) {
    _pluginsStatusIsLoading = false;
    const el = document.getElementById("plugins-status");
    el.textContent = text || "";
    el.classList.toggle("error", !!isError);
}

function setPluginsTab(tab) {
    _pluginsTab = tab;
    document.querySelectorAll("#plugins-tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    document.getElementById("plugins-bar-mkt").hidden = tab !== PluginsTab.Marketplaces;
    document.getElementById("plugins-bar-search").hidden = tab === PluginsTab.Marketplaces;
    document.getElementById("plugins-scope").hidden = tab !== PluginsTab.Discover;
    renderPlugins();
}

function onPluginsData(d) {
    if (d.error || !d.catalog) { setPluginsStatus(t("plugins.loadFailed", { error: d.error || "" }), true); return; }
    _plugins = d.catalog;
    if (_pluginsStatusIsLoading) setPluginsStatus("");
    renderPlugins();
}

function pluginAction(action, target, scope) {
    if (_pluginsBusy !== null) return;
    _pluginsBusy = target;
    setPluginsStatus(t("plugins.running", { target: target || action }));
    window.chrome.webview.postMessage({
        type: PluginMsg.Action, pluginAction: action, pluginTarget: target,
        pluginScope: PLUGIN_SCOPES.includes(scope) ? scope : null
    });
    renderPlugins();
}

function onPluginsResult(d) {
    _pluginsBusy = null;
    if (d.ok) {
        setPluginsStatus(t("plugins.done", { target: d.target || d.action }));
        requestPlugins(true);
    } else {
        setPluginsStatus(t("plugins.failed", { error: d.error || "" }), true);
    }
    renderPlugins();
}

function addPluginMarketplace() {
    const input = document.getElementById("plugins-mkt-source");
    const source = input.value.trim();
    if (!source) return;
    input.value = "";
    pluginAction(PluginAction.MarketplaceAdd, source);
}

function confirmPluginAction(action, target, scope, question) {
    if (confirm(question)) pluginAction(action, target, scope);
}

function pluginsRow(title, chips, desc, buttons) {
    const row = document.createElement("div");
    row.className = "plugins-row";
    const body = document.createElement("div");
    body.className = "plugins-row-body";
    const head = document.createElement("div");
    head.className = "plugins-row-head";
    const name = document.createElement("span");
    name.className = "plugins-row-name";
    name.textContent = title;
    head.appendChild(name);
    for (const c of chips) {
        if (!c) continue;
        const chip = document.createElement("span");
        chip.className = "plugins-chip";
        chip.textContent = c;
        head.appendChild(chip);
    }
    body.appendChild(head);
    if (desc) {
        const d = document.createElement("div");
        d.className = "plugins-row-desc";
        d.textContent = desc;
        d.title = desc;
        body.appendChild(d);
    }
    row.appendChild(body);
    const actions = document.createElement("div");
    actions.className = "plugins-row-actions";
    for (const b of buttons) {
        const btn = document.createElement("button");
        btn.className = "plugins-btn" + (b.danger ? " danger" : "");
        btn.textContent = b.label;
        btn.disabled = _pluginsBusy !== null || !!b.disabled;
        btn.onclick = b.run;
        actions.appendChild(btn);
    }
    row.appendChild(actions);
    return row;
}

function renderPlugins() {
    const list = document.getElementById("plugins-list");
    if (!list) return;
    list.innerHTML = "";
    if (!_plugins) return;
    const q = document.getElementById("plugins-search").value.trim().toLowerCase();
    const matches = (...fields) => !q || fields.some(f => (f || "").toLowerCase().includes(q));
    const empty = key => {
        const el = document.createElement("div");
        el.className = "plugins-empty";
        el.textContent = t(key);
        list.appendChild(el);
    };

    if (_pluginsTab === PluginsTab.Installed) {
        const rows = _plugins.installed.filter(p => matches(p.id));
        if (!rows.length) return empty(_plugins.installed.length ? "plugins.noMatch" : "plugins.noneInstalled");
        for (const p of rows) {
            list.appendChild(pluginsRow(p.id, [p.version && "v" + p.version, p.scope, p.enabled ? null : t("plugins.disabled")], "", [
                p.enabled
                    ? { label: t("plugins.disable"), run: () => pluginAction(PluginAction.Disable, p.id, p.scope) }
                    : { label: t("plugins.enable"), run: () => pluginAction(PluginAction.Enable, p.id, p.scope) },
                { label: t("plugins.update"), run: () => pluginAction(PluginAction.Update, p.id, p.scope) },
                { label: t("plugins.uninstall"), danger: true,
                  run: () => confirmPluginAction(PluginAction.Uninstall, p.id, p.scope, t("plugins.confirmUninstall", { target: p.id })) }
            ]));
        }
        return;
    }

    if (_pluginsTab === PluginsTab.Discover) {
        const installed = new Set(_plugins.installed.map(p => p.id));
        const all = _plugins.available
            .filter(p => matches(p.name, p.description, p.marketplace))
            .sort((a, b) => (b.installs || 0) - (a.installs || 0));
        if (!all.length) return empty(_plugins.available.length ? "plugins.noMatch" : "plugins.noneAvailable");
        const scopeSelect = document.getElementById("plugins-scope");
        for (const p of all.slice(0, PLUGINS_MAX_ROWS)) {
            const isInstalled = installed.has(p.id);
            list.appendChild(pluginsRow(p.name, [p.marketplace, p.installs ? t("plugins.installs", { n: p.installs.toLocaleString() }) : null], p.description, [
                { label: isInstalled ? t("plugins.installed") : t("plugins.install"), disabled: isInstalled,
                  run: () => pluginAction(PluginAction.Install, p.id, scopeSelect.value) }
            ]));
        }
        if (all.length > PLUGINS_MAX_ROWS) {
            const more = document.createElement("div");
            more.className = "plugins-empty";
            more.textContent = t("plugins.more", { shown: PLUGINS_MAX_ROWS, total: all.length });
            list.appendChild(more);
        }
        return;
    }

    if (!_plugins.marketplaces.length) return empty("plugins.noMarketplaces");
    for (const m of _plugins.marketplaces) {
        list.appendChild(pluginsRow(m.name, [], m.source, [
            { label: t("plugins.update"), run: () => pluginAction(PluginAction.MarketplaceUpdate, m.name) },
            { label: t("plugins.remove"), danger: true,
              run: () => confirmPluginAction(PluginAction.MarketplaceRemove, m.name, null, t("plugins.confirmRemoveMkt", { target: m.name })) }
        ]));
    }
}
