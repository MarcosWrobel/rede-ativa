import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { EXPECTED_EXTENSION_VERSION } from "@/lib/clientDispatcher";

const ROOT_DIR = path.resolve(__dirname, "../../..");
const WA_CONTENT_PATH = path.join(ROOT_DIR, "extension/whatsapp-content.js");
const BACKGROUND_PATH = path.join(ROOT_DIR, "extension/background.js");
const BRIDGE_PATH = path.join(ROOT_DIR, "extension/registro-bridge.js");
const MANIFEST_PATH = path.join(ROOT_DIR, "extension/manifest.json");
const ZIP_REDE_ATIVA_PATH = path.join(ROOT_DIR, "public/extensao-rede-ativa.zip");
const ZIP_LEOPOLDINA_PATH = path.join(ROOT_DIR, "public/extensao-leopoldina.zip");

const NodeConstants = {
  DOCUMENT_POSITION_DISCONNECTED: 1,
  DOCUMENT_POSITION_PRECEDING: 2,
  DOCUMENT_POSITION_FOLLOWING: 4,
  DOCUMENT_POSITION_CONTAINS: 8,
  DOCUMENT_POSITION_CONTAINED_BY: 16,
};

interface MutationRecordMock {
  type: "childList";
  target: DomElementMock;
  addedNodes: DomElementMock[];
  removedNodes: DomElementMock[];
}

class DomElementMock {
  nodeType = 1;
  tagName: string;
  id = "";
  className = "";
  title = "";
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: DomElementMock[] = [];
  parentNode: DomElementMock | null = null;
  ownerDocument: DomDocumentMock;
  private _text = "";
  private listeners = new Map<string, Set<(...args: any[]) => void>>();

  constructor(tagName: string, ownerDocument: DomDocumentMock) {
    this.tagName = tagName.toLowerCase();
    this.ownerDocument = ownerDocument;
  }

