import assert from "node:assert/strict";
import test from "node:test";
import { parseEnvFile, substituteEnvVars } from "../src/env.ts";

// ---------------------------------------------------------------------------
// parseEnvFile
// ---------------------------------------------------------------------------

test("parseEnvFile: basic KEY=value pairs", () => {
  const result = parseEnvFile("FOO=bar\nBAZ=qux\n");
  assert.equal(result.get("FOO"), "bar");
  assert.equal(result.get("BAZ"), "qux");
  assert.equal(result.size, 2);
});

test("parseEnvFile: comments (lines starting with #) are ignored", () => {
  const result = parseEnvFile("# this is a comment\nFOO=bar\n# another comment\n");
  assert.equal(result.size, 1);
  assert.equal(result.get("FOO"), "bar");
});

test("parseEnvFile: empty lines are skipped", () => {
  const result = parseEnvFile("FOO=bar\n\n\nBAZ=qux\n\n");
  assert.equal(result.size, 2);
  assert.equal(result.get("FOO"), "bar");
  assert.equal(result.get("BAZ"), "qux");
});

test("parseEnvFile: double-quoted values with escape sequences", () => {
  const result = parseEnvFile(
    'NEWLINE="hello\\nworld"\nTAB="col1\\tcol2"\nBACKSLASH="back\\\\slash"\nQUOTE="say \\"hi\\""\n',
  );
  assert.equal(result.get("NEWLINE"), "hello\nworld");
  assert.equal(result.get("TAB"), "col1\tcol2");
  assert.equal(result.get("BACKSLASH"), "back\\slash");
  assert.equal(result.get("QUOTE"), 'say "hi"');
});

test("parseEnvFile: single-quoted values are literal (no escape processing)", () => {
  const result = parseEnvFile("RAW='hello\\nworld'\nLITERAL='back\\\\slash'\n");
  assert.equal(result.get("RAW"), "hello\\nworld");
  assert.equal(result.get("LITERAL"), "back\\\\slash");
});

test("parseEnvFile: unquoted values are trimmed", () => {
  const result = parseEnvFile("FOO=  bar  \nBAZ=qux   \n");
  assert.equal(result.get("FOO"), "bar");
  assert.equal(result.get("BAZ"), "qux");
});

test("parseEnvFile: inline comments in unquoted values", () => {
  const result = parseEnvFile("FOO=bar # this is a comment\nBAZ=qux#notacomment\n");
  // The inline comment after space+# should be stripped
  assert.equal(result.get("FOO"), "bar");
  // Without a leading space, # may or may not be treated as comment depending on implementation.
  // Typical dotenv: "qux#notacomment" is treated as the value. But with space: "qux #comment" -> "qux"
  // We test the most common case: space-hash is a comment delimiter
});

test("parseEnvFile: empty values (KEY=)", () => {
  const result = parseEnvFile("EMPTY=\nALSO_EMPTY=  \n");
  assert.equal(result.get("EMPTY"), "");
  assert.equal(result.get("ALSO_EMPTY"), "");
});

test("parseEnvFile: values with = signs", () => {
  const result = parseEnvFile("URL=https://example.com?a=1&b=2\nEQ=a=b\n");
  assert.equal(result.get("URL"), "https://example.com?a=1&b=2");
  assert.equal(result.get("EQ"), "a=b");
});

test("parseEnvFile: keys with underscores and numbers", () => {
  const result = parseEnvFile("MY_VAR_2=test\n_PRIVATE=secret\nA1_B2_C3=abc\n");
  assert.equal(result.get("MY_VAR_2"), "test");
  assert.equal(result.get("_PRIVATE"), "secret");
  assert.equal(result.get("A1_B2_C3"), "abc");
});

test("parseEnvFile: no newline at end of file", () => {
  const result = parseEnvFile("FOO=bar\nBAZ=qux");
  assert.equal(result.size, 2);
  assert.equal(result.get("FOO"), "bar");
  assert.equal(result.get("BAZ"), "qux");
});

