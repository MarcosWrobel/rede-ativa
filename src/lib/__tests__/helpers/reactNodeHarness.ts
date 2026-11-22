import React from "react";

type HookCleanup = void | (() => void);

interface EffectSlot {
  kind: "effect";
  create: () => HookCleanup;
  deps: readonly unknown[] | undefined;
  cleanup: HookCleanup;
}

interface PendingEffect {
  hookIdx: number;
  create: () => HookCleanup;
  deps: readonly unknown[] | undefined;
}

interface MemoSlot {
  value: unknown;
  deps: readonly unknown[] | undefined;
}

interface CallbackSlot<T> {
  fn: T;
  deps: readonly unknown[] | undefined;
}

interface React19Internals {
  H: Record<string, unknown> | null;
}

function depsEqual(
  prevDeps: readonly unknown[] | undefined,
  nextDeps: readonly unknown[] | undefined
): boolean {
  if (prevDeps === undefined || nextDeps === undefined) return false;
  if (prevDeps.length !== nextDeps.length) return false;
  for (let i = 0; i < prevDeps.length; i++) {
    if (!Object.is(prevDeps[i], nextDeps[i])) return false;
  }
  return true;
}

export function extractNodeText(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractNodeText).join(" ").replace(/\s+/g, " ").trim();
  }
  if (React.isValidElement<{ children?: unknown }>(node)) {
    return extractNodeText(node.props?.children);
  }
  return "";
}

export function findElements(
  node: unknown,
  predicate: (el: React.ReactElement<Record<string, unknown>>) => boolean,
  acc: Array<React.ReactElement<Record<string, unknown>>> = []
): Array<React.ReactElement<Record<string, unknown>>> {
  if (node === null || node === undefined || typeof node === "boolean") {
    return acc;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      findElements(item, predicate, acc);
    }
    return acc;
  }
  if (React.isValidElement<Record<string, unknown>>(node)) {
    if (predicate(node)) {
      acc.push(node);
    }
    if ("children" in (node.props || {})) {
      findElements(node.props.children, predicate, acc);
    }
  }
  return acc;
}

export interface MountedReactComponent<P extends object> {
  getTree: () => React.ReactNode;
  updateProps: (nextProps: NoInfer<P>) => Promise<void>;
  flush: () => Promise<void>;
  unmount: () => void;
  getText: () => string;
  findAll: (
    predicate: (el: React.ReactElement<Record<string, unknown>>) => boolean
  ) => Array<React.ReactElement<Record<string, unknown>>>;
  findByTag: (tag: string) => Array<React.ReactElement<Record<string, unknown>>>;
  findById: (id: string) => React.ReactElement<Record<string, unknown>>;
  findByAriaLabel: (label: string) => React.ReactElement<Record<string, unknown>>;
  findButton: (textIncludes: string) => React.ReactElement<Record<string, unknown>>;
}

