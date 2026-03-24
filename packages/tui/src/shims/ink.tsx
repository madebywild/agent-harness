/**
 * Browser-compatible shims for `ink` primitives.
 * Used only by Storybook via Vite aliases — never in the real terminal build.
 */

import { type CSSProperties, type ReactNode, useCallback, useEffect } from "react";

// ---------------------------------------------------------------------------
// Prop-to-CSS helpers
// ---------------------------------------------------------------------------

const UNIT = 8; // px per terminal row/col unit

function spacingPx(value: number | undefined): string | undefined {
  return value != null ? `${value * UNIT}px` : undefined;
}

// ---------------------------------------------------------------------------
// Box
// ---------------------------------------------------------------------------

interface BoxProps {
  children?: ReactNode;
  flexDirection?: "row" | "column" | "row-reverse" | "column-reverse";
  marginTop?: number;
  marginLeft?: number;
  marginRight?: number;
  marginBottom?: number;
  paddingX?: number;
  paddingTop?: number;
  paddingBottom?: number;
  borderStyle?: "single" | "double" | "round" | "bold" | "classic";
  borderColor?: string;
  gap?: number;
}

export function Box({
  children,
  flexDirection = "row",
  marginTop,
  marginLeft,
  marginRight,
  marginBottom,
  paddingX,
  paddingTop,
  paddingBottom,
  borderStyle,
  borderColor,
  gap,
}: BoxProps) {
  const style: CSSProperties = {
    display: "flex",
    flexDirection,
    marginTop: spacingPx(marginTop),
    marginLeft: spacingPx(marginLeft),
    marginRight: spacingPx(marginRight),
    marginBottom: spacingPx(marginBottom),
    paddingLeft: spacingPx(paddingX),
    paddingRight: spacingPx(paddingX),
    paddingTop: spacingPx(paddingTop),
    paddingBottom: spacingPx(paddingBottom),
    gap: gap != null ? `${gap * UNIT}px` : undefined,
  };

  if (borderStyle) {
    style.border = `1px ${borderStyle === "double" ? "double" : "solid"} ${borderColor ?? "#888"}`;
    style.borderRadius = borderStyle === "round" ? "4px" : undefined;
    style.padding = style.padding ?? "4px 8px";
  }

  return <div style={style}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

interface TextProps {
  children?: ReactNode;
  color?: string;
  bold?: boolean;
  dimColor?: boolean;
  underline?: boolean;
  italic?: boolean;
}

export function Text({ children, color, bold, dimColor, underline, italic }: TextProps) {
  const style: CSSProperties = {
    color: color ?? undefined,
    fontWeight: bold ? "bold" : undefined,
    opacity: dimColor ? 0.5 : undefined,
    textDecoration: underline ? "underline" : undefined,
    fontStyle: italic ? "italic" : undefined,
    whiteSpace: "pre-wrap",
  };

  return <span style={style}>{children}</span>;
}

// ---------------------------------------------------------------------------
// useInput
// ---------------------------------------------------------------------------

interface InputKey {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  return: boolean;
  escape: boolean;
  backspace: boolean;
  delete: boolean;
  tab: boolean;
  ctrl: boolean;
  meta: boolean;
}

type InputHandler = (input: string, key: InputKey) => void;

export function useInput(handler: InputHandler): void {
  const stableHandler = useCallback(handler, [handler]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key: InputKey = {
        upArrow: e.key === "ArrowUp",
        downArrow: e.key === "ArrowDown",
        leftArrow: e.key === "ArrowLeft",
        rightArrow: e.key === "ArrowRight",
        return: e.key === "Enter",
        escape: e.key === "Escape",
        backspace: e.key === "Backspace",
        delete: e.key === "Delete",
        tab: e.key === "Tab",
        ctrl: e.ctrlKey,
        meta: e.metaKey,
      };

      const isSpecial = e.key.length > 1 || e.ctrlKey || e.metaKey;
      const input = isSpecial ? "" : e.key;

      // Prevent default for keys that the component handles
      if (key.tab || key.upArrow || key.downArrow) {
        e.preventDefault();
      }

      stableHandler(input, key);
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [stableHandler]);
}

// ---------------------------------------------------------------------------
// Static — renders children sequentially (no terminal semantics in browser)
// ---------------------------------------------------------------------------

interface StaticProps<T> {
  items?: T[];
  children?: ((item: T, index: number) => ReactNode) | ReactNode;
}

export function Static<T>({ items, children }: StaticProps<T>) {
  if (items && typeof children === "function") {
    return <div>{items.map((item, i) => (children as (item: T, index: number) => ReactNode)(item, i))}</div>;
  }
  return <div>{children as ReactNode}</div>;
}

// ---------------------------------------------------------------------------
// useApp — no-op in browser
// ---------------------------------------------------------------------------

export function useApp() {
  return { exit: () => {} };
}

// ---------------------------------------------------------------------------
// render — no-op stub (Storybook handles rendering)
// ---------------------------------------------------------------------------

export function render() {
  return { waitUntilExit: () => Promise.resolve() };
}