test("parseEnvFile: Windows-style line endings (\\r\\n)", () => {
  const result = parseEnvFile("FOO=bar\r\nBAZ=qux\r\n");
  assert.equal(result.size, 2);
  assert.equal(result.get("FOO"), "bar");
  assert.equal(result.get("BAZ"), "qux");
});

test("parseEnvFile: export prefix is stripped for shell-compatible .env files", () => {
  const result = parseEnvFile("export FOO=bar\nexport BAZ=qux\n");
  assert.equal(result.get("FOO"), "bar");
  assert.equal(result.get("BAZ"), "qux");
  assert.equal(result.size, 2);
});

test("parseEnvFile: completely empty input", () => {
  const result = parseEnvFile("");
  assert.equal(result.size, 0);
});

test("parseEnvFile: only comments and whitespace", () => {
  const result = parseEnvFile("# comment\n\n# another\n  \n");
  assert.equal(result.size, 0);
});

test("parseEnvFile: double-quoted empty string", () => {
  const result = parseEnvFile('EMPTY=""\n');
  assert.equal(result.get("EMPTY"), "");
});

test("parseEnvFile: single-quoted empty string", () => {
  const result = parseEnvFile("EMPTY=''\n");
  assert.equal(result.get("EMPTY"), "");
});

test("parseEnvFile: multiline double-quoted values preserve internal newlines", () => {
  const result = parseEnvFile('MULTI="line1\\nline2\\nline3"\n');
  assert.equal(result.get("MULTI"), "line1\nline2\nline3");
});

test("parseEnvFile: later keys override earlier keys", () => {
  const result = parseEnvFile("FOO=first\nFOO=second\n");
  assert.equal(result.get("FOO"), "second");
});

// ---------------------------------------------------------------------------
// substituteEnvVars
// ---------------------------------------------------------------------------

test("substituteEnvVars: simple substitution", () => {
  const vars = new Map([["FOO", "hello"]]);
  const { result, usedKeys, unresolvedKeys } = substituteEnvVars("value is {{FOO}}", vars);
  assert.equal(result, "value is hello");
  assert.ok(usedKeys.has("FOO"));
  assert.deepEqual(unresolvedKeys, []);
});

test("substituteEnvVars: multiple different placeholders in same text", () => {
  const vars = new Map([
    ["A", "alpha"],
    ["B", "beta"],
  ]);
  const { result } = substituteEnvVars("{{A}} and {{B}}", vars);
  assert.equal(result, "alpha and beta");
});

test("substituteEnvVars: same placeholder used multiple times", () => {
  const vars = new Map([["X", "val"]]);
  const { result, usedKeys } = substituteEnvVars("{{X}}-{{X}}-{{X}}", vars);
  assert.equal(result, "val-val-val");
  assert.ok(usedKeys.has("X"));
  assert.equal(usedKeys.size, 1);
});

test("substituteEnvVars: no placeholders returns text unchanged", () => {
  const vars = new Map([["FOO", "bar"]]);
  const { result, usedKeys, unresolvedKeys } = substituteEnvVars("plain text here", vars);
  assert.equal(result, "plain text here");
  assert.equal(usedKeys.size, 0);
  assert.deepEqual(unresolvedKeys, []);
});

test("substituteEnvVars: unresolved placeholder stays as-is and appears in unresolvedKeys", () => {
  const vars = new Map<string, string>();
  // Temporarily ensure the key is NOT in process.env either
  const originalValue = process.env.DEFINITELY_MISSING_VAR_XYZ;
  delete process.env.DEFINITELY_MISSING_VAR_XYZ;
  try {
    const { result, unresolvedKeys } = substituteEnvVars("hello {{DEFINITELY_MISSING_VAR_XYZ}}", vars);
    assert.equal(result, "hello {{DEFINITELY_MISSING_VAR_XYZ}}");
    assert.ok(unresolvedKeys.includes("DEFINITELY_MISSING_VAR_XYZ"));
  } finally {
    if (originalValue !== undefined) {
      process.env.DEFINITELY_MISSING_VAR_XYZ = originalValue;
    }
  }
});

