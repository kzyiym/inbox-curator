import { vi } from 'vitest';

export class App {}

export class Modal {
  app: App;
  contentEl: HTMLElement;
  constructor(app: App) {
    this.app = app;
    this.contentEl = document.createElement('div');
  }
  open() {}
  close() {}
  onOpen() {}
  onClose() {}
}

export class TFile {
  path = '';
  basename = '';
  extension = '';
  stat = { mtime: 0, size: 0 };
}

export class TFolder {
  path = '';
  name = '';
}

export class Notice {
  constructor(_message?: string, _duration?: number) {}
  setMessage(_message: string) {
    return this;
  }
  hide() {}
}

export class Plugin {
  app: App;
  manifest: any;
  constructor(app: App, manifest: any) {
    this.app = app;
    this.manifest = manifest;
  }
  onload() {}
  onunload() {}
  registerEvent() {}
  addSettingTab() {}
  addCommand() {}
  addStatusBarItem() { return document.createElement('div'); }
  loadData() { return Promise.resolve({}); }
  saveData() { return Promise.resolve(); }
}

export class MarkdownView {
  file: TFile | null = null;
}

export class PluginSettingTab {}

export class Setting {
  setName() {
    return this;
  }
  setDesc() {
    return this;
  }
  addText(callback?: (component: { setPlaceholder: () => unknown; setValue: () => unknown; onChange: () => unknown }) => unknown) {
    callback?.({
      setPlaceholder: () => this,
      setValue: () => this,
      onChange: () => this,
    });
    return this;
  }
  addToggle(callback?: (component: { setValue: () => unknown; onChange: () => unknown }) => unknown) {
    callback?.({
      setValue: () => this,
      onChange: () => this,
    });
    return this;
  }
  addDropdown(callback?: (component: { addOption: () => unknown; setValue: () => unknown; onChange: () => unknown }) => unknown) {
    callback?.({
      addOption: () => this,
      setValue: () => this,
      onChange: () => this,
    });
    return this;
  }
  addButton(callback?: (component: { setButtonText: () => unknown; onClick: () => unknown; setCta: () => unknown; setTooltip: () => unknown; setIcon: () => unknown; buttonEl: HTMLButtonElement }) => unknown) {
    const component = {
      setButtonText: () => component,
      onClick: () => component,
      setCta: () => component,
      setTooltip: () => component,
      setIcon: () => component,
      buttonEl: document.createElement('button'),
    };
    callback?.(component);
    return this;
  }
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/(^|\/)\.\//g, '$1').replace(/\/$/, '');
}

export const requestUrl = vi.fn();

export function getLanguage(): string {
  try {
    const stored = window.localStorage.getItem('language');
    if (stored) {
      return stored;
    }
  } catch {
    // localStorage unavailable
  }
  return 'en';
}

// Provide Obsidian's global activeDocument for test environment
(globalThis as Record<string, unknown>).activeDocument = document;
export const activeDocument = typeof document !== 'undefined' ? document : undefined as any;

export const apiVersion = '1.0.0';

// Mock Obsidian Element extensions for jsdom environment
if (typeof window !== 'undefined' && window.HTMLElement) {
  (window.HTMLElement.prototype as any).empty = function(this: HTMLElement) {
    this.innerHTML = '';
    return this;
  };

  (window.HTMLElement.prototype as any).createEl = function(
    this: HTMLElement,
    tag: string,
    options?: {
      cls?: string | string[];
      text?: string | number | null;
      title?: string;
      attr?: Record<string, string | number | null | undefined>;
    },
  ) {
    const el = document.createElement(tag);
    if (options) {
      const cls = options.cls;
      if (typeof cls === 'string') {
        el.className = cls;
      } else if (Array.isArray(cls)) {
        el.className = cls.join(' ');
      }
      if (options.text !== undefined && options.text !== null) {
        el.textContent = String(options.text);
      }
      if (options.title) {
        el.setAttribute('title', options.title);
      }
      if (options.attr) {
        for (const [key, value] of Object.entries(options.attr)) {
          if (value !== null && value !== undefined) {
            el.setAttribute(key, String(value));
          }
        }
      }
    }
    this.appendChild(el);
    return el;
  };

  (window.HTMLElement.prototype as any).createDiv = function(
    this: HTMLElement,
    options?: Parameters<HTMLElement['createEl']>[1],
  ) {
    return (this as any).createEl('div', options);
  };

  (window.HTMLElement.prototype as any).addClass = function(
    this: HTMLElement,
    ...classes: (string | string[] | undefined)[]
  ) {
    for (const entry of classes) {
      const list = Array.isArray(entry) ? entry : [entry];
      for (const cls of list) {
        if (cls) {
          this.classList.add(cls);
        }
      }
    }
    return this;
  };

  (window.HTMLElement.prototype as any).setText = function(this: HTMLElement, text: string) {
    this.textContent = text;
    return this;
  };
}

export function parseYaml(source: string): unknown {
  const obj: Record<string, unknown> = {};
  const lines = source.split('\n');
  
  let currentArrayKey: string | null = null;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    if (trimmed.startsWith('- ')) {
      if (currentArrayKey) {
        let val: unknown = trimmed.slice(2).trim();
        if (typeof val === 'string' && val.startsWith('"') && val.endsWith('"')) {
          try { val = JSON.parse(val); } catch { /* ignore */ }
        }
        (obj[currentArrayKey] as unknown[]).push(val);
      }
      continue;
    }
    
    currentArrayKey = null;
    const colon = line.indexOf(':');
    if (colon > 0) {
      const key = line.slice(0, colon).trim();
      let val: unknown = line.slice(colon + 1).trim();
      
      if (val === '') {
        currentArrayKey = key;
        obj[key] = [];
      } else {
        if (val === 'true') obj[key] = true;
        else if (val === 'false') obj[key] = false;
        else if (val === 'null') obj[key] = null;
        else if (!isNaN(Number(val))) obj[key] = Number(val);
        else {
          if (typeof val === 'string' && val.startsWith('"') && val.endsWith('"')) {
             try { val = JSON.parse(val); } catch { /* ignore */ }
          }
          obj[key] = val;
        }
      }
    }
  }
  return obj;
}
