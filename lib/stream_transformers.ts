import { JsonParseStream } from "https://deno.land/std@0.184.0/json/mod.ts";
import { ChatRole, ErrorEvent, EventType } from "./rungpt_chat_api.ts";
import { ChatHistory } from "./chat_history.ts";

// Add a regular expression for detecting action-specific tags
const ACTION_TAG_REGEX = /\{\{(\w+)\s*((?:\w+\s*=\s*[^,=\s]+(?:,\s*)?)*\w*\s*(?:\((?:[^{}()]|\([^{}()]*\))*\))?)\}\}/;

type ParsedParameter = string | number | boolean;

type ParsedParameters = {
  // `ParsedParameter[]` is necessary for positional parameters under key `_`
  [key: string]: ParsedParameter | ParsedParameter[];
};

export interface ParsedActionTag {
  action: string;
  parameters: ParsedParameters;
  source: string;
}

export interface DeltaMessage {
  choices: {
    delta: {
      content: string;
    };
  }[];
}

export function ActionTagDecoder(): TransformStream<string, ParsedActionTag> {
  const tagRegex = new RegExp(ACTION_TAG_REGEX.source, ACTION_TAG_REGEX.flags + "g");
  let lastIndexProcessed = 0;
  let totalContent = "";

  return new TransformStream<string, ParsedActionTag>({
    transform(content, controller) {
      try {
        // Append content to totalContent
        totalContent += content;

        // Update lastIndexProcessed
        tagRegex.lastIndex = lastIndexProcessed;

        // Parse and handle action-specific tags
        let match;
        while ((match = tagRegex.exec(totalContent)) !== null) {
          try {
            const action = match[1];
            const parameters = parseParameters(match[2]);
            controller.enqueue({ action, parameters, source: match[0] });
          } finally {
            // Update lastIndexProcessed to the current match end index
            lastIndexProcessed = tagRegex.lastIndex;
          }
        }
      } catch (err) {
        console.error(err);
      }
    },
  });
}

export function DeltaMessageContentDecoder(): TransformStream<DeltaMessage, string> {
  return new TransformStream<DeltaMessage, string>({
    transform(data, controller) {
      const { content } = data.choices[0].delta;
      controller.enqueue(content ?? "");
    },
  });
}

function parseParameters(parameterString: string): ParsedParameters {
  const namedParamRegex = /(\w+)\s*=\s*(?:(["'])(.*?[^\\])\2|(\w+|-?\d+(\.\d+)?))/g;
  const unnamedParamRegex = /(?:(["'])(.*?[^\\])\1|(\w+|-?\d+(\.\d+)?))/g;

  const parameters: ParsedParameters = { };
  const positional: ParsedParameter[] = [];

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

  return { ...parameters, _: positional } as ParsedParameters;
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

export function DeltaMessageTransformer(chatHistory: ChatHistory, messageIndex: number, role: ChatRole): TransformStream<DeltaMessage, ErrorEvent> {
  return new TransformStream({
    transform(chunk: DeltaMessage) {
      if (!chunk.choices[0].delta.content) return;

      chatHistory.appendToMessage(messageIndex, chunk.choices[0].delta.content);
    },
  });
}

export function ActionExecutionTransformer(
  chatHistory: ChatHistory,
  invokeAction: (action: ParsedActionTag, handleError: (error: Error) => void) => ReadableStream<string>,
  role: ChatRole = ChatRole.System,
): TransformStream<ParsedActionTag, ErrorEvent> {
  return new TransformStream({
    async transform(action: ParsedActionTag, controller: TransformStreamDefaultController<ErrorEvent>) {
      const handleError = (error: Error) => {
        console.error(error);
        controller.enqueue({
          type: EventType.Error,
          data: {
            message: error.message,
          },
        });
      };

      try {
        const actionOutput = invokeAction(action, handleError);
        const messageIndex = chatHistory.addMessage({
          content: "",
          role,
        });

        let read: ReadableStreamDefaultReadResult<string>;
        const reader = actionOutput.getReader();

        while (!(read = await reader.read()).done) {
          chatHistory.appendToMessage(messageIndex, read.value);
        }
      } catch (error) {
        handleError(error);
      } finally {
        controller.terminate();
      }
    },
  });
}

export interface ChatGPTSSETransformer {
  actions: ReadableStream<ParsedActionTag>;
  ingress: WritableStream<Uint8Array>;
  messages: ReadableStream<DeltaMessage>;
}

export function ChatGPTSSEDecoder(): ChatGPTSSETransformer {
  const sseDecoder = SSEDecoder();
  const doneDecoder = StreamCloser("[DONE]");
  const jsonDecoder = new JsonParseStream();
  const deltaMsgDecoder = DeltaMessageContentDecoder();
  const actionTagDecoder = ActionTagDecoder();

  const messages = sseDecoder.readable
    .pipeThrough(doneDecoder)
    .pipeThrough(jsonDecoder) as unknown as ReadableStream<DeltaMessage>;

  const [messages1, messages2] = messages.tee();
  const actions = messages1.pipeThrough(deltaMsgDecoder).pipeThrough(actionTagDecoder);

  return {
    actions,
    ingress: sseDecoder.writable,
    messages: messages2,
  };
}
