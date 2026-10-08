/// <reference types="@figma/plugin-typings" />

type Scope    = 'global' | 'frames' | 'groups' | 'components' | 'instances' | 'section' | 'selection' | 'page';
type Category = 'text' | 'font' | 'fontColor' | 'fontSize' | 'textDecoration' | 'paragraphSpacing' | 'paragraphIndent' | 'textCase' | 'styles' | 'shape' | 'stroke' | 'variables';

interface FindMatch {
  nodeId:   string;
  nodeName: string;
  nodeType: string;
  preview:  string;
}

interface RGB { r: number; g: number; b: number; }

figma.showUI(__html__, { width: 380, height: 520, title: 'Find & Replace' });

// Broadcast available styles, variables, pages and selection right away
broadcastStyles();
broadcastTextStyles();
broadcastVariables();
broadcastFonts();
broadcastSelection();
broadcastPages();

// Available fonts are async — send when ready
figma.listAvailableFontsAsync().then(fonts => {
  const grouped: Record<string, string[]> = {};
  fonts.forEach(({ fontName }) => {
    (grouped[fontName.family] = grouped[fontName.family] || []).push(fontName.style);
  });
  const families = Object.keys(grouped).sort((a, b) => a.localeCompare(b))
    .map(family => ({ family, styles: grouped[family] }));
  figma.ui.postMessage({ type: 'availableFonts', families });
});

// Keep UI in sync with canvas selection changes
figma.on('selectionchange', broadcastSelection);

// ─── Message dispatch ──────────────────────────────────────────────────────────
figma.ui.onmessage = async (msg: any) => {
  switch (msg.type) {
    case 'find':
      handleFind(msg.category, msg.scope, msg.find, msg.options ?? {});
      break;
    case 'replace-all':
      await handleReplaceAll(msg.category, msg.scope, msg.find, msg.replace, msg.options ?? {});
      break;
    case 'replace-one':
      await handleReplaceOne(msg.category, msg.nodeId, msg.find, msg.replace, msg.options ?? {});
      break;
    case 'select-node':
      selectNode(msg.nodeId);
      break;
    case 'resize':
      figma.ui.resize(380, msg.height);
      break;
  }
};

// ─── Broadcast helpers ────────────────────────────────────────────────────────
function broadcastSelection() {
  const sel      = figma.currentPage.selection;
  const sections = sel
    .filter(n => n.type === 'SECTION')
    .map(n => ({ id: n.id, name: n.name }));
  figma.ui.postMessage({
    type:     'selection-changed',
    count:    sel.length,
    sections,
  });
}

function broadcastPages() {
  const pages = figma.root.children.map(p => ({ id: p.id, name: p.name, isCurrent: p.id === figma.currentPage.id }));
  figma.ui.postMessage({ type: 'pages', pages });
}

function broadcastStyles() {
  const styles = figma.getLocalPaintStyles().map(s => ({
    id:      s.id,
    name:    s.name,
    preview: s.paints.length > 0 ? paintToHex(s.paints[0]) : null,
  }));
  figma.ui.postMessage({ type: 'styles', styles });
}

function broadcastFonts() {
  const families = new Set<string>();
  function scanNode(node: SceneNode) {
    if (node.type === 'TEXT') {
      const fn = node.fontName;
      if (typeof fn !== 'symbol') {
        families.add(fn.family);
      } else {
        for (let i = 0; i < node.characters.length; i++) {
          const rf = node.getRangeFontName(i, i + 1);
          if (typeof rf !== 'symbol') families.add((rf as FontName).family);
        }
      }
    }
    if ('children' in node) {
      for (const child of (node as ChildrenMixin).children) scanNode(child as SceneNode);
    }
  }
  for (const page of figma.root.children) {
    for (const child of page.children) scanNode(child as SceneNode);
  }
  const sorted = Array.from(families).sort((a, b) => a.localeCompare(b));
  figma.ui.postMessage({ type: 'fonts', fonts: sorted });
}

