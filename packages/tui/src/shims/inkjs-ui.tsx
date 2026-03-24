/**
 * Browser-compatible shims for `@inkjs/ui` components.
 * Used only by Storybook via Vite aliases — never in the real terminal build.
 */

import { type CSSProperties, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface SpinnerProps {
  label?: string;
}

export function Spinner({ label }: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(timer);
  }, []);

  return (
    <span style={{ whiteSpace: "pre-wrap" }}>
      <span style={{ color: "cyan" }}>{SPINNER_FRAMES[frame]}</span>
      {label ? ` ${label}` : ""}
    </span>
  );
}

// ---------------------------------------------------------------------------
// TextInput
// ---------------------------------------------------------------------------

interface TextInputProps {
  placeholder?: string;
  defaultValue?: string;
  onSubmit?: (value: string) => void;
  onChange?: (value: string) => void;
}

export function TextInput({ placeholder, defaultValue = "", onSubmit, onChange }: TextInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);

  // Auto-focus on mount
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const style: CSSProperties = {
    background: "transparent",
    border: "none",
    borderBottom: "1px solid #888",
    color: "inherit",
    fontFamily: "inherit",
    fontSize: "inherit",
    outline: "none",
    padding: "2px 0",
    minWidth: "200px",
  };

  return (
    <input
      ref={ref}
      type="text"
      style={style}
      placeholder={placeholder}
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        onChange?.(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.stopPropagation();
          onSubmit?.(value);
        }
      }}
    />
  );
}