export function mountReactComponent<P extends object>(
  Component: (props: P) => React.ReactNode,
  initialProps: NoInfer<P>
): MountedReactComponent<P> {
  const internals = (
    React as unknown as {
      __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: React19Internals;
    }
  ).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

  if (!internals) {
    throw new Error("React 19 internals indisponíveis no ambiente de teste.");
  }
  const runtimeInternals: React19Internals = internals;

  let currentProps = initialProps;
  let currentTree: React.ReactNode = null;
  let hookIndex = 0;
  let renderQueued = false;
  let unmounted = false;
  let idSeq = 0;

  const stateSlots: unknown[] = [];
  const stateSetters: Array<(next: unknown) => void> = [];
  const refSlots: Array<{ current: unknown }> = [];
  const memoSlots: MemoSlot[] = [];
  const callbackSlots: Array<CallbackSlot<unknown>> = [];
  const effectSlots: Array<EffectSlot | undefined> = [];
  const idSlots: string[] = [];

  function scheduleRender() {
    if (unmounted || renderQueued) return;
    renderQueued = true;
    Promise.resolve().then(() => {
      if (unmounted) return;
      renderQueued = false;
      renderNow();
    });
  }

  function renderNow() {
    if (unmounted) return;
    hookIndex = 0;
    const pendingEffects: PendingEffect[] = [];

    const prevDispatcher = runtimeInternals.H;
    runtimeInternals.H = {
      useState<T>(initialState: T | (() => T)) {
        const idx = hookIndex++;
        if (!(idx in stateSlots)) {
          stateSlots[idx] =
            typeof initialState === "function"
              ? (initialState as () => T)()
              : initialState;
        }
        if (!stateSetters[idx]) {
          stateSetters[idx] = (next: unknown) => {
            if (unmounted) return;
            const prevVal = stateSlots[idx];
            const resolved =
              typeof next === "function"
                ? (next as (prev: unknown) => unknown)(prevVal)
                : next;
            if (!Object.is(prevVal, resolved)) {
              stateSlots[idx] = resolved;
              scheduleRender();
            }
          };
        }
        return [stateSlots[idx] as T, stateSetters[idx] as React.Dispatch<React.SetStateAction<T>>];
      },
      useReducer<S, A>(
        reducer: (state: S, action: A) => S,
        initialArg: unknown,
        init?: (arg: unknown) => S
      ) {
        const idx = hookIndex++;
        if (!(idx in stateSlots)) {
          stateSlots[idx] = init ? init(initialArg) : (initialArg as S);
        }
        if (!stateSetters[idx]) {
          stateSetters[idx] = (action: unknown) => {
            if (unmounted) return;
            const prevVal = stateSlots[idx] as S;
            const nextVal = reducer(prevVal, action as A);
            if (!Object.is(prevVal, nextVal)) {
              stateSlots[idx] = nextVal;
              scheduleRender();
            }
          };
        }
        return [stateSlots[idx] as S, stateSetters[idx] as React.Dispatch<A>];
      },
      useRef<T>(initialValue: T) {
        const idx = hookIndex++;
        if (!(idx in refSlots)) {
          refSlots[idx] = { current: initialValue };
        }
        return refSlots[idx] as React.MutableRefObject<T>;
      },
      useMemo<T>(factory: () => T, deps: readonly unknown[] | undefined) {
        const idx = hookIndex++;
        const prev = memoSlots[idx];
        if (prev && depsEqual(prev.deps, deps)) {
          return prev.value as T;
        }
        const value = factory();
        memoSlots[idx] = { value, deps };
        return value;
      },
      useCallback<T>(fn: T, deps: readonly unknown[] | undefined) {
        const idx = hookIndex++;
        const prev = callbackSlots[idx];
        if (prev && depsEqual(prev.deps, deps)) {
          return prev.fn as T;
        }
        callbackSlots[idx] = { fn, deps };
        return fn;
      },
      useEffect(create: () => HookCleanup, deps?: readonly unknown[]) {
        const idx = hookIndex++;
        const prev = effectSlots[idx];
        if (!prev || !depsEqual(prev.deps, deps)) {
          pendingEffects.push({ hookIdx: idx, create, deps });
        }
      },
      useLayoutEffect(create: () => HookCleanup, deps?: readonly unknown[]) {
        const idx = hookIndex++;
        const prev = effectSlots[idx];
        if (!prev || !depsEqual(prev.deps, deps)) {
          pendingEffects.push({ hookIdx: idx, create, deps });
        }
      },
      useInsertionEffect(create: () => HookCleanup, deps?: readonly unknown[]) {
        const idx = hookIndex++;
        const prev = effectSlots[idx];
        if (!prev || !depsEqual(prev.deps, deps)) {
          pendingEffects.push({ hookIdx: idx, create, deps });
        }
      },
      useId() {
        const idx = hookIndex++;
        if (!(idx in idSlots)) {
          idSlots[idx] = `:r${++idSeq}:`;
        }
        return idSlots[idx];
      },
      useContext<T>(context: React.Context<T> & { _currentValue?: T }) {
        return context._currentValue as T;
      },
      useImperativeHandle() {
        hookIndex++;
      },
      useDebugValue() {
        // noop
      },
      useDeferredValue<T>(value: T) {
        hookIndex++;
        return value;
      },
      useTransition() {
        const idx = hookIndex++;
        if (!stateSetters[idx]) {
          stateSetters[idx] = (fn: unknown) => {
            if (typeof fn === "function") (fn as () => void)();
          };
        }
        return [false, stateSetters[idx]];
      },
    };

    try {
      currentTree = Component(currentProps);
    } finally {
      runtimeInternals.H = prevDispatcher;
    }

    for (const pending of pendingEffects) {
      if (unmounted) break;
      const existing = effectSlots[pending.hookIdx];
      if (existing && typeof existing.cleanup === "function") {
        existing.cleanup();
      }
      const nextCleanup = pending.create();
      effectSlots[pending.hookIdx] = {
        kind: "effect",
        create: pending.create,
        deps: pending.deps,
        cleanup: nextCleanup,
      };
    }
  }

  async function flush() {
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
      if (renderQueued && !unmounted) {
        renderQueued = false;
        renderNow();
      }
    }
  }

  renderNow();

  return {
    getTree: () => currentTree,
    updateProps: async (nextProps: P) => {
      currentProps = nextProps;
      renderNow();
      await flush();
    },
    flush,
    unmount: () => {
      if (unmounted) return;
      unmounted = true;
      renderQueued = false;
      for (const slot of effectSlots) {
        if (slot && typeof slot.cleanup === "function") {
          slot.cleanup();
        }
      }
    },
    getText: () => extractNodeText(currentTree),
    findAll: (predicate) => findElements(currentTree, predicate),
    findByTag: (tag) => findElements(currentTree, (el) => el.type === tag),
    findById: (id) => {
      const found = findElements(currentTree, (el) => el.props?.id === id);
      if (found.length === 0) {
        throw new Error(`Elemento com id="${id}" não encontrado.`);
      }
      return found[0];
    },
    findByAriaLabel: (label) => {
      const found = findElements(currentTree, (el) => el.props?.["aria-label"] === label);
      if (found.length === 0) {
        throw new Error(`Elemento com aria-label="${label}" não encontrado.`);
      }
      return found[0];
    },
    findButton: (textIncludes) => {
      const buttons = findElements(currentTree, (el) => el.type === "button");
      const matched = buttons.find((btn) =>
        extractNodeText(btn).includes(textIncludes)
      );
      if (!matched) {
        throw new Error(`Botão contendo "${textIncludes}" não encontrado.`);
      }
      return matched;
    },
  };
}