function broadcastTextStyles() {
  const styles = figma.getLocalTextStyles().map(s => ({ id: s.id, name: s.name }));
  figma.ui.postMessage({ type: 'textStyles', styles });
}

function broadcastVariables() {
  try {
    const vars = figma.variables.getLocalVariables().map(v => {
      const col = figma.variables.getVariableCollectionById(v.variableCollectionId);
      return { id: v.id, name: v.name, collectionName: col?.name ?? '', resolvedType: v.resolvedType };
    });
    figma.ui.postMessage({ type: 'variables', variables: vars });
  } catch (_) {
    figma.ui.postMessage({ type: 'variables', variables: [] });
  }
}

// ─── Scope helpers ────────────────────────────────────────────────────────────
function getSearchRoots(scope: Scope, opts: { pageId?: string } = {}): SceneNode[] {
  const currentPage = figma.currentPage;

  if (scope === 'global')    return [...currentPage.children] as SceneNode[];
  if (scope === 'selection') return [...currentPage.selection] as SceneNode[];
  if (scope === 'section')   return currentPage.selection.filter(n => n.type === 'SECTION') as SceneNode[];
  if (scope === 'page') {
    const target = opts.pageId
      ? (figma.getNodeById(opts.pageId) as PageNode | null)
      : currentPage;
    return target ? (Array.from(target.children) as SceneNode[]) : [];
  }

  const typeMap: Record<string, string> = {
    frames:     'FRAME',
    groups:     'GROUP',
    components: 'COMPONENT',
    instances:  'INSTANCE',
  };
  const targetType = typeMap[scope];
  const results: SceneNode[] = [];

  function walk(node: SceneNode) {
    if (node.type === targetType) { results.push(node); return; }
    if ('children' in node) {
      for (const child of (node as ChildrenMixin).children) walk(child as SceneNode);
    }
  }
  for (const child of currentPage.children) walk(child as SceneNode);
  return results;
}

function flatten(roots: SceneNode[]): SceneNode[] {
  const all: SceneNode[] = [];
  function walk(node: SceneNode) {
    all.push(node);
    if ('children' in node) {
      for (const child of (node as ChildrenMixin).children) walk(child as SceneNode);
    }
  }
  for (const r of roots) walk(r);
  return all;
}

// ─── Find dispatcher ──────────────────────────────────────────────────────────
function handleFind(category: Category, scope: Scope, find: string, options: any) {
  if (!find.trim()) {
    figma.ui.postMessage({ type: 'matches', matches: [], total: 0 });
    return;
  }
  const nodes   = flatten(getSearchRoots(scope, { pageId: options.pageId }));
  let   matches: FindMatch[] = [];

  switch (category) {
    case 'text':             matches = findText(nodes, find, options);             break;
    case 'font':             matches = findFont(nodes, find);                      break;
    case 'fontColor':        matches = findFontColor(nodes, find);                 break;
    case 'fontSize':         matches = findFontSize(nodes, find);                  break;
    case 'textDecoration':   matches = findTextDecoration(nodes, find);            break;
    case 'paragraphSpacing': matches = findParagraphSpacing(nodes, find);          break;
    case 'paragraphIndent':  matches = findParagraphIndent(nodes, find);           break;
    case 'textCase':         matches = findTextCase(nodes, find);                  break;
    case 'styles':           matches = findStyles(nodes, find);                    break;
    case 'shape':            matches = findShapeFill(nodes, find, options);        break;
    case 'stroke':           matches = findStroke(nodes, find);                    break;
    case 'variables':        matches = findVariables(nodes, find);                 break;
  }
  figma.ui.postMessage({ type: 'matches', matches: matches.slice(0, 200), total: matches.length });
}

