/**
 * 内存版 localStorage —— prefs/sfx 单测的「成功路径」stub。
 * node 环境本无 localStorage：不装 stub 时 get/set 抛错被 try/catch 吞掉 = 天然即为「失败回退」路径。
 */
export function installMemoryStorage(): void {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

/** 摘除 localStorage（恢复「不可用」态，用于测失败回退） */
export function removeMemoryStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: undefined,
  });
}