"use strict";
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fold = s => s.toLowerCase().replace(/ё/g, "е");
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
};
const STATES = { none: "няма перакладу", stale: "рускі тэкст змяніўся", draft: "чарнавік", old: "з кнігі 2012", done: "гатова" };
const S = {
  nodes: new Map(), kids: new Map(), item: new Map(), chap: new Map(),
  dict: null, idx: null, chapter: LS.get("chapter", null), mode: LS.get("mode", "par"),
  filter: "all", q: "", editRu: null
};

/* ---------- сховішча (IndexedDB) ---------- */
const DB = {
  _db: null,
  db() {
    return this._db || (this._db = new Promise((res, rej) => {
      const r = indexedDB.open("pdd-editor", 1);
      r.onupgradeneeded = () => { r.result.createObjectStore("nodes", { keyPath: "id" }); r.result.createObjectStore("kv"); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  },
  async tx(store, mode, fn) {
    const db = await this.db();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const out = fn(t.objectStore(store));
      t.oncomplete = () => res(out ? out.result : undefined);
      t.onerror = () => rej(t.error);
    });
  },
  all() { return this.tx("nodes", "readonly", s => s.getAll()); },
  put(n) { return this.tx("nodes", "readwrite", s => s.put(n)); },
  get(k) { return this.tx("kv", "readonly", s => s.get(k)); },
  set(k, v) { return this.tx("kv", "readwrite", s => s.put(v, k)); }
};

/* ---------- мадэль ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const ctx = () => ({ item: S.item, chap: S.chap, byId: S.nodes });
const kids = id => S.kids.get(id || "") || [];
function walk(n, depth, fn) { fn(n, depth); for (const c of kids(n.id)) walk(c, depth + 1, fn); }
function rebuild() {
  S.kids = new Map(); S.item = new Map(); S.chap = new Map();
  for (const n of S.nodes.values()) {
    if (n.deleted) continue;
    const k = n.parent || "";
    if (!S.kids.has(k)) S.kids.set(k, []);
    S.kids.get(k).push(n);
    (n.kind === "chapter" ? S.chap : S.item).set(n.label, n.id);
  }
  for (const l of S.kids.values())
    l.sort((a, b) => a.order - b.order || String(a.label).localeCompare(String(b.label), undefined, { numeric: true }));
}
function nstate(n) {
  if (!n.be) return "none";
  if (n.ruBase !== n.ru) return "stale";
  return n.status || "draft";
}
let saveFlash;
function flash(t) {
  const el = $("#save");
  el.textContent = t;
  clearTimeout(saveFlash);
  saveFlash = setTimeout(() => (el.textContent = ""), 1500);
}
function touch(n) {
  n.updated = Date.now();
  DB.put(n).then(() => flash("Захавана ✓"), () => flash("Памылка захавання!"));
}
const timers = new Map();
function schedule(n) {
  clearTimeout(timers.get(n.id));
  timers.set(n.id, setTimeout(() => touch(n), 400));
}
function create(p) {
  const n = { id: uid(), parent: null, order: 0, kind: "item", label: "", ru: "", be: "", status: "draft",
              ruBase: "", deleted: false, updated: Date.now(), ...p };
  S.nodes.set(n.id, n);
  DB.put(n).catch(() => {});
  return n;
}
let toastTimer;
function toast(t) {
  const el = $("#toast");
  el.textContent = t;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), 4500);
}

/* ---------- слоўнік і падказкі ---------- */
const WORD = /[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*/g;
function edit1(a, b) { // адлегласць рэдагавання ≤ 1 (выпадны галосны: перекресток/перекрестка)
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const x = a.slice(i), y = b.slice(i);
  return x.length === y.length ? x.slice(1) === y.slice(1) : x.length > y.length ? x.slice(1) === y : y.slice(1) === x;
}
const similar = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 &&
  (a.startsWith(b) || b.startsWith(a)) && Math.abs(a.length - b.length) <= 2) ||
  (Math.min(a.length, b.length) >= 6 && edit1(a, b));
function buildIdx(pairs) {
  const groups = new Map(), buckets = new Map();
  for (const [ru, be] of pairs) {
    const ts = [...ru.matchAll(WORD)].map(m => ruStem(m[0]));
    if (!ts.length || (ts.length === 1 && ts[0].length < 3)) continue;
    const key = ts.join(" ");
    let g = groups.get(key);
    if (!g) { g = { key, stems: ts, items: new Map() }; groups.set(key, g); }
    if (!g.items.has(ru)) g.items.set(ru, []);
    if (!g.items.get(ru).includes(be)) g.items.get(ru).push(be);
  }
  for (const g of groups.values()) {
    const b = g.stems[0].slice(0, 3);
    if (!buckets.has(b)) buckets.set(b, []);
    buckets.get(b).push(g);
  }
  return { groups, buckets };
}
function findHit(toks, i, seg) {
  const cands = S.idx.buckets.get(toks[i].st.slice(0, 3));
  if (!cands) return null;
  let len = 0, hits = [];
  for (const g of cands) {
    const n = g.stems.length;
    if (i + n > toks.length || n < len) continue;
    let ok = true, exact = true;
    for (let j = 0; j < n && ok; j++) {
      const a = toks[i + j].st, b = g.stems[j];
      if (j && !/^\s+$/.test(seg.slice(toks[i + j - 1].e, toks[i + j].s))) ok = false;
      else if (a !== b) { exact = false; if (!similar(a, b)) ok = false; }
    }
    if (!ok) continue;
    if (n > len) { len = n; hits = []; }
    hits.push({ g, exact });
  }
  if (!hits.length) return null;
  hits.sort((x, y) => y.exact - x.exact);
  return { len, keys: hits.map(h => h.g.key) };
}
function hintHtml(seg) {
  const plain = s => esc(s).replace(/\n/g, "<br>");
  if (!S.idx) return plain(seg);
  const toks = [...seg.matchAll(WORD)].map(m => ({ s: m.index, e: m.index + m[0].length, st: ruStem(m[0]) }));
  let out = "", pos = 0;
  for (let i = 0; i < toks.length;) {
    const h = findHit(toks, i, seg);
    if (!h) { i++; continue; }
    const last = toks[i + h.len - 1];
    out += plain(seg.slice(pos, toks[i].s)) + `<span class="h" data-k="${esc(h.keys.join("|"))}">${esc(seg.slice(toks[i].s, last.e))}</span>`;
    pos = last.e;
    i += h.len;
  }
  return out + plain(seg.slice(pos));
}
const snip = n => (n.be || n.ru).replace(/\{[#?][^}]*\}/g, "…").slice(0, 140);
function richText(t, hint) {
  return t.split(/(\{[#?][^}]*\})/).map(p => {
    const m = p.match(/^\{([#?])([^}]*)\}$/);
    if (!m) return hint ? hintHtml(p) : esc(p).replace(/\n/g, "<br>");
    if (m[1] === "#") {
      const n = S.nodes.get(m[2]);
      return n && !n.deleted
        ? `<a class="ref" href="#" data-ref="${n.id}" title="${esc(snip(n))}">${esc(n.label)}</a>`
        : '<span class="ref bad" title="Пункт выдалены">?</span>';
    }
    return `<span class="ref bad" title="Такога пункта пакуль няма">${esc(m[2].replace(/^гл\./i, ""))}</span>`;
  }).join("");
}

/* ---------- вывад ---------- */
const OPT = [["draft", "чарнавік"], ["old", "з кнігі 2012"], ["done", "гатова"]];
function card(n, depth) {
  const st = nstate(n), ch = n.kind === "chapter", c = ctx();
  const refBad = n.be && refSig(n.ru) !== refSig(n.be);
  let body;
  if (S.mode === "read") {
    body = `<div class="rd">${n.be ? richText(n.be, false) : '<span class="muted">' + richText(n.ru, false) + "</span>"}</div>`;
  } else {
    const ruCol = S.editRu === n.id
      ? `<textarea class="ru-ed" aria-label="Рускі тэкст" rows="2">${esc(toDisplay(n.ru, c))}</textarea>`
      : `<div class="ru">${richText(n.ru, true) || '<span class="muted">(пуста)</span>'}<button class="mini" data-act="editru" title="Рэдагаваць рускі тэкст" aria-label="Рэдагаваць рускі тэкст">✎</button></div>`;
    const beCol = `<textarea class="be" aria-label="Беларускі пераклад" placeholder="Пераклад…" rows="2">${esc(toDisplay(n.be, c))}</textarea>`;
    body = `<div class="cols${S.mode === "be" ? " one" : ""}">${S.mode === "be" ? "" : ruCol}${beCol}</div>`;
  }
  const warn =
    (st === "stale" ? `<div class="warn">Рускі тэкст змяніўся пасля перакладу. <button data-act="ack">Пазначыць праверанай</button>` +
      `<details><summary>Што было</summary>${richText(n.ruBase || "", false)}</details></div>` : "") +
    (refBad ? '<div class="warn">Спасылкі ў рускім і беларускім тэкстах не супадаюць.</div>' : "");
  const chip = st === "none" || st === "stale" ? `<span class="chip">${STATES[st]}</span>` : "";
  return `<article class="card${ch ? " ch" : ""}" data-id="${n.id}" data-d="${depth}" data-st="${st}" style="--d:${depth}">
<div class="bar">${ch ? '<span class="lt">Глава</span>' : ""}<input class="lab" value="${esc(n.label)}" size="7" aria-label="Нумар" placeholder="нумар">
<select class="stsel" aria-label="Статус">${OPT.map(([v, t]) => `<option value="${v}"${(n.status || "draft") === v ? " selected" : ""}>${t}</option>`).join("")}</select>${chip}
<span class="sp"></span>
<button class="mini" data-act="up" title="Вышэй" aria-label="Вышэй">↑</button><button class="mini" data-act="down" title="Ніжэй" aria-label="Ніжэй">↓</button>
<button class="mini" data-act="add" title="Дадаць пасля" aria-label="Дадаць пасля">＋</button><button class="mini" data-act="addchild" title="Дадаць падпункт" aria-label="Дадаць падпункт">↳</button>
<button class="mini" data-act="del" title="Выдаліць" aria-label="Выдаліць">✕</button></div>${body}${warn}</article>`;
}
function matches(n) {
  if (S.q.trim() && !fold(n.ru + " " + n.be + " " + n.label).includes(fold(S.q.trim()))) return false;
  const f = S.filter;
  if (f === "all") return true;
  if (f === "refs") return !!n.be && refSig(n.ru) !== refSig(n.be);
  return nstate(n) === f;
}
const grow = ta => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + 2 + "px"; };
function renderTree() {
  $("#tree").innerHTML = kids("").map(c => {
    let t = 0, d = 0;
    walk(c, 0, n => { t++; const s = nstate(n); if (s !== "none" && s !== "stale") d++; });
    const title = (c.be || c.ru).replace(/\{[#?][^}]*\}/g, "");
    return `<button class="ti${c.id === S.chapter ? " on" : ""}" data-ch="${c.id}"><span>Глава ${esc(c.label)}. ${esc(title)}</span><small>${d}/${t}</small></button>`;
  }).join("") || '<p class="muted pad">Глаў пакуль няма. Імпартуйце тэкст або дадайце главу.</p>';
}
function renderPane() {
  const searching = !!S.q.trim();
  const roots = searching ? kids("") : [S.nodes.get(S.chapter)].filter(Boolean);
  const list = [];
  for (const r of roots) walk(r, 0, (n, d) => { if (list.length < 150 && matches(n)) list.push([n, d]); });
  $("#pane").innerHTML = list.length ? list.map(([n, d]) => card(n, d)).join("")
    : '<p class="muted">Нічога няма. Змяніце фільтр або пошук.</p>';
  $("#cnt").textContent = searching ? `Знойдзена: ${list.length}${list.length >= 150 ? "+" : ""}` : "";
  $("#pane").querySelectorAll("textarea").forEach(grow);
}
function renderAll() {
  renderTree();
  renderPane();
  $("#dinfo").textContent = S.dict ? `Слоўнік: ${S.dict.pairs.length} пар, версія ${S.dict.version ?? "?"}` : "Слоўнік не загружаны";
}
function refreshCard(id) {
  const el = $(`.card[data-id="${id}"]`), n = S.nodes.get(id);
  if (!el || !n) return;
  el.outerHTML = card(n, +el.dataset.d);
  $(`.card[data-id="${id}"]`).querySelectorAll("textarea").forEach(grow);
}
function goto(id) {
  let n = S.nodes.get(id);
  if (!n) return;
  let ch = n;
  while (ch.parent) ch = S.nodes.get(ch.parent);
  S.q = ""; S.filter = "all"; S.chapter = ch.id;
  $("#q").value = ""; $("#flt").value = "all";
  LS.set("chapter", S.chapter);
  document.body.classList.remove("drawer");
  renderAll();
  const el = $(`.card[data-id="${id}"]`);
  if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1600); }
}

/* ---------- дзеянні над вузламі ---------- */
const nextLabel = l => {
  const p = String(l).split(".");
  const last = parseInt(p.pop(), 10);
  return isNaN(last) ? "" : p.concat(String(last + 1)).join(".");
};
function openNew(n) {
  S.editRu = n.id;
  rebuild();
  renderAll();
  const el = $(`.card[data-id="${n.id}"] .ru-ed`) || $(`.card[data-id="${n.id}"] .be`);
  if (el) { el.scrollIntoView({ block: "center" }); el.focus(); }
}
function act(btn) {
  const card = btn.closest(".card"), n = card && S.nodes.get(card.dataset.id), a = btn.dataset.act;
  if (!n) return;
  if (a === "editru") {
    S.editRu = n.id;
    refreshCard(n.id);
    const t = $(`.card[data-id="${n.id}"] .ru-ed`);
    if (t) t.focus();
  } else if (a === "ack") {
    n.ruBase = n.ru; touch(n); refreshCard(n.id); renderTree();
  } else if (a === "up" || a === "down") {
    const arr = kids(n.parent).slice(), i = arr.indexOf(n), j = a === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    arr.forEach((s, k) => { if (s.order !== k) { s.order = k; touch(s); } });
    rebuild(); renderPane();
    const el = $(`.card[data-id="${n.id}"]`); if (el) el.scrollIntoView({ block: "nearest" });
  } else if (a === "add") {
    const arr = kids(n.parent), next = arr[arr.indexOf(n) + 1];
    openNew(create({ parent: n.parent, kind: n.kind, label: nextLabel(n.label), order: next ? (n.order + next.order) / 2 : n.order + 1 }));
  } else if (a === "addchild") {
    const k = kids(n.id), last = k[k.length - 1];
    const label = last ? nextLabel(last.label) : n.kind === "item" ? n.label + ".1" : "";
    openNew(create({ parent: n.id, kind: "item", label, order: last ? last.order + 1 : 0 }));
  } else if (a === "del") {
    if (!confirm("Выдаліць разам з укладзенымі пунктамі?")) return;
    const all = [];
    walk(n, 0, x => all.push(x));
    all.forEach(x => { x.deleted = true; touch(x); });
    rebuild();
    if (!S.nodes.get(S.chapter) || S.nodes.get(S.chapter).deleted) S.chapter = kids("")[0] ? kids("")[0].id : null;
    renderAll();
  }
}
function insertInto(ta, text) {
  const s = ta.dataset.s !== undefined ? +ta.dataset.s : ta.value.length;
  const e = ta.dataset.e !== undefined ? +ta.dataset.e : s;
  ta.setRangeText(text, s, e, "end");
  ta.dataset.s = ta.dataset.e = String(ta.selectionEnd);
  ta.focus();
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}

/* ---------- падказка са слоўніка ---------- */
const pop = $("#pop");
let popTimer;
function showPop(el) {
  clearTimeout(popTimer);
  let html = "";
  for (const k of el.dataset.k.split("|")) {
    const g = S.idx && S.idx.groups.get(k);
    if (!g) continue;
    for (const [ru, trs] of g.items)
      html += `<div class="pr"><b>${esc(ru)}</b> → ${trs.map(t => `<button class="ins" data-t="${esc(t)}">${esc(t)}</button>`).join("")}</div>`;
  }
  pop.innerHTML = html;
  pop.dataset.card = el.closest(".card").dataset.id;
  pop.hidden = false;
  const r = el.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + "px";
  const below = r.bottom + 4;
  pop.style.top = (below + pop.offsetHeight > innerHeight ? Math.max(8, r.top - pop.offsetHeight - 4) : below) + "px";
}
const hidePopSoon = () => { clearTimeout(popTimer); popTimer = setTimeout(() => (pop.hidden = true), 250); };

/* ---------- імпарт тэксту ---------- */
function importPreview() {
  const { items, cont } = parseDoc($("#impText").value);
  const ch = items.filter(i => i.kind === "chapter").length;
  $("#impInfo").textContent = items.length
    ? `Знойдзена: глаў ${ch}, пунктаў ${items.length - ch}; радкоў, далучаных да папярэдняга: ${cont}.`
    : "Тэкст пакуль не распазнаны.";
}
function doImport() {
  const kind = document.querySelector("input[name=kind]:checked").value;
  const { items } = parseDoc($("#impText").value);
  let chap = null, added = 0, changed = 0, missed = 0, seq = 0;
  const local = new Map(), pending = [];
  for (const it of items) {
    seq++;
    if (it.kind === "chapter") {
      chap = S.nodes.get(S.chap.get(it.label)) || null;
      if (!chap && kind === "ru") {
        chap = create({ kind: "chapter", label: it.label, order: seq });
        S.chap.set(it.label, chap.id);
        added++;
      }
      local.clear();
      if (chap) {
        chap.order = seq;
        walk(chap, 0, n => { if (n !== chap) local.set(n.label, n); });
        pending.push([chap, it.text]);
      } else missed++;
      continue;
    }
    if (!chap) { missed++; continue; }
    let n = local.get(it.label);
    if (!n) {
      if (kind === "be") { missed++; continue; }
      const parts = it.label.split(".");
      const par = parts.length > 1 ? local.get(parts.slice(0, -1).join(".")) || chap : chap;
      n = create({ parent: par.id, kind: "item", label: it.label, order: seq });
      local.set(it.label, n);
      added++;
    } else if (kind === "ru") n.order = seq;
    pending.push([n, it.text]);
  }
  rebuild();
  for (const [n, raw] of pending) {
    const stored = toStored(autoLink(raw), ctx());
    if (kind === "ru") {
      if (n.ru !== stored) { if (n.be) changed++; n.ru = stored; }
    } else if (n.be !== stored) {
      n.be = stored; n.ruBase = n.ru; n.status = "old";
    }
    touch(n);
  }
  rebuild();
  if (!S.nodes.get(S.chapter) || S.nodes.get(S.chapter).deleted) S.chapter = kids("")[0] ? kids("")[0].id : null;
  renderAll();
  toast(kind === "ru"
    ? `Новых: ${added}. Пераклады, у якіх змяніўся рускі тэкст: ${changed} (фільтр «Рускі тэкст змяніўся»).`
    : `Перакладзена па нумарах: ${pending.length}. Не знойдзена адпаведнікаў: ${missed}.`);
}

/* ---------- файлы: экспарт, імпарт, слоўнік ---------- */
function exportFile() {
  const data = { format: "pdd-translation", v: 1, exported: new Date().toISOString(), nodes: [...S.nodes.values()] };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
  a.download = "pdd-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
async function importFile(file) {
  let obj;
  try { obj = JSON.parse(await file.text()); } catch (e) { return toast("Не атрымалася прачытаць файл."); }
  if (obj.format !== "pdd-translation" || !Array.isArray(obj.nodes)) return toast("Гэта не файл працы з рэдактара.");
  let added = 0, took = 0, kept = 0;
  for (const n of obj.nodes) {
    const l = S.nodes.get(n.id);
    if (!l) { S.nodes.set(n.id, n); await DB.put(n).catch(() => {}); added++; }
    else if (n.updated > l.updated) { S.nodes.set(n.id, n); await DB.put(n).catch(() => {}); took++; }
    else if (n.updated < l.updated) kept++;
  }
  rebuild();
  if (!S.nodes.get(S.chapter) || S.nodes.get(S.chapter).deleted) S.chapter = kids("")[0] ? kids("")[0].id : null;
  renderAll();
  toast(`Новых: ${added}. Узята з файла (свежае): ${took}. Пакінута маё (свежае): ${kept}.`);
}
async function importDict(file) {
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.pairs)) throw 0;
    S.dict = { version: d.version, pairs: d.pairs };
    S.idx = buildIdx(d.pairs);
    await DB.set("dict", S.dict).catch(() => {});
    renderAll();
    toast(`Слоўнік загружаны: ${d.pairs.length} пар.`);
  } catch (e) { toast("Гэта не words.json са слоўніка."); }
}

/* ---------- падзеі ---------- */
const nodeOf = el => { const c = el.closest(".card"); return c && S.nodes.get(c.dataset.id); };
function bind() {
  const pane = $("#pane");
  pane.addEventListener("click", e => {
    const b = e.target.closest("[data-act]");
    if (b) return act(b);
    const r = e.target.closest("[data-ref]");
    if (r) { e.preventDefault(); return goto(r.dataset.ref); }
    const h = e.target.closest(".h");
    if (h) showPop(h);
  });
  pane.addEventListener("mouseover", e => { const h = e.target.closest(".h"); if (h) showPop(h); });
  pane.addEventListener("mouseout", e => { if (e.target.closest(".h")) hidePopSoon(); });
  pop.addEventListener("mouseenter", () => clearTimeout(popTimer));
  pop.addEventListener("mouseleave", hidePopSoon);
  pop.addEventListener("click", e => {
    const b = e.target.closest(".ins");
    const ta = b && $(`.card[data-id="${pop.dataset.card}"] textarea.be`);
    if (ta) insertInto(ta, b.dataset.t);
  });
  document.addEventListener("click", e => { if (!e.target.closest(".h, #pop")) pop.hidden = true; });

  pane.addEventListener("input", e => {
    const ta = e.target;
    if (ta.matches("textarea")) grow(ta);
    if (ta.matches("textarea.be")) {
      const n = nodeOf(ta);
      const wasEmpty = !n.be;
      n.be = toStored(autoLink(ta.value), ctx());
      if (wasEmpty && n.be) n.ruBase = n.ru;
      const sel = ta.closest(".card").querySelector(".stsel");
      if (n.status !== "draft") { n.status = "draft"; sel.value = "draft"; }
      ta.closest(".card").dataset.st = nstate(n);
      schedule(n);
    }
  });
  pane.addEventListener("focusout", e => {
    const ta = e.target;
    if (ta.matches("textarea.be")) { ta.dataset.s = ta.selectionStart; ta.dataset.e = ta.selectionEnd; renderTree(); }
    else if (ta.matches("textarea.ru-ed")) {
      const n = nodeOf(ta);
      n.ru = toStored(autoLink(ta.value), ctx());
      S.editRu = null;
      touch(n);
      refreshCard(n.id);
      renderTree();
    }
  });
  pane.addEventListener("change", e => {
    const n = nodeOf(e.target);
    if (!n) return;
    if (e.target.matches(".lab")) { n.label = e.target.value.trim(); touch(n); rebuild(); renderTree(); }
    else if (e.target.matches(".stsel")) { n.status = e.target.value; touch(n); e.target.closest(".card").dataset.st = nstate(n); renderTree(); }
  });

  $("#tree").addEventListener("click", e => {
    const b = e.target.closest("[data-ch]");
    if (!b) return;
    S.chapter = b.dataset.ch; LS.set("chapter", S.chapter);
    S.q = ""; $("#q").value = "";
    document.body.classList.remove("drawer");
    renderAll();
    scrollTo(0, 0);
  });
  $("#addch").onclick = () => {
    const k = kids(""), last = k[k.length - 1];
    const n = create({ kind: "chapter", label: last ? nextLabel(last.label) : "1", order: last ? last.order + 1 : 0 });
    S.chapter = n.id; LS.set("chapter", n.id);
    openNew(n);
  };
  $("#menu").onclick = () => document.body.classList.toggle("drawer");
  $("#shade").onclick = () => document.body.classList.remove("drawer");
  $("#more").onclick = () => { const p = $("#panel"); p.hidden = !p.hidden; $("#more").setAttribute("aria-expanded", String(!p.hidden)); };
  $("#q").addEventListener("input", e => { S.q = e.target.value; renderPane(); });
  $("#mode").onchange = e => { S.mode = e.target.value; LS.set("mode", S.mode); S.editRu = null; renderPane(); };
  $("#flt").onchange = e => { S.filter = e.target.value; renderPane(); };

  $("#bImpText").onclick = () => { $("#panel").hidden = true; $("#impText").value = ""; importPreview(); $("#dlg").showModal(); };
  $("#impText").addEventListener("input", importPreview);
  $("#impGo").onclick = e => { e.preventDefault(); $("#dlg").close(); doImport(); };
  $("#bImpFile").onclick = () => $("#fileIn").click();
  $("#fileIn").onchange = e => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ""; $("#panel").hidden = true; };
  $("#bExp").onclick = () => { exportFile(); $("#panel").hidden = true; };
  $("#bDict").onclick = () => $("#dictIn").click();
  $("#dictIn").onchange = e => { if (e.target.files[0]) importDict(e.target.files[0]); e.target.value = ""; $("#panel").hidden = true; };
  $("#bTheme").onclick = () => {
    const el = document.documentElement;
    const dark = el.dataset.theme ? el.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    el.dataset.theme = dark ? "light" : "dark";
    LS.set("theme", el.dataset.theme);
  };
}

(async () => {
  try {
    (await DB.all()).forEach(n => S.nodes.set(n.id, n));
    S.dict = (await DB.get("dict")) || null;
  } catch (e) { toast("Сховішча браўзера недаступнае: змены не захоўваюцца!"); }
  if (S.dict) S.idx = buildIdx(S.dict.pairs);
  rebuild();
  if (!S.nodes.has(S.chapter) || S.nodes.get(S.chapter).deleted) S.chapter = kids("")[0] ? kids("")[0].id : null;
  if (!["par", "be", "read"].includes(S.mode)) S.mode = "par";
  $("#mode").value = S.mode;
  bind();
  renderAll();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
