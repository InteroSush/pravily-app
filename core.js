"use strict";
// Чыстыя функцыі: работа са спасылкамі на пункты.
(function (root) {
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

  const api = { autoLink, toStored, toDisplay, refSig };
  Object.assign(root, api);
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
