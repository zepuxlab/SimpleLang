declare const __html__: string;

interface LocaleBlock {
  localeSuffix: string;
  byLayerName: Map<string, string>;
}

interface TextNodeEntry {
  node: TextNode;
  layerName: string;
}

interface UIMessage {
  type: string;
  translationList?: string;
  mcpToken?: string;
}

const MCP_TOKEN_KEY = "simplelang_mcp_token";

const LOCALE_REGEX = /^\d{2}_[A-Z]{2}$/i;
const KEY_REGEX = /^(title|sub|subtitle|desc|description)\s+(.*)$/i;
const NAME_LOCALE_NN_LL = /\d{2}_[A-Z]{2}/i;
const DEFAULT_SOURCE_EN = /^\d{2}_EN$/i;

const LAYER_ALIASES: Record<string, string> = {
  sub: "subtitle",
  subtitle: "subtitle",
  title: "title",
  desc: "desc",
  description: "desc",
};

function normalizeTextForDisplay(s: string): string {
  const lines = s.replace(/\r\n|\r/g, "\n").split("\n");
  return lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeLayerKey(name: string): string {
  const lower = name.trim().toLowerCase();
  if (LAYER_ALIASES[lower]) return LAYER_ALIASES[lower];
  if (lower.includes("subtitle") || (lower.includes("sub") && !lower.includes("subtitled"))) return "subtitle";
  if (lower.includes("title")) return "title";
  if (lower.includes("desc")) return "desc";
  return lower;
}

function parseTranslationList(raw: string): LocaleBlock[] {
  const blocks: LocaleBlock[] = [];
  const lines = raw.split(/\r?\n/);
  let currentLocale = "";
  let byLayerName = new Map<string, string>();
  let lastKey: string | null = null;

  function flush(): void {
    if (currentLocale && byLayerName.size > 0) {
      blocks.push({ localeSuffix: currentLocale, byLayerName: new Map(byLayerName) });
    }
    byLayerName = new Map<string, string>();
    lastKey = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (LOCALE_REGEX.test(t)) {
      flush();
      currentLocale = t;
      continue;
    }
    if (!t) continue;
    const keyMatch = t.match(KEY_REGEX);
    if (keyMatch) {
      lastKey = normalizeLayerKey(keyMatch[1]);
      const val = keyMatch[2].trim();
      byLayerName.set(lastKey, val);
    } else if (lastKey !== null) {
      const prev = byLayerName.get(lastKey) || "";
      byLayerName.set(lastKey, prev ? prev + "\n" + t : t);
    }
  }
  flush();
  return blocks;
}

function findSourceFrames(): SceneNode[] {
  const selection = figma.currentPage.selection.slice();
  if (selection.length > 0) return selection;
  const children = figma.currentPage.children;
  for (let i = 0; i < children.length; i++) {
    const name = children[i].name;
    const part = name.match(NAME_LOCALE_NN_LL)?.[0];
    if (part && DEFAULT_SOURCE_EN.test(part)) return [children[i]];
  }
  return [];
}

function detachAllInstances(root: SceneNode): void {
  const children = (root as SceneNode & { children?: readonly SceneNode[] }).children;
  if (!children) return;
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (child.type === "INSTANCE") {
      try {
        const detach = (child as SceneNode & { detachInstance?: () => SceneNode }).detachInstance;
        if (typeof detach === "function") {
          const frame = detach.call(child);
          detachAllInstances(frame);
        }
      } catch (_) {}
    } else {
      detachAllInstances(child);
    }
  }
}

const FILL_ORDER: string[] = ["title", "subtitle", "desc"];

function collectAllTextNodes(root: SceneNode): TextNodeEntry[] {
  const findAll = (root as SceneNode & { findAll?: (pred: (n: SceneNode) => boolean) => SceneNode[] }).findAll;
  let list: TextNodeEntry[];
  if (typeof findAll === "function") {
    const textNodes = findAll.call(root, (n: SceneNode) => n.type === "TEXT") as TextNode[];
    list = textNodes.map((node) => ({ node, layerName: normalizeLayerKey(node.name || "") }));
  } else {
    list = [];
    function traverse(node: SceneNode): void {
      if (node.type === "TEXT") {
        list.push({ node: node as TextNode, layerName: normalizeLayerKey((node as TextNode).name || "") });
      }
      const ch = (node as SceneNode & { children?: readonly SceneNode[] }).children;
      if (ch) for (let i = 0; i < ch.length; i++) traverse(ch[i]);
    }
    traverse(root);
  }
  const y = (n: TextNode) => ("y" in n && typeof n.y === "number" ? n.y : 0);
  const x = (n: TextNode) => ("x" in n && typeof n.x === "number" ? n.x : 0);
  list.sort((a, b) => {
    const dy = y(a.node) - y(b.node);
    return dy !== 0 ? dy : x(a.node) - x(b.node);
  });
  return list;
}

