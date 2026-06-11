import { parseYaml } from 'obsidian';

/**
 * Parses a YAML string into a safe Record<string, unknown>.
 * @param source - YAML string
 * @returns Empty object if parsing fails or result is not an object
 */
export function parseYamlRecord(source: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  return parsed as Record<string, unknown>;
}

function escapeYamlString(str: string): string {
  const specialCharsRegex = /[:#'"\[\]{}|>&*!%@`,\n]/;
  const startsWithSpecialRegex = /^[-?|<>=!%@`]/;
  const needsQuotes =
    str === '' ||
    str.trim() !== str ||
    specialCharsRegex.test(str) ||
    startsWithSpecialRegex.test(str) ||
    str === 'true' ||
    str === 'false' ||
    str === 'null' ||
    !isNaN(Number(str));

  if (needsQuotes) {
    return JSON.stringify(str);
  }
  return str;
}

/**
 * Stringifies a Record<string, unknown> into a YAML string without relying on js-yaml.
 * Safely handles strings, numbers, booleans, and arrays.
 */
export function stringifyYamlRecord(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;

    if (value === null) {
      lines.push(`${key}: null`);
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else if (typeof value === 'string') {
      lines.push(`${key}: ${escapeYamlString(value)}`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        for (const item of value) {
          if (item === null) {
            lines.push(`  - null`);
          } else if (typeof item === 'boolean' || typeof item === 'number') {
            lines.push(`  - ${item}`);
          } else if (typeof item === 'string') {
            lines.push(`  - ${escapeYamlString(item)}`);
          } else {
            lines.push(`  - ${JSON.stringify(item)}`);
          }
        }
      }
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  return lines.join('\n');
}
