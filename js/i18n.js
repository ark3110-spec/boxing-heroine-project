// Display-only localization. Canonical dialogue, IDs, rules and saved state stay
// in Japanese; translating a speaker must never affect sprite/voice selection.
export const LANGUAGE_STORAGE_KEY = "boxing-game-language";
const normalize = value => String(value).trim().replace(/\s+/g, " ");
const japanese = /[\u3040-\u30ff\u3400-\u9fff]/;
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let language = "ja";
try { if (globalThis.localStorage?.getItem(LANGUAGE_STORAGE_KEY) === "en") language = "en"; } catch { /* storage can be unavailable */ }
let catalog = {};
let available = false;
try {
  const response = await fetch("content/locales/en.json?v=20260920-pages-debug-a1");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  catalog = await response.json();
  available = catalog.version === 1 && typeof catalog.messages === "object";
} catch (error) { console.warn("[i18n] English catalog unavailable; using Japanese.", error); }
if (!available) language = "ja";
const messages = catalog.messages ?? {};
const patterns = Object.entries(messages).filter(([source]) => /\{\w+\}/.test(source)).map(([source, target]) => {
  const keys = [];
  let expression = "", cursor = 0;
  for (const run of source.matchAll(/(?:\{\w+\})+/g)) {
    expression += escapeRegex(source.slice(cursor, run.index));
    cursor = run.index + run[0].length;
    keys.push([...run[0].matchAll(/\{(\w+)\}/g)].map(match => match[1]));
    // Adjacent interpolation fields have no observable boundary in rendered
    // text. Translate their combined value once instead of splitting a word.
    expression += /^以上/.test(source.slice(cursor)) ? "([+-]?\\d+(?:\\.\\d+)?)" : "(.+?)";
  }
  expression += escapeRegex(source.slice(cursor));
  return { regex: new RegExp(`^${expression}$`), target, keys, weight: source.replace(/\{\w+\}/g, "").length };
}).sort((a, b) => b.weight - a.weight);
const fragments = Object.entries(messages).filter(([source]) => !source.includes("{")).sort((a, b) => b[0].length - a[0].length);
const cache = new Map();
export function getLanguage() { return language; }
export function englishAvailable() { return available; }
export function translate(value, locale = language, depth = 0) {
  const source = String(value ?? "");
  if (locale !== "en" || !source.trim() || depth > 5) return source;
  const key = normalize(source);
  const wrap = text => source.match(/^\s*/)[0] + text + source.match(/\s*$/)[0];
  if (Object.hasOwn(messages, key)) return wrap(messages[key]);
  if (!japanese.test(key)) return source;
  if (cache.has(key)) return wrap(cache.get(key));
  for (const pattern of patterns) {
    const match = key.match(pattern.regex);
    if (!match) continue;
    const values = Object.fromEntries(pattern.keys.flatMap((names, index) => names.map((name, part) => [name, part === 0 ? translate(match[index + 1], locale, depth + 1) : ""])));
    const translated = pattern.target.replace(/\{(\w+)\}/g, (token, name) => values[name] ?? token);
    if (!japanese.test(translated)) cache.set(key, translated);
    return wrap(translated);
  }
  // Composite labels/logs join already translated content with punctuation.
  // Longest matches win, and replacements are never processed a second time.
  let rest = key, translated = "";
  while (rest) {
    let best = null;
    for (const [ja, en] of fragments) {
      const at = rest.indexOf(ja);
      if (at >= 0 && (!best || at < best.at)) best = { at, ja, en };
      if (at === 0) break;
    }
    if (!best) { translated += rest; break; }
    translated += rest.slice(0, best.at) + best.en;
    rest = rest.slice(best.at + best.ja.length);
  }
  cache.set(key, translated);
  return wrap(translated);
}

const roots = new Set();
const sourceText = new WeakMap();
const sourceAttributes = new WeakMap();
const attributeNames = ["aria-label", "aria-description", "alt", "title", "placeholder"];
function convert(current, previous) {
  const source = previous && current === previous.output ? previous.source : current;
  const output = language === "en" ? translate(source) : source;
  return { source, output };
}
function localizeText(node) {
  if (!node.parentElement || node.parentElement.closest("script,style,textarea,[data-no-i18n]")) return;
  const previous = sourceText.get(node);
  const entry = convert(node.nodeValue, previous);
  sourceText.set(node, entry);
  if (node.nodeValue !== entry.output) node.nodeValue = entry.output;
}
function localizeAttributes(element) {
  if (element.closest("[data-no-i18n]")) return;
  const entries = sourceAttributes.get(element) ?? {};
  for (const name of attributeNames) {
    if (!element.hasAttribute(name)) continue;
    const current = element.getAttribute(name);
    const entry = convert(current, entries[name]);
    entries[name] = entry;
    if (current !== entry.output) element.setAttribute(name, entry.output);
  }
  sourceAttributes.set(element, entries);
}
export function localizeUI(root) {
  if (!root) return;
  if (root.nodeType === 3) { localizeText(root); return; }
  if (root.nodeType !== 1) return;
  localizeAttributes(root);
  const walker = root.ownerDocument.createTreeWalker(root, 1 | 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3) localizeText(node);
    else localizeAttributes(node);
  }
}
let originalTitle = "";
function updateDocumentLanguage(doc) {
  doc.documentElement.lang = language;
  doc.documentElement.style.setProperty("--fight-loading-text", JSON.stringify(translate("試合の準備中…")));
  doc.title = translate(originalTitle, language);
}
export function setLanguage(value) {
  if (!["ja", "en"].includes(value) || (value === "en" && !available)) return false;
  language = value;
  try { globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, language); } catch { /* session-only preference */ }
  if (typeof document !== "undefined") {
    updateDocumentLanguage(document);
  }
  roots.forEach(localizeUI);
  return true;
}
export function observeLocalizedUI(root) {
  roots.add(root);
  originalTitle = root.ownerDocument.title;
  updateDocumentLanguage(root.ownerDocument);
  localizeUI(root);
  // Covers asynchronous fight captions and the unchanged Zuika sequence. The
  // observer runs before painting, touches no IDs/HTML and cannot advance play.
  const observer = new MutationObserver(records => {
    const changed = new Set();
    for (const record of records) {
      if (record.type === "childList") record.addedNodes.forEach(node => changed.add(node));
      else changed.add(record.target);
    }
    changed.forEach(node => { if (root.contains(node)) localizeUI(node); });
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: attributeNames });
  return () => { observer.disconnect(); roots.delete(root); };
}
