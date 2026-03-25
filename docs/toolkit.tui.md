# TUI Package (`@madebywild/agent-harness-tui`)

Reusable Ink (terminal React) components extracted from the toolkit, with a browser-based Storybook for visual development.

## Components

| Component | Description | Props |
|---|---|---|
| `AutocompleteSelect` | Searchable select with keyboard navigation, scrolling, and highlight matching | `options`, `onChange`, `onCancel?`, `label?`, `visibleOptionCount?` |
| `ToggleConfirm` | Yes/No toggle with arrow key / Tab switching | `message`, `onSubmit`, `defaultValue?`, `onEscape?` |
| `TextPrompt` | Text input with required/optional validation | `message`, `required`, `onSubmit`, `onCancel` |
| `OutputStep` | Command output display (success/error) with Enter to dismiss | `label`, `lines`, `isError`, `onDismiss` |
| `OnboardingComplete` | Setup completion summary with bullet list | `summary`, `onDismiss` |

All components depend only on `ink`, `@inkjs/ui`, and `react` — no toolkit internals.

## Running Storybook

```bash
pnpm storybook          # from monorepo root (port 6006)
# or
pnpm --filter @madebywild/agent-harness-tui storybook
```

Build static Storybook:

```bash
pnpm build-storybook
```

## How it works

Components import from `ink` and `@inkjs/ui` as normal. For Storybook (browser), Vite aliases in `.storybook/main.ts` redirect these imports to browser-compatible shims in `src/shims/`:

- `ink` → `src/shims/ink.tsx` — maps `Box` to `<div>` with flexbox, `Text` to `<span>` with CSS, `useInput` to `document.addEventListener("keydown")`
- `@inkjs/ui` → `src/shims/inkjs-ui.tsx` — maps `Spinner` to animated braille frames, `TextInput` to `<input>`

The shims are excluded from the main TypeScript build (`tsconfig.json` excludes `src/shims/`) and only compiled by Storybook's Vite bundler using `tsconfig.storybook.json` (which includes DOM types).

## Adding a new component

1. Create `packages/tui/src/components/<name>.tsx` — import from `ink` / `@inkjs/ui` / `react` only
2. Export from `src/index.ts`
3. Create `packages/tui/stories/<Name>.stories.tsx` in CSF3 format
4. If the component uses new Ink primitives not yet shimmed, add them to the relevant shim file
5. Update the toolkit to import from `@madebywild/agent-harness-tui` instead of inline definitions

## Package structure

```
packages/tui/
  src/
    index.ts                          # barrel exports
    components/                       # Ink components (terminal-native)
      autocomplete-select.tsx
      toggle-confirm.tsx
      text-prompt.tsx
      output-step.tsx
      onboarding-complete.tsx
    shims/                            # browser shims (Storybook only)
      ink.tsx
      inkjs-ui.tsx
      index.ts
  stories/                            # Storybook stories (CSF3)
  .storybook/
    main.ts                           # Vite config with ink→shim aliases
    preview.ts                        # terminal-like dark background + monospace font
  tsconfig.json                       # main build (excludes shims)
  tsconfig.storybook.json             # Storybook build (includes DOM, shims, stories)
```