// ─── Replace-all dispatcher ───────────────────────────────────────────────────
async function handleReplaceAll(category: Category, scope: Scope, find: string, replace: string, options: any) {
  const nodes = flatten(getSearchRoots(scope, { pageId: options.pageId }));
  let count = 0;
  switch (category) {
    case 'text':             count = await replaceAllText(nodes, find, replace, options);      break;
    case 'font':             count = await replaceAllFont(nodes, find, replace);               break;
    case 'fontColor':        count = replaceAllFontColor(nodes, find, replace);                break;
    case 'fontSize':         count = await replaceAllFontSize(nodes, find, replace);           break;
    case 'textDecoration':   count = await replaceAllTextDecoration(nodes, find, replace);     break;
    case 'paragraphSpacing': count = replaceAllParagraphSpacing(nodes, find, replace);         break;
    case 'paragraphIndent':  count = replaceAllParagraphIndent(nodes, find, replace);          break;
    case 'textCase':         count = await replaceAllTextCase(nodes, find, replace);           break;
    case 'styles':           count = replaceAllStyles(nodes, find, replace);                   break;
    case 'shape':            count = replaceAllShapeFill(nodes, find, replace);                break;
    case 'stroke':           count = replaceAllStroke(nodes, find, replace);                   break;
    case 'variables':        count = replaceAllVariables(nodes, find, replace);                break;
  }
  figma.ui.postMessage({ type: 'replaced', count });
}

// ─── Replace-one dispatcher ───────────────────────────────────────────────────
async function handleReplaceOne(category: Category, nodeId: string, find: string, replace: string, options: any) {
  const node = figma.getNodeById(nodeId) as SceneNode | null;
  if (!node) { figma.ui.postMessage({ type: 'replaced-one', nodeId, count: 0 }); return; }
  let count = 0;
  switch (category) {
    case 'text':             count = await replaceAllText([node], find, replace, options);      break;
    case 'font':             count = await replaceAllFont([node], find, replace);               break;
    case 'fontColor':        count = replaceAllFontColor([node], find, replace);                break;
    case 'fontSize':         count = await replaceAllFontSize([node], find, replace);           break;
    case 'textDecoration':   count = await replaceAllTextDecoration([node], find, replace);     break;
    case 'paragraphSpacing': count = replaceAllParagraphSpacing([node], find, replace);         break;
    case 'paragraphIndent':  count = replaceAllParagraphIndent([node], find, replace);          break;
    case 'textCase':         count = await replaceAllTextCase([node], find, replace);           break;
    case 'styles':           count = replaceAllStyles([node], find, replace);                   break;
    case 'shape':            count = replaceAllShapeFill([node], find, replace);                break;
    case 'stroke':           count = replaceAllStroke([node], find, replace);                   break;
    case 'variables':        count = replaceAllVariables([node], find, replace);                break;
  }
  figma.ui.postMessage({ type: 'replaced-one', nodeId, count });
}

function selectNode(nodeId: string) {
  const node = figma.getNodeById(nodeId);
  if (!node || node.type === 'PAGE' || node.type === 'DOCUMENT') return;

  // Walk up to find the containing page
  let current: BaseNode = node;
  while (current.parent && current.parent.type !== 'DOCUMENT') {
    current = current.parent;
  }
  const page = current as PageNode;

  if (page.id !== figma.currentPage.id) {
    figma.currentPage = page;
  }

  figma.currentPage.selection = [node as SceneNode];
  figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
}

// ─── TEXT ─────────────────────────────────────────────────────────────────────
function buildRegex(find: string, opts: { caseSensitive?: boolean; wholeWord?: boolean }): RegExp {
  let esc = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (opts.wholeWord) esc = `\\b${esc}\\b`;
  return new RegExp(esc, opts.caseSensitive ? 'g' : 'gi');
}

