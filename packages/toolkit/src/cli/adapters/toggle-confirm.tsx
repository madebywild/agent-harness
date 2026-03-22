import { Box, Text, useInput } from "ink";
import { useState } from "react";

export interface ToggleConfirmProps {
  message: string;
  defaultValue?: boolean;
  onSubmit: (value: boolean) => void;
  onEscape?: () => void;
}

export function ToggleConfirm({ message, defaultValue = false, onSubmit, onEscape }: ToggleConfirmProps) {
  const [value, setValue] = useState(defaultValue);

  useInput((_input, key) => {
    if (key.leftArrow || key.rightArrow || key.tab) {
      setValue((v) => !v);
    } else if (key.return) {
      onSubmit(value);
    } else if (key.escape) {
      if (onEscape) onEscape();
      else onSubmit(false);
    }
  });

  return (
    <Box marginTop={1}>
      <Text dimColor>{message} </Text>
      <Text color={value ? "cyan" : undefined} bold={value}>
        {value ? "❯ Yes" : "  Yes"}
      </Text>
      <Text> / </Text>
      <Text color={!value ? "cyan" : undefined} bold={!value}>
        {!value ? "❯ No" : "  No"}
      </Text>
    </Box>
  );
}
