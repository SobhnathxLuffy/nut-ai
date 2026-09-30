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
      '@typescript-eslint/no-explicit-any': 'off',
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
    //   - onboarding/**      — Chrome/Controls/Charts ternaries + SVG palette:
    //                          the Wave-3 onboarding-chrome token batch.
    //   - camera.tsx         — text over a live camera feed must stay
    //                          theme-independent white/black for contrast.
    //   - app.config.ts      — native build config takes ONE static colour;
    //                          the runtime theme cannot apply (documented there).
    files: ['apps/mobile/**/*.{ts,tsx}'],
    ignores: [
      '**/*.test.*',
      '**/tokens.ts',
      '**/alert-web.ts',
      '**/onboarding/**',
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
      ],
    },
  },
)
