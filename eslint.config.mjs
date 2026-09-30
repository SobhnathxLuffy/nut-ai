import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.expo/**',
      'apps/mobile/android/**',
      'apps/mobile/ios/**',
      'apps/mobile/.expo/**',
      '**/*.d.ts',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // The recommended default ('error' on every `: any` annotation) stays
      // OFF — the wire/wasm boundary is documented-acceptable. The regrowth
      // guard is the `as any` CAST rule just below (P2-42 / P3-13).
      '@typescript-eslint/no-explicit-any': 'off',
      // P2-42 / P3-13: the census metric is the `as any` CAST (a raw type
      // assertion over parsed-or-raw data), not `: any` annotations at the
      // wire boundary (typed signatures, documented-acceptable). A NEW `as
      // any` breaks the gate (--max-warnings=0); the pre-existing ones carry
      // per-line justifications.
      'no-restricted-syntax': [
        'warn',
        {
          selector: 'TSAsExpression > TSAnyKeyword',
          message:
            'Avoid `as any` casts — narrow or parse at the boundary instead. If this is a documented network/wasm/feature-detect exception, add an eslint-disable-next-line with the justification.',
        },
      ],
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Test files are exempt from the any-cast warn (mocks and fixture builders
    // are deliberately loose; the census that matters is non-test source).
    files: ['**/*.test.{ts,tsx}', 'apps/mobile/e2e/**'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    // The two rules tokens.ts has always promised (QA P2-20):
    //
    //   1. Hex colours live in src/theme/tokens.ts ONLY. A hardcoded colour is
    //      a colour that silently ignores dark mode and never gets
    //      contrast-checked.
    //   2. Tap targets are at least MIN_TAP_TARGET (44px) tall — anything
    //      smaller must lean on hitSlop instead of shrinking the target.
    //
    // Scoped exemptions, each deliberate:
    //   - tokens.ts          — the sanctioned home of every hex.
    //   - alert-web.ts       — DOM shim that cannot consume the React theme
    //                          context; its values mirror the palette exactly.
    //   - onboarding/Charts  — SVG illustration palette (static marketing
    //                          artwork, not themed UI). The Chrome/Controls
    //                          ternaries were tokenized in Wave 3 (QA P2-19).
    //   - camera.tsx         — text over a live camera feed must stay
    //                          theme-independent white/black for contrast.
    //   - app.config.ts      — native build config takes ONE static colour;
    //                          the runtime theme cannot apply (documented there).
    files: ['apps/mobile/**/*.{ts,tsx}'],
    ignores: [
      '**/*.test.*',
      '**/tokens.ts',
      '**/alert-web.ts',
      '**/onboarding/Charts.tsx',
      '**/camera.tsx',
      '**/app.config.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value=/^#[0-9a-fA-F]{3,4}(?:[0-9a-fA-F]{3,4})?$/]",
          message:
            'Hex colours live in src/theme/tokens.ts only — use a theme token (see the tokens.ts header for why).',
        },
        {
          selector: "Property[key.name='minHeight'][value.type='Literal'][value.value<44]",
          message:
            'Tap targets must be at least 44 (MIN_TAP_TARGET) — raise the target, or shrink the visual and set hitSlop on the Pressable.',
        },
        {
          // P2-42/P3-13 as-any cast ban — same rule as the global block (this
          // block replaces it for apps/mobile, so the selector repeats here).
          selector: 'TSAsExpression > TSAnyKeyword',
          message:
            'Avoid `as any` casts — narrow or parse at the boundary instead. If this is a documented network/wasm/feature-detect exception, add an eslint-disable-next-line with the justification.',
        },
      ],
    },
  },
)
