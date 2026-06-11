# Dependency License Audit (Engineering-Level Review)

This is an engineering-level review of the licenses of direct dependencies declared in `package.json`. It is not legal advice.

## Direct Dev Dependencies

| Dependency | Version | Declared License | Status | Notes |
|---|---|---|---|---|

| @types/node | ^24.3.0 | MIT | OK | Type definitions only (dev) |
| esbuild | ^0.25.9 | MIT | OK | Bundler, binary included |

| jsdom | ^29.1.1 | MIT | OK | Test dependency |
| obsidian | ^1.5.0 | MIT | OK | Type definitions only (dev) |
| typescript | ^5.9.2 | Apache-2.0 | OK | Compiler only (dev) |
| vitest | ^4.1.8 | MIT | OK | Test framework (dev) |

## Notes

- All direct dependencies are either MIT or Apache-2.0, both compatible with the MIT license.
- `typescript` (Apache-2.0) is used only as a dev tool and is not bundled into the plugin output.
- No dependencies with unknown, proprietary, non-commercial, or source-available licenses were found.
- No dependencies with postinstall scripts that could pose a supply-chain risk were identified.
- No external runtime dependencies are bundled by esbuild anymore.
- All transitive dependencies were also verified via `pnpm licenses list` and are MIT-compatible except:
  - `lightningcss` (MPL-2.0) — used internally by Vite/vitest as a dev CSS tool, not bundled into plugin output.
  - `lru-cache` (BlueOak-1.0.0) — MIT-compatible permissive license.

  - `mdn-data` (CC0-1.0) — public domain dedication, no restrictions.

## Summary

**All direct and transitive dependencies are compatible with the MIT license.**