function findText(nodes: SceneNode[], find: string, opts: any): FindMatch[] {
  const re = buildRegex(find, opts);
  return nodes
    .filter(n => n.type === 'TEXT' && re.test(n.characters))
    .map(n => ({
      nodeId:   n.id,
      nodeName: n.name,
      nodeType: 'TEXT',
      preview:  (n as TextNode).characters.slice(0, 90),
    }));
}

async function loadFonts(node: TextNode) {
  if (node.fontName !== figma.mixed) {
    await figma.loadFontAsync(node.fontName as FontName);
    return;
  }
  const seen = new Set<string>();
  for (let i = 0; i < node.characters.length; i++) {
    const fn  = node.getRangeFontName(i, i + 1) as FontName;
    const key = `${fn.family}:${fn.style}`;
    if (!seen.has(key)) { seen.add(key); await figma.loadFontAsync(fn); }
  }
}

async function replaceAllText(nodes: SceneNode[], find: string, replace: string, opts: any): Promise<number> {
  const re = buildRegex(find, opts);
  let count = 0;
  for (const node of nodes) {
    if (node.type !== 'TEXT') continue;
    const t = node as TextNode;
    re.lastIndex = 0;
    if (!re.test(t.characters)) continue;
    re.lastIndex = 0;
    const newChars = t.characters.replace(re, replace);
    try {
      await loadFonts(t);
      t.characters = newChars;
      count++;
    } catch (e) { console.error('replaceText', node.id, e); }
  }
  return count;
}

// ─── FONT FAMILY ─────────────────────────────────────────────────────────────
function findFont(nodes: SceneNode[], find: string): FindMatch[] {
  const lc = find.toLowerCase();
  return nodes.filter(n => {
    if (n.type !== 'TEXT') return false;
    const fn = (n as TextNode).fontName;
    if (typeof fn !== 'symbol') return fn.family.toLowerCase().includes(lc);
    // Mixed: check all character ranges
    const t = n as TextNode;
    for (let i = 0; i < t.characters.length; i++) {
      const rf = t.getRangeFontName(i, i + 1);
      if (typeof rf !== 'symbol' && (rf as FontName).family.toLowerCase().includes(lc)) return true;
    }
    return false;
  }).map(n => {
    const fn = (n as TextNode).fontName;
    const family = typeof fn === 'symbol' ? '(mixed)' : fn.family;
    return { nodeId: n.id, nodeName: n.name, nodeType: 'TEXT', preview: `Font: ${family}` };
  });
}

async function replaceAllFont(nodes: SceneNode[], find: string, replace: string): Promise<number> {
  const lc = find.toLowerCase();

  // Text style mode: "textstyle:<id>"
  if (replace.startsWith('textstyle:')) {
    const styleId = replace.slice('textstyle:'.length);
    const style   = figma.getStyleById(styleId);
    if (!style || style.type !== 'TEXT') return 0;
    let count = 0;
    for (const node of nodes) {
      if (node.type !== 'TEXT') continue;
      const t  = node as TextNode;
      const fn = t.fontName;
      if (typeof fn === 'symbol') continue;
      if (!fn.family.toLowerCase().includes(lc)) continue;
      try {
        await loadFonts(t);
        t.textStyleId = style.id;
        count++;
      } catch (e) { console.error('replaceFont textStyle', node.id, e); }
    }
    return count;
  }

  // Font mode: "Family||Style"
  const sep    = replace.indexOf('||');
  const family = sep >= 0 ? replace.slice(0, sep) : replace;
  const style  = sep >= 0 ? replace.slice(sep + 2) : null;
  if (!family) return 0;
  let count = 0;
  for (const node of nodes) {
    if (node.type !== 'TEXT') continue;
    const t  = node as TextNode;
    const fn = t.fontName;
    if (typeof fn === 'symbol') continue;
    if (!fn.family.toLowerCase().includes(lc)) continue;
    const targetStyle = style || fn.style;
    const preferred: FontName = { family, style: targetStyle };
    try {
      await figma.loadFontAsync(preferred);
      t.fontName = preferred;
      count++;
    } catch {
      const regular: FontName = { family, style: 'Regular' };
      try {
        await figma.loadFontAsync(regular);
        t.fontName = regular;
        count++;
      } catch (e) { console.error('replaceFont', node.id, e); }
    }
  }
  return count;
}

