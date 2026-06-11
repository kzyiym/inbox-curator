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
  addButton(callback?: (component: { setButtonText: () => unknown; onClick: () => unknown; setCta: () => unknown }) => unknown) {
    callback?.({
      setButtonText: () => this,
      onClick: () => this,
      setCta: () => this,
    });
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
}
