import { vi } from 'vitest';

export class App {}

export class TFile {
  path = '';
  basename = '';
  extension = '';
  stat = { mtime: 0, size: 0 };
}

export class Notice {
  constructor(_message?: string, _duration?: number) {}
  setMessage(_message: string) {
    return this;
  }
  hide() {}
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