// ─── FONT COLOR ───────────────────────────────────────────────────────────────
function findFontColor(nodes: SceneNode[], find: string): FindMatch[] {
  const fc = parseHex(find);
  if (!fc) return [];
  return nodes.filter(n => {
    if (n.type !== 'TEXT') return false;
    const fills = (n as TextNode).fills;
    return Array.isArray(fills) && fills.some(f => f.type === 'SOLID' && rgbMatch(f.color, fc));
  }).map(n => ({ nodeId: n.id, nodeName: n.name, nodeType: 'TEXT', preview: `Color: #${find.replace('#', '')}` }));
}

function replaceAllFontColor(nodes: SceneNode[], find: string, replace: string): number {
  const fc = parseHex(find);
  const rc = parseHex(replace);
  if (!fc || !rc) return 0;
  let count = 0;
  for (const node of nodes) {
    if (node.type !== 'TEXT') continue;
    const t = node as TextNode;
    const fills = t.fills;
    if (!Array.isArray(fills)) continue;
    if (!fills.some(f => f.type === 'SOLID' && rgbMatch(f.color, fc))) continue;
    const newF = fills.map(f => f.type === 'SOLID' && rgbMatch(f.color, fc) ? { ...f, color: rc } : f);
    try { t.fills = newF; count++; } catch (e) { console.error('replaceFontColor', node.id, e); }
  }
  return count;
}

// ─── FONT SIZE ────────────────────────────────────────────────────────────────
function findFontSize(nodes: SceneNode[], find: string): FindMatch[] {
  const target = parseFloat(find);
  if (isNaN(target)) return [];
  return nodes
    .filter(n => n.type === 'TEXT')
    .filter(n => {
      const fs = (n as TextNode).fontSize;
      return typeof fs === 'number' && fs === target;
    })
    .map(n => ({
      nodeId: n.id, nodeName: n.name, nodeType: 'TEXT',
      preview: `Font size: ${(n as TextNode).fontSize}`,
    }));
}

async function replaceAllFontSize(nodes: SceneNode[], find: string, replace: string): Promise<number> {
  const target  = parseFloat(find);
  const newSize = parseFloat(replace);
  if (isNaN(target) || isNaN(newSize) || newSize <= 0) return 0;
  let count = 0;
  for (const node of nodes) {
    if (node.type !== 'TEXT') continue;
    const t = node as TextNode;
    if (typeof t.fontSize !== 'number' || t.fontSize !== target) continue;
    try {
      await loadFonts(t);
      t.fontSize = newSize;
      count++;
    } catch (e) { console.error('replaceFontSize', node.id, e); }
  }
  return count;
}

// ─── TEXT DECORATION ──────────────────────────────────────────────────────────
function findTextDecoration(nodes: SceneNode[], find: string): FindMatch[] {
  return nodes
    .filter(n => n.type === 'TEXT')
    .filter(n => {
      const td = (n as TextNode).textDecoration;
      return typeof td === 'string' && td === find;
    })
    .map(n => ({
      nodeId: n.id, nodeName: n.name, nodeType: 'TEXT',
      preview: `Text decoration: ${find}`,
    }));
}

async function replaceAllTextDecoration(nodes: SceneNode[], find: string, replace: string): Promise<number> {
  let count = 0;
  for (const node of nodes) {
    if (node.type !== 'TEXT') continue;
    const t = node as TextNode;
    if (typeof t.textDecoration !== 'string' || t.textDecoration !== find) continue;
    try {
      await loadFonts(t);
      t.textDecoration = replace as TextDecoration;
      count++;
    } catch (e) { console.error('replaceTextDecoration', node.id, e); }
  }
  return count;
}

