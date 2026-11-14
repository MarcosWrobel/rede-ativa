import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

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

describe("Suite de Regressão de Desempenho e Confiabilidade — Extensão & Busca Ativa (v1.6.0)", () => {
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
    expect(pingResponses[0]).toEqual({ pong: true, version: "1.6.0" });
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
    expect((sandbox.document.documentElement.dataset as any).redeativaExtensionVersion).toBe("1.6.0");
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

  it("13. Pacotes ZIP distribuídos contêm exatamente os arquivos de extension/ com hashes SHA-256 idênticos e versão 1.6.0", () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    expect(manifest.version).toBe("1.6.0");

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
});
