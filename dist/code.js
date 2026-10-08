"use strict";
var __plugin = (() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __async = (__this, __arguments, generator) => {
    return new Promise((resolve, reject) => {
      var fulfilled = (value) => {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      };
      var rejected = (value) => {
        try {
          step(generator.throw(value));
        } catch (e) {
          reject(e);
        }
      };
      var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
      step((generator = generator.apply(__this, __arguments)).next());
    });
  };

  // src/code.ts
  var require_code = __commonJS({
    "src/code.ts"(exports) {
      figma.showUI(__html__, { width: 380, height: 520, title: "Find & Replace" });
      broadcastStyles();
      broadcastTextStyles();
      broadcastVariables();
      broadcastFonts();
      broadcastSelection();
      broadcastPages();
      figma.listAvailableFontsAsync().then((fonts) => {
        const grouped = {};
        fonts.forEach(({ fontName }) => {
          (grouped[fontName.family] = grouped[fontName.family] || []).push(fontName.style);
        });
        const families = Object.keys(grouped).sort((a, b) => a.localeCompare(b)).map((family) => ({ family, styles: grouped[family] }));
        figma.ui.postMessage({ type: "availableFonts", families });
      });
      figma.on("selectionchange", broadcastSelection);
      figma.ui.onmessage = (msg) => __async(exports, null, function* () {
        var _a, _b, _c;
        switch (msg.type) {
          case "find":
            handleFind(msg.category, msg.scope, msg.find, (_a = msg.options) != null ? _a : {});
            break;
          case "replace-all":
            yield handleReplaceAll(msg.category, msg.scope, msg.find, msg.replace, (_b = msg.options) != null ? _b : {});
            break;
          case "replace-one":
            yield handleReplaceOne(msg.category, msg.nodeId, msg.find, msg.replace, (_c = msg.options) != null ? _c : {});
            break;
          case "select-node":
            selectNode(msg.nodeId);
            break;
          case "resize":
            figma.ui.resize(380, msg.height);
            break;
        }
      });
      function broadcastSelection() {
        const sel = figma.currentPage.selection;
        const sections = sel.filter((n) => n.type === "SECTION").map((n) => ({ id: n.id, name: n.name }));
        figma.ui.postMessage({
          type: "selection-changed",
          count: sel.length,
          sections
        });
      }
      function broadcastPages() {
        const pages = figma.root.children.map((p) => ({ id: p.id, name: p.name, isCurrent: p.id === figma.currentPage.id }));
        figma.ui.postMessage({ type: "pages", pages });
      }
      function broadcastStyles() {
        const styles = figma.getLocalPaintStyles().map((s) => ({
          id: s.id,
          name: s.name,
          preview: s.paints.length > 0 ? paintToHex(s.paints[0]) : null
        }));
        figma.ui.postMessage({ type: "styles", styles });
      }
      function broadcastFonts() {
        const families = /* @__PURE__ */ new Set();
        function scanNode(node) {
          if (node.type === "TEXT") {
            const fn = node.fontName;
            if (typeof fn !== "symbol") {
              families.add(fn.family);
            } else {
              for (let i = 0; i < node.characters.length; i++) {
                const rf = node.getRangeFontName(i, i + 1);
                if (typeof rf !== "symbol")
                  families.add(rf.family);
              }
            }
          }
          if ("children" in node) {
            for (const child of node.children)
              scanNode(child);
          }
        }
        for (const page of figma.root.children) {
          for (const child of page.children)
            scanNode(child);
        }
        const sorted = Array.from(families).sort((a, b) => a.localeCompare(b));
        figma.ui.postMessage({ type: "fonts", fonts: sorted });
      }
      function broadcastTextStyles() {
        const styles = figma.getLocalTextStyles().map((s) => ({ id: s.id, name: s.name }));
        figma.ui.postMessage({ type: "textStyles", styles });
      }
      function broadcastVariables() {
        try {
          const vars = figma.variables.getLocalVariables().map((v) => {
            var _a;
            const col = figma.variables.getVariableCollectionById(v.variableCollectionId);
            return { id: v.id, name: v.name, collectionName: (_a = col == null ? void 0 : col.name) != null ? _a : "", resolvedType: v.resolvedType };
          });
          figma.ui.postMessage({ type: "variables", variables: vars });
        } catch (_) {
          figma.ui.postMessage({ type: "variables", variables: [] });
        }
      }
      function getSearchRoots(scope, opts = {}) {
        const currentPage = figma.currentPage;
        if (scope === "global")
          return [...currentPage.children];
        if (scope === "selection")
          return [...currentPage.selection];
        if (scope === "section")
          return currentPage.selection.filter((n) => n.type === "SECTION");
        if (scope === "page") {
          const target = opts.pageId ? figma.getNodeById(opts.pageId) : currentPage;
          return target ? Array.from(target.children) : [];
        }
        const typeMap = {
          frames: "FRAME",
          groups: "GROUP",
          components: "COMPONENT",
          instances: "INSTANCE"
        };
        const targetType = typeMap[scope];
        const results = [];
        function walk(node) {
          if (node.type === targetType) {
            results.push(node);
            return;
          }
          if ("children" in node) {
            for (const child of node.children)
              walk(child);
          }
        }
        for (const child of currentPage.children)
          walk(child);
        return results;
      }
      function flatten(roots) {
        const all = [];
        function walk(node) {
          all.push(node);
          if ("children" in node) {
            for (const child of node.children)
              walk(child);
          }
        }
        for (const r of roots)
          walk(r);
        return all;
      }
      function handleFind(category, scope, find, options) {
        if (!find.trim()) {
          figma.ui.postMessage({ type: "matches", matches: [], total: 0 });
          return;
        }
        const nodes = flatten(getSearchRoots(scope, { pageId: options.pageId }));
        let matches = [];
        switch (category) {
          case "text":
            matches = findText(nodes, find, options);
            break;
          case "font":
            matches = findFont(nodes, find);
            break;
          case "fontColor":
            matches = findFontColor(nodes, find);
            break;
          case "fontSize":
            matches = findFontSize(nodes, find);
            break;
          case "textDecoration":
            matches = findTextDecoration(nodes, find);
            break;
          case "paragraphSpacing":
            matches = findParagraphSpacing(nodes, find);
            break;
          case "paragraphIndent":
            matches = findParagraphIndent(nodes, find);
            break;
          case "textCase":
            matches = findTextCase(nodes, find);
            break;
          case "styles":
            matches = findStyles(nodes, find);
            break;
          case "shape":
            matches = findShapeFill(nodes, find, options);
            break;
          case "stroke":
            matches = findStroke(nodes, find);
            break;
          case "variables":
            matches = findVariables(nodes, find);
            break;
        }
        figma.ui.postMessage({ type: "matches", matches: matches.slice(0, 200), total: matches.length });
      }
      function handleReplaceAll(category, scope, find, replace, options) {
        return __async(this, null, function* () {
          const nodes = flatten(getSearchRoots(scope, { pageId: options.pageId }));
          let count = 0;
          switch (category) {
            case "text":
              count = yield replaceAllText(nodes, find, replace, options);
              break;
            case "font":
              count = yield replaceAllFont(nodes, find, replace);
              break;
            case "fontColor":
              count = replaceAllFontColor(nodes, find, replace);
              break;
            case "fontSize":
              count = yield replaceAllFontSize(nodes, find, replace);
              break;
            case "textDecoration":
              count = yield replaceAllTextDecoration(nodes, find, replace);
              break;
            case "paragraphSpacing":
              count = replaceAllParagraphSpacing(nodes, find, replace);
              break;
            case "paragraphIndent":
              count = replaceAllParagraphIndent(nodes, find, replace);
              break;
            case "textCase":
              count = yield replaceAllTextCase(nodes, find, replace);
              break;
            case "styles":
              count = replaceAllStyles(nodes, find, replace);
              break;
            case "shape":
              count = replaceAllShapeFill(nodes, find, replace);
              break;
            case "stroke":
              count = replaceAllStroke(nodes, find, replace);
              break;
            case "variables":
              count = replaceAllVariables(nodes, find, replace);
              break;
          }
          figma.ui.postMessage({ type: "replaced", count });
        });
      }
      function handleReplaceOne(category, nodeId, find, replace, options) {
        return __async(this, null, function* () {
          const node = figma.getNodeById(nodeId);
          if (!node) {
            figma.ui.postMessage({ type: "replaced-one", nodeId, count: 0 });
            return;
          }
          let count = 0;
          switch (category) {
            case "text":
              count = yield replaceAllText([node], find, replace, options);
              break;
            case "font":
              count = yield replaceAllFont([node], find, replace);
              break;
            case "fontColor":
              count = replaceAllFontColor([node], find, replace);
              break;
            case "fontSize":
              count = yield replaceAllFontSize([node], find, replace);
              break;
            case "textDecoration":
              count = yield replaceAllTextDecoration([node], find, replace);
              break;
            case "paragraphSpacing":
              count = replaceAllParagraphSpacing([node], find, replace);
              break;
            case "paragraphIndent":
              count = replaceAllParagraphIndent([node], find, replace);
              break;
            case "textCase":
              count = yield replaceAllTextCase([node], find, replace);
              break;
            case "styles":
              count = replaceAllStyles([node], find, replace);
              break;
            case "shape":
              count = replaceAllShapeFill([node], find, replace);
              break;
            case "stroke":
              count = replaceAllStroke([node], find, replace);
              break;
            case "variables":
              count = replaceAllVariables([node], find, replace);
              break;
          }
          figma.ui.postMessage({ type: "replaced-one", nodeId, count });
        });
      }
      function selectNode(nodeId) {
        const node = figma.getNodeById(nodeId);
        if (!node || node.type === "PAGE" || node.type === "DOCUMENT")
          return;
        let current = node;
        while (current.parent && current.parent.type !== "DOCUMENT") {
          current = current.parent;
        }
        const page = current;
        if (page.id !== figma.currentPage.id) {
          figma.currentPage = page;
        }
        figma.currentPage.selection = [node];
        figma.viewport.scrollAndZoomIntoView([node]);
      }
      function buildRegex(find, opts) {
        let esc = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (opts.wholeWord)
          esc = `\\b${esc}\\b`;
        return new RegExp(esc, opts.caseSensitive ? "g" : "gi");
      }
      function findText(nodes, find, opts) {
        const re = buildRegex(find, opts);
        return nodes.filter((n) => n.type === "TEXT" && re.test(n.characters)).map((n) => ({
          nodeId: n.id,
          nodeName: n.name,
          nodeType: "TEXT",
          preview: n.characters.slice(0, 90)
        }));
      }
      function loadFonts(node) {
        return __async(this, null, function* () {
          if (node.fontName !== figma.mixed) {
            yield figma.loadFontAsync(node.fontName);
            return;
          }
          const seen = /* @__PURE__ */ new Set();
          for (let i = 0; i < node.characters.length; i++) {
            const fn = node.getRangeFontName(i, i + 1);
            const key = `${fn.family}:${fn.style}`;
            if (!seen.has(key)) {
              seen.add(key);
              yield figma.loadFontAsync(fn);
            }
          }
        });
      }
      function replaceAllText(nodes, find, replace, opts) {
        return __async(this, null, function* () {
          const re = buildRegex(find, opts);
          let count = 0;
          for (const node of nodes) {
            if (node.type !== "TEXT")
              continue;
            const t = node;
            re.lastIndex = 0;
            if (!re.test(t.characters))
              continue;
            re.lastIndex = 0;
            const newChars = t.characters.replace(re, replace);
            try {
              yield loadFonts(t);
              t.characters = newChars;
              count++;
            } catch (e) {
              console.error("replaceText", node.id, e);
            }
          }
          return count;
        });
      }
      function findFont(nodes, find) {
        const lc = find.toLowerCase();
        return nodes.filter((n) => {
          if (n.type !== "TEXT")
            return false;
          const fn = n.fontName;
          if (typeof fn !== "symbol")
            return fn.family.toLowerCase().includes(lc);
          const t = n;
          for (let i = 0; i < t.characters.length; i++) {
            const rf = t.getRangeFontName(i, i + 1);
            if (typeof rf !== "symbol" && rf.family.toLowerCase().includes(lc))
              return true;
          }
          return false;
        }).map((n) => {
          const fn = n.fontName;
          const family = typeof fn === "symbol" ? "(mixed)" : fn.family;
          return { nodeId: n.id, nodeName: n.name, nodeType: "TEXT", preview: `Font: ${family}` };
        });
      }
      function replaceAllFont(nodes, find, replace) {
        return __async(this, null, function* () {
          const lc = find.toLowerCase();
          if (replace.startsWith("textstyle:")) {
            const styleId = replace.slice("textstyle:".length);
            const style2 = figma.getStyleById(styleId);
            if (!style2 || style2.type !== "TEXT")
              return 0;
            let count2 = 0;
            for (const node of nodes) {
              if (node.type !== "TEXT")
                continue;
              const t = node;
              const fn = t.fontName;
              if (typeof fn === "symbol")
                continue;
              if (!fn.family.toLowerCase().includes(lc))
                continue;
              try {
                yield loadFonts(t);
                t.textStyleId = style2.id;
                count2++;
              } catch (e) {
                console.error("replaceFont textStyle", node.id, e);
              }
            }
            return count2;
          }
          const sep = replace.indexOf("||");
          const family = sep >= 0 ? replace.slice(0, sep) : replace;
          const style = sep >= 0 ? replace.slice(sep + 2) : null;
          if (!family)
            return 0;
          let count = 0;
          for (const node of nodes) {
            if (node.type !== "TEXT")
              continue;
            const t = node;
            const fn = t.fontName;
            if (typeof fn === "symbol")
              continue;
            if (!fn.family.toLowerCase().includes(lc))
              continue;
            const targetStyle = style || fn.style;
            const preferred = { family, style: targetStyle };
            try {
              yield figma.loadFontAsync(preferred);
              t.fontName = preferred;
              count++;
            } catch (e) {
              const regular = { family, style: "Regular" };
              try {
                yield figma.loadFontAsync(regular);
                t.fontName = regular;
                count++;
              } catch (e2) {
                console.error("replaceFont", node.id, e2);
              }
            }
          }
          return count;
        });
      }
      function findFontColor(nodes, find) {
        const fc = parseHex(find);
        if (!fc)
          return [];
        return nodes.filter((n) => {
          if (n.type !== "TEXT")
            return false;
          const fills = n.fills;
          return Array.isArray(fills) && fills.some((f) => f.type === "SOLID" && rgbMatch(f.color, fc));
        }).map((n) => ({ nodeId: n.id, nodeName: n.name, nodeType: "TEXT", preview: `Color: #${find.replace("#", "")}` }));
      }
      function replaceAllFontColor(nodes, find, replace) {
        const fc = parseHex(find);
        const rc = parseHex(replace);
        if (!fc || !rc)
          return 0;
        let count = 0;
        for (const node of nodes) {
          if (node.type !== "TEXT")
            continue;
          const t = node;
          const fills = t.fills;
          if (!Array.isArray(fills))
            continue;
          if (!fills.some((f) => f.type === "SOLID" && rgbMatch(f.color, fc)))
            continue;
          const newF = fills.map((f) => f.type === "SOLID" && rgbMatch(f.color, fc) ? __spreadProps(__spreadValues({}, f), { color: rc }) : f);
          try {
            t.fills = newF;
            count++;
          } catch (e) {
            console.error("replaceFontColor", node.id, e);
          }
        }
        return count;
      }
      function findFontSize(nodes, find) {
        const target = parseFloat(find);
        if (isNaN(target))
          return [];
        return nodes.filter((n) => n.type === "TEXT").filter((n) => {
          const fs = n.fontSize;
          return typeof fs === "number" && fs === target;
        }).map((n) => ({
          nodeId: n.id,
          nodeName: n.name,
          nodeType: "TEXT",
          preview: `Font size: ${n.fontSize}`
        }));
      }
      function replaceAllFontSize(nodes, find, replace) {
        return __async(this, null, function* () {
          const target = parseFloat(find);
          const newSize = parseFloat(replace);
          if (isNaN(target) || isNaN(newSize) || newSize <= 0)
            return 0;
          let count = 0;
          for (const node of nodes) {
            if (node.type !== "TEXT")
              continue;
            const t = node;
            if (typeof t.fontSize !== "number" || t.fontSize !== target)
              continue;
            try {
              yield loadFonts(t);
              t.fontSize = newSize;
              count++;
            } catch (e) {
              console.error("replaceFontSize", node.id, e);
            }
          }
          return count;
        });
      }
      function findTextDecoration(nodes, find) {
        return nodes.filter((n) => n.type === "TEXT").filter((n) => {
          const td = n.textDecoration;
          return typeof td === "string" && td === find;
        }).map((n) => ({
          nodeId: n.id,
          nodeName: n.name,
          nodeType: "TEXT",
          preview: `Text decoration: ${find}`
        }));
      }
      function replaceAllTextDecoration(nodes, find, replace) {
        return __async(this, null, function* () {
          let count = 0;
          for (const node of nodes) {
            if (node.type !== "TEXT")
              continue;
            const t = node;
            if (typeof t.textDecoration !== "string" || t.textDecoration !== find)
              continue;
            try {
              yield loadFonts(t);
              t.textDecoration = replace;
              count++;
            } catch (e) {
              console.error("replaceTextDecoration", node.id, e);
            }
          }
          return count;
        });
      }
      function findParagraphSpacing(nodes, find) {
        const target = parseFloat(find);
        if (isNaN(target))
          return [];
        return nodes.filter((n) => n.type === "TEXT").filter((n) => n.paragraphSpacing === target).map((n) => ({
          nodeId: n.id,
          nodeName: n.name,
          nodeType: "TEXT",
          preview: `Paragraph spacing: ${target}`
        }));
      }
      function replaceAllParagraphSpacing(nodes, find, replace) {
        const target = parseFloat(find);
        const newVal = parseFloat(replace);
        if (isNaN(target) || isNaN(newVal))
          return 0;
        let count = 0;
        for (const node of nodes) {
          if (node.type !== "TEXT")
            continue;
          const t = node;
          if (t.paragraphSpacing !== target)
            continue;
          try {
            t.paragraphSpacing = newVal;
            count++;
          } catch (e) {
            console.error("replaceParagraphSpacing", node.id, e);
          }
        }
        return count;
      }
      function findParagraphIndent(nodes, find) {
        const target = parseFloat(find);
        if (isNaN(target))
          return [];
        return nodes.filter((n) => n.type === "TEXT").filter((n) => n.paragraphIndent === target).map((n) => ({
          nodeId: n.id,
          nodeName: n.name,
          nodeType: "TEXT",
          preview: `Paragraph indent: ${target}`
        }));
      }
      function replaceAllParagraphIndent(nodes, find, replace) {
        const target = parseFloat(find);
        const newVal = parseFloat(replace);
        if (isNaN(target) || isNaN(newVal))
          return 0;
        let count = 0;
        for (const node of nodes) {
          if (node.type !== "TEXT")
            continue;
          const t = node;
          if (t.paragraphIndent !== target)
            continue;
          try {
            t.paragraphIndent = newVal;
            count++;
          } catch (e) {
            console.error("replaceParagraphIndent", node.id, e);
          }
        }
        return count;
      }
      function findTextCase(nodes, find) {
        return nodes.filter((n) => n.type === "TEXT").filter((n) => {
          const tc = n.textCase;
          return typeof tc === "string" && tc === find;
        }).map((n) => ({
          nodeId: n.id,
          nodeName: n.name,
          nodeType: "TEXT",
          preview: `Text case: ${find}`
        }));
      }
      function replaceAllTextCase(nodes, find, replace) {
        return __async(this, null, function* () {
          let count = 0;
          for (const node of nodes) {
            if (node.type !== "TEXT")
              continue;
            const t = node;
            if (typeof t.textCase !== "string" || t.textCase !== find)
              continue;
            try {
              yield loadFonts(t);
              t.textCase = replace;
              count++;
            } catch (e) {
              console.error("replaceTextCase", node.id, e);
            }
          }
          return count;
        });
      }
      function resolveStyle(idOrName) {
        var _a;
        const byId = figma.getStyleById(idOrName);
        if (byId)
          return byId;
        return (_a = figma.getLocalPaintStyles().find((s) => s.name.toLowerCase() === idOrName.toLowerCase())) != null ? _a : null;
      }
      function findStyles(nodes, findIdOrName) {
        const target = resolveStyle(findIdOrName);
        const matches = [];
        for (const node of nodes) {
          let preview = "";
          if ("fillStyleId" in node) {
            const id = node.fillStyleId;
            if (typeof id === "string") {
              if (target ? id === target.id : false) {
                preview = `Fill: ${target.name}`;
              } else if (!target) {
                const s = figma.getStyleById(id);
                if (s && s.name.toLowerCase().includes(findIdOrName.toLowerCase()))
                  preview = `Fill: ${s.name}`;
              }
            }
          }
          if (!preview && "strokeStyleId" in node) {
            const id = node.strokeStyleId;
            if (typeof id === "string") {
              if (target ? id === target.id : false) {
                preview = `Stroke: ${target.name}`;
              } else if (!target) {
                const s = figma.getStyleById(id);
                if (s && s.name.toLowerCase().includes(findIdOrName.toLowerCase()))
                  preview = `Stroke: ${s.name}`;
              }
            }
          }
          if (preview)
            matches.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, preview });
        }
        return matches;
      }
      function replaceAllStyles(nodes, findIdOrName, replaceIdOrName) {
        const findS = resolveStyle(findIdOrName);
        const replaceS = resolveStyle(replaceIdOrName);
        if (!findS || !replaceS)
          return 0;
        let count = 0;
        for (const node of nodes) {
          let changed = false;
          if ("fillStyleId" in node && node.fillStyleId === findS.id) {
            try {
              node.fillStyleId = replaceS.id;
              changed = true;
            } catch (_) {
            }
          }
          if ("strokeStyleId" in node && node.strokeStyleId === findS.id) {
            try {
              node.strokeStyleId = replaceS.id;
              changed = true;
            } catch (_) {
            }
          }
          if (changed)
            count++;
        }
        return count;
      }
      function parseHex(hex) {
        const s = hex.replace("#", "").trim();
        if (s.length === 3) {
          return {
            r: parseInt(s[0] + s[0], 16) / 255,
            g: parseInt(s[1] + s[1], 16) / 255,
            b: parseInt(s[2] + s[2], 16) / 255
          };
        }
        if (s.length === 6) {
          return {
            r: parseInt(s.slice(0, 2), 16) / 255,
            g: parseInt(s.slice(2, 4), 16) / 255,
            b: parseInt(s.slice(4, 6), 16) / 255
          };
        }
        return null;
      }
      function rgbMatch(a, b) {
        return Math.round(a.r * 255) === Math.round(b.r * 255) && Math.round(a.g * 255) === Math.round(b.g * 255) && Math.round(a.b * 255) === Math.round(b.b * 255);
      }
      function findShapeFill(nodes, find, _opts) {
        const fc = parseHex(find);
        if (!fc)
          return [];
        return nodes.filter((n) => {
          if (!("fills" in n))
            return false;
          const fills = n.fills;
          return Array.isArray(fills) && fills.some((f) => f.type === "SOLID" && rgbMatch(f.color, fc));
        }).map((n) => ({ nodeId: n.id, nodeName: n.name, nodeType: n.type, preview: `Fill: #${find.replace("#", "")}` }));
      }
      function replaceAllShapeFill(nodes, find, replace) {
        const fc = parseHex(find);
        const rc = parseHex(replace);
        if (!fc || !rc)
          return 0;
        let count = 0;
        for (const node of nodes) {
          if (!("fills" in node))
            continue;
          const gm = node;
          const fills = gm.fills;
          if (!Array.isArray(fills))
            continue;
          const newF = fills.map((f) => f.type === "SOLID" && rgbMatch(f.color, fc) ? __spreadProps(__spreadValues({}, f), { color: rc }) : f);
          if (JSON.stringify(newF) !== JSON.stringify(fills)) {
            try {
              gm.fills = newF;
              count++;
            } catch (_) {
            }
          }
        }
        return count;
      }
      function findStroke(nodes, find) {
        const fc = parseHex(find);
        if (!fc)
          return [];
        return nodes.filter((n) => {
          if (!("strokes" in n))
            return false;
          const strokes = n.strokes;
          return Array.isArray(strokes) && strokes.some((s) => s.type === "SOLID" && rgbMatch(s.color, fc));
        }).map((n) => ({ nodeId: n.id, nodeName: n.name, nodeType: n.type, preview: `Stroke: #${find.replace("#", "")}` }));
      }
      function replaceAllStroke(nodes, find, replace) {
        const fc = parseHex(find);
        const rc = parseHex(replace);
        if (!fc || !rc)
          return 0;
        let count = 0;
        for (const node of nodes) {
          if (!("strokes" in node))
            continue;
          const sm = node;
          const strokes = sm.strokes;
          if (!Array.isArray(strokes))
            continue;
          const newS = strokes.map((s) => s.type === "SOLID" && rgbMatch(s.color, fc) ? __spreadProps(__spreadValues({}, s), { color: rc }) : s);
          if (JSON.stringify(newS) !== JSON.stringify(strokes)) {
            try {
              sm.strokes = newS;
              count++;
            } catch (_) {
            }
          }
        }
        return count;
      }
      function findVariables(nodes, find) {
        var _a;
        const lc = find.toLowerCase();
        const vars = figma.variables.getLocalVariables().filter((v) => v.name.toLowerCase().includes(lc));
        const ids = new Set(vars.map((v) => v.id));
        if (ids.size === 0)
          return [];
        const matches = [];
        for (const node of nodes) {
          const bindings = node.boundVariables;
          if (!bindings)
            continue;
          let preview = "";
          outer:
            for (const field of Object.keys(bindings)) {
              const b = bindings[field];
              if (!b)
                continue;
              const arr = Array.isArray(b) ? b : [b];
              for (const item of arr) {
                if ((item == null ? void 0 : item.id) && ids.has(item.id)) {
                  const v = figma.variables.getVariableById(item.id);
                  preview = `${field}: ${(_a = v == null ? void 0 : v.name) != null ? _a : item.id}`;
                  break outer;
                }
              }
            }
          if (preview)
            matches.push({ nodeId: node.id, nodeName: node.name, nodeType: node.type, preview });
        }
        return matches;
      }
      function replaceAllVariables(nodes, find, replace) {
        const all = figma.variables.getLocalVariables();
        const findV = all.find((v) => v.name.toLowerCase() === find.toLowerCase());
        const replaceV = all.find((v) => v.name.toLowerCase() === replace.toLowerCase());
        if (!findV || !replaceV)
          return 0;
        let count = 0;
        for (const node of nodes) {
          const bindings = node.boundVariables;
          if (!bindings)
            continue;
          let changed = false;
          for (const field of Object.keys(bindings)) {
            const b = bindings[field];
            if (!b)
              continue;
            if (Array.isArray(b)) {
              b.forEach((item, i) => {
                if ((item == null ? void 0 : item.id) === findV.id) {
                  try {
                    node.setBoundVariable(field, i, replaceV);
                    changed = true;
                  } catch (_) {
                  }
                }
              });
            } else if ((b == null ? void 0 : b.id) === findV.id) {
              try {
                node.setBoundVariable(field, replaceV);
                changed = true;
              } catch (_) {
              }
            }
          }
          if (changed)
            count++;
        }
        return count;
      }
      function paintToHex(paint) {
        if (paint.type !== "SOLID")
          return null;
        const { r, g, b } = paint.color;
        return "#" + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
      }
    }
  });
  return require_code();
})();
