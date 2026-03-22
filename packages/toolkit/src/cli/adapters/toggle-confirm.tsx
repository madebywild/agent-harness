import { Box, Text, useInput } from "ink";
import { useState } from "react";

export interface ToggleConfirmProps {
  message: string;
  defaultValue?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ToggleConfirm({ message, defaultValue = false, onConfirm, onCancel }: ToggleConfirmProps) {
  const [value, setValue] = useState(defaultValue);

  useInput((_input, key) => {
    if (key.leftArrow || key.rightArrow || key.tab) {
      setValue((v) => !v);
    } else if (key.return) {
      if (value) onConfirm();
      else onCancel();
    } else if (key.escape) {
      onCancel();
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