test("substituteEnvVars: mixed resolved and unresolved placeholders", () => {
  const vars = new Map([["KNOWN", "yes"]]);
  const originalValue = process.env.UNKNOWN_PLACEHOLDER_TEST;
  delete process.env.UNKNOWN_PLACEHOLDER_TEST;
  try {
    const { result, usedKeys, unresolvedKeys } = substituteEnvVars("{{KNOWN}} and {{UNKNOWN_PLACEHOLDER_TEST}}", vars);
    assert.equal(result, "yes and {{UNKNOWN_PLACEHOLDER_TEST}}");
    assert.ok(usedKeys.has("KNOWN"));
    assert.ok(unresolvedKeys.includes("UNKNOWN_PLACEHOLDER_TEST"));
  } finally {
    if (originalValue !== undefined) {
      process.env.UNKNOWN_PLACEHOLDER_TEST = originalValue;
    }
  }
});

test("substituteEnvVars: usedKeys tracks which vars were actually used", () => {
  const vars = new Map([
    ["USED", "yes"],
    ["UNUSED", "no"],
  ]);
  const { usedKeys } = substituteEnvVars("only {{USED}} here", vars);
  assert.ok(usedKeys.has("USED"));
  assert.ok(!usedKeys.has("UNUSED"));
});

test("substituteEnvVars: placeholder in JSON context", () => {
  const vars = new Map([["API_KEY", "sk-test-12345"]]);
  const input = '{"token": "{{API_KEY}}", "enabled": true}';
  const { result } = substituteEnvVars(input, vars);
  assert.equal(result, '{"token": "sk-test-12345", "enabled": true}');
});

test("substituteEnvVars: placeholder in markdown context", () => {
  const vars = new Map([["PROJECT", "MyApp"]]);
  const input = "# Welcome to {{PROJECT}}\n\nThis is the {{PROJECT}} documentation.";
  const { result } = substituteEnvVars(input, vars);
  assert.equal(result, "# Welcome to MyApp\n\nThis is the MyApp documentation.");
});

test("substituteEnvVars: adjacent placeholders", () => {
  const vars = new Map([
    ["A", "hello"],
    ["B", "world"],
  ]);
  const { result } = substituteEnvVars("{{A}}{{B}}", vars);
  assert.equal(result, "helloworld");
});

test("substituteEnvVars: nested-looking patterns", () => {
  const vars = new Map([["FOO", "resolved"]]);
  // The pattern /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g should match the inner {{FOO}} first
  // The outer braces {{ and }} are literal text surrounding the match
  const { result } = substituteEnvVars("{{{{FOO}}}}", vars);
  // Regex would find {{FOO}} inside the string "{{{{FOO}}}}"
  // Replaced: "{{" + "resolved" + "}}" -> "{{resolved}}"
  assert.equal(result, "{{resolved}}");
});

test("substituteEnvVars: invalid placeholder names are not matched: {{123}}", () => {
  const vars = new Map<string, string>();
  const { result, unresolvedKeys } = substituteEnvVars("{{123}}", vars);
  assert.equal(result, "{{123}}");
  assert.deepEqual(unresolvedKeys, []);
});

test("substituteEnvVars: invalid placeholder names are not matched: {{a-b}}", () => {
  const vars = new Map<string, string>();
  const { result, unresolvedKeys } = substituteEnvVars("{{a-b}}", vars);
  assert.equal(result, "{{a-b}}");
  assert.deepEqual(unresolvedKeys, []);
});

test("substituteEnvVars: invalid placeholder names are not matched: {{}}", () => {
  const vars = new Map<string, string>();
  const { result, unresolvedKeys } = substituteEnvVars("{{}}", vars);
  assert.equal(result, "{{}}");
  assert.deepEqual(unresolvedKeys, []);
});

