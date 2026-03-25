import { Box, Text, useInput } from "ink";

export interface OutputStepProps {
  label: string;
  lines: string[];
  isError: boolean;
  onDismiss: () => void;
}

export function OutputStep({ label, lines, isError, onDismiss }: OutputStepProps) {
  useInput((_input, key) => {
    if (key.return) onDismiss();
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={isError ? "red" : "green"}>
        {isError ? `✗ ${label}` : `✓ ${label}`}
      </Text>
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        <Text>{lines.join("\n")}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Enter to continue...</Text>
      </Box>
    </Box>
  );
}
