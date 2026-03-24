import { Box, Text, useInput } from "ink";
import { useMemo, useRef, useState } from "react";

export interface AutocompleteSelectOption {
  label: string;
  value: string;
}

export interface AutocompleteSelectProps {
  options: AutocompleteSelectOption[];
  onChange: (value: string) => void;
  onCancel?: () => void;
  label?: string;
  visibleOptionCount?: number;
}

export interface AutocompleteMultiSelectProps {
  options: AutocompleteSelectOption[];
  onSubmit: (values: string[]) => void;
  onCancel?: () => void;
  label?: string;
  visibleOptionCount?: number;
  doneLabel?: (selectedCount: number) => string;
}

export function AutocompleteSelect({
  options,
  onChange,
  onCancel,
  label = "Search",
  visibleOptionCount = 8,
}: AutocompleteSelectProps) {
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const scrollRef = useRef(0);

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // Clamp focus to valid range
  const focus = Math.min(focusIndex, Math.max(0, filtered.length - 1));
  const actualVisible = Math.min(visibleOptionCount, filtered.length);

  // Adjust scroll to keep focus visible
  if (focus < scrollRef.current) {
    scrollRef.current = focus;
  } else if (focus >= scrollRef.current + actualVisible) {
    scrollRef.current = focus - actualVisible + 1;
  }
  scrollRef.current = Math.max(0, Math.min(scrollRef.current, Math.max(0, filtered.length - actualVisible)));

  const visibleSlice = filtered.slice(scrollRef.current, scrollRef.current + actualVisible);

  useInput((input, key) => {
    if (key.downArrow) {
      setFocusIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (key.upArrow) {
      setFocusIndex((i) => Math.max(i - 1, 0));
    } else if (key.return) {
      const selected = filtered[focus];
      if (selected) onChange(selected.value);
    } else if (key.escape) {
      if (query) {
        setQuery("");
        setFocusIndex(0);
        scrollRef.current = 0;
      } else {
        onCancel?.();
      }
    } else if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setFocusIndex(0);
      scrollRef.current = 0;
    } else if (input && !key.ctrl && !key.meta && !key.tab) {
      setQuery((q) => q + input);
      setFocusIndex(0);
      scrollRef.current = 0;
    }
  });

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>{label}: </Text>
        <Text>{query}</Text>
        <Text dimColor>█</Text>
        {filtered.length !== options.length && <Text dimColor>{` (${filtered.length}/${options.length})`}</Text>}
      </Box>
      {scrollRef.current > 0 && <Text dimColor>{"  ↑"}</Text>}
      {visibleSlice.map((option, i) => {
        const isFocused = scrollRef.current + i === focus;
        return (
          <Box key={option.value}>
            <Text color={isFocused ? "cyan" : undefined}>{isFocused ? "❯ " : "  "}</Text>
            <HighlightedLabel label={option.label} query={query} isFocused={isFocused} />
          </Box>
        );
      })}
      {scrollRef.current + actualVisible < filtered.length && <Text dimColor>{"  ↓"}</Text>}
      {filtered.length === 0 && <Text dimColor>{"  No matches"}</Text>}
    </Box>
  );
}

export function AutocompleteMultiSelect({
  options,
  onSubmit,
  onCancel,
  label = "Search",
  visibleOptionCount = 8,
  doneLabel = (selectedCount) => `Done (${selectedCount} selected)`,
}: AutocompleteMultiSelectProps) {
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const [selectedValues, setSelectedValues] = useState<Set<string>>(() => new Set());
  const scrollRef = useRef(0);

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const rowCount = filtered.length + 1;
  const focus = Math.min(focusIndex, Math.max(0, rowCount - 1));
  const actualVisible = Math.min(visibleOptionCount, rowCount);

  if (focus < scrollRef.current) {
    scrollRef.current = focus;
  } else if (focus >= scrollRef.current + actualVisible) {
    scrollRef.current = focus - actualVisible + 1;
  }
  scrollRef.current = Math.max(0, Math.min(scrollRef.current, Math.max(0, rowCount - actualVisible)));

  const visibleRows = Array.from({ length: actualVisible }, (_, i) => scrollRef.current + i).filter(
    (row) => row < rowCount,
  );

  useInput((input, key) => {
    if (key.downArrow) {
      setFocusIndex((i) => Math.min(i + 1, rowCount - 1));
      return;
    }
    if (key.upArrow) {
      setFocusIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (key.return) {
      if (focus === 0) {
        const orderedSelection = options
          .filter((option) => selectedValues.has(option.value))
          .map((option) => option.value);
        onSubmit(orderedSelection);
        return;
      }
      const focusedOption = filtered[focus - 1];
      if (!focusedOption) return;
      setSelectedValues((prev) => {
        const next = new Set(prev);
        if (next.has(focusedOption.value)) {
          next.delete(focusedOption.value);
        } else {
          next.add(focusedOption.value);
        }
        return next;
      });
      return;
    }
    if (key.escape) {
      if (query) {
        setQuery("");
        setFocusIndex(0);
        scrollRef.current = 0;
      } else {
        onCancel?.();
      }
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setFocusIndex(0);
      scrollRef.current = 0;
      return;
    }
    if (input && !key.ctrl && !key.meta && !key.tab) {
      setQuery((q) => q + input);
      setFocusIndex(0);
      scrollRef.current = 0;
    }
  });

  const selectedCount = selectedValues.size;

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>{label}: </Text>
        <Text>{query}</Text>
        <Text dimColor>█</Text>
        {filtered.length !== options.length && <Text dimColor>{` (${filtered.length}/${options.length})`}</Text>}
      </Box>
      <Text dimColor>{`Enter toggles selection. Select "${doneLabel(selectedCount)}" to continue.`}</Text>
      {scrollRef.current > 0 && <Text dimColor>{"  ^"}</Text>}
      {visibleRows.map((row) => {
        const isFocused = row === focus;
        if (row === 0) {
          return (
            <Box key="done-row">
              <Text color={isFocused ? "cyan" : undefined}>{isFocused ? "> " : "  "}</Text>
              <Text bold color={isFocused ? "cyan" : undefined}>
                {doneLabel(selectedCount)}
              </Text>
            </Box>
          );
        }
        const option = filtered[row - 1];
        if (!option) return null;
        const selected = selectedValues.has(option.value);
        return (
          <Box key={option.value}>
            <Text color={isFocused ? "cyan" : undefined}>{isFocused ? "> " : "  "}</Text>
            <Text color={isFocused ? "cyan" : undefined}>{selected ? "[x] " : "[ ] "}</Text>
            <HighlightedLabel label={option.label} query={query} isFocused={isFocused} />
          </Box>
        );
      })}
      {scrollRef.current + actualVisible < rowCount && <Text dimColor>{"  v"}</Text>}
      {filtered.length === 0 && <Text dimColor>{"  No matches"}</Text>}
    </Box>
  );
}

function HighlightedLabel({ label, query, isFocused }: { label: string; query: string; isFocused: boolean }) {
  if (!query) {
    return <Text color={isFocused ? "cyan" : undefined}>{label}</Text>;
  }
  const idx = label.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) {
    return <Text color={isFocused ? "cyan" : undefined}>{label}</Text>;
  }
  return (
    <Text color={isFocused ? "cyan" : undefined}>
      {label.slice(0, idx)}
      <Text bold underline>
        {label.slice(idx, idx + query.length)}
      </Text>
      {label.slice(idx + query.length)}
    </Text>
  );
}