  get isConnected(): boolean {
    let cur: DomElementMock | null = this;
    while (cur) {
      if (cur === this.ownerDocument.body) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  get firstChild(): DomElementMock | null {
    return this.children[0] || null;
  }

  get textContent(): string {
    if (this.children.length === 0) return this._text;
    return this._text + this.children.map((c) => c.textContent).join("");
  }

  set textContent(val: string) {
    const next = String(val ?? "");
    const hadChildren = this.children.length > 0;
    const prevText = this._text;
    const removed = [...this.children];
    for (const c of removed) c.parentNode = null;
    this.children = [];
    this._text = next;
    if (hadChildren || prevText !== next) {
      this.ownerDocument.notifyMutation({
        type: "childList",
        target: this,
        addedNodes: [],
        removedNodes: removed,
      });
    }
  }

  get innerText(): string {
    this.ownerDocument.stats.innerTextReads++;
    return this.textContent;
  }

  set innerText(val: string) {
    this.textContent = val;
  }

  get innerHTML(): string {
    return this.textContent;
  }

  set innerHTML(val: string) {
    this.textContent = val;
  }

  setAttribute(name: string, value: string) {
    const v = String(value);
    this.attributes.set(name, v);
    if (name === "id") this.id = v;
    if (name === "class") this.className = v;
    if (name === "title") this.title = v;
  }

  getAttribute(name: string): string | null {
    if (name === "id" && this.id) return this.id;
    if (name === "class" && this.className) return this.className;
    if (name === "title" && this.title) return this.title;
    return this.attributes.has(name) ? this.attributes.get(name)! : null;
  }

  appendChild(child: DomElementMock): DomElementMock {
    if (child.parentNode) {
      const idx = child.parentNode.children.indexOf(child);
      if (idx >= 0) child.parentNode.children.splice(idx, 1);
    }
    child.parentNode = this;
    this.children.push(child);
    this.ownerDocument.notifyMutation({
      type: "childList",
      target: this,
      addedNodes: [child],
      removedNodes: [],
    });
    return child;
  }

  insertBefore(newNode: DomElementMock, refNode: DomElementMock | null): DomElementMock {
    if (!refNode) return this.appendChild(newNode);
    if (newNode.parentNode) {
      const oldIdx = newNode.parentNode.children.indexOf(newNode);
      if (oldIdx >= 0) newNode.parentNode.children.splice(oldIdx, 1);
    }
    newNode.parentNode = this;
    const idx = this.children.indexOf(refNode);
    if (idx >= 0) {
      this.children.splice(idx, 0, newNode);
    } else {
      this.children.push(newNode);
    }
    this.ownerDocument.notifyMutation({
      type: "childList",
      target: this,
      addedNodes: [newNode],
      removedNodes: [],
    });
    return newNode;
  }

  remove() {
    if (!this.parentNode) return;
    const parent = this.parentNode;
    const idx = parent.children.indexOf(this);
    if (idx >= 0) parent.children.splice(idx, 1);
    this.parentNode = null;
    this.ownerDocument.notifyMutation({
      type: "childList",
      target: parent,
      addedNodes: [],
      removedNodes: [this],
    });
  }

  contains(other: DomElementMock | null): boolean {
    let cur: DomElementMock | null = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  compareDocumentPosition(other: DomElementMock): number {
    if (this === other) return 0;
    const all = this.ownerDocument.flattenOrder();
    const idxThis = all.indexOf(this);
    const idxOther = all.indexOf(other);
    if (idxThis === -1 || idxOther === -1) return NodeConstants.DOCUMENT_POSITION_DISCONNECTED;
    return idxOther > idxThis
      ? NodeConstants.DOCUMENT_POSITION_FOLLOWING
      : NodeConstants.DOCUMENT_POSITION_PRECEDING;
  }

  cloneNode(deep = false): DomElementMock {
    const copy = new DomElementMock(this.tagName, this.ownerDocument);
    copy.id = this.id;
    copy.className = this.className;
    copy.title = this.title;
    copy._text = this._text;
    for (const [k, v] of this.attributes.entries()) copy.attributes.set(k, v);
    if (deep) {
      for (const ch of this.children) {
        const clonedChild = ch.cloneNode(true);
        clonedChild.parentNode = copy;
        copy.children.push(clonedChild);
      }
    }
    return copy;
  }

  matchesSingleSelector(sel: string): boolean {
    const s = sel.trim();
    if (!s) return false;

    if (s.includes(" ")) {
      const parts = s.split(/\s+/);
      const last = parts[parts.length - 1];
      if (!this.matchesSingleSelector(last)) return false;
      let ancestor = this.parentNode;
      for (let i = parts.length - 2; i >= 0; i--) {
        while (ancestor && !ancestor.matchesSingleSelector(parts[i])) {
          ancestor = ancestor.parentNode;
        }
        if (!ancestor) return false;
        ancestor = ancestor.parentNode;
      }
      return true;
    }

    if (s.startsWith("#")) {
      return this.id === s.slice(1);
    }

    let rest = s;
    const tagMatch = rest.match(/^[a-zA-Z0-9_-]+/);
    if (tagMatch) {
      if (this.tagName !== tagMatch[0].toLowerCase()) return false;
      rest = rest.slice(tagMatch[0].length);
    }

    const classMatches = rest.match(/\.[a-zA-Z0-9_-]+/g) || [];
    const classList = this.className.split(/\s+/).filter(Boolean);
    for (const cm of classMatches) {
      if (!classList.includes(cm.slice(1))) return false;
      rest = rest.replace(cm, "");
    }

    const attrRegex = /\[([a-zA-Z0-9_-]+)(?:(\^=|\*=|=)['"]?([^'"\]]*)['"]?)?\]/g;
    let m: RegExpExecArray | null;
    while ((m = attrRegex.exec(rest)) !== null) {
      const attrName = m[1];
      const op = m[2];
      const expectedVal = m[3] ?? "";
      const actualVal = this.getAttribute(attrName);
      if (actualVal === null) return false;
      if (op === "=" && actualVal !== expectedVal) return false;
      if (op === "^=" && !actualVal.startsWith(expectedVal)) return false;
      if (op === "*=" && !actualVal.includes(expectedVal)) return false;
    }

    return true;
  }

  matches(selectorGroup: string): boolean {
    return selectorGroup
      .split(",")
      .some((part) => this.matchesSingleSelector(part.trim()));
  }

  closest(selectorGroup: string): DomElementMock | null {
    let cur: DomElementMock | null = this;
    while (cur) {
      if (cur.matches(selectorGroup)) return cur;
      cur = cur.parentNode;
    }
    return null;
  }

  querySelectorAll(selectorGroup: string): DomElementMock[] {
    this.ownerDocument.stats.querySelectorAllCalls++;
    const results: DomElementMock[] = [];
    const visit = (node: DomElementMock) => {
      for (const child of node.children) {
        if (child.matches(selectorGroup)) results.push(child);
        visit(child);
      }
    };
    visit(this);
    return results;
  }

  querySelector(selectorGroup: string): DomElementMock | null {
    const all = this.querySelectorAll(selectorGroup);
    return all[0] || null;
  }

  addEventListener(type: string, fn: (...args: any[]) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: (...args: any[]) => void) {
    this.listeners.get(type)?.delete(fn);
  }

  dispatchEvent(event: any) {
    event.target = event.target || this;
    this.ownerDocument.dispatchBubbleOrCapture(this, event);
    const set = this.listeners.get(event.type);
    if (set) {
      for (const fn of [...set]) fn(event);
    }
    return true;
  }

  click() {
    this.dispatchEvent({ type: "click", target: this });
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }
}

class DomDocumentMock {
  body: DomElementMock;
  documentElement: DomElementMock;
  activeElement: DomElementMock | null = null;
  docListeners: Array<{ type: string; fn: any; capture: boolean }> = [];
  observers = new Set<{
    callback: (records: MutationRecordMock[]) => void;
    target: DomElementMock | null;
    options: { childList?: boolean; subtree?: boolean };
  }>();
  stats = {
    mutationCallbacks: 0,
    mutationRecords: 0,
    querySelectorAllCalls: 0,
    innerTextReads: 0,
  };

  constructor() {
    this.documentElement = new DomElementMock("html", this);
    this.body = new DomElementMock("body", this);
    this.documentElement.appendChild(this.body);
  }

  createElement(tag: string) {
    return new DomElementMock(tag, this);
  }

  getElementById(id: string): DomElementMock | null {
    return this.body.querySelector(`#${id}`);
  }

  querySelector(sel: string): DomElementMock | null {
    return this.body.querySelector(sel);
  }

  querySelectorAll(sel: string): DomElementMock[] {
    return this.body.querySelectorAll(sel);
  }

  addEventListener(type: string, fn: any, options?: any) {
    const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
    this.docListeners.push({ type, fn, capture });
  }

  removeEventListener(type: string, fn: any, options?: any) {
    const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
    const idx = this.docListeners.findIndex(
      (l) => l.type === type && l.fn === fn && l.capture === capture
    );
    if (idx >= 0) this.docListeners.splice(idx, 1);
  }

  dispatchEvent(event: any) {
    for (const l of [...this.docListeners]) {
      if (l.type === event.type) l.fn(event);
    }
  }

  dispatchBubbleOrCapture(target: DomElementMock, event: any) {
    for (const l of [...this.docListeners]) {
      if (l.type === event.type) l.fn({ ...event, target });
    }
  }

  flattenOrder(): DomElementMock[] {
    const out: DomElementMock[] = [];
    const walk = (n: DomElementMock) => {
      out.push(n);
      for (const c of n.children) walk(c);
    };
    walk(this.body);
    return out;
  }

  notifyMutation(record: MutationRecordMock) {
    for (const obs of [...this.observers]) {
      if (!obs.target) continue;
      const matchesTarget =
        obs.target === record.target ||
        (obs.options?.subtree && obs.target.contains(record.target));
      if (matchesTarget) {
        this.stats.mutationCallbacks++;
        this.stats.mutationRecords++;
        obs.callback([record]);
      }
    }
  }
}

function createWhatsAppContentHarness(options?: {
  url?: string;
  chatTitle?: string;
  initialDispatch?: any;
  initialCaptureCtx?: any;
  outgoingCount?: number;
  incomingCount?: number;
}) {
  const doc = new DomDocumentMock();
  const appEl = doc.createElement("div");
  appEl.id = "app";
  const mainEl = doc.createElement("div");
  mainEl.id = "main";

  const headerEl = doc.createElement("header");
  const headerSpan = doc.createElement("span");
  const title = options?.chatTitle ?? "+55 42 99999-1111";
  headerSpan.setAttribute("title", title);
  headerSpan.textContent = title;
  headerEl.appendChild(headerSpan);
  mainEl.appendChild(headerEl);

  const chatMessages = doc.createElement("div");
  chatMessages.id = "chat-messages";

  const inCount = options?.incomingCount ?? 3;
  for (let i = 0; i < inCount; i++) {
    const inMsg = doc.createElement("div");
    inMsg.className = "message-in";
    inMsg.setAttribute("data-id", `false_5542999991111@c.us_IN_${i}`);
    const span = doc.createElement("span");
    span.className = "selectable-text copyable-text";
    span.textContent = `Resposta sintética recebida ${i}`;
    inMsg.appendChild(span);
    chatMessages.appendChild(inMsg);
  }

  const outCount = options?.outgoingCount ?? 3;
  for (let i = 0; i < outCount; i++) {
    const outMsg = doc.createElement("div");
    outMsg.className = "message-out";
    outMsg.setAttribute("data-id", `true_5542999991111@c.us_OUT_${i}`);
    const span = doc.createElement("span");
    span.className = "selectable-text copyable-text";
    span.textContent = `Comunicado anterior ${i}`;
    outMsg.appendChild(span);
    chatMessages.appendChild(outMsg);
  }
  mainEl.appendChild(chatMessages);

  const footer = doc.createElement("footer");
  const composeBox = doc.createElement("div");
  composeBox.setAttribute("contenteditable", "true");
  composeBox.setAttribute("role", "textbox");
  composeBox.textContent = "Comunicado escolar de busca ativa";
  footer.appendChild(composeBox);

  const sendBtn = doc.createElement("button");
  sendBtn.setAttribute("data-tab", "11");
  sendBtn.setAttribute("aria-label", "Enviar");
  footer.appendChild(sendBtn);
  mainEl.appendChild(footer);

  appEl.appendChild(mainEl);
  doc.body.appendChild(appEl);

  // Reset stats after initial DOM construction
  doc.stats.mutationCallbacks = 0;
  doc.stats.mutationRecords = 0;
  doc.stats.querySelectorAllCalls = 0;
  doc.stats.innerTextReads = 0;

  let nextTimerId = 1;
  let nowMs = 1_700_000_000_000;
  const timeouts = new Map<number, { fn: () => void; dueAt: number }>();
  const intervals = new Map<number, { fn: () => void; delay: number; nextAt: number }>();

  const runtimeListeners: Array<(req: any, sender: any, sendResponse: (r: any) => void) => any> = [];
  const storageListeners: Array<(...args: any[]) => void> = [];
  const sentRuntimeMessages: any[] = [];

  let activeDispatchMock = options?.initialDispatch ?? null;
  let activeCaptureCtxMock = options?.initialCaptureCtx ?? null;
  let selectedText = "";

  const parsedUrl = new URL(options?.url ?? "https://web.whatsapp.com/send?phone=5542999991111&text=Comunicado%20escolar%20de%20busca%20ativa");

  class MutationObserverMock {
    private entry: {
      callback: (records: MutationRecordMock[]) => void;
      target: DomElementMock | null;
      options: { childList?: boolean; subtree?: boolean };
    };
    constructor(cb: (records: MutationRecordMock[]) => void) {
      this.entry = { callback: cb, target: null, options: {} };
    }
    observe(target: DomElementMock, opts: { childList?: boolean; subtree?: boolean }) {
      this.entry.target = target;
      this.entry.options = opts || {};
      doc.observers.add(this.entry);
    }
    disconnect() {
      this.entry.target = null;
      doc.observers.delete(this.entry);
    }
  }

  const windowObj: any = {
    location: {
      href: parsedUrl.href,
      origin: parsedUrl.origin,
      search: parsedUrl.search,
    },
    getSelection: () => ({
      isCollapsed: selectedText.length === 0,
      anchorNode: mainEl,
      toString: () => selectedText,
    }),
  };

  const chromeObj: any = {
    runtime: {
      id: "ext-rede-ativa-test",
      lastError: null,
      sendMessage: (msg: any, cb?: (res: any) => void) => {
        sentRuntimeMessages.push(msg);
        if (msg?.type === "LEOPOLDINA_GET_ACTIVE_DISPATCH") {
          if (cb) cb({ activeDispatch: activeDispatchMock });
          return Promise.resolve({ activeDispatch: activeDispatchMock });
        }
        if (msg?.type === "LEOPOLDINA_GET_CAPTURE_CONTEXT") {
          if (cb) {
            cb(
              activeCaptureCtxMock
                ? { success: true, ...activeCaptureCtxMock }
                : { success: false, error: "UNKNOWN_OPERATION_CONTEXT" }
            );
          }
          return Promise.resolve({ success: Boolean(activeCaptureCtxMock) });
        }
        if (msg?.type === "LEOPOLDINA_PUSH_CAPTURED_REPLY") {
          if (cb) cb({ success: true, relayedCount: 1 });
          return Promise.resolve({ success: true, relayedCount: 1 });
        }
        if (cb) cb({ success: true });
        return Promise.resolve({ success: true });
      },
      onMessage: {
        addListener: (fn: any) => {
          runtimeListeners.push(fn);
        },
        removeListener: (fn: any) => {
          const i = runtimeListeners.indexOf(fn);
          if (i >= 0) runtimeListeners.splice(i, 1);
        },
      },
    },
    storage: {
      onChanged: {
        addListener: (fn: any) => storageListeners.push(fn),
        removeListener: (fn: any) => {
          const i = storageListeners.indexOf(fn);
          if (i >= 0) storageListeners.splice(i, 1);
        },
      },
    },
  };

  const sandbox: any = {
    window: windowObj,
    document: doc,
    chrome: chromeObj,
    Node: NodeConstants,
    MutationObserver: MutationObserverMock,
    KeyboardEvent: class {
      type: string;
      key: string;
      shiftKey: boolean;
      constructor(type: string, init?: any) {
        this.type = type;
        this.key = init?.key || "";
        this.shiftKey = Boolean(init?.shiftKey);
      }
    },
    URL,
    URLSearchParams,
    WeakSet,
    Set,
    Map,
    Date: {
      now: () => nowMs,
    },
    setTimeout: (fn: () => void, delay = 0) => {
      const id = nextTimerId++;
      timeouts.set(id, { fn, dueAt: nowMs + Math.max(0, Number(delay) || 0) });
      return id;
    },
    clearTimeout: (id: number) => {
      timeouts.delete(id);
    },
    setInterval: (fn: () => void, delay = 0) => {
      const id = nextTimerId++;
      const d = Math.max(1, Number(delay) || 1);
      intervals.set(id, { fn, delay: d, nextAt: nowMs + d });
      return id;
    },
    clearInterval: (id: number) => {
      intervals.delete(id);
    },
    console: { log: () => {}, warn: () => {}, error: () => {} },
  };

  const scriptCode = fs.readFileSync(WA_CONTENT_PATH, "utf8");

  function injectScript() {
    vm.runInNewContext(scriptCode, sandbox, { filename: "whatsapp-content.js" });
  }

  function advanceTime(ms: number) {
    const targetTime = nowMs + ms;
    while (nowMs < targetTime) {
      let nextStep = targetTime;
      for (const t of timeouts.values()) {
        if (t.dueAt < nextStep) nextStep = t.dueAt;
      }
      for (const iv of intervals.values()) {
        if (iv.nextAt < nextStep) nextStep = iv.nextAt;
      }
      nowMs = nextStep;

      for (const [id, t] of [...timeouts.entries()]) {
        if (t.dueAt <= nowMs) {
          timeouts.delete(id);
          t.fn();
        }
      }
      for (const [id, iv] of [...intervals.entries()]) {
        if (iv.nextAt <= nowMs && intervals.has(id)) {
          iv.nextAt = nowMs + iv.delay;
          iv.fn();
        }
      }
    }
  }

  function appendOutgoingBubble(text = "Comunicado escolar de busca ativa", jidPhone = "5542999991111") {
    const bubble = doc.createElement("div");
    bubble.className = "message-out";
    bubble.setAttribute("data-id", `true_${jidPhone}@c.us_NEW_${nowMs}`);
    const span = doc.createElement("span");
    span.className = "selectable-text copyable-text";
    span.textContent = text;
    bubble.appendChild(span);
    chatMessages.appendChild(bubble);
    composeBox.textContent = "";
    return bubble;
  }

  return {
    doc,
    windowObj,
    mainEl,
    headerSpan,
    chatMessages,
    composeBox,
    sendBtn,
    timeouts,
    intervals,
    runtimeListeners,
    storageListeners,
    sentRuntimeMessages,
    injectScript,
    advanceTime,
    appendOutgoingBubble,
    setSelection(text: string) {
      selectedText = text;
    },
    setActiveDispatchMock(d: any) {
      activeDispatchMock = d;
    },
    sendRuntimeToContent(message: any) {
      const responses: any[] = [];
      for (const fn of [...runtimeListeners]) {
        fn(message, {}, (res: any) => responses.push(res));
      }
      return responses;
    },
  };
}

describe("Suite de Regressão de Desempenho e Confiabilidade — Extensão & Busca Ativa (v1.7.1)", () => {
  it("1. Reinjeção 1x, 5x e 10x de whatsapp-content.js não acumula listeners, timers, observers nem barras duplicadas", () => {
    const h = createWhatsAppContentHarness();

    for (let i = 1; i <= 10; i++) {
      h.injectScript();
      if (i === 1 || i === 5 || i === 10) {
        expect(h.runtimeListeners).toHaveLength(1);
        expect(h.storageListeners).toHaveLength(0);
        expect(h.doc.docListeners).toHaveLength(3); // selectionchange, click, keydown
        expect(h.intervals.size).toBe(0); // Sem heartbeat permanente quando ocioso
        expect(h.doc.observers.size).toBe(1); // Apenas rootContainerObserver leve (subtree: false)
        expect(h.doc.querySelectorAll("#leopoldina-wa-topbar")).toHaveLength(1);
      }
    }

    const pingResponses = h.sendRuntimeToContent({ type: "LEOPOLDINA_PING" });
    expect(pingResponses).toHaveLength(1);
    expect(pingResponses[0]).toEqual({ pong: true, version: "1.7.1" });
  });

  it("2. __REDEATIVA_WA_CLEANUP__ remove todos os listeners, cancela timers pendentes e impede confirmação posterior", () => {
    const h = createWhatsAppContentHarness({
      initialDispatch: {
        requestId: "req-clean-1",
        logId: "log-clean-1",
        phone: "5542999991111",
        studentName: "Estudante Teste",
        autoSend: false,
        dispatchedAt: 1_700_000_000_000,
      },
    });
    h.injectScript();

    // Clica no botão Enviar (agenda timeout de verificação) e adiciona bolha
    h.sendBtn.click();
    expect(h.timeouts.size).toBeGreaterThan(0);

    // Executa cleanup imediatamente antes do timeout disparar (e chama 2x para provar idempotência)
    h.windowObj.__REDEATIVA_WA_CLEANUP__();
    h.windowObj.__REDEATIVA_WA_CLEANUP__();

    expect(h.timeouts.size).toBe(0);
    expect(h.intervals.size).toBe(0);
    expect(h.doc.observers.size).toBe(0);
    expect(h.doc.docListeners).toHaveLength(0);
    expect(h.runtimeListeners).toHaveLength(0);
    expect(h.doc.getElementById("leopoldina-wa-topbar")).toBeNull();

    // Avança o tempo e tenta adicionar bolha ou enviar PING após cleanup
    h.appendOutgoingBubble();
    h.advanceTime(2000);
    h.sendRuntimeToContent({ type: "LEOPOLDINA_PING" });

    const outcomes = h.sentRuntimeMessages.filter(
      (m) => m.type === "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME"
    );
    expect(outcomes).toHaveLength(0);
    expect(h.doc.getElementById("leopoldina-wa-topbar")).toBeNull();
  });

  it("3. Mutações do DOM sem despacho ativo não disparam varreduras globais querySelectorAll nem leituras innerText", () => {
    const h = createWhatsAppContentHarness({ initialDispatch: null });
    h.injectScript();

    h.doc.stats.mutationCallbacks = 0;
    h.doc.stats.querySelectorAllCalls = 0;
    h.doc.stats.innerTextReads = 0;

    // 100 mutações dentro de #chat-messages sem despacho ativo
    for (let i = 0; i < 100; i++) {
      const node = h.doc.createElement("div");
      node.textContent = `Mensagem em conversa ${i}`;
      h.chatMessages.appendChild(node);
    }
    h.advanceTime(500);

    expect(h.doc.stats.mutationCallbacks).toBe(0);
    expect(h.doc.stats.querySelectorAllCalls).toBe(0);
    expect(h.doc.stats.innerTextReads).toBe(0);
  });

  it("4. selectionchange repetido sem mudança de estado não muta o DOM nem recria o texto do botão", () => {
    const h = createWhatsAppContentHarness({ initialDispatch: null });
    h.injectScript();

    h.doc.stats.mutationCallbacks = 0;
    h.doc.stats.mutationRecords = 0;

    for (let i = 0; i < 50; i++) {
      h.doc.dispatchEvent({ type: "selectionchange" });
      h.advanceTime(100);
    }

    expect(h.doc.stats.mutationCallbacks).toBe(0);
    expect(h.doc.stats.mutationRecords).toBe(0);
  });

  it("5. Expiração do monitoramento de envio desconecta o dispatchObserver, encerra o timer e impede confirmação tardia", () => {
    const h = createWhatsAppContentHarness({
      initialDispatch: {
        requestId: "req-exp-1",
        logId: "log-exp-1",
        phone: "5542999991111",
        studentName: "Estudante Expiração",
        autoSend: true,
        dispatchedAt: 1_700_000_000_000,
      },
    });
    h.injectScript();
    expect(h.intervals.size).toBe(1);
    expect(h.doc.observers.size).toBe(2); // rootContainerObserver + dispatchObserver

    // Avança 30 segundos (45+ ticks de 600ms) sem que uma nova bolha de saída apareça
    h.advanceTime(30_000);

    // Após expirar, o intervalo e o dispatchObserver devem ter sido encerrados
    expect(h.intervals.size).toBe(0);
    expect(h.doc.observers.size).toBe(1); // Apenas rootContainerObserver permanece

    // Uma bolha enviada tardiamente após a expiração NÃO pode confirmar o despacho expirado
    h.appendOutgoingBubble("Comunicado escolar de busca ativa");
    h.advanceTime(1000);

    const outcomes = h.sentRuntimeMessages.filter(
      (m) => m.type === "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME"
    );
    expect(outcomes).toHaveLength(0);
  });

  it("6. Isolamento entre duas abas do WhatsApp Web: aba não autorizada não recebe o despacho nem confirma envio", () => {
    // Aba 1: WhatsApp pessoal aberto em outra conversa (sem activeDispatch)
    const tab1 = createWhatsAppContentHarness({
      url: "https://web.whatsapp.com/",
      chatTitle: "Conversa Pessoal Aba 1",
      initialDispatch: null,
    });
    // Aba 2: Janela dedicada autorizada para 5542999991111
    const tab2 = createWhatsAppContentHarness({
      url: "https://web.whatsapp.com/send?phone=5542999991111&text=Comunicado%20escolar%20de%20busca%20ativa",
      chatTitle: "+55 42 99999-1111",
      initialDispatch: {
        requestId: "req-tab2",
        logId: "log-tab2",
        phone: "5542999991111",
        studentName: "Estudante Aba 2",
        autoSend: true,
        dispatchedAt: 1_700_000_000_000,
      },
    });

    tab1.injectScript();
    tab2.injectScript();

    // Aba 1 envia mensagens normais na conversa pessoal
    tab1.sendBtn.click();
    tab1.appendOutgoingBubble("Mensagem pessoal na aba 1", "5541988887777");
    tab1.advanceTime(2000);

    // Aba 2 executa o envio assistido e o WhatsApp adiciona a nova bolha na base
    tab2.advanceTime(900);
    tab2.appendOutgoingBubble("Comunicado escolar de busca ativa", "5542999991111");
    tab2.advanceTime(500);

    const tab1Outcomes = tab1.sentRuntimeMessages.filter(
      (m) => m.type === "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME"
    );
    const tab2Outcomes = tab2.sentRuntimeMessages.filter(
      (m) => m.type === "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME"
    );

    expect(tab1Outcomes).toHaveLength(0);
    expect(tab2Outcomes).toHaveLength(1);
    expect(tab2Outcomes[0]).toMatchObject({
      outcome: "SENT",
      requestId: "req-tab2",
      logId: "log-tab2",
      phone: "5542999991111",
    });
  });

  it("7. Troca do despacho A para o despacho B invalida callbacks pendentes de A e preserva B", () => {
    const h = createWhatsAppContentHarness({
      url: "https://web.whatsapp.com/send?phone=5542999991111&text=Mensagem%20A",
      chatTitle: "+55 42 99999-1111",
      initialDispatch: {
        requestId: "req-A",
        logId: "log-A",
        phone: "5542999991111",
        studentName: "Estudante A",
        text: "Mensagem A",
        autoSend: false,
        dispatchedAt: 1_700_000_000_000,
      },
    });
    h.injectScript();

    // Clica em Enviar durante o despacho A (agenda verificação em 150ms), mas antes de confirmar chega o despacho B
    h.sendBtn.click();
    h.advanceTime(50);

    h.headerSpan.setAttribute("title", "+55 42 99999-2222");
    h.headerSpan.textContent = "+55 42 99999-2222";
    h.sendRuntimeToContent({
      type: "LEOPOLDINA_ACTIVATE_DISPATCH",
      activeDispatch: {
        requestId: "req-B",
        logId: "log-B",
        phone: "5542999992222",
        studentName: "Estudante B",
        text: "Mensagem B",
        autoSend: false,
        dispatchedAt: 1_700_000_000_050,
      },
    });

    // Avança o tempo além do callback agendado por A: nenhuma confirmação de A deve ocorrer
    h.advanceTime(500);
    expect(
      h.sentRuntimeMessages.filter((m) => m.type === "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME")
    ).toHaveLength(0);

    // Agora o envio de B realmente se concretiza na conversa de B
    h.composeBox.textContent = "Mensagem B";
    h.sendBtn.click();
    h.appendOutgoingBubble("Mensagem B", "5542999992222");
    h.advanceTime(200);

    const outcomes = h.sentRuntimeMessages.filter(
      (m) => m.type === "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME"
    );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      outcome: "SENT",
      requestId: "req-B",
      logId: "log-B",
      phone: "5542999992222",
    });
  });

  it("8. Rolagem/carregamento de mensagens antigas no topo da conversa NÃO confirma SENT", () => {
    const h = createWhatsAppContentHarness({
      initialDispatch: {
        requestId: "req-scroll-1",
        logId: "log-scroll-1",
        phone: "5542999991111",
        studentName: "Estudante Scroll",
        autoSend: false,
        dispatchedAt: 1_700_000_000_000,
      },
    });
    h.injectScript();

    // Insere 10 mensagens antigas de saída no TOPO de #chat-messages (simulando paginação por scroll para cima)
    for (let i = 0; i < 10; i++) {
      const oldBubble = h.doc.createElement("div");
      oldBubble.className = "message-out";
      oldBubble.setAttribute("data-id", `true_5542999991111@c.us_OLD_${i}`);
      const span = h.doc.createElement("span");
      span.className = "selectable-text copyable-text";
      span.textContent = `Comunicado antigo da semana passada ${i}`;
      oldBubble.appendChild(span);
      h.chatMessages.insertBefore(oldBubble, h.chatMessages.firstChild);
    }

    h.advanceTime(1000);
    const outcomes = h.sentRuntimeMessages.filter(
      (m) => m.type === "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME"
    );
    expect(outcomes).toHaveLength(0);
  });

  it("9. Troca para outra conversa (com nome salvo ou outro número) impede confirmação de SENT", () => {
    const h = createWhatsAppContentHarness({
      url: "https://web.whatsapp.com/send?phone=5542999991111&text=Comunicado%20escolar%20de%20busca%20ativa",
      chatTitle: "+55 42 99999-1111",
      initialDispatch: {
        requestId: "req-switch-1",
        logId: "log-switch-1",
        phone: "5542999991111",
        studentName: "Estudante Alvo",
        autoSend: false,
        dispatchedAt: 1_700_000_000_000,
      },
    });
    h.injectScript();

    //Caso A: Troca para conversa com nome salvo ("Coordenação Pedagógica")
    h.headerSpan.setAttribute("title", "Coordenação Pedagógica");
    h.headerSpan.textContent = "Coordenação Pedagógica";
    h.sendBtn.click();
    h.appendOutgoingBubble("Mensagem enviada para a coordenação", "5541988887777");
    h.advanceTime(500);

    // Caso B: Troca para outro número visível ("+55 41 97777-6666")
    h.headerSpan.setAttribute("title", "+55 41 97777-6666");
    h.headerSpan.textContent = "+55 41 97777-6666";
    h.sendBtn.click();
    h.appendOutgoingBubble("Comunicado escolar de busca ativa", "5541977776666");
    h.advanceTime(500);

    const outcomes = h.sentRuntimeMessages.filter(
      (m) => m.type === "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME"
    );
    expect(outcomes).toHaveLength(0);
  });

  it("10. background.js: reuso de janela não fecha outras abas do WhatsApp, não redimensiona repetidamente e bloqueia aba não autorizada", async () => {
    const storageData: Record<string, any> = {};
    const removedTabIds: number[] = [];
    const windowUpdates: Array<{ winId: number; props: any }> = [];
    const tabs = [
      { id: 101, windowId: 1, url: "https://www.redeativa.app.br/busca-ativa", active: true },
      { id: 900, windowId: 99, url: "https://web.whatsapp.com/", active: true },
      { id: 901, windowId: 1, url: "https://web.whatsapp.com/", active: false }, // Aba pessoal da usuária
    ];
    let onMessageListener: any = null;

    const chromeMock: any = {
      runtime: {
        id: "ext-rede-ativa-test",
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: { addListener: (fn: any) => { onMessageListener = fn; } },
      },
      storage: {
        local: {
          get: vi.fn(async (keys: any) => {
            const list = Array.isArray(keys) ? keys : [keys];
            const out: Record<string, any> = {};
            for (const k of list) if (k in storageData) out[k] = storageData[k];
            return out;
          }),
          set: vi.fn(async (items: any) => { Object.assign(storageData, items); }),
          remove: vi.fn(async (keys: any) => {
            for (const k of (Array.isArray(keys) ? keys : [keys])) delete storageData[k];
          }),
        },
      },
      tabs: {
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
        remove: vi.fn(async (id: number) => { removedTabIds.push(id); }),
        query: vi.fn(async (q: any) =>
          q?.url === "*://web.whatsapp.com/*"
            ? tabs.filter((t) => t.url.startsWith("https://web.whatsapp.com"))
            : [...tabs]
        ),
        get: vi.fn(async (id: number) => tabs.find((t) => t.id === id)),
        update: vi.fn(async (id: number, props: any) => {
          const t = tabs.find((x) => x.id === id);
          if (t && props.url) t.url = props.url;
          return t;
        }),
        sendMessage: vi.fn(async () => ({ ok: true })),
      },
      windows: {
        getCurrent: vi.fn(async () => ({ id: 1, width: 1440, left: 0, top: 0 })),
        get: vi.fn(async (winId: number) => ({ id: winId, type: winId === 99 ? "popup" : "normal" })),
        update: vi.fn(async (winId: number, props: any) => {
          windowUpdates.push({ winId, props });
          return {};
        }),
        create: vi.fn(async () => ({ id: 99, tabs: [{ id: 900, windowId: 99 }] })),
      },
      scripting: { executeScript: vi.fn(async () => []) },
    };

    const bgCode = fs.readFileSync(BACKGROUND_PATH, "utf8");
    vm.runInNewContext(
      bgCode,
      {
        chrome: chromeMock,
        URL,
        Object,
        Array,
        Date,
        Math,
        String,
        Number,
        Boolean,
        Promise,
        setTimeout,
        clearTimeout,
        console: { warn: () => {}, error: () => {}, log: () => {} },
      },
      { filename: "background.js" }
    );

    const callBg = (req: any, sender: any) =>
      new Promise<any>((resolve) =>
        onMessageListener(req, { frameId: 0, documentId: `doc-${sender.tab?.id}`, ...sender }, resolve)
      );

    const dispRes = await callBg(
      {
        type: "LEOPOLDINA_DISPATCH_WHATSAPP",
        requestId: "req-win-1",
        logId: "log-win-1",
        phone: "5542999991111",
        studentName: "Estudante Janela",
        url: "https://web.whatsapp.com/send?phone=5542999991111&text=Oi",
      },
      { id: "ext-rede-ativa-test", url: "https://www.redeativa.app.br/busca-ativa", tab: { id: 101, windowId: 1 } }
    );

    expect(dispRes.success).toBe(true);
    expect(dispRes.tabId).toBe(900);
    // Nenhuma outra aba do WhatsApp foi fechada!
    expect(removedTabIds).toHaveLength(0);
    // A janela reutilizada recebeu apenas { focused: true }, sem redimensionamento/reposicionamento forçado
    expect(windowUpdates).toEqual([{ winId: 99, props: { focused: true } }]);

    // Aba 901 (não autorizada) tenta consultar ou confirmar o despacho da aba 900 -> bloqueada!
    const getFromUnauthorizedTab = await callBg(
      { type: "LEOPOLDINA_GET_ACTIVE_DISPATCH", phone: "5542999991111" },
      { id: "ext-rede-ativa-test", url: "https://web.whatsapp.com/", tab: { id: 901, windowId: 1 } }
    );
    expect(getFromUnauthorizedTab.activeDispatch).toBeNull();

    // Aba 900 (autorizada), mesmo após o WhatsApp Web limpar ?phone= via history.replaceState (phone: null, url: "/"), recebe o despacho!
    const getFromAuthorizedTabWithoutUrlPhone = await callBg(
      { type: "LEOPOLDINA_GET_ACTIVE_DISPATCH", phone: null },
      { id: "ext-rede-ativa-test", url: "https://web.whatsapp.com/", tab: { id: 900, windowId: 99 } }
    );
    expect(getFromAuthorizedTabWithoutUrlPhone.activeDispatch).toMatchObject({
      requestId: "req-win-1",
      logId: "log-win-1",
      phone: "5542999991111",
    });

    const outcomeFromUnauthorizedTab = await callBg(
      {
        type: "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME",
        outcome: "SENT",
        requestId: "req-win-1",
        logId: "log-win-1",
        phone: "5542999991111",
      },
      { id: "ext-rede-ativa-test", url: "https://web.whatsapp.com/", tab: { id: 901, windowId: 1 } }
    );
    expect(outcomeFromUnauthorizedTab.success).toBe(false);
    expect(outcomeFromUnauthorizedTab.error).toBe("UNAUTHORIZED_WHATSAPP_TAB");

    // O despacho na aba autorizada (900) permanece intacto e pode ser confirmado normalmente pela aba 900
    const outcomeFromAuthorizedTab = await callBg(
      {
        type: "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME",
        outcome: "SENT",
        requestId: "req-win-1",
        logId: "log-win-1",
        phone: "5542999991111",
      },
      { id: "ext-rede-ativa-test", url: "https://web.whatsapp.com/", tab: { id: 900, windowId: 99 } }
    );
    expect(outcomeFromAuthorizedTab.success).toBe(true);
  });

  it("11. registro-bridge.js é idempotente na reinjeção e remove listeners anteriores via __REDEATIVA_BRIDGE_CLEANUP__", () => {
    const winListeners: any[] = [];
    const runtimeListeners: any[] = [];

    const winMock: any = {
      location: { origin: "https://www.redeativa.app.br", hostname: "www.redeativa.app.br" },
      addEventListener: vi.fn((type: string, fn: any) => {
        if (type === "message") winListeners.push(fn);
      }),
      removeEventListener: vi.fn((type: string, fn: any) => {
        if (type === "message") {
          const i = winListeners.indexOf(fn);
          if (i >= 0) winListeners.splice(i, 1);
        }
      }),
      postMessage: vi.fn(),
    };

    const chromeMock: any = {
      runtime: {
        id: "ext-rede-ativa-test",
        sendMessage: vi.fn(),
        onMessage: {
          addListener: vi.fn((fn: any) => runtimeListeners.push(fn)),
          removeListener: vi.fn((fn: any) => {
            const i = runtimeListeners.indexOf(fn);
            if (i >= 0) runtimeListeners.splice(i, 1);
          }),
        },
      },
      storage: { local: { get: vi.fn(), remove: vi.fn() } },
    };

    const bridgeCode = fs.readFileSync(BRIDGE_PATH, "utf8");
    const sandbox = {
      window: winMock,
      document: { documentElement: { dataset: {} } },
      sessionStorage: { removeItem: vi.fn(), getItem: vi.fn() },
      chrome: chromeMock,
      URL,
      Set,
      Map,
      Date,
      Math,
      setTimeout,
      clearTimeout,
      console: { warn: () => {}, error: () => {}, log: () => {} },
    };

    for (let i = 0; i < 5; i++) {
      vm.runInNewContext(bridgeCode, sandbox, { filename: "registro-bridge.js" });
    }

    expect(winListeners).toHaveLength(1);
    expect(runtimeListeners).toHaveLength(1);
    expect((sandbox.document.documentElement.dataset as any).redeativaExtensionVersion).toBe("1.7.1");
  });

  it("12. WhatsAppDispatchToggle e BuscaAtivaClient removem todos os listeners e timers no cleanup de useEffect", () => {
    const toggleSource = fs.readFileSync(
      path.join(ROOT_DIR, "src/components/whatsapp/WhatsAppDispatchToggle.tsx"),
      "utf8"
    );
    expect(toggleSource).toContain('window.addEventListener("message", handleWindowMessage)');
    expect(toggleSource).toContain('window.removeEventListener("message", handleWindowMessage)');

    const buscaAtivaSource = fs.readFileSync(
      path.join(ROOT_DIR, "src/app/busca-ativa/BuscaAtivaClient.tsx"),
      "utf8"
    );
    expect(buscaAtivaSource).toContain('window.removeEventListener("message", handleExtensionConfirmation)');
    expect(buscaAtivaSource).toContain("if (toastTimer) clearTimeout(toastTimer)");
  });

  it("13. Pacotes ZIP distribuídos contêm exatamente os arquivos de extension/ com hashes SHA-256 idênticos e versão 1.7.1 sincronizada com EXPECTED_EXTENSION_VERSION", () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    expect(manifest.version).toBe("1.7.1");
    expect(EXPECTED_EXTENSION_VERSION).toBe(manifest.version);

    expect(fs.existsSync(ZIP_REDE_ATIVA_PATH)).toBe(true);
    expect(fs.existsSync(ZIP_LEOPOLDINA_PATH)).toBe(true);

    const zipHashRedeAtiva = crypto
      .createHash("sha256")
      .update(fs.readFileSync(ZIP_REDE_ATIVA_PATH))
      .digest("hex");
    const zipHashLeopoldina = crypto
      .createHash("sha256")
      .update(fs.readFileSync(ZIP_LEOPOLDINA_PATH))
      .digest("hex");
    expect(zipHashRedeAtiva).toBe(zipHashLeopoldina);

    const filesToVerify = [
      "manifest.json",
      "background.js",
      "whatsapp-content.js",
      "registro-bridge.js",
      "interceptor.js",
      "content.js",
      "serp-content.js",
      "popup.js",
      "popup.html",
      "whatsapp-focus.css",
    ];

    for (const relFile of filesToVerify) {
      const sourceBytes = fs.readFileSync(path.join(ROOT_DIR, "extension", relFile));
      const zippedBytes = execFileSync("unzip", ["-p", ZIP_REDE_ATIVA_PATH, relFile]);
      const sourceSha = crypto.createHash("sha256").update(sourceBytes).digest("hex");
      const zippedSha = crypto.createHash("sha256").update(zippedBytes).digest("hex");
      expect(zippedSha).toBe(sourceSha);
    }
  });

  it("14. Cenário real do WhatsApp Web: URL sem ?phone= (após history.replaceState), cabeçalho com nome salvo em span[dir=auto], IDs @lid e markdown *negrito* confirmam auto-send e envio manual", () => {
    const markdownTemplate =
      "Olá! Aqui é da Equipe Pedagógica da *Instituição de Ensino*. Notamos a ausência de *ESTUDANTE TESTE* nas aulas.";
    const renderedDomBubbleText =
      "Olá! Aqui é da Equipe Pedagógica da Instituição de Ensino. Notamos a ausência de ESTUDANTE TESTE nas aulas.\n23:30";

    // Parte A: Auto-Send em conversa real sem ?phone= na URL, título nomeado e botão div[role="button"] > span[data-icon="wds-ic-send-filled"]
    const autoHarness = createWhatsAppContentHarness({
      url: "https://web.whatsapp.com/", // Após history.replaceState limpar /send?phone=...
      chatTitle: "Maria Responsável",
      outgoingCount: 0,
      incomingCount: 0,
      initialDispatch: {
        requestId: "req-real-auto",
        logId: "log-real-auto",
        phone: "5542999991111",
        studentName: "ESTUDANTE TESTE",
        text: markdownTemplate,
        autoSend: true,
        dispatchedAt: 1_700_000_000_000,
      },
    });

    // Simula cabeçalho moderno do WhatsApp Web (span[dir="auto"] sem atributo title)
    autoHarness.headerSpan.attributes.delete("title");
    autoHarness.headerSpan.title = "";
    autoHarness.headerSpan.setAttribute("dir", "auto");
    autoHarness.headerSpan.textContent = "Maria Responsável";
    autoHarness.composeBox.textContent = markdownTemplate;

    // Substitui o botão padrão por div[role="button"] contendo span[data-icon="wds-ic-send-filled"]
    const footerEl = autoHarness.sendBtn.parentNode!;
    autoHarness.sendBtn.remove();
    const roleBtn = autoHarness.doc.createElement("div");
    roleBtn.setAttribute("role", "button");
    roleBtn.setAttribute("aria-label", "Enviar");
    const iconSpan = autoHarness.doc.createElement("span");
    iconSpan.setAttribute("data-icon", "wds-ic-send-filled");
    roleBtn.appendChild(iconSpan);
    footerEl.appendChild(roleBtn);

    let autoSendClicked = false;
    roleBtn.addEventListener("click", () => {
      autoSendClicked = true;
      // WhatsApp Web renderiza bolha com @lid (sem @c.us) e sem asteriscos de markdown
      const lidRow = autoHarness.doc.createElement("div");
      lidRow.setAttribute("data-id", "true_192837465@lid_3EB0AAAA");
      const innerOut = autoHarness.doc.createElement("div");
      innerOut.className = "message-out";
      const textSpan = autoHarness.doc.createElement("span");
      textSpan.className = "selectable-text copyable-text";
      textSpan.textContent = renderedDomBubbleText;
      innerOut.appendChild(textSpan);
      lidRow.appendChild(innerOut);
      autoHarness.chatMessages.appendChild(lidRow);
      autoHarness.composeBox.textContent = "";
    });

    autoHarness.injectScript();
    autoHarness.advanceTime(1200);

    expect(autoSendClicked).toBe(true);
    const autoOutcomes = autoHarness.sentRuntimeMessages.filter(
      (m) => m.type === "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME"
    );
    expect(autoOutcomes).toHaveLength(1);
    expect(autoOutcomes[0]).toMatchObject({
      outcome: "SENT",
      requestId: "req-real-auto",
      logId: "log-real-auto",
      phone: "5542999991111",
    });

    // Parte B: Envio manual (autoSend: false) pressionando Enter em nó filho do editor Lexical
    const manualHarness = createWhatsAppContentHarness({
      url: "https://web.whatsapp.com/",
      chatTitle: "Maria Responsável",
      outgoingCount: 0,
      incomingCount: 0,
      initialDispatch: {
        requestId: "req-real-manual",
        logId: "log-real-manual",
        phone: "5542999991111",
        studentName: "ESTUDANTE TESTE",
        text: markdownTemplate,
        autoSend: false,
        dispatchedAt: 1_700_000_000_000,
      },
    });
    manualHarness.headerSpan.attributes.delete("title");
    manualHarness.headerSpan.title = "";
    manualHarness.headerSpan.setAttribute("dir", "auto");
    manualHarness.headerSpan.textContent = "Maria Responsável";

    const lexicalChild = manualHarness.doc.createElement("span");
    lexicalChild.setAttribute("data-lexical-text", "true");
    lexicalChild.textContent = markdownTemplate;
    manualHarness.composeBox.textContent = "";
    manualHarness.composeBox.appendChild(lexicalChild);

    manualHarness.injectScript();

    // Usuária pressiona Enter com foco no nó filho dentro de div[contenteditable="true"]
    lexicalChild.focus();
    lexicalChild.dispatchEvent({ type: "keydown", key: "Enter", shiftKey: false, target: lexicalChild });

    const manualLidBubble = manualHarness.doc.createElement("div");
    manualLidBubble.setAttribute("data-id", "true_192837465@lid_3EB0BBBB");
    const manualInner = manualHarness.doc.createElement("div");
    manualInner.className = "message-out";
    const manualSpan = manualHarness.doc.createElement("span");
    manualSpan.className = "selectable-text copyable-text";
    manualSpan.textContent = renderedDomBubbleText;
    manualInner.appendChild(manualSpan);
    manualLidBubble.appendChild(manualInner);
    manualHarness.chatMessages.appendChild(manualLidBubble);
    manualHarness.composeBox.textContent = "";

    manualHarness.advanceTime(400);

    const manualOutcomes = manualHarness.sentRuntimeMessages.filter(
      (m) => m.type === "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME"
    );
    expect(manualOutcomes).toHaveLength(1);
    expect(manualOutcomes[0]).toMatchObject({
      outcome: "SENT",
      requestId: "req-real-manual",
      logId: "log-real-manual",
      phone: "5542999991111",
    });
  });

  it("15. Proteção anti-microfone: nunca clica em button[data-tab='11'] de voz/microfone após envio e confirma SENT mesmo se tabs.onUpdated reenviar LEOPOLDINA_ACTIVATE_DISPATCH", () => {
    const dispatchPayload = {
      requestId: "req-no-mic-1",
      logId: "log-no-mic-1",
      phone: "5542999991111",
      studentName: "NATIELE PACHECO DOS SANTOS",
      text: "teste",
      autoSend: true,
      dispatchedAt: 1_700_000_000_000,
    };

    const h = createWhatsAppContentHarness({
      url: "https://web.whatsapp.com/",
      chatTitle: "MARCOS",
      outgoingCount: 2,
      incomingCount: 1,
      initialDispatch: dispatchPayload,
    });
    h.headerSpan.attributes.delete("title");
    h.headerSpan.title = "";
    h.headerSpan.setAttribute("dir", "auto");
    h.headerSpan.textContent = "MARCOS";
    h.composeBox.textContent = "teste";

    let sendClickCount = 0;
    let micClicked = false;

    h.sendBtn.addEventListener("click", () => {
      if (h.sendBtn.getAttribute("aria-label") === "Mensagem de voz") {
        micClicked = true;
        return;
      }
      sendClickCount++;
      // Simula comportamento real do WhatsApp Web: limpa a caixa de texto e transforma button[data-tab="11"] no botão de microfone!
      h.composeBox.textContent = "";
      h.sendBtn.setAttribute("aria-label", "Mensagem de voz");
      const pttIcon = h.doc.createElement("span");
      pttIcon.setAttribute("data-icon", "ptt");
      h.sendBtn.appendChild(pttIcon);
    });

    h.injectScript();

    // Avança até o disparo do auto-send (600ms tick + 250ms timeout = 850ms)
    h.advanceTime(900);
    expect(sendClickCount).toBe(1);

    // Simula chrome.tabs.onUpdated (status === "complete") reenviando LEOPOLDINA_ACTIVATE_DISPATCH com o mesmo requestId
    h.sendRuntimeToContent({
      type: "LEOPOLDINA_ACTIVATE_DISPATCH",
      activeDispatch: dispatchPayload,
    });

    // Avança mais 5 segundos: deve confirmar SENT e JAMAIS clicar no botão de microfone
    h.advanceTime(5000);

    expect(micClicked).toBe(false);
    expect(sendClickCount).toBe(1);

    const outcomes = h.sentRuntimeMessages.filter(
      (m) => m.type === "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME"
    );
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      outcome: "SENT",
      requestId: "req-no-mic-1",
      logId: "log-no-mic-1",
      phone: "5542999991111",
    });
  });

  it("16. onInstalled reinjeta registro-bridge.js em abas já abertas da plataforma autorizada e ignora origens externas", async () => {
    const injectedFilesByTab: Array<{ tabId: number; files: string[] }> = [];
    let onInstalledCb: any = null;

    const tabs = [
      { id: 10, url: "https://www.redeativa.app.br/busca-ativa" },
      { id: 20, url: "https://evil.example.com/busca-ativa" },
      { id: 30, url: "https://web.whatsapp.com/" },
    ];

    const chromeMock: any = {
      runtime: {
        id: "ext-rede-ativa-test",
        onInstalled: { addListener: (fn: any) => { onInstalledCb = fn; } },
        onStartup: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() },
      },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => {}),
          remove: vi.fn(async () => {}),
        },
      },
      tabs: {
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
        query: vi.fn(async (q: any) =>
          q?.url === "*://web.whatsapp.com/*"
            ? tabs.filter((t) => t.url.startsWith("https://web.whatsapp.com"))
            : [...tabs]
        ),
        sendMessage: vi.fn(async () => ({ pong: true })),
      },
      windows: { getCurrent: vi.fn(), get: vi.fn(), update: vi.fn(), create: vi.fn() },
      scripting: {
        executeScript: vi.fn(async ({ target, files }: any) => {
          injectedFilesByTab.push({ tabId: target.tabId, files });
          return [];
        }),
      },
    };

    const bgCode = fs.readFileSync(BACKGROUND_PATH, "utf8");
    vm.runInNewContext(
      bgCode,
      {
        chrome: chromeMock,
        URL,
        Object,
        Array,
        Date,
        Math,
        String,
        Number,
        Boolean,
        Promise,
        setTimeout,
        clearTimeout,
        console: { warn: () => {}, error: () => {}, log: () => {} },
      },
      { filename: "background.js" }
    );

    expect(typeof onInstalledCb).toBe("function");
    onInstalledCb();
    await new Promise((r) => setTimeout(r, 20));

    expect(injectedFilesByTab).toEqual([
      { tabId: 10, files: ["registro-bridge.js"] },
    ]);
  });

  it("17. background.js reutiliza janela/aba do WhatsApp via SPA (sem recarregar url) quando opt_whatsapp_spa_reuse está ativo e faz fallback seguro quando desativado ou recusado", async () => {
    let onMessageCb: any = null;
    const storageData: Record<string, any> = {
      opt_whatsapp_auto_send: true,
      opt_whatsapp_spa_reuse: true,
    };
    const tabsUpdateCalls: Array<{ tabId: number; props: any }> = [];
    const tabsSendMessageCalls: Array<{ tabId: number; msg: any }> = [];
    let spaAccepted = true;

    const chromeMock: any = {
      runtime: {
        id: "ext-rede-ativa-test",
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: { addListener: (fn: any) => { onMessageCb = fn; } },
      },
      storage: {
        local: {
          get: vi.fn(async (keys: any) => {
            if (Array.isArray(keys)) {
              const out: Record<string, any> = {};
              for (const k of keys) {
                if (k in storageData) out[k] = storageData[k];
              }
              return out;
            }
            return { ...storageData };
          }),
          set: vi.fn(async (patch: any) => Object.assign(storageData, patch)),
          remove: vi.fn(async () => {}),
        },
      },
      tabs: {
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
        get: vi.fn(async (id: number) =>
          id === 10
            ? { id: 10, url: "https://www.redeativa.app.br/busca-ativa" }
            : id === 77
            ? { id: 77, windowId: 5, url: "https://web.whatsapp.com/" }
            : null
        ),
        query: vi.fn(async (q: any) =>
          q?.url === "*://web.whatsapp.com/*"
            ? [{ id: 77, windowId: 5, url: "https://web.whatsapp.com/" }]
            : [{ id: 10, url: "https://www.redeativa.app.br/busca-ativa" }]
        ),
        update: vi.fn(async (tabId: number, props: any) => {
          tabsUpdateCalls.push({ tabId, props });
          return { id: tabId, windowId: 5, ...props };
        }),
        sendMessage: vi.fn(async (tabId: number, msg: any) => {
          tabsSendMessageCalls.push({ tabId, msg });
          if (msg?.type === "LEOPOLDINA_SPA_NAVIGATE_AND_DISPATCH") {
            return spaAccepted ? { accepted: true, requestId: msg.activeDispatch?.requestId } : { accepted: false };
          }
          return { ok: true };
        }),
      },
      windows: {
        getCurrent: vi.fn(async () => ({ id: 1 })),
        get: vi.fn(async (id: number) => ({ id, type: "popup" })),
        update: vi.fn(async () => ({})),
        create: vi.fn(async () => ({ id: 9, tabs: [{ id: 99 }] })),
      },
      scripting: { executeScript: vi.fn(async () => []) },
    };

    const bgCode = fs.readFileSync(BACKGROUND_PATH, "utf8");
    vm.runInNewContext(
      bgCode,
      {
        chrome: chromeMock,
        URL,
        Object,
        Array,
        Date,
        Math,
        String,
        Number,
        Boolean,
        Promise,
        setTimeout,
        clearTimeout,
        console: { warn: () => {}, error: () => {}, log: () => {} },
      },
      { filename: "background.js" }
    );

    const invokeDispatch = (requestId: string) =>
      new Promise<any>((resolve) => {
        onMessageCb(
          {
            type: "LEOPOLDINA_DISPATCH_WHATSAPP",
            requestId,
            logId: `log-${requestId}`,
            phone: "5542999991111",
            studentName: "Estudante SPA",
            url: "https://web.whatsapp.com/send/?phone=5542999991111&text=Oi",
            reuseTab: true,
          },
          { tab: { id: 10, url: "https://www.redeativa.app.br/busca-ativa" }, frameId: 0, documentId: "doc-1", origin: "https://www.redeativa.app.br" },
          resolve
        );
      });

    // 1) SPA habilitado e aceito -> NÃO passa url em chrome.tabs.update
    const res1 = await invokeDispatch("req-spa-1");
    expect(res1.success).toBe(true);
    expect(res1.spaSwitched).toBe(true);
    expect(tabsSendMessageCalls.some((c) => c.msg?.type === "LEOPOLDINA_SPA_NAVIGATE_AND_DISPATCH")).toBe(true);
    expect(tabsUpdateCalls.some((c) => "url" in c.props)).toBe(false);

    // 2) SPA recusado pelo content script -> fallback imediato para chrome.tabs.update({ url })
    tabsUpdateCalls.length = 0;
    spaAccepted = false;
    const res2 = await invokeDispatch("req-spa-2");
    expect(res2.success).toBe(true);
    expect(res2.spaSwitched).toBe(false);
    expect(tabsUpdateCalls.some((c) => c.props.url === "https://web.whatsapp.com/send/?phone=5542999991111&text=Oi")).toBe(true);

    // 3) Toggle opt_whatsapp_spa_reuse = false -> reverte diretamente para reload via chrome.tabs.update({ url })
    tabsUpdateCalls.length = 0;
    tabsSendMessageCalls.length = 0;
    storageData.opt_whatsapp_spa_reuse = false;
    spaAccepted = true;
    const res3 = await invokeDispatch("req-spa-3");
    expect(res3.success).toBe(true);
    expect(res3.spaSwitched).toBe(false);
    expect(tabsSendMessageCalls.some((c) => c.msg?.type === "LEOPOLDINA_SPA_NAVIGATE_AND_DISPATCH")).toBe(false);
    expect(tabsUpdateCalls.some((c) => c.props.url === "https://web.whatsapp.com/send/?phone=5542999991111&text=Oi")).toBe(true);
  });

  it("18. whatsapp-content.js alterna de Chat A para Chat B via LEOPOLDINA_SPA_NAVIGATE_AND_DISPATCH sem absorver histórico/título do Chat A na baseline", () => {
    const h = createWhatsAppContentHarness({
      url: "https://web.whatsapp.com/",
      outgoingCount: 1,
    });
    h.headerSpan.setAttribute("title", "Contato Anterior A");
    h.headerSpan.title = "Contato Anterior A";
    h.headerSpan.textContent = "Contato Anterior A";
    h.composeBox.textContent = "";
    h.injectScript();

    // Configura #side para indicar WhatsApp Web carregado e autenticado
    const appEl = h.doc.getElementById("app")!;
    const sideEl = h.doc.createElement("div");
    sideEl.id = "side";
    appEl.appendChild(sideEl);

    const responses = h.sendRuntimeToContent({
      type: "LEOPOLDINA_SPA_NAVIGATE_AND_DISPATCH",
      targetUrl: "https://web.whatsapp.com/send/?phone=5542999992222&text=Nova+mensagem+B",
      activeDispatch: {
        requestId: "req-spa-switch-B",
        logId: "log-spa-switch-B",
        phone: "5542999992222",
        studentName: "Responsavel B",
        text: "Nova mensagem B",
        autoSend: true,
        dispatchedAt: 1_700_000_000_000,
      },
    });

    expect(responses[0]).toEqual({ accepted: true, requestId: "req-spa-switch-B" });

    // Simula WhatsApp Web trocando o #main do Chat A para o Chat B de forma assíncrona
    h.headerSpan.setAttribute("title", "Responsavel B");
    h.headerSpan.title = "Responsavel B";
    h.headerSpan.textContent = "Responsavel B";
    h.chatMessages.children = [];
    h.composeBox.textContent = "Nova mensagem B";

    h.sendBtn.addEventListener("click", () => {
      h.composeBox.textContent = "";
      const newBubbleB = h.doc.createElement("div");
      newBubbleB.setAttribute("data-id", "true_5542999992222@c.us_3EB0B1");
      const innerB = h.doc.createElement("div");
      innerB.className = "message-out";
      const spanB = h.doc.createElement("span");
      spanB.className = "selectable-text copyable-text";
      spanB.textContent = "Nova mensagem B";
      innerB.appendChild(spanB);
      newBubbleB.appendChild(innerB);
      h.chatMessages.appendChild(newBubbleB);
    });

    // Avança timers para resolver SPA switch, capturar baseline do Chat B, acionar auto-send e confirmar SENT
    h.advanceTime(900);
    h.advanceTime(1200);

    const sentOutcome = h.sentRuntimeMessages.find(
      (m) => m.type === "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME" && m.requestId === "req-spa-switch-B"
    );
    expect(sentOutcome).toBeDefined();
    expect(sentOutcome.outcome).toBe("SENT");
  });

  it("19. Extração em contato salvo (@lid + URL limpa) funciona via comprovação de texto/vínculo @lid/navegação SPA e bloqueia rigorosamente grupos ou conversas alheias (zero vazamento)", () => {
    const h = createWhatsAppContentHarness({
      url: "https://web.whatsapp.com/",
      outgoingCount: 0,
      incomingCount: 0,
    });
    h.headerSpan.attributes.delete("title");
    h.headerSpan.title = "";
    h.headerSpan.setAttribute("dir", "auto");
    h.headerSpan.textContent = "Mãe do João";

    // Bolhas reais com identificador @lid (sem @c.us)
    const sentMsg = h.doc.createElement("div");
    sentMsg.setAttribute("data-id", "true_192837465001@lid_3EB0OUT1");
    sentMsg.className = "message-out";
    const sentSpan = h.doc.createElement("span");
    sentSpan.className = "selectable-text copyable-text";
    sentSpan.textContent = "Olá, notamos 3 faltas consecutivas de João.";
    sentMsg.appendChild(sentSpan);
    h.chatMessages.appendChild(sentMsg);

    const incomingMsg = h.doc.createElement("div");
    incomingMsg.setAttribute("data-id", "false_192837465001@lid_3EB0IN1");
    incomingMsg.className = "message-in";
    const inSpan = h.doc.createElement("span");
    inSpan.className = "selectable-text copyable-text";
    inSpan.textContent = "Ele estava com febre hoje.";
    incomingMsg.appendChild(inSpan);
    h.chatMessages.appendChild(incomingMsg);

    h.injectScript();

    // 1) Grupo (@g.us) no #main é bloqueado imediatamente com CHAT_MISMATCH
    const groupMarker = h.doc.createElement("div");
    groupMarker.setAttribute("data-id", "false_120363000111222@g.us_3EB0GRP");
    h.chatMessages.appendChild(groupMarker);

    const groupResponses: any[] = [];
    h.runtimeListeners[0](
      {
        type: "LEOPOLDINA_EXTRACT_LAST_INCOMING_MESSAGE",
        requestId: "req-ext-grp",
        logId: "log-ext-grp",
        phone: "5542999991111",
        expectedOutgoingText: "Olá, notamos 3 faltas consecutivas de João.",
      },
      { id: "ext-rede-ativa-test" },
      (r: any) => groupResponses.push(r)
    );
    h.advanceTime(4000);
    expect(groupResponses[0].success).toBe(false);
    expect(groupResponses[0].error).toBe("CHAT_MISMATCH");
    groupMarker.remove();

    // 2) Conversa individual nominal (@lid) sem expectedOutgoingText e sem vínculo prévio -> bloqueada (zero vazamento)
    const unverifiedResponses: any[] = [];
    h.runtimeListeners[0](
      {
        type: "LEOPOLDINA_EXTRACT_LAST_INCOMING_MESSAGE",
        requestId: "req-ext-unverified",
        logId: "log-ext-unverified",
        phone: "5542999991111",
      },
      { id: "ext-rede-ativa-test" },
      (r: any) => unverifiedResponses.push(r)
    );
    h.advanceTime(4000);
    expect(unverifiedResponses[0].success).toBe(false);
    expect(unverifiedResponses[0].error).toBe("CHAT_PHONE_UNAVAILABLE");

    // 3) Com expectedOutgoingText compatível -> confirma o contato @lid e extrai a resposta
    const verifiedResponses: any[] = [];
    h.runtimeListeners[0](
      {
        type: "LEOPOLDINA_EXTRACT_LAST_INCOMING_MESSAGE",
        requestId: "req-ext-verified",
        logId: "log-ext-verified",
        phone: "5542999991111",
        expectedOutgoingText: "Olá, notamos 3 faltas consecutivas de João.",
      },
      { id: "ext-rede-ativa-test" },
      (r: any) => verifiedResponses.push(r)
    );
    expect(verifiedResponses[0]).toMatchObject({
      success: true,
      requestId: "req-ext-verified",
      logId: "log-ext-verified",
      activeChatTitle: "Mãe do João",
    });
    expect(verifiedResponses[0].rawText).toContain("Ele estava com febre hoje.");

    // 4) Agora @lid 192837465001@lid já está vinculado a 5542999991111: tentar extrair OUTRO aluno nele retorna CHAT_MISMATCH!
    const crossStudentResponses: any[] = [];
    h.runtimeListeners[0](
      {
        type: "LEOPOLDINA_EXTRACT_LAST_INCOMING_MESSAGE",
        requestId: "req-ext-other",
        logId: "log-ext-other",
        phone: "5542988887777",
      },
      { id: "ext-rede-ativa-test" },
      (r: any) => crossStudentResponses.push(r)
    );
    h.advanceTime(4000);
    expect(crossStudentResponses[0].success).toBe(false);
    expect(crossStudentResponses[0].error).toBe("CHAT_MISMATCH");

    // 5) Navegação SPA silenciosa na extração quando outra conversa pessoal está aberta: transiciona #main e extrai sem text= na URL
    const appEl = h.doc.getElementById("app")!;
    const sideEl = h.doc.createElement("div");
    sideEl.id = "side";
    appEl.appendChild(sideEl);

    h.headerSpan.textContent = "Contato Pessoal Qualquer";
    sentMsg.setAttribute("data-id", "true_999000888777@lid_3EB0PERS");
    sentSpan.textContent = "Conversa pessoal privada";
    incomingMsg.setAttribute("data-id", "false_999000888777@lid_3EB0PERSIN");
    inSpan.textContent = "Assunto privado que não pode vazar";

    const spaLinksClicked: string[] = [];
    const origCreate = h.doc.createElement.bind(h.doc);
    h.doc.createElement = ((tag: string) => {
      const el = origCreate(tag);
      if (tag.toLowerCase() === "a") {
        (el as any).click = () => {
          spaLinksClicked.push((el as any).href || "");
          // Simula transição do #main para o chat da Responsável 3 após clique SPA
          h.headerSpan.textContent = "Responsável Maria Lote";
          sentMsg.setAttribute("data-id", "true_777666555444@lid_3EB0R3");
          sentSpan.textContent = "Mensagem oficial escola";
          incomingMsg.setAttribute("data-id", "false_777666555444@lid_3EB0R3IN");
          inSpan.textContent = "Recebido, obrigada!";
        };
      }
      return el;
    }) as any;

    const spaResponses: any[] = [];
    h.runtimeListeners[0](
      {
        type: "LEOPOLDINA_EXTRACT_LAST_INCOMING_MESSAGE",
        requestId: "req-ext-spa-3",
        logId: "log-ext-spa-3",
        phone: "5542977776666",
      },
      { id: "ext-rede-ativa-test" },
      (r: any) => spaResponses.push(r)
    );
    h.advanceTime(650);

    expect(spaLinksClicked).toEqual(["https://web.whatsapp.com/send/?phone=5542977776666"]);
    expect(spaResponses[0].success).toBe(true);
    expect(spaResponses[0].rawText).toContain("Recebido, obrigada!");
  });

  it("20. Botão 'Capturar Retorno' na barra do WhatsApp Web em contato @lid exige confirmação pelo contexto único e bloqueia se a conversa aberta for alheia", async () => {
    const h = createWhatsAppContentHarness({
      url: "https://web.whatsapp.com/",
      outgoingCount: 0,
      incomingCount: 0,
      initialCaptureCtx: {
        requestId: "req-cap-lid-1",
        logId: "log-cap-lid-1",
        phone: "5542999995555",
        expectedOutgoingText: "Comunicado Busca Ativa Escolar",
      },
    });
    h.headerSpan.attributes.delete("title");
    h.headerSpan.title = "";
    h.headerSpan.textContent = "Pai do Lucas";

    const outEl = h.doc.createElement("div");
    outEl.setAttribute("data-id", "true_555444333222@lid_3EB0OUT");
    outEl.className = "message-out";
    const outSpan = h.doc.createElement("span");
    outSpan.textContent = "Mensagem pessoal completamente diferente";
    outEl.appendChild(outSpan);
    h.chatMessages.appendChild(outEl);

    const inEl = h.doc.createElement("div");
    inEl.setAttribute("data-id", "false_555444333222@lid_3EB0IN");
    inEl.className = "message-in";
    const inSpan = h.doc.createElement("span");
    inSpan.textContent = "Dado pessoal privado";
    inEl.appendChild(inSpan);
    h.chatMessages.appendChild(inEl);

    h.injectScript();

    // 1) Conversa aberta não bate com expectedOutgoingText nem @lid -> bloqueia PUSH (zero vazamento)
    h.sendRuntimeToContent({ type: "LEOPOLDINA_TRIGGER_HUMAN_CAPTURE" });
    expect(
      h.sentRuntimeMessages.filter((m) => m.type === "LEOPOLDINA_PUSH_CAPTURED_REPLY")
    ).toHaveLength(0);

    // 2) Na conversa correta contendo a mensagem enviada do atendimento -> envia PUSH com sucesso
    outSpan.textContent = "Comunicado Busca Ativa Escolar";
    inSpan.textContent = "Sim, iremos conversar com o Lucas.";

    h.sendRuntimeToContent({ type: "LEOPOLDINA_TRIGGER_HUMAN_CAPTURE" });
    const pushes = h.sentRuntimeMessages.filter(
      (m) => m.type === "LEOPOLDINA_PUSH_CAPTURED_REPLY"
    );
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatchObject({
      requestId: "req-cap-lid-1",
      logId: "log-cap-lid-1",
      phone: "5542999995555",
    });
    expect(pushes[0].rawText).toContain("Sim, iremos conversar com o Lucas.");
  });

  it("21. registro-bridge.js intercepta links do WhatsApp com DDI 55 em janela compacta e respeita modo native", () => {
    const bridgeCode = fs.readFileSync(
      path.join(ROOT_DIR, "extension/registro-bridge.js"),
      "utf8"
    );

    const winListeners: Record<string, any[]> = {};
    const docListeners: Record<string, any[]> = {};
    const sentToBg: any[] = [];
    let currentDispatchMode: string | null = null;

    const chromeMock: any = {
      runtime: {
        id: "ext-rede-ativa-test",
        lastError: null,
        sendMessage: (msg: any, cb?: (res: any) => void) => {
          sentToBg.push(msg);
          if (cb) cb({ success: true });
        },
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      storage: {
        local: {
          get: (_keys: string[], cb: (res: any) => void) => cb({ opt_whatsapp_tab_reuse: true }),
        },
      },
    };

    const sandbox: any = {
      window: {
        location: { origin: "https://www.redeativa.app.br", hostname: "www.redeativa.app.br" },
        addEventListener: (ev: string, fn: any) => {
          (winListeners[ev] ||= []).push(fn);
        },
        removeEventListener: (ev: string, fn: any) => {
          winListeners[ev] = (winListeners[ev] || []).filter((f) => f !== fn);
        },
        postMessage: vi.fn(),
      },
      document: {
        documentElement: { dataset: {} },
        addEventListener: (ev: string, fn: any) => {
          (docListeners[ev] ||= []).push(fn);
        },
        removeEventListener: (ev: string, fn: any) => {
          docListeners[ev] = (docListeners[ev] || []).filter((f) => f !== fn);
        },
      },
      localStorage: {
        getItem: (key: string) =>
          key === "redeativa_whatsapp_dispatch_mode" ? currentDispatchMode : null,
      },
      sessionStorage: { removeItem: vi.fn(), getItem: vi.fn() },
      chrome: chromeMock,
      URL,
      Set,
      Map,
      Date,
      Math,
      setTimeout,
      clearTimeout,
      console: { warn: () => {}, error: () => {}, log: () => {} },
    };

    vm.runInNewContext(bridgeCode, sandbox, { filename: "registro-bridge.js" });
    expect(docListeners.click).toHaveLength(1);

    const makeAnchorClick = (href: string) => {
      let prevented = false;
      const anchor = {
        dataset: {},
        hasAttribute: () => false,
        getAttribute: (name: string) => (name === "href" ? href : null),
      };
      const ev = {
        defaultPrevented: false,
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        preventDefault: () => {
          prevented = true;
          ev.defaultPrevented = true;
        },
        target: {
          closest: (sel: string) => (sel === "a[href]" ? anchor : null),
        },
      };
      docListeners.click[0](ev);
      return prevented;
    };

    // 1) Clique padrão em link sem DDI 55 -> intercepta e normaliza 5542999998888
    expect(makeAnchorClick("https://web.whatsapp.com/send?phone=42999998888")).toBe(true);
    expect(sentToBg).toHaveLength(1);
    expect(sentToBg[0]).toMatchObject({
      type: "LEOPOLDINA_OPEN_WHATSAPP_CHAT",
      url: "https://web.whatsapp.com/send/?phone=5542999998888",
      phone: "5542999998888",
    });

    // 2) Clique em wa.me -> também normaliza e roteia via extensão
    expect(makeAnchorClick("https://wa.me/42991112222")).toBe(true);
    expect(sentToBg).toHaveLength(2);
    expect(sentToBg[1]).toMatchObject({
      type: "LEOPOLDINA_OPEN_WHATSAPP_CHAT",
      url: "https://web.whatsapp.com/send/?phone=5542991112222",
      phone: "5542991112222",
    });

    // 3) Quando modo local está em "native", não intercepta clique
    currentDispatchMode = "native";
    expect(makeAnchorClick("https://web.whatsapp.com/send?phone=42988887777")).toBe(false);
    expect(sentToBg).toHaveLength(2);

    // 4) Cleanup remove o listener de clique
    sandbox.window.__REDEATIVA_BRIDGE_CLEANUP__();
    expect(docListeners.click).toHaveLength(0);
  });

  it("22. Bloqueia vinculação de @lid sem transição SPA (!didTransition), sinaliza spaNavNoTransition, aceita verifiedTabPhone e limpa ao clicar em #pane-side", () => {
    const h = createWhatsAppContentHarness({
      url: "https://web.whatsapp.com/",
      outgoingCount: 0,
      incomingCount: 0,
    });
    const appEl = h.doc.getElementById("app")!;
    const sideEl = h.doc.createElement("div");
    sideEl.id = "side";
    appEl.appendChild(sideEl);

    const paneSide = h.doc.createElement("div");
    paneSide.id = "pane-side";
    appEl.appendChild(paneSide);

    h.headerSpan.attributes.delete("title");
    h.headerSpan.title = "";
    h.headerSpan.textContent = "Conversa Alheia";

    const inEl = h.doc.createElement("div");
    inEl.setAttribute("data-id", "false_111222333444@lid_3EB0PRIV");
    inEl.className = "message-in";
    const inSpan = h.doc.createElement("span");
    inSpan.textContent = "Mensagem privada";
    inEl.appendChild(inSpan);
    h.chatMessages.appendChild(inEl);

    // Simula clique SPA que NÃO altera #main (!didTransition)
    const origCreate = h.doc.createElement.bind(h.doc);
    h.doc.createElement = ((tag: string) => {
      const el = origCreate(tag);
      if (tag.toLowerCase() === "a") {
        (el as any).click = () => {};
      }
      return el;
    }) as any;

    h.injectScript();

    // 1) Extração para outro telefone sem transição de #main -> bloqueia vazamento e retorna spaNavNoTransition: true
    const blockedRes: any[] = [];
    h.runtimeListeners[0](
      {
        type: "LEOPOLDINA_EXTRACT_LAST_INCOMING_MESSAGE",
        requestId: "req-no-trans-1",
        logId: "log-no-trans-1",
        phone: "5542988887777",
      },
      { id: "ext-rede-ativa-test" },
      (r: any) => blockedRes.push(r)
    );
    h.advanceTime(4000);

    expect(blockedRes[0]).toMatchObject({
      success: false,
      error: "CHAT_PHONE_UNAVAILABLE",
      spaNavNoTransition: true,
    });
    expect(blockedRes[0].rawText).toBeUndefined();

    // 2) Fallback/navegação confirmada na conversa correta com verifiedTabPhone -> pareia @lid e extrai normalmente
    h.headerSpan.textContent = "Mãe do Carlos";
    inEl.setAttribute("data-id", "false_222333444555@lid_3EB0CARLOS");
    inSpan.textContent = "Estou a caminho da escola";

    const verifiedRes: any[] = [];
    h.runtimeListeners[0](
      {
        type: "LEOPOLDINA_EXTRACT_LAST_INCOMING_MESSAGE",
        requestId: "req-verified-nav-2",
        logId: "log-verified-nav-2",
        phone: "5542988887777",
        verifiedTabPhone: "5542988887777",
      },
      { id: "ext-rede-ativa-test" },
      (r: any) => verifiedRes.push(r)
    );
    expect(verifiedRes[0].success).toBe(true);
    expect(verifiedRes[0].rawText).toContain("Estou a caminho da escola");

    // 3) Clique manual em #pane-side limpa verifiedTabPhone e bloqueia outro chat sem transição
    paneSide.click();

    expect(
      h.sentRuntimeMessages.some((m) => m.type === "LEOPOLDINA_CLEAR_TAB_VERIFIED_PHONE")
    ).toBe(true);

    h.headerSpan.textContent = "Outro Contato";
    inEl.setAttribute("data-id", "false_333444555666@lid_3EB0OTHER");
    inSpan.textContent = "Dado sensível";

    const blockedAfterSwitch: any[] = [];
    h.runtimeListeners[0](
      {
        type: "LEOPOLDINA_EXTRACT_LAST_INCOMING_MESSAGE",
        requestId: "req-after-switch-3",
        logId: "log-after-switch-3",
        phone: "5542988887777",
        verifiedTabPhone: "5542988887777",
      },
      { id: "ext-rede-ativa-test" },
      (r: any) => blockedAfterSwitch.push(r)
    );
    h.advanceTime(4000);
    expect(blockedAfterSwitch[0].success).toBe(false);
    expect(blockedAfterSwitch[0].rawText).toBeUndefined();
  });

  it("23. Corrige corrida CLEAR vs REGISTER, restaura marcadores pós-hidratação, infere studentName do modal e casa @lid por Aluno(a) filtrando timestamp de figurinha", async () => {
    // (a) background.js: CLEAR sem requestId após/durante REGISTER não remove o contexto CAPTURE recém-registrado
    const storageData: Record<string, any> = {};
    let onBgMessage: any = null;
    const bgChromeMock: any = {
      runtime: {
        id: "ext-rede-ativa-test",
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        onMessage: { addListener: (fn: any) => { onBgMessage = fn; } },
      },
      storage: {
        local: {
          get: vi.fn(async (keys: any) => {
            const list = Array.isArray(keys) ? keys : [keys];
            const out: Record<string, any> = {};
            for (const k of list) if (k in storageData) out[k] = storageData[k];
            return out;
          }),
          set: vi.fn(async (items: any) => {
            Object.assign(storageData, items);
          }),
          remove: vi.fn(async (keys: any) => {
            await Promise.resolve();
            for (const k of (Array.isArray(keys) ? keys : [keys])) delete storageData[k];
          }),
        },
      },
      tabs: {
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
        query: vi.fn(async () => []),
        update: vi.fn(),
        remove: vi.fn(),
        sendMessage: vi.fn(async () => ({ ok: true })),
      },
      windows: {
        getCurrent: vi.fn(async () => ({ id: 1, width: 1440, left: 0, top: 0 })),
        get: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
      },
      scripting: { executeScript: vi.fn(async () => []) },
    };

    vm.runInNewContext(
      fs.readFileSync(BACKGROUND_PATH, "utf8"),
      {
        chrome: bgChromeMock,
        URL,
        Object,
        Array,
        Date,
        Math,
        String,
        Number,
        Boolean,
        Promise,
        setTimeout,
        clearTimeout,
        console: { warn: () => {}, error: () => {}, log: () => {} },
      },
      { filename: "background.js" }
    );

    const callBg = (req: any, sender: any) =>
      new Promise<any>((resolve) =>
        onBgMessage(req, { frameId: 0, documentId: `doc-${sender.tab?.id}`, ...sender }, resolve)
      );

    const platformSender = {
      id: "ext-rede-ativa-test",
      url: "https://redeativa.app.br/historico",
      tab: { id: 101, windowId: 1 },
    };
    const [clearLegacyRes, regRes] = await Promise.all([
      callBg({ type: "LEOPOLDINA_CLEAR_LAST_CAPTURED_REPLY" }, platformSender),
      callBg(
        {
          type: "LEOPOLDINA_REGISTER_CAPTURE_CONTEXT",
          requestId: "cap-race-v165",
          logId: "log-race-v165",
          phone: "5542988455899",
          studentName: "NATIELE PACHECO",
        },
        platformSender
      ),
    ]);

    expect(clearLegacyRes.success).toBe(true);
    expect(regRes.success).toBe(true);

    const waGetCtx = await callBg(
      { type: "LEOPOLDINA_GET_CAPTURE_CONTEXT", phone: null },
      { id: "ext-rede-ativa-test", url: "https://web.whatsapp.com/", tab: { id: 900, windowId: 99 } }
    );
    expect(waGetCtx).toMatchObject({
      success: true,
      requestId: "cap-race-v165",
      logId: "log-race-v165",
      studentName: "NATIELE PACHECO",
    });

    const explicitClear = await callBg(
      { type: "LEOPOLDINA_CLEAR_LAST_CAPTURED_REPLY", requestId: "cap-race-v165" },
      platformSender
    );
    expect(explicitClear.success).toBe(true);
    const waAfterExplicitClear = await callBg(
      { type: "LEOPOLDINA_GET_CAPTURE_CONTEXT", phone: null },
      { id: "ext-rede-ativa-test", url: "https://web.whatsapp.com/", tab: { id: 900, windowId: 99 } }
    );
    expect(waAfterExplicitClear).toEqual({ success: false, error: "UNKNOWN_OPERATION_CONTEXT" });

    // (b) registro-bridge.js: restaura marcadores após hidratação e infere studentName do <dialog open>
    const postedMessages: any[] = [];
    const sentBridgeMessages: any[] = [];
    const scheduledTimers: Array<{ id: number; fn: () => void }> = [];
    let nextTimerId = 1;
    const winListeners = new Map<string, Set<(ev: any) => void>>();
    const docListeners = new Map<string, Set<(ev: any) => void>>();
    const bridgeRuntimeListeners: any[] = [];
    let disconnectedObservers = 0;
    const mutationObservers: Array<{ cb: () => void }> = [];

    class MockMutationObserver {
      private cb: () => void;
      constructor(cb: () => void) {
        this.cb = cb;
        mutationObservers.push({ cb });
      }
      observe() {}
      disconnect() {
        disconnectedObservers++;
      }
    }

    const subtitleEl = { textContent: "NATIELE PACHECO • 1º A" };
    const headingEl = {
      textContent: "Capturar Retorno do Responsável",
      parentElement: {
        querySelector: (sel: string) => (sel === "p" ? subtitleEl : null),
      },
    };
    const openDialogMock = {
      querySelector: (sel: string) => {
        if (sel.includes("h1")) return headingEl;
        return null;
      },
    };
    const rootDataset: Record<string, string> = {};

    const bridgeSandbox: any = {
      MutationObserver: MockMutationObserver,
      window: {
        location: { origin: "https://redeativa.app.br", hostname: "redeativa.app.br" },
        addEventListener: (t: string, fn: any) => {
          if (!winListeners.has(t)) winListeners.set(t, new Set());
          winListeners.get(t)!.add(fn);
        },
        removeEventListener: (t: string, fn: any) => winListeners.get(t)?.delete(fn),
        postMessage: (msg: any) => postedMessages.push(msg),
      },
      document: {
        documentElement: { dataset: rootDataset },
        addEventListener: (t: string, fn: any) => {
          if (!docListeners.has(t)) docListeners.set(t, new Set());
          docListeners.get(t)!.add(fn);
        },
        removeEventListener: (t: string, fn: any) => docListeners.get(t)?.delete(fn),
        querySelectorAll: (sel: string) =>
          sel.includes("dialog[open]") ? [openDialogMock] : [],
      },
      sessionStorage: { removeItem: vi.fn(), getItem: vi.fn() },
      chrome: {
        runtime: {
          id: "ext-rede-ativa-test",
          sendMessage: (msg: any, cb?: any) => {
            sentBridgeMessages.push(msg);
            if (typeof cb === "function") cb({ success: true });
          },
          onMessage: {
            addListener: (fn: any) => bridgeRuntimeListeners.push(fn),
            removeListener: (fn: any) => {
              const i = bridgeRuntimeListeners.indexOf(fn);
              if (i >= 0) bridgeRuntimeListeners.splice(i, 1);
            },
          },
        },
      },
      URL,
      Set,
      Map,
      Date,
      Math,
      setTimeout: (fn: () => void) => {
        const id = nextTimerId++;
        scheduledTimers.push({ id, fn });
        return id;
      },
      clearTimeout: (id: number) => {
        const idx = scheduledTimers.findIndex((t) => t.id === id);
        if (idx >= 0) scheduledTimers.splice(idx, 1);
      },
      console: { warn: () => {}, error: () => {}, log: () => {} },
    };

    vm.runInNewContext(fs.readFileSync(BRIDGE_PATH, "utf8"), bridgeSandbox, {
      filename: "registro-bridge.js",
    });

    expect(rootDataset.redeativaExtension).toBe("true");
    expect(rootDataset.redeativaExtensionVersion).toBe("1.7.1");

    // Simula hidratação do Next/React removendo atributos data-* do <html>
    delete rootDataset.redeativaExtension;
    delete rootDataset.redeativaExtensionVersion;
    const readyCountBefore = postedMessages.filter((m) => m.type === "REDEATIVA_EXTENSION_READY").length;
    mutationObservers[0].cb();

    expect(rootDataset.redeativaExtension).toBe("true");
    expect(rootDataset.redeativaExtensionVersion).toBe("1.7.1");
    expect(
      postedMessages.filter((m) => m.type === "REDEATIVA_EXTENSION_READY").length
    ).toBeGreaterThan(readyCountBefore);

    // Ping vindo do background também responde alive + version
    const pingReplies: any[] = [];
    bridgeRuntimeListeners[0](
      { type: "LEOPOLDINA_BRIDGE_PING" },
      { id: "ext-rede-ativa-test" },
      (res: any) => pingReplies.push(res)
    );
    expect(pingReplies[0]).toEqual({ alive: true, version: "1.7.1" });

    // Modal aberto sem enviar studentName no payload -> bridge infere "NATIELE PACHECO" do <dialog open>
    for (const fn of winListeners.get("message") || []) {
      fn({
        source: bridgeSandbox.window,
        origin: "https://redeativa.app.br",
        data: {
          type: "REDEATIVA_REGISTER_CAPTURE_CONTEXT",
          requestId: "req-dlg-1",
          logId: "log-dlg-1",
          phone: "5542988455899",
        },
      });
    }
    const regBridgeMsg = sentBridgeMessages.find(
      (m) => m.type === "LEOPOLDINA_REGISTER_CAPTURE_CONTEXT"
    );
    expect(regBridgeMsg?.studentName).toBe("NATIELE PACHECO");

    bridgeSandbox.window.__REDEATIVA_BRIDGE_CLEANUP__();
    expect(disconnectedObservers).toBe(1);
    expect(scheduledTimers).toHaveLength(0);

    // (c) whatsapp-content.js: chat salvo ("Amor ❤️") + @lid casa via Aluno(a) e ignora timestamp "16:28"
    const waH = createWhatsAppContentHarness({
      url: "https://web.whatsapp.com/",
      chatTitle: "Amor ❤️",
      outgoingCount: 0,
      incomingCount: 0,
    });
    waH.headerSpan.attributes.delete("title");
    waH.headerSpan.title = "";
    waH.headerSpan.textContent = "Amor ❤️";

    const outEl = waH.doc.createElement("div");
    outEl.setAttribute("data-id", "true_999888777666@lid_3EB0OUT");
    outEl.className = "message-out";
    const outSpan = waH.doc.createElement("span");
    outSpan.textContent =
      "Boa noite! diva\nAluno(a): NATIELE PACHECO\nTurma: 1º A\nPedimos que desconsiderem esta notificação.\n15:57";
    outEl.appendChild(outSpan);
    waH.chatMessages.appendChild(outEl);

    for (const txt of ["Começou a pinicar kkkk\n16:24", "Até o pescoço\n16:24", "16:28"]) {
      const inBubble = waH.doc.createElement("div");
      inBubble.setAttribute("data-id", "false_999888777666@lid_3EB0IN");
      inBubble.className = "message-in";
      const inSpan = waH.doc.createElement("span");
      inSpan.textContent = txt;
      inBubble.appendChild(inSpan);
      waH.chatMessages.appendChild(inBubble);
    }

    waH.injectScript();

    const extractRes: any[] = [];
    waH.runtimeListeners[0](
      {
        type: "LEOPOLDINA_EXTRACT_LAST_INCOMING_MESSAGE",
        requestId: "req-natiele-1",
        logId: "log-natiele-1",
        phone: "5542988455899",
        studentName: "NATIELE PACHECO",
      },
      { id: "ext-rede-ativa-test" },
      (r: any) => extractRes.push(r)
    );
    waH.advanceTime(2500);

    expect(extractRes[0].success).toBe(true);
    expect(extractRes[0].rawText).toContain("Começou a pinicar kkkk");
    expect(extractRes[0].rawText).toContain("Até o pescoço");
    expect(extractRes[0].rawText).not.toContain("16:28");

    // Termo genérico ("Aluno") em outro chat @lid sem texto esperado NÃO autoriza correlação
    const genericH = createWhatsAppContentHarness({
      url: "https://web.whatsapp.com/",
      chatTitle: "Contato Qualquer",
      outgoingCount: 0,
      incomingCount: 0,
    });
    const gOut = genericH.doc.createElement("div");
    gOut.setAttribute("data-id", "true_555444333222@lid_3EB0GEN");
    gOut.className = "message-out";
    const gOutSpan = genericH.doc.createElement("span");
    gOutSpan.textContent = "Mensagem com palavra aluno sem nome completo";
    gOut.appendChild(gOutSpan);
    genericH.chatMessages.appendChild(gOut);

    const gIn = genericH.doc.createElement("div");
    gIn.setAttribute("data-id", "false_555444333222@lid_3EB0GENIN");
    gIn.className = "message-in";
    const gInSpan = genericH.doc.createElement("span");
    gInSpan.textContent = "Conteúdo privado";
    gIn.appendChild(gInSpan);
    genericH.chatMessages.appendChild(gIn);

    genericH.injectScript();
    const genericBlocked: any[] = [];
    genericH.runtimeListeners[0](
      {
        type: "LEOPOLDINA_EXTRACT_LAST_INCOMING_MESSAGE",
        requestId: "req-generic-1",
        logId: "log-generic-1",
        phone: "5542988455899",
        studentName: "Aluno",
      },
      { id: "ext-rede-ativa-test" },
      (r: any) => genericBlocked.push(r)
    );
    genericH.advanceTime(4000);
    expect(genericBlocked[0].success).toBe(false);
    expect(genericBlocked[0].rawText).toBeUndefined();
  });

  it("24. MED-01: isDispatchConversationVerified rejeita contradição de headerPhone explícito ou @lid mapeado para outro número", () => {
    // (a) headerPhone explícito divergente via tel:/link ou texto no #main header
    const hHeaderMismatch = createWhatsAppContentHarness({
      url: "https://web.whatsapp.com/",
      chatTitle: "Responsável Salvo",
      outgoingCount: 0,
      incomingCount: 0,
    });
    const headerLink = hHeaderMismatch.doc.createElement("a");
    headerLink.setAttribute("href", "tel:+5542988887777");
    headerLink.textContent = "+55 42 98888-7777";
    hHeaderMismatch.mainEl.querySelector("header")!.appendChild(headerLink);
    hHeaderMismatch.injectScript();

    hHeaderMismatch.runtimeListeners[0](
      {
        type: "LEOPOLDINA_ACTIVATE_DISPATCH",
        activeDispatch: {
          requestId: "req-med01-hdr",
          logId: "log-med01-hdr",
          phone: "5542999991111",
          studentName: "Estudante Alvo",
          text: "Comunicado oficial",
          autoSend: false,
        },
      },
      { id: "ext-rede-ativa-test" },
      () => {}
    );
    hHeaderMismatch.advanceTime(1200);
    // Não deve confirmar despacho na conversa cujo headerPhone diverge
    expect(
      hHeaderMismatch.sentRuntimeMessages.some(
        (m) => m.type === "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME"
      )
    ).toBe(false);

    // (b) @lid já vinculado a outro número (5542988887777) bloqueia despacho para 5542999991111
    const hLidMismatch = createWhatsAppContentHarness({
      url: "https://web.whatsapp.com/send/?phone=5542988887777",
      chatTitle: "Contato Salvo A",
      outgoingCount: 1,
      incomingCount: 0,
    });
    const existingOut = hLidMismatch.chatMessages.children[0];
    existingOut.setAttribute("data-id", "true_111222333444@lid_3EB0OLD");
    hLidMismatch.injectScript();

    // Agora ativa despacho para outro número enquanto #main ainda exibe @lid 111222333444@lid
    hLidMismatch.runtimeListeners[0](
      {
        type: "LEOPOLDINA_ACTIVATE_DISPATCH",
        activeDispatch: {
          requestId: "req-med01-lid",
          logId: "log-med01-lid",
          phone: "5542999991111",
          studentName: "Estudante B",
          text: "Outro comunicado",
          autoSend: true,
        },
      },
      { id: "ext-rede-ativa-test" },
      () => {}
    );
    hLidMismatch.advanceTime(1200);
    expect(
      hLidMismatch.sentRuntimeMessages.some(
        (m) => m.type === "LEOPOLDINA_WHATSAPP_DISPATCH_OUTCOME" && m.requestId === "req-med01-lid"
      )
    ).toBe(false);
  });

  it("25. BAI-02: handleHumanCaptureButtonClick aplica fail-closed quando requiresVerification=true e phone ausente sem prova outgoing", () => {
    const h = createWhatsAppContentHarness({
      url: "https://web.whatsapp.com/",
      chatTitle: "Contato Sem Prova",
      outgoingCount: 0,
      incomingCount: 1,
      initialCaptureCtx: {
        requestId: "req-bai02-1",
        logId: "log-bai02-1",
        phone: null,
        studentName: "Estudante Sem Prova",
        expectedOutgoingText: "Texto que não existe no DOM",
        requiresVerification: true,
      },
    });
    h.injectScript();

    const captureBtn = h.doc.getElementById("leopoldina-wa-capture-btn");
    expect(captureBtn).toBeTruthy();
    captureBtn!.click();

    expect(
      h.sentRuntimeMessages.some((m) => m.type === "LEOPOLDINA_PUSH_CAPTURED_REPLY")
    ).toBe(false);
    const banner = h.doc.getElementById("leopoldina-wa-banner");
    expect(banner?.textContent).toContain("Não foi possível confirmar este contato");
  });

  it("26. OBS-01 & BAI-01: registro-bridge limpa activeDispatches quando despacho falha e WhatsAppDispatchToggle valida source/origin", () => {
    const bridgeCode = fs.readFileSync(
      path.join(ROOT_DIR, "extension/registro-bridge.js"),
      "utf8"
    );
    const winListeners = new Map<string, Array<(e: any) => void>>();
    const postedMessages: any[] = [];
    const sandbox: any = {
      window: {
        location: { origin: "https://www.redeativa.app.br", hostname: "www.redeativa.app.br" },
        addEventListener: (ev: string, fn: (e: any) => void) => {
          const list = winListeners.get(ev) || [];
          list.push(fn);
          winListeners.set(ev, list);
        },
        removeEventListener: vi.fn(),
        postMessage: (msg: any) => postedMessages.push(msg),
      },
      document: {
        documentElement: { dataset: {} },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        querySelectorAll: () => [],
      },
      sessionStorage: { getItem: () => null, removeItem: vi.fn() },
      localStorage: { getItem: () => "extension" },
      chrome: {
        runtime: {
          id: "ext-rede-ativa-test",
          lastError: null as any,
          sendMessage: (msg: any, cb?: (res: any) => void) => {
            if (msg?.type === "LEOPOLDINA_DISPATCH_WHATSAPP") {
              cb?.({ success: false, error: "DISPATCH_FAILED" });
            }
          },
          onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        },
        storage: { local: { get: (_keys: string[], cb: (r: any) => void) => cb({}) } },
      },
      URL,
      Set,
      Map,
      Date,
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
      console,
    };
    vm.runInNewContext(bridgeCode, sandbox);

    for (const fn of winListeners.get("message") || []) {
      fn({
        source: sandbox.window,
        origin: "https://www.redeativa.app.br",
        data: {
          type: "LEOPOLDINA_DISPATCH_WHATSAPP",
          requestId: "req-fail-cleanup-1",
          logId: "log-fail-cleanup-1",
          url: "https://web.whatsapp.com/send/?phone=5542999990001",
        },
      });
    }

    // Se activeDispatches foi limpo imediatamente no ACK de erro, um novo despacho com o mesmo requestId pode ser aceito (ou não fica retido)
    expect(postedMessages.some((m) => m.type === "LEOPOLDINA_DISPATCH_WHATSAPP_ACK" && m.requestId === "req-fail-cleanup-1" && m.response?.success === false)).toBe(true);
    // Verifica que o relay de outcome após falha é rejeitado porque activeDispatches não retém req-fail-cleanup-1
    const runtimeFn = sandbox.chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const confirmedBefore = postedMessages.filter((m) => m.type === "REDEATIVA_WHATSAPP_CONFIRMED").length;
    runtimeFn(
      {
        type: "REDEATIVA_WHATSAPP_DISPATCH_OUTCOME_RELAY",
        requestId: "req-fail-cleanup-1",
        logId: "log-fail-cleanup-1",
        outcome: "SENT",
      },
      { id: "ext-rede-ativa-test" }
    );
    expect(postedMessages.filter((m) => m.type === "REDEATIVA_WHATSAPP_CONFIRMED").length).toBe(confirmedBefore);

    // BAI-01: WhatsAppDispatchToggle valida source e origin no listener de message
    const toggleSource = fs.readFileSync(
      path.join(ROOT_DIR, "src/components/whatsapp/WhatsAppDispatchToggle.tsx"),
      "utf8"
    );
    expect(toggleSource).toContain("if (event.source !== undefined && event.source !== window) return;");
    expect(toggleSource).toContain("event.origin !== window.location.origin");
  });

  it("27. Janela compacta (480x760px) oculta a coluna da lista de conversas (#side/#pane-side) apenas quando #main está aberto e preserva 100% de largura para a conversa", () => {
    const backgroundSource = fs.readFileSync(
      path.join(ROOT_DIR, "extension/background.js"),
      "utf8"
    );
    expect(backgroundSource).toContain("const POPUP_WIDTH = 480;");
    expect(backgroundSource).toContain("const POPUP_HEIGHT = 760;");

    const focusCss = fs.readFileSync(
      path.join(ROOT_DIR, "extension/whatsapp-focus.css"),
      "utf8"
    );
    expect(focusCss).toContain("@media (max-width: 768px)");
    expect(focusCss).toContain("#app:has(#main) #side");
    expect(focusCss).toContain("#app:has(#main) #pane-side");
    expect(focusCss).toContain("div:has(> #side):not(:has(#main))");
    expect(focusCss).toContain("div:has(> #pane-side):not(:has(#main))");
    expect(focusCss).toMatch(/#main\s*\{[\s\S]*width:\s*100%\s*!important;/);
    expect(focusCss).toMatch(/#main\s*\{[\s\S]*min-width:\s*0\s*!important;/);
  });
});
