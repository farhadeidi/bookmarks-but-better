import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `.claude/worktrees` and `.worktrees` hold agent worktrees: whole checkouts
  // of this repo nested inside it. Linting them means linting a second copy of
  // every file, under the root config rather than the config that copy would
  // use — `website/src/entries/**` overrides, for one, are relative and stop
  // matching once the path is prefixed.
  globalIgnores(['dist', 'dist-*', 'target', '.claude', '.worktrees']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // Build entries mount a root and export nothing by design.
    files: ['website/src/entries/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
