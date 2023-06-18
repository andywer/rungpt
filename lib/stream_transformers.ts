import { readableStreamFromIterable } from "std/streams/readable_stream_from_iterable.ts";
import { BaseChatMessage } from "langchain/schema";
import { ParameterType, Parameters, ParsedCodeBlockTag } from "../types/plugins.d.ts";

export function ProcessMessageContent<T>(decode: (input: ReadableStream<string>) => ReadableStream<T>): TransformStream<BaseChatMessage, [T, BaseChatMessage]> {
  return new TransformStream<BaseChatMessage, [T, BaseChatMessage]>({
    async transform(message, controller) {
      let read: ReadableStreamDefaultReadResult<T>;
      const decoding = decode(readableStreamFromIterable([message.text]));
      const reader = decoding.getReader();

      while ((read = await reader.read()) && !read.done) {
        controller.enqueue([read.value, message]);
      }
    },
  });
}

export interface ParsedCodeBlock {
  content: string;
  tag: string;
}

// Input strings must be a complete message / document at a time!
export function MarkdownCodeBlockDecoder(consecutiveUpdates = false): TransformStream<string, ParsedCodeBlock> {
  let latestProcessedLineIndex = -1;
  return new TransformStream<string, ParsedCodeBlock>({
    transform(text, controller) {
      let lines = text.split("\n");

      if (consecutiveUpdates) {
        lines = lines.slice(latestProcessedLineIndex + 1);
      }

      while(lines.length > 0) {
        const startLineIndex = lines.findIndex(line => line.startsWith("```"));
        if (startLineIndex === -1) break;

        const startLine = lines[startLineIndex];
        lines = lines.slice(startLineIndex + 1);

        const tag = startLine.slice(3);
        const endLineIndex = lines.findIndex(line => line.startsWith("```"));

        if (endLineIndex === -1) {
          if (consecutiveUpdates) {
            break;
          } else {
            throw new Error(`Invalid code block: Missing end line for tag '${tag}'`);
          }
        }

        const content = lines.slice(0, endLineIndex).join("\n");
        latestProcessedLineIndex = endLineIndex;
        controller.enqueue({ tag, content });
        lines.splice(0, endLineIndex + 1);
      }
    },
  });
}

export interface ParsedTaggedCodeBlock {
  block: ParsedCodeBlock;
  tag: ParsedCodeBlockTag;
}

export function TagInvocationBlockDecoder(): TransformStream<ParsedCodeBlock, ParsedTaggedCodeBlock> {
  return new TransformStream<ParsedCodeBlock, ParsedTaggedCodeBlock>({
    transform(block, controller) {
      if (!block.tag.includes(";") && !block.tag.includes("(")) return;
      const tag = parseCodeBlockTag(block.tag);
      controller.enqueue({ block, tag });
    },
  });
}

function parseCodeBlockTag(raw: string): ParsedCodeBlockTag {
  // FIXME: This will fail in a subtle way if there is a tag invocation
  //        with a string parameter that contains a semicolon
  const fragments = raw.split(";").map(frag => frag.trim());
  const [language, additional] = fragments[0].includes("(")
    ? ["", fragments]
    : [fragments[0], fragments.slice(1)];
  return {
    language,
    additional: additional.map(frag => {
      let invocation: ParsedCodeBlockTag["additional"][number]["invocation"];
      if (frag.includes("(")) {
        const [name, paramList] = frag.split("(");
        invocation = {
          name: name.trim(),
          parameters: parseParameters(paramList),
        };
      }
      return {
        invocation,
        raw: frag,
      };
    }),
  };
}

function parseParameters(parameterString: string): Parameters {
  const namedParamRegex = /(\w+)\s*=\s*(?:(["'])(.*?[^\\])\2|(\w+|-?\d+(\.\d+)?))/g;
  const unnamedParamRegex = /(?:(["'])(.*?[^\\])\1|(\w+|-?\d+(\.\d+)?))/g;

  const parameters: Record<string, ParameterType> = { };
  const positional: ParameterType[] = [];

  let match;
  while ((match = namedParamRegex.exec(parameterString)) !== null) {
    const [wholeMatch, key, , stringValue, primitiveValue] = match;
    if (stringValue !== undefined) {
      parameters[key] = stringValue.replace(/\\(["'])/g, '$1');
    } else if (primitiveValue === 'true' || primitiveValue === 'false') {
      parameters[key] = primitiveValue === 'true';
    } else if (!isNaN(Number(primitiveValue))) {
      parameters[key] = Number(primitiveValue);
    } else {
      parameters[key] = primitiveValue;
    }
    parameterString = parameterString.replace(wholeMatch, "");
    namedParamRegex.lastIndex -= wholeMatch.length;
  }

  while ((match = unnamedParamRegex.exec(parameterString)) !== null) {
    const [, , stringValue, primitiveValue] = match;
    if (stringValue !== undefined) {
      positional.push(stringValue.replace(/\\(["'])/g, '$1'));
    } else if (primitiveValue === 'true' || primitiveValue === 'false') {
      positional.push(primitiveValue === 'true');
    } else if (!isNaN(Number(primitiveValue))) {
      positional.push(Number(primitiveValue));
    } else {
      positional.push(primitiveValue);
    }
  }

  return { ...parameters, _: positional } as Parameters;
}

/**
 * A transform stream that decodes a stream of raw SSE data into
 * a stream of data event payloads.
 */
export function SSEDecoder(): TransformStream<Uint8Array, string> {
  let buffer = "";
  const decoder = new TextDecoder();

  // Define a custom transform function for the TransformStream
  const transform = (chunk: Uint8Array, controller: TransformStreamDefaultController<string>) => {
    const chunkStr = decoder.decode(chunk);
    buffer += chunkStr;

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data:")) {
        const data = line.slice(5).trim();
        controller.enqueue(data);
      }
    }
  };

  // Define a custom flush function to handle any remaining data in the buffer
  const flush = (controller: TransformStreamDefaultController<string>) => {
    if (buffer && buffer.startsWith("data:")) {
      const data = buffer.slice(5).trim();
      controller.enqueue(data);
    }
  };

  return new TransformStream({ transform, flush });
}

/**
 * A transform stream that encodes a stream of data event payloads into
 * a stream of raw SSE data.
 */
export function SSEEncoder(): TransformStream<string, Uint8Array> {
  const encoder = new TextEncoder();

  return new TransformStream({
    transform(chunk: string, controller: TransformStreamDefaultController<Uint8Array>) {
      controller.enqueue(encoder.encode(`data: ${chunk}`));
    },
  });
}

export function OnStreamEnd<T>(callback: () => Promise<ReadableStream<T>> | ReadableStream<T>): TransformStream<T, T> {
  let done = false;
  return new TransformStream({
    async flush(controller: TransformStreamDefaultController<T>) {
      if (done) return;
      done = true;

      let read: ReadableStreamDefaultReadResult<T>;
      const reader = (await callback()).getReader();

      while (!(read = await reader.read()).done) {
        controller.enqueue(read.value);
      }
    },
  });
}
