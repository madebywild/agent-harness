import { Box, Text, useInput } from "ink";

export interface OnboardingCompleteProps {
  summary: string[];
  onDismiss: () => void;
}

export function OnboardingComplete({ summary, onDismiss }: OnboardingCompleteProps) {
  useInput((_input, key) => {
    if (key.return) onDismiss();
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="green">
        Setup complete!
      </Text>
      {summary.length > 0 && (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          {summary.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static list, never reordered
            <Text key={i} dimColor>
              - {line}
            </Text>
          ))}
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>Press Enter to continue to the main menu...</Text>
      </Box>
    </Box>
  );
}