async function loadFontForNode(node: TextNode): Promise<void> {
  const font = node.fontName;
  if (font !== figma.mixed) {
    await figma.loadFontAsync(font as FontName);
    return;
  }
  const len = node.characters.length;
  const loaded = new Set<string>();
  for (let i = 0; i < len; i++) {
    const f = (node as TextNode & { getRangeFontName?: (a: number, b: number) => FontName | symbol }).getRangeFontName?.(i, i + 1);
    if (f && f !== figma.mixed && typeof f === "object") {
      const key = (f as FontName).family + (f as FontName).style;
      if (!loaded.has(key)) {
        loaded.add(key);
        await figma.loadFontAsync(f as FontName);
      }
    }
  }
}

async function duplicateAndFill(
  source: SceneNode,
  block: LocaleBlock,
  baseY: number
): Promise<{ offset: number; duplicated: SceneNode }> {
  const duplicated = source.clone();
  const srcX = typeof source.x === "number" ? source.x : 0;
  const srcH = "height" in source && typeof source.height === "number" ? source.height : 0;
  duplicated.x = srcX;
  duplicated.y = baseY;
  duplicated.name = source.name.replace(NAME_LOCALE_NN_LL, block.localeSuffix);
  if (duplicated.name === source.name) duplicated.name = (source.name.trim() || block.localeSuffix) + " " + block.localeSuffix;
  figma.currentPage.appendChild(duplicated);
  detachAllInstances(duplicated);
  const entries = collectAllTextNodes(duplicated);
  const byLayer = block.byLayerName;
  const filled = new Set<TextNode>();
  const usedKeys = new Set<string>();
  for (const { node, layerName } of entries) {
    if (!layerName) continue;
    const text = byLayer.get(layerName);
    if (text === undefined) continue;
    try {
      await loadFontForNode(node);
      node.characters = normalizeTextForDisplay(text);
      if (node.textAutoResize !== undefined) node.textAutoResize = "HEIGHT";
      filled.add(node);
      usedKeys.add(layerName);
    } catch (_) {}
  }
  const unfilled = entries.filter((e) => !filled.has(e.node));
  const unusedKeys = FILL_ORDER.filter((k) => byLayer.has(k) && !usedKeys.has(k));
  const limit = Math.min(unfilled.length, unusedKeys.length);
  for (let i = 0; i < limit; i++) {
    const text = byLayer.get(unusedKeys[i]);
    if (text === undefined) continue;
    const node = unfilled[i].node;
    try {
      await loadFontForNode(node);
      node.characters = normalizeTextForDisplay(text);
      if (node.textAutoResize !== undefined) node.textAutoResize = "HEIGHT";
    } catch (_) {}
  }
  const dupH = "height" in duplicated && typeof duplicated.height === "number" ? duplicated.height : srcH;
  return { offset: dupH + 40, duplicated };
}

function notifyUI(type: "status" | "error" | "success", message: string): void {
  figma.ui.postMessage({ type, message });
}

figma.showUI(__html__, { width: 380, height: 390 });

figma.ui.onmessage = async (msg: unknown) => {
  const m = msg as UIMessage;
  if (m.type === "ready") {
    const stored = await figma.clientStorage.getAsync(MCP_TOKEN_KEY);
    figma.ui.postMessage({ type: "init", tokenSaved: !!stored });
    return;
  }
  if (m.type === "saveToken") {
    try {
      const token = (m.mcpToken ?? "").trim();
      if (token) await figma.clientStorage.setAsync(MCP_TOKEN_KEY, token);
      else await figma.clientStorage.deleteAsync(MCP_TOKEN_KEY);
      figma.ui.postMessage({ type: "tokenSaved" });
    } catch (err) {
      figma.ui.postMessage({ type: "tokenError", message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
  if (m.type !== "start") return;

  const raw = (m.translationList || "").trim();
  if (!raw) {
    notifyUI("error", "Вставьте список переводов (формат: 01_FR, затем имя слоя и текст).");
    return;
  }

  const blocks = parseTranslationList(raw);
  if (blocks.length === 0) {
    notifyUI("error", "Не найдено ни одного блока локали (01_FR, 01_DE…).");
    return;
  }

  const sources = findSourceFrames();
  if (sources.length === 0) {
    notifyUI("error", "Выделите фреймы или создайте фрейм 01_EN, 02_EN и т.д. на странице.");
    return;
  }

  notifyUI("status", "Создание дублей по локалям…");

  try {
    const gap = 40;
    const baseYByIndex: number[] = sources.map((s) => {
      const y = typeof s.y === "number" ? s.y : 0;
      const h = "height" in s && typeof s.height === "number" ? s.height : 0;
      return y + h + gap;
    });
    const nodesToView: SceneNode[] = [];

    for (let i = 0; i < blocks.length; i++) {
      const sourceIndex = i % sources.length;
      const source = sources[sourceIndex];
      const baseY = baseYByIndex[sourceIndex];
      const { offset, duplicated } = await duplicateAndFill(source, blocks[i], baseY);
      baseYByIndex[sourceIndex] = baseY + offset;
      nodesToView.push(duplicated);
    }

    if (nodesToView.length > 0) {
      figma.viewport.scrollAndZoomIntoView(nodesToView);
    }
    notifyUI("success", `Готово: ${blocks.length} блоков.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    notifyUI("error", message);
  }
};
