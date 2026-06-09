import { App, TFile } from 'obsidian';

export async function extractPdfText(
  app: App,
  file: TFile,
  options?: {
    maxPages?: number;
    maxChars?: number;
    maxBytes?: number;
  },
): Promise<{
  ok: boolean;
  text?: string;
  warning?: string;
  pagesRead?: number;
}> {
  const maxBytes = options?.maxBytes ?? 5 * 1024 * 1024;
  if (file.stat.size > maxBytes) {
    return {
      ok: false,
      warning: 'PDF file exceeds size limit.',
    };
  }

  const pdfjsLib = (window as any).pdfjsLib;
  if (!pdfjsLib) {
    return {
      ok: false,
      warning: 'PDF text extraction is not available in this Obsidian environment.',
    };
  }

  try {
    const arrayBuffer = await app.vault.readBinary(file);
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    const maxPages = options?.maxPages ?? 5;
    const pagesToRead = Math.min(pdf.numPages, maxPages);
    let text = '';
    const maxChars = options?.maxChars ?? 10000;

    for (let i = 1; i <= pagesToRead; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');

      if (text.length + pageText.length > maxChars) {
        const remaining = maxChars - text.length;
        text += pageText.slice(0, remaining);
        break;
      }
      text += pageText + '\n';
    }

    const trimmedText = text.trim();
    if (!trimmedText) {
      return {
        ok: false,
        warning: 'PDF has no extractable text.',
      };
    }

    return {
      ok: true,
      text: trimmedText,
      pagesRead: pagesToRead,
    };
  } catch (error) {
    return {
      ok: false,
      warning: `Failed to extract PDF text: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
