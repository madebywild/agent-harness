import { TextInput } from "@inkjs/ui";
import { Box, Text, useInput } from "ink";
import { useState } from "react";

export interface TextPromptProps {
  message: string;
  required: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function TextPrompt({ message, required, onSubmit, onCancel }: TextPromptProps) {
  const [error, setError] = useState(false);

  useInput((_input, key) => {
    if (key.escape) onCancel();
    else if (error && !key.return) setError(false);
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text dimColor>{message}: </Text>
        <TextInput
          placeholder={required ? "" : "optional"}
          onSubmit={(value) => {
            if (required && value.trim().length === 0) {
              setError(true);
              return;
            }
            onSubmit(value);
          }}
        />
      </Box>
      {error && <Text color="red">{"  This value is required"}</Text>}
    </Box>
  );
}