test("substituteEnvVars: falls back to process.env for missing keys", () => {
  const originalValue = process.env.TEST_HARNESS_ENV_FALLBACK;
  process.env.TEST_HARNESS_ENV_FALLBACK = "from-process";
  try {
    const vars = new Map<string, string>();
    const { result, usedKeys, unresolvedKeys } = substituteEnvVars("hello {{TEST_HARNESS_ENV_FALLBACK}}", vars);
    assert.equal(result, "hello from-process");
    assert.ok(usedKeys.has("TEST_HARNESS_ENV_FALLBACK"));
    assert.deepEqual(unresolvedKeys, []);
  } finally {
    if (originalValue === undefined) {
      delete process.env.TEST_HARNESS_ENV_FALLBACK;
    } else {
      process.env.TEST_HARNESS_ENV_FALLBACK = originalValue;
    }
  }
});

test("substituteEnvVars: process.env fallback — key not in vars and not in process.env → unresolved", () => {
  const originalValue = process.env.TEST_HARNESS_TRULY_MISSING;
  delete process.env.TEST_HARNESS_TRULY_MISSING;
  try {
    const vars = new Map<string, string>();
    const { result, unresolvedKeys } = substituteEnvVars("{{TEST_HARNESS_TRULY_MISSING}}", vars);
    assert.equal(result, "{{TEST_HARNESS_TRULY_MISSING}}");
    assert.ok(unresolvedKeys.includes("TEST_HARNESS_TRULY_MISSING"));
  } finally {
    if (originalValue !== undefined) {
      process.env.TEST_HARNESS_TRULY_MISSING = originalValue;
    }
  }
});

test("substituteEnvVars: vars map takes precedence over process.env", () => {
  const originalValue = process.env.TEST_HARNESS_PRECEDENCE;
  process.env.TEST_HARNESS_PRECEDENCE = "from-process";
  try {
    const vars = new Map([["TEST_HARNESS_PRECEDENCE", "from-vars"]]);
    const { result } = substituteEnvVars("{{TEST_HARNESS_PRECEDENCE}}", vars);
    assert.equal(result, "from-vars");
  } finally {
    if (originalValue === undefined) {
      delete process.env.TEST_HARNESS_PRECEDENCE;
    } else {
      process.env.TEST_HARNESS_PRECEDENCE = originalValue;
    }
  }
});

test("substituteEnvVars: single braces are not matched", () => {
  const vars = new Map([["FOO", "bar"]]);
  const { result, usedKeys } = substituteEnvVars("{FOO}", vars);
  assert.equal(result, "{FOO}");
  assert.equal(usedKeys.size, 0);
});

test("substituteEnvVars: triple braces leave extra brace around resolved value", () => {
  const vars = new Map([["FOO", "bar"]]);
  const { result } = substituteEnvVars("{{{FOO}}}", vars);
  // The regex will find {{FOO}} inside "{{{FOO}}}" and replace it
  // Result: "{" + "bar" + "}"
  assert.equal(result, "{bar}");
});

test("substituteEnvVars: empty string input returns empty string", () => {
  const vars = new Map([["FOO", "bar"]]);
  const { result, usedKeys, unresolvedKeys } = substituteEnvVars("", vars);
  assert.equal(result, "");
  assert.equal(usedKeys.size, 0);
  assert.deepEqual(unresolvedKeys, []);
});

test("substituteEnvVars: placeholder value can be empty string", () => {
  const vars = new Map([["EMPTY", ""]]);
  const { result, usedKeys } = substituteEnvVars("before{{EMPTY}}after", vars);
  assert.equal(result, "beforeafter");
  assert.ok(usedKeys.has("EMPTY"));
});

test("substituteEnvVars: placeholder with underscores and numbers in name", () => {
  const vars = new Map([["MY_VAR_2", "works"]]);
  const { result } = substituteEnvVars("{{MY_VAR_2}}", vars);
  assert.equal(result, "works");
});

test("substituteEnvVars: placeholder starting with underscore", () => {
  const vars = new Map([["_PRIVATE", "secret"]]);
  const { result } = substituteEnvVars("{{_PRIVATE}}", vars);
  assert.equal(result, "secret");
});