// ─── PARAGRAPH SPACING ────────────────────────────────────────────────────────
function findParagraphSpacing(nodes: SceneNode[], find: string): FindMatch[] {
  const target = parseFloat(find);
  if (isNaN(target)) return [];
  return nodes
    .filter(n => n.type === 'TEXT')
    .filter(n => (n as TextNode).paragraphSpacing === target)
    .map(n => ({
      nodeId: n.id, nodeName: n.name, nodeType: 'TEXT',
      preview: `Paragraph spacing: ${target}`,
    }));
}

function replaceAllParagraphSpacing(nodes: SceneNode[], find: string, replace: string): number {
  const target = parseFloat(find);
  const newVal = parseFloat(replace);
  if (isNaN(target) || isNaN(newVal)) return 0;
  let count = 0;
  for (const node of nodes) {
    if (node.type !== 'TEXT') continue;
    const t = node as TextNode;
    if (t.paragraphSpacing !== target) continue;
    try { t.paragraphSpacing = newVal; count++; } catch (e) { console.error('replaceParagraphSpacing', node.id, e); }
  }
  return count;
}

// ─── PARAGRAPH INDENT ─────────────────────────────────────────────────────────
function findParagraphIndent(nodes: SceneNode[], find: string): FindMatch[] {
  const target = parseFloat(find);
  if (isNaN(target)) return [];
  return nodes
    .filter(n => n.type === 'TEXT')
    .filter(n => (n as TextNode).paragraphIndent === target)
    .map(n => ({
      nodeId: n.id, nodeName: n.name, nodeType: 'TEXT',
      preview: `Paragraph indent: ${target}`,
    }));
}

function replaceAllParagraphIndent(nodes: SceneNode[], find: string, replace: string): number {
  const target = parseFloat(find);
  const newVal = parseFloat(replace);
  if (isNaN(target) || isNaN(newVal)) return 0;
  let count = 0;
  for (const node of nodes) {
    if (node.type !== 'TEXT') continue;
    const t = node as TextNode;
    if (t.paragraphIndent !== target) continue;
    try { t.paragraphIndent = newVal; count++; } catch (e) { console.error('replaceParagraphIndent', node.id, e); }
  }
  return count;
}

// ─── TEXT CASE ────────────────────────────────────────────────────────────────
function findTextCase(nodes: SceneNode[], find: string): FindMatch[] {
  return nodes
    .filter(n => n.type === 'TEXT')
    .filter(n => {
      const tc = (n as TextNode).textCase;
      return typeof tc === 'string' && tc === find;
    })
    .map(n => ({
      nodeId: n.id, nodeName: n.name, nodeType: 'TEXT',
      preview: `Text case: ${find}`,
    }));
}

async function replaceAllTextCase(nodes: SceneNode[], find: string, replace: string): Promise<number> {
  let count = 0;
  for (const node of nodes) {
    if (node.type !== 'TEXT') continue;
    const t = node as TextNode;
    if (typeof t.textCase !== 'string' || t.textCase !== find) continue;
    try {
      await loadFonts(t);
      t.textCase = replace as TextCase;
      count++;
    } catch (e) { console.error('replaceTextCase', node.id, e); }
  }
  return count;
}

// ─── LIBRARY STYLES ───────────────────────────────────────────────────────────

// Resolve a style by ID first, then fall back to exact name match.
function resolveStyle(idOrName: string): PaintStyle | null {
  const byId = figma.getStyleById(idOrName) as PaintStyle | null;
  if (byId) return byId;
  return figma.getLocalPaintStyles().find(s => s.name.toLowerCase() === idOrName.toLowerCase()) ?? null;
}

