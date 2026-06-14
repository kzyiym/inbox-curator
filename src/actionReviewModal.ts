import { App, Modal, Notice, Setting } from 'obsidian';
import { t, type TranslationKey } from './i18n';
import type { ProposedActionItem } from './utils/proposedActions';

export interface ActionReviewModalCallbacks {
  applySelected: (items: ProposedActionItem[]) => Promise<void>;
  refresh: () => Promise<ProposedActionItem[]>;
}

function actionLabel(reviewAction: string): string {
  return t(`actionReview.action.${reviewAction}` as TranslationKey) || reviewAction;
}

function confidenceLabel(value: string): string {
  return t(`actionReview.confidence.${value}` as TranslationKey) || value;
}

export class ActionReviewModal extends Modal {
  private selected = new Set<string>();

  constructor(
    app: App,
    private items: ProposedActionItem[],
    private readonly readOnly: boolean,
    private readonly callbacks: ActionReviewModalCallbacks,
  ) {
    super(app);
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('inbox-curator-action-review');

    contentEl.createEl('h3', {
      text: this.readOnly ? t('actionReview.titleDryRun') : t('actionReview.title'),
    });
    contentEl.createEl('p', {
      text: this.readOnly ? t('actionReview.descDryRun') : t('actionReview.desc'),
      cls: 'setting-item-description',
    });

    if (this.items.length === 0) {
      contentEl.createEl('p', { text: t('actionReview.empty') });
      new Setting(contentEl).addButton((btn) =>
        btn.setButtonText(t('actionReview.button.close')).onClick(() => this.close()),
      );
      return;
    }

    const table = contentEl.createEl('table', { cls: 'inbox-curator-action-review-table' });
    const thead = table.createEl('thead');
    const headRow = thead.createEl('tr');
    if (!this.readOnly) headRow.createEl('th', { text: '' });
    headRow.createEl('th', { text: t('actionReview.col.note') });
    headRow.createEl('th', { text: t('actionReview.col.action') });
    headRow.createEl('th', { text: t('actionReview.col.confidence') });
    headRow.createEl('th', { text: t('actionReview.col.reliability') });
    headRow.createEl('th', { text: t('actionReview.col.auto') });
    headRow.createEl('th', { text: t('actionReview.col.destination') });

    const tbody = table.createEl('tbody');
    for (const item of this.items) {
      const row = tbody.createEl('tr');
      const selectable = !item.decision.allowedByAllowlist ? false : true;

      if (!this.readOnly) {
        const cbCell = row.createEl('td');
        const cb = cbCell.createEl('input', { attr: { type: 'checkbox' } });
        cb.checked = this.selected.has(item.notePath);
        cb.disabled = !selectable;
        cb.addEventListener('change', () => {
          if (cb.checked) this.selected.add(item.notePath);
          else this.selected.delete(item.notePath);
        });
      }

      row.createEl('td', { text: item.noteTitle, title: item.notePath });
      row.createEl('td', { text: actionLabel(item.reviewAction) });
      row.createEl('td', { text: confidenceLabel(item.confidence) });
      row.createEl('td', { text: confidenceLabel(item.reliabilityLabel) });

      const autoCell = row.createEl('td');
      if (item.decision.wouldAutoExecute) {
        autoCell.setText('✓');
        autoCell.addClass('inbox-curator-folder-status-ok');
      } else {
        autoCell.setText(item.decision.skipReason ?? '—');
        autoCell.addClass('inbox-curator-meta-info');
      }

      const destText = item.destinationPath
        ? item.destinationConflict
          ? `${item.destinationPath} (${t('actionReview.conflict')})`
          : item.destinationPath
        : '—';
      row.createEl('td', { text: destText });
    }

    if (this.readOnly) {
      new Setting(contentEl).addButton((btn) =>
        btn.setButtonText(t('actionReview.button.close')).onClick(() => this.close()),
      );
      return;
    }

    const controls = new Setting(contentEl);
    controls.addButton((btn) =>
      btn.setButtonText(t('actionReview.button.selectAuto')).onClick(() => {
        for (const item of this.items) {
          if (item.decision.wouldAutoExecute) this.selected.add(item.notePath);
        }
        this.render();
      }),
    );
    controls.addButton((btn) =>
      btn
        .setButtonText(t('actionReview.button.applySelected'))
        .setCta()
        .onClick(() => {
          void this.applySelected();
        }),
    );
    controls.addButton((btn) =>
      btn.setButtonText(t('actionReview.button.close')).onClick(() => this.close()),
    );
  }

  private async applySelected(): Promise<void> {
    const toApply = this.items.filter(
      (item) => this.selected.has(item.notePath) && item.decision.allowedByAllowlist,
    );
    if (toApply.length === 0) {
      new Notice(t('actionReview.noSelection'));
      return;
    }

    await this.callbacks.applySelected(toApply);
    this.selected.clear();
    try {
      this.items = await this.callbacks.refresh();
    } catch {
      this.items = [];
    }
    this.render();
  }
}
