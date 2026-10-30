"use strict";
// Чыстыя функцыі: разбор тэксту ПДР на главы/пункты і работа са спасылкамі.
(function (root) {
  // Глава N. Назва / 12. тэкст / 12.3. тэкст / 12.3.1 тэкст; астатнія радкі = працяг папярэдняга
  function parseDoc(text) {
    const items = [], seen = new Set();
    let lastTop = 0, cont = 0;
    for (const raw of text.split(/\r?\n/)) {
      const t = raw.trim();
      if (!t) continue;
      let m = t.match(/^глава\s+(\d+)\s*[.:]?\s*(.*)$/i);
      if (m) { items.push({ kind: "chapter", label: m[1], text: m[2] }); seen.clear(); continue; }
      m = t.match(/^(\d+(?:\.\d+)*)\.?\s+(\S.*)$/);
      if (m) {
        const parts = m[1].split(".");
        let ok;
        if (parts.length === 1) { const n = +parts[0]; ok = n === 1 || (n > lastTop && n - lastTop <= 5); }
        else ok = seen.has(parts.slice(0, -1).join("."));
        if (ok) {
          items.push({ kind: "item", label: m[1], text: m[2] });
          seen.add(m[1]);
          if (parts.length === 1) lastTop = +parts[0];
          continue;
        }
      }
      if (items.length) { items[items.length - 1].text += "\n" + t; cont++; }
    }
    return { items, cont };
  }

  const NUM = "\\d+(?:\\.\\d+)*";
  const REF = new RegExp("((?:подпункт|падпункт|пункт|глав|раздел|раздзел)[а-яёіў]*)\\s+(" + NUM +
    "(?:\\s*(?:,|и|или|і|ці|або|ды)\\s*" + NUM + ")*)", "gi");
  // «пункта 5.1 и 5.2» → «пункта [[5.1]] и [[5.2]]»; «главы 3» → «главы [[гл.3]]»
  function autoLink(t) {
    return t.replace(REF, (all, word, nums) => {
      const pre = /^(глав|раздел|раздзел)/i.test(word) ? "гл." : "";
      return word + " " + nums.replace(new RegExp(NUM, "g"), n => "[[" + pre + n + "]]");
    });
  }
  // [[5.1]] ↔ {#id}; нязнойдзеная спасылка захоўваецца як {?5.1}
  function toStored(t, ctx) {
    return t.replace(/\[\[([^\]]+)\]\]/g, (a, l) => {
      l = l.trim();
      const ch = /^гл\./i.test(l), lab = ch ? l.slice(3).trim() : l;
      const id = (ch ? ctx.chap : ctx.item).get(lab);
      return id ? "{#" + id + "}" : "{?" + (ch ? "гл." : "") + lab + "}";
    });
  }
  function toDisplay(t, ctx) {
    return t
      .replace(/\{#([a-z0-9]+)\}/g, (a, id) => {
        const n = ctx.byId.get(id);
        return n && !n.deleted ? "[[" + (n.kind === "chapter" ? "гл." : "") + n.label + "]]" : "[[?]]";
      })
      .replace(/\{\?([^}]*)\}/g, "[[$1]]");
  }
  const refSig = t => (t.match(/\{[#?][^}]*\}/g) || []).sort().join(",");

  const api = { parseDoc, autoLink, toStored, toDisplay, refSig };
  Object.assign(root, api);
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
