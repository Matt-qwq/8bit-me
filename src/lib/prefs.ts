/**
 * 开关型用户偏好（localStorage 持久化）
 * - 读取失败（隐私模式 / 存储被禁用）一律回退默认值
 * - 写入失败静默忽略（偏好不持久化，但不影响本次会话）
 * - 键名集中于此模块，组件不再散落 '8bitme:*' 字符串
 */

export interface TogglePref {
  readonly key: string;
  /** 当前值（无记录时返回 defaultValue） */
  get(): boolean;
  /** 持久化新值（失败静默） */
  set(on: boolean): void;
}

export function createTogglePref(
  key: string,
  defaultValue = true
): TogglePref {
  return {
    key,
    get(): boolean {
      try {
        const v = localStorage.getItem(key);
        return v === null ? defaultValue : v === 'on';
      } catch {
        return defaultValue;
      }
    },
    set(on: boolean): void {
      try {
        localStorage.setItem(key, on ? 'on' : 'off');
      } catch {
        /* storage unavailable — ignore */
      }
    },
  };
}


/** 自定义光标形态（'8bitme:cursor'）：off | reticle | frame | dot | block | cross
 * - get：读取当前形态（无记录 → null；读取失败静默）
 * - set：持久化形态（失败静默）
 * 值合法性由 CursorFx 组件的 MODES 白名单负责 */
export const cursorPref = {
  key: '8bitme:cursor',
  get(): string | null {
    try {
      return localStorage.getItem(cursorPref.key);
    } catch {
      return null;
    }
  },
  set(style: string): void {
    try {
      localStorage.setItem(cursorPref.key, style);
    } catch {
      /* storage unavailable — ignore */
    }
  },
};

/** chip-tune SFX 开关（默认开，尊重用户偏好） */
export const sfxPref = createTogglePref('8bitme:sfx');

/** bg-fx 画布动画模式（'8bitme:bgfx'）：off | world（ADR-0020 三档，2026-09-25 core 退役→双档）
 * - get：读取当前模式（无记录 → null；读取失败静默）
 * - set：持久化模式（失败静默）
 * 值合法性与旧档归一（v4 五滤镜 / 已退役的 core → world）由 BgFx / SideDock 的 normalize 负责 */
export const bgfxPref = {
  key: '8bitme:bgfx',
  get(): string | null {
    try {
      return localStorage.getItem(bgfxPref.key);
    } catch {
      return null;
    }
  },
  set(mode: string): void {
    try {
      localStorage.setItem(bgfxPref.key, mode);
    } catch {
      /* storage unavailable — ignore */
    }
  },
};