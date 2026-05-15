# `packages/toolkit/src/provider-adapters/hook-capabilities.ts`

## Purpose

Centralizes provider hook event capabilities so renderers and legacy import paths use the same support matrix.

## Core exports

- `HOOK_PROVIDER_CAPABILITIES`
- `getHookEventCapability(provider, eventName)`
- `nativeToCanonicalHookEvent(provider, nativeEvent)`

## Captured capabilities

- Native provider event name for each supported canonical event.
- Whether `matcher` is supported for that provider/event pair.
- Command-handler field support such as timeout key, `cwd`, `env`, and `statusMessage`.

This module is data-oriented. Provider renderers still own provider-native output shapes, so Claude/Codex grouped hook
config and Copilot/Cursor flat hook config stay separate.