function findStyles(nodes: SceneNode[], findIdOrName: string): FindMatch[] {
  const target = resolveStyle(findIdOrName);
  const matches: FindMatch[] = [];

  for (const node of nodes) {
    let preview = '';

    if ('fillStyleId' in node) {
      const id = (node as MinimalFillsMixin).fillStyleId;
      if (typeof id === 'string') {
        if (target ? id === target.id : false) {
          preview = `Fill: ${target!.name}`;
        } else if (!target) {
          // plain-text fallback — substring match on name
          const s = figma.getStyleById(id) as PaintStyle | null;
          if (s && s.name.toLowerCase().includes(findIdOrName.toLowerCase())) preview = `Fill: ${s.name}`;
        }
      }
    }
    if (!preview && 'strokeStyleId' in node) {
      const id = (node as MinimalStrokesMixin).strokeStyleId;
      if (typeof id === 'string') {
        if (target ? id === target.id : false) {
          preview = `Stroke: ${target!.name}`;
        } else if (!target) {
          const s = figma.getStyleById(id) as PaintStyle | null;
          if (s && s.name.toLowerCase().includes(findIdOrName.toLowerCase())) preview = `Stroke: ${s.name}`;
        }
      }
    }
    if (preview) matches.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, preview });
  }
  return matches;
}

function replaceAllStyles(nodes: SceneNode[], findIdOrName: string, replaceIdOrName: string): number {
  const findS    = resolveStyle(findIdOrName);
  const replaceS = resolveStyle(replaceIdOrName);
  if (!findS || !replaceS) return 0;
  let count = 0;
  for (const node of nodes) {
    let changed = false;
    if ('fillStyleId' in node && (node as MinimalFillsMixin).fillStyleId === findS.id) {
      try { (node as MinimalFillsMixin).fillStyleId = replaceS.id; changed = true; } catch (_) {}
    }
    if ('strokeStyleId' in node && (node as MinimalStrokesMixin).strokeStyleId === findS.id) {
      try { (node as MinimalStrokesMixin).strokeStyleId = replaceS.id; changed = true; } catch (_) {}
    }
    if (changed) count++;
  }
  return count;
}

// ─── SHAPE & FRAME FILL ───────────────────────────────────────────────────────
function parseHex(hex: string): RGB | null {
  const s = hex.replace('#', '').trim();
  if (s.length === 3) {
    return {
      r: parseInt(s[0]+s[0], 16) / 255,
      g: parseInt(s[1]+s[1], 16) / 255,
      b: parseInt(s[2]+s[2], 16) / 255,
    };
  }
  if (s.length === 6) {
    return {
      r: parseInt(s.slice(0, 2), 16) / 255,
      g: parseInt(s.slice(2, 4), 16) / 255,
      b: parseInt(s.slice(4, 6), 16) / 255,
    };
  }
  return null;
}

function rgbMatch(a: RGB, b: RGB): boolean {
  return Math.round(a.r * 255) === Math.round(b.r * 255) &&
         Math.round(a.g * 255) === Math.round(b.g * 255) &&
         Math.round(a.b * 255) === Math.round(b.b * 255);
}

function findShapeFill(nodes: SceneNode[], find: string, _opts: any): FindMatch[] {
  const fc = parseHex(find);
  if (!fc) return [];
  return nodes.filter(n => {
    if (!('fills' in n)) return false;
    const fills = (n as GeometryMixin).fills;
    return Array.isArray(fills) && fills.some(f => f.type === 'SOLID' && rgbMatch(f.color, fc));
  }).map(n => ({ nodeId: n.id, nodeName: n.name, nodeType: n.type, preview: `Fill: #${find.replace('#','')}` }));
}

function replaceAllShapeFill(nodes: SceneNode[], find: string, replace: string): number {
  const fc = parseHex(find);
  const rc = parseHex(replace);
  if (!fc || !rc) return 0;
  let count = 0;
  for (const node of nodes) {
    if (!('fills' in node)) continue;
    const gm     = node as GeometryMixin;
    const fills  = gm.fills;
    if (!Array.isArray(fills)) continue;
    const newF   = fills.map(f => f.type === 'SOLID' && rgbMatch(f.color, fc) ? { ...f, color: rc } : f);
    if (JSON.stringify(newF) !== JSON.stringify(fills)) {
      try { gm.fills = newF; count++; } catch (_) {}
    }
  }
  return count;
}

