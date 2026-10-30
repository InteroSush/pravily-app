"use strict";
// Стэмер рускай мовы (алгарытм Snowball). Прыводзіць формы слова да асновы.
(function (root) {
  const V = "аеиоуыэюя";
  const L = s => s.split(" ");
  const ADJ = L("ее ие ые ое ими ыми ей ий ый ой ем им ым ом его ого ему ому их ых ую юю ая яя ою ею");
  const PART1 = L("ем нн вш ющ щ"), PART2 = L("ивш ывш ующ");
  const PG1 = L("в вши вшись"), PG2 = L("ив ивши ившись ыв ывши ывшись");
  const VERB1 = L("ла на ете йте ли й л ем н ло но ет ют ны ть ешь нно");
  const VERB2 = L("ила ыла ена ейте уйте ите или ыли ей уй ил ыл им ым ен ило ыло ено ят ует уют ит ыт ены ить ыть ишь ую ю");
  const NOUN = L("а ев ов ие ье е иями ями ами еи ии и ией ей ой ий й иям ям ием ем ам ом о у ах иях ях ы ь ю ию ью я ия ья");

  // найдаўжэйшае канчатак; g1 патрабуе перад сабой «а» або «я» ўнутры RV
  function cut(s, g2, g1) {
    let best = -1;
    for (const e of g2) if (e.length > best && s.endsWith(e)) best = e.length;
    for (const e of g1)
      if (e.length > best && s.length > e.length && s.endsWith(e) && "ая".includes(s[s.length - e.length - 1])) best = e.length;
    return best < 0 ? null : s.slice(0, s.length - best);
  }

  function stem(word) {
    const w = word.toLowerCase().replace(/ё/g, "е");
    let v = -1;
    for (let i = 0; i < w.length; i++) if (V.includes(w[i])) { v = i; break; }
    if (v < 0) return w;
    const rvStart = v + 1;
    const region = from => {
      for (let i = from; i < w.length - 1; i++) if (V.includes(w[i]) && !V.includes(w[i + 1])) return i + 2;
      return w.length;
    };
    const r2 = region(region(0));
    const head = w.slice(0, rvStart);
    let rv = w.slice(rvStart), x;

    if ((x = cut(rv, PG2, PG1)) !== null) rv = x;
    else {
      if ((x = cut(rv, ["ся", "сь"], [])) !== null) rv = x;
      if ((x = cut(rv, ADJ, [])) !== null) {
        rv = x;
        if ((x = cut(rv, PART2, PART1)) !== null) rv = x;
      } else if ((x = cut(rv, VERB2, VERB1)) !== null) rv = x;
      else if ((x = cut(rv, NOUN, [])) !== null) rv = x;
    }
    if (rv.endsWith("и")) rv = rv.slice(0, -1);
    let f = head + rv;
    if (f.endsWith("ость") && f.length - 4 >= r2) f = f.slice(0, -4);
    else if (f.endsWith("ост") && f.length - 3 >= r2) f = f.slice(0, -3);

    if (f.endsWith("нн")) f = f.slice(0, -1);
    else {
      const s = f.endsWith("ейше") ? 4 : f.endsWith("ейш") ? 3 : 0;
      if (s && f.length - s >= rvStart) {
        f = f.slice(0, -s);
        if (f.endsWith("нн")) f = f.slice(0, -1);
      } else if (f.endsWith("ь")) f = f.slice(0, -1);
    }
    return f;
  }
  root.ruStem = stem;
  if (typeof module !== "undefined") module.exports = stem;
})(typeof window !== "undefined" ? window : globalThis);
