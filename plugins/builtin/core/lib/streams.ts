const lastCharOf = (str: string) => str[str.length - 1];

async function* processStream(input: ReadableStream<string>): AsyncGenerator<string> {
  let actionSeen = false;
  let partialJson = "";
  let inString = false;
  let streaming = false;
  const reader = input.getReader();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      let output = "";
      for (const char of value) {
        // Poor man's JSON streaming parser
        if (!inString && char === ',' && partialJson.match(/"action":\s*"Final Answer"$/)) {
          actionSeen = true;
        } else if (!inString && char === '"') {
          const prevChar = lastCharOf(partialJson.trimEnd());
          if (prevChar === ':') {
            inString = true;
            streaming = actionSeen && partialJson.match(/"action_input":\s*$/) ? true : false;
            actionSeen = false;
            partialJson += char;
            continue;
          }
        } else if (inString && char === '"') {
          const trailingBackslashes = partialJson.match(/\\+$/)?.[0].length ?? 0;
          if (trailingBackslashes % 2 === 0) {
            inString = false;
            streaming = false;
          }
        }

        partialJson += char;

        if (streaming) {
          output += char;
        }
      }

      if (output) {
        yield output;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function processJsonStream(input: ReadableStream<string>): ReadableStream<string> {
  const readableStream = new ReadableStream({
    async start(controller) {
      for await (const value of processStream(input)) {
        controller.enqueue(value);
      }
      controller.close();
    }
  });

  return readableStream;
}

export function JsonStringEscapeSeqDecoder(): TransformStream<string, string> {
  let buffered = "";

  return new TransformStream({
    transform(chunk, controller) {
      let output = "";
      for (const char of chunk) {
        if (!buffered && char !== "\\") {
          output += char;
        } else {
          buffered += char;
          if (buffered.length > 1) {
            switch (buffered[1]) {
              case "n": {
                output += "\n";
                buffered = "";
                break;
              }
              case "r": {
                output += "\r";
                buffered = "";
                break;
              }
              default: {
                output += buffered[1];
                buffered = "";
                break;
              }
            }
          }
        }
      }
      controller.enqueue(output);
    },
  });
}