export interface BrowserShimHandle {
  storageMap: Map<string, string>;
  windowListeners: Map<string, Set<EventListenerOrEventListenerObject>>;
  documentState: { hidden: boolean };
  restore: () => void;
}

export function installBrowserShims(): BrowserShimHandle {
  const g = globalThis as Record<string, unknown>;
  const hadWindow = Object.prototype.hasOwnProperty.call(g, "window");
  const hadDocument = Object.prototype.hasOwnProperty.call(g, "document");
  const hadLocalStorage = Object.prototype.hasOwnProperty.call(g, "localStorage");

  const prevWindow = g.window;
  const prevDocument = g.document;
  const prevLocalStorage = g.localStorage;

  const storageMap = new Map<string, string>();
  const localStorageShim: Storage = {
    get length() {
      return storageMap.size;
    },
    clear() {
      storageMap.clear();
    },
    getItem(key: string) {
      return storageMap.has(key) ? storageMap.get(key)! : null;
    },
    key(index: number) {
      return Array.from(storageMap.keys())[index] ?? null;
    },
    removeItem(key: string) {
      storageMap.delete(key);
    },
    setItem(key: string, value: string) {
      storageMap.set(key, String(value));
    },
  };

  const windowListeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const windowShim = {
    localStorage: localStorageShim,
    location: { origin: "http://localhost:3001" },
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      if (!windowListeners.has(type)) {
        windowListeners.set(type, new Set());
      }
      windowListeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      windowListeners.get(type)?.delete(listener);
    },
  };

  const documentState = { hidden: false };
  const documentShim = {
    get hidden() {
      return documentState.hidden;
    },
    getElementById: () => null,
    createElement: () => ({}),
    body: { appendChild: () => {} },
  };

  g.localStorage = localStorageShim;
  g.window = windowShim;
  g.document = documentShim;

  return {
    storageMap,
    windowListeners,
    documentState,
    restore: () => {
      if (hadWindow) g.window = prevWindow;
      else delete g.window;

      if (hadDocument) g.document = prevDocument;
      else delete g.document;

      if (hadLocalStorage) g.localStorage = prevLocalStorage;
      else delete g.localStorage;
    },
  };
}
