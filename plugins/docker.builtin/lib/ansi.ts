export function stripAnsi(input: string): string {
  // This regex pattern will match ANSI escape sequences
  const ansiRegex = new RegExp(
    [
      "(?:\\u001B\\[|\\u009B)" + // ESC [
      "(?:(?:\\d{1,3}(?:(?:;\\d{0,3}){0,3})[A-PRZcf-ntqry=><~])|" + // CSI ... Command
      "(?:\\d{1,4}(?:;\\d{0,4}){0,3})?[cf-ntqry=><~])" // Control Sequence Introducer (CSI) or OSC
    ].join(""),
    "g"
  );

  return input.replace(ansiRegex, "");
}

export function AnsiStripper(): TransformStream<string, string> {
  return new TransformStream<string, string>({
    transform(chunk: string, controller: TransformStreamDefaultController<string>) {
      // Enqueue the transformed chunk
      controller.enqueue(stripAnsi(chunk));
    },
  });
}
