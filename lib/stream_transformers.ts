import { JsonParseStream } from "https://deno.land/std@0.184.0/json/mod.ts";
import { readableStreamFromIterable } from "https://deno.land/std@0.184.0/streams/readable_stream_from_iterable.ts";
import { ChatHistory, ChatMessage, ParameterType, Parameters, ParsedCodeBlockTag } from "../plugins.d.ts";
import { mergeReadableStreams } from "https://deno.land/std@0.184.0/streams/merge_readable_streams.ts";
import { AnsiStripper } from "./ansi.ts";

// Add a regular expression for detecting action-specific tags
const ACTION_INVOCATION_REGEX = /(\w+)\s*((?:\w+\s*=\s*[^,=\s]+(?:,\s*)?)*\w*\s*(?:\((?:[^{}()]|\([^{}()]*\))*\))?)/;

export interface ParsedActionInvocation {
  action: string;
  parameters: Parameters;
}

export interface DeltaMessage {
  choices: {
    delta: {
      content: string;
    };
  }[];
}

export function ProcessMessageContent<T>(decode: (input: ReadableStream<string>) => ReadableStream<T>): TransformStream<ChatMessage, [T, ChatMessage]> {
  return new TransformStream<ChatMessage, [T, ChatMessage]>({
    async transform(message, controller) {
      let read: ReadableStreamDefaultReadResult<T>;
      const decoding = decode(readableStreamFromIterable([message.content]));
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

export function ActionInvocationDecoder(): TransformStream<ParsedCodeBlock, ParsedActionInvocation> {
  return new TransformStream<ParsedCodeBlock, ParsedActionInvocation>({
    transform(block, controller) {
      if (block.tag !== "rungpt:action") return;

      const errors: Error[] = [];
      const lines = block.content.split("\n");

      for (const line of lines.filter(line => line.trim().length > 0)) {
        try {
          const match = ACTION_INVOCATION_REGEX.exec(line);

          if (!match) {
            throw new Error(`Invalid action invocation: ${line}`);
          }

          const [, action, paramList] = match;
          controller.enqueue({
            action,
            parameters: parseParameters(paramList),
          });
        } catch (error) {
          errors.push(error);
        }
      }

      if (errors.length > 0) {
        throw errors[0];
      }
    },
  });
}

export interface ParsedTaggedCodeBlock {
  block: ParsedCodeBlock;
  tag: ParsedCodeBlockTag
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

function DeltaMessageContentDecoder(message: ChatMessage): TransformStream<DeltaMessage, ChatMessage> {
  return new TransformStream<DeltaMessage, ChatMessage>({
    transform(data, controller) {
      const { content } = data.choices[0].delta;
      controller.enqueue({
        ...message,
        content: message.content + content ?? "",
      });
    },
  });
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

export function StreamCloser(closeString: string): TransformStream<string, string> {
  let closed = false;

  return new TransformStream({
    transform(chunk: string, controller: TransformStreamDefaultController<string>) {
      if (closed) return;

      if (chunk === closeString) {
        closed = true;
      } else {
        controller.enqueue(chunk);
      }
    },
  });
}

export function DeltaMessageTransformer(chatHistory: ChatHistory, messageIndex: number): TransformStream<DeltaMessage, Error> {
  return new TransformStream({
    async transform(chunk: DeltaMessage) {
      if (!chunk.choices[0].delta.content) return;

      await chatHistory.appendToMessage(messageIndex, chunk.choices[0].delta.content);
    },
  });
}

export function streamExecutedCommand(process: Deno.Process<{ cmd: string[], stderr: "piped", stdout: "piped" }>): ReadableStream<string> {
  type Marking = "STDOUT" | "STDERR";
  type MarkedChunk = [Marking, string];

  let prevChunkType: Marking | null = null;

  const MarkChunkAs = (marking: Marking) => new TransformStream<string, MarkedChunk>({
    transform(chunk, controller) {
      controller.enqueue([marking, chunk]);
    },
  });

  const stdout = process.stdout.readable
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(AnsiStripper())
    .pipeThrough(MarkChunkAs("STDOUT"));
  const stderr = process.stderr.readable
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(AnsiStripper())
    .pipeThrough(MarkChunkAs("STDERR"));

  const output = new TransformStream<MarkedChunk, string>({
    transform([type, chunk], controller) {
      if (prevChunkType !== type) {
        controller.enqueue(`${prevChunkType === null ? "" : "\n"}---${type}---\n`);
      }
      controller.enqueue(chunk);
      prevChunkType = type;
    },
    async flush(controller) {
      const status = await process.status();
      controller.enqueue(`\n---EXIT---\nExit code ${status.code}\n`);
    }
  });

  mergeReadableStreams(stdout, stderr).pipeThrough(output);
  return output.readable;
}

export interface ChatGPTSSETransformer {
  ingress: WritableStream<Uint8Array>;
  messages: ReadableStream<DeltaMessage>;
  tags: ReadableStream<ParsedTaggedCodeBlock>;
}

export function ChatGPTSSEDecoder(message: ChatMessage): ChatGPTSSETransformer {
  let latestMessageContent = "";

  const sseDecoder = SSEDecoder();
  const rawMessages = sseDecoder.readable
    .pipeThrough(StreamCloser("[DONE]"))
    .pipeThrough(new JsonParseStream()) as unknown as ReadableStream<DeltaMessage>;

  const [rawMessages1, rawMessages2] = rawMessages.tee();
  const tags = rawMessages2
    .pipeThrough(DeltaMessageContentDecoder(message))
    .pipeThrough(new TransformStream({
      transform(msg) {
        latestMessageContent = msg.content;
      },
      flush(controller) {
        if (!latestMessageContent) return;
        controller.enqueue(latestMessageContent);
      },
    }))
    .pipeThrough(MarkdownCodeBlockDecoder(true))
    .pipeThrough(TagInvocationBlockDecoder())

  return {
    ingress: sseDecoder.writable,
    messages: rawMessages1,
    tags,
  };
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

export function OnStreamValue<T>(callback: (value: T) => void): TransformStream<T, T> {
  return new TransformStream({
    transform(value: T, controller: TransformStreamDefaultController<T>) {
      try {
        callback(value);
      } finally {
        controller.enqueue(value);
      }
    },
  });
}
