// Minimal XML helpers over fast-xml-parser, shaped to mirror graph-builder's use
// of xml.etree: `parseXmlFile` returns the root element's children object, and
// `text(el, tag)` returns the first matching child's text (like ElementTree.find).
import * as fs from "fs";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: true,
  ignoreDeclaration: true,
  parseTagValue: false, // keep values as strings (e.g. "Lookup", not coerced)
  trimValues: true,
});

/** Parse an XML file and return the root element's value (its children), or null. */
export function parseXmlFile(path: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = fs.readFileSync(path, "utf8");
  } catch {
    return null;
  }
  return parseXml(raw);
}

export function parseXml(raw: string): Record<string, unknown> | null {
  try {
    const obj = parser.parse(raw) as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return null;
    const root = obj[keys[0]];
    return root && typeof root === "object" ? (root as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

/** First child text for `tag` (ElementTree.find semantics: first match wins). */
export function text(el: Record<string, unknown> | null | undefined, tag: string): string {
  if (!el) return "";
  let v = (el as Record<string, unknown>)[tag];
  if (Array.isArray(v)) v = v[0];
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && "#text" in (v as object)) return String((v as Record<string, unknown>)["#text"]);
  return "";
}

/** Coerce a fast-xml-parser child (absent | single | repeated) into an array. */
export function asArray<T = unknown>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Sub-element object for `tag` (or null) — for stepping into nested elements. */
export function child(el: Record<string, unknown> | null | undefined, tag: string): Record<string, unknown> | null {
  if (!el) return null;
  let v = (el as Record<string, unknown>)[tag];
  if (Array.isArray(v)) v = v[0];
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

/** Direct children named `tag`, as element objects (ElementTree `findall("sf:tag")`). */
export function asArrayObj(v: unknown): Record<string, unknown>[] {
  return asArray(v).filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
}

/** Every value (string or object), at any depth, under a key === `tag` — mirrors
 *  ElementTree `root.iter("tag")`. Recurses into matched elements too. */
export function collectByTag(nodeVal: unknown, tag: string, out: unknown[] = []): unknown[] {
  if (nodeVal == null || typeof nodeVal !== "object") return out;
  if (Array.isArray(nodeVal)) {
    for (const item of nodeVal) collectByTag(item, tag, out);
    return out;
  }
  for (const [k, v] of Object.entries(nodeVal as Record<string, unknown>)) {
    const values = Array.isArray(v) ? v : [v];
    if (k === tag) for (const vv of values) out.push(vv);
    for (const vv of values) if (vv && typeof vv === "object") collectByTag(vv, tag, out);
  }
  return out;
}

/** All descendant text values for `tag` (like `iter(tag)` keeping `.text`). */
export function iterText(root: Record<string, unknown> | null | undefined, tag: string): string[] {
  return collectByTag(root, tag).filter((v): v is string => typeof v === "string");
}

/** All descendant element objects for `tag` (like `iter(tag)` over elements). */
export function iterElements(root: Record<string, unknown> | null | undefined, tag: string): Record<string, unknown>[] {
  return collectByTag(root, tag).filter(
    (v): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v),
  );
}

/** All descendant text values whose key matches `tag` case-insensitively. */
export function iterTextCI(root: unknown, tagLower: string, out: string[] = []): string[] {
  if (root == null || typeof root !== "object") return out;
  if (Array.isArray(root)) {
    for (const item of root) iterTextCI(item, tagLower, out);
    return out;
  }
  for (const [k, v] of Object.entries(root as Record<string, unknown>)) {
    const values = Array.isArray(v) ? v : [v];
    if (k.toLowerCase() === tagLower) for (const vv of values) if (typeof vv === "string") out.push(vv);
    for (const vv of values) if (vv && typeof vv === "object") iterTextCI(vv, tagLower, out);
  }
  return out;
}