// ─── STROKE ───────────────────────────────────────────────────────────────────
function findStroke(nodes: SceneNode[], find: string): FindMatch[] {
  const fc = parseHex(find);
  if (!fc) return [];
  return nodes.filter(n => {
    if (!('strokes' in n)) return false;
    const strokes = (n as MinimalStrokesMixin).strokes;
    return Array.isArray(strokes) && strokes.some(s => s.type === 'SOLID' && rgbMatch(s.color, fc));
  }).map(n => ({ nodeId: n.id, nodeName: n.name, nodeType: n.type, preview: `Stroke: #${find.replace('#','')}` }));
}

function replaceAllStroke(nodes: SceneNode[], find: string, replace: string): number {
  const fc = parseHex(find);
  const rc = parseHex(replace);
  if (!fc || !rc) return 0;
  let count = 0;
  for (const node of nodes) {
    if (!('strokes' in node)) continue;
    const sm      = node as MinimalStrokesMixin;
    const strokes = sm.strokes;
    if (!Array.isArray(strokes)) continue;
    const newS = strokes.map(s => s.type === 'SOLID' && rgbMatch(s.color, fc) ? { ...s, color: rc } : s);
    if (JSON.stringify(newS) !== JSON.stringify(strokes)) {
      try { sm.strokes = newS; count++; } catch (_) {}
    }
  }
  return count;
}

// ─── VARIABLES ────────────────────────────────────────────────────────────────
function findVariables(nodes: SceneNode[], find: string): FindMatch[] {
  const lc   = find.toLowerCase();
  const vars = figma.variables.getLocalVariables().filter(v => v.name.toLowerCase().includes(lc));
  const ids  = new Set(vars.map(v => v.id));
  if (ids.size === 0) return [];

  const matches: FindMatch[] = [];
  for (const node of nodes) {
    const bindings = (node as any).boundVariables;
    if (!bindings) continue;
    let preview = '';
    outer: for (const field of Object.keys(bindings)) {
      const b = bindings[field];
      if (!b) continue;
      const arr = Array.isArray(b) ? b : [b];
      for (const item of arr) {
        if (item?.id && ids.has(item.id)) {
          const v = figma.variables.getVariableById(item.id);
          preview = `${field}: ${v?.name ?? item.id}`;
          break outer;
        }
      }
    }
    if (preview) matches.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, preview });
  }
  return matches;
}

function replaceAllVariables(nodes: SceneNode[], find: string, replace: string): number {
  const all     = figma.variables.getLocalVariables();
  const findV   = all.find(v => v.name.toLowerCase() === find.toLowerCase());
  const replaceV = all.find(v => v.name.toLowerCase() === replace.toLowerCase());
  if (!findV || !replaceV) return 0;
  let count = 0;
  for (const node of nodes) {
    const bindings = (node as any).boundVariables;
    if (!bindings) continue;
    let changed = false;
    for (const field of Object.keys(bindings)) {
      const b = bindings[field];
      if (!b) continue;
      if (Array.isArray(b)) {
        b.forEach((item: any, i: number) => {
          if (item?.id === findV.id) {
            try { (node as any).setBoundVariable(field, i, replaceV); changed = true; } catch (_) {}
          }
        });
      } else if (b?.id === findV.id) {
        try { (node as any).setBoundVariable(field, replaceV); changed = true; } catch (_) {}
      }
    }
    if (changed) count++;
  }
  return count;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function paintToHex(paint: Paint): string | null {
  if (paint.type !== 'SOLID') return null;
  const { r, g, b } = paint.color;
  return '#' + [r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}
