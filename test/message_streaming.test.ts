// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "https://deno.land/std@0.184.0/testing/asserts.ts";
import { ActionInvocationDecoder, ChatGPTSSEDecoder, DeltaMessage, MarkdownCodeBlockDecoder, ParsedActionInvocation, ParsedTaggedCodeBlock, TagInvocationBlockDecoder } from "../lib/stream_transformers.ts";
import { readableStreamFromIterable } from "https://deno.land/std@0.184.0/streams/readable_stream_from_iterable.ts";

const codeblock = (tag: string, content: string) => "```" + tag + "\n" + content + "\n```";

async function collectAll<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const result: T[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    result.push(value);
  }
  return result;
}

function toStream(text: string): ReadableStream<string> {
  return readableStreamFromIterable([text]);
}

Deno.test("action invocation decoder works", async (t) => {
  const transform = async (input: string): Promise<ParsedActionInvocation[]> => {
    const decoder = ActionInvocationDecoder();
    const stream = toStream(input).pipeThrough(MarkdownCodeBlockDecoder()).pipeThrough(decoder);
    const captured = await collectAll(stream);
    return captured;
  };

  await t.step("can decode a code block with a single invocation", async () => {
    assertEquals(
      await transform(codeblock("rungpt:action", `concat("World")`)),
      [{ action: "concat", parameters: { _: ["World"] } as any }],
    );
  });
  await t.step("can decode a code block with multiple invocations", async () => {
    assertEquals(
      await transform(codeblock("rungpt:action", `test1()\n\ntest2()`)),
      [
        { action: "test1", parameters: { _: [] } as any },
        { action: "test2", parameters: { _: [] } as any },
      ],
    );
  });

  await t.step("can decode different kinds of parameters", async () => {
    assertEquals(
      await transform(codeblock("rungpt:action", `test()`)),
      [{ action: "test", parameters: { _: [] } as any }],
    );
    assertEquals(
      await transform(codeblock("rungpt:action", `concat("Hello", "World", delimiter="_")`)),
      [{ action: "concat", parameters: { _: ["Hello", "World"], delimiter: "_" } as any }],
    );
    assertEquals(
      await transform(codeblock("rungpt:action", `add(1, -2, 5)`)),
      [{ action: "add", parameters: { _: [1, -2, 5] } as any }],
    );
  });
});

Deno.test("tag invocation decoder works", async (t) => {
  const transform = async (input: string): Promise<ParsedTaggedCodeBlock[]> => {
    const decoder = TagInvocationBlockDecoder();
    const stream = toStream(input).pipeThrough(MarkdownCodeBlockDecoder()).pipeThrough(decoder);
    const captured = await collectAll(stream);
    return captured;
  };

  await t.step("can decode a standard tag invocation code block", async () => {
    assertEquals(
      await transform(codeblock(`typescript;write_file("./test.ts")`, `console.log("Hello, World!")`)),
      [{
        block: {
          content: `console.log("Hello, World!")`,
          tag: `typescript;write_file("./test.ts")`,
        },
        tag: {
          language: "typescript",
          additional: [{
            invocation: {
              name: "write_file",
              parameters: { _: ["./test.ts"] } as any,
            },
            raw: `write_file("./test.ts")`,
          }],
        },
      }],
    );
  });

  await t.step("can decode a tag invocation code block without language", async () => {
    assertEquals(
      await transform(codeblock(`write_file("./test.ts")`, `console.log("Hello, World!")`)),
      [{
        block: {
          content: `console.log("Hello, World!")`,
          tag: `write_file("./test.ts")`,
        },
        tag: {
          language: "",
          additional: [{
            invocation: {
              name: "write_file",
              parameters: { _: ["./test.ts"] } as any,
            },
            raw: `write_file("./test.ts")`,
          }],
        },
      }],
    );
  });

  await t.step("ignores code blocks without tag invocations", async () => {
    assertEquals(
      await transform(codeblock("", `concat("World")`)),
      [],
    );
    assertEquals(
      await transform(codeblock("rungpt:action", `concat("World")`)),
      [],
    );
  });
});

Deno.test("SSE stream parsing works", async () => {
  const sse = mockDeltaMessagesSSEStream([
    { choices: [{ delta: { content: "Hello" } }] },
    { choices: [{ delta: { content: " world!\n```rungpt:action\ntest()\n```\n" } }] },
  ]);

  const decoder = ChatGPTSSEDecoder({ content: "", role: "user" });
  sse.pipeTo(decoder.ingress);

  // const [actions, messages] = await Promise.all([
  //   collectAll(decoder.actions),
  //   collectAll(decoder.messages),
  //   collectAll(decoder.tags),
  // ]);

  // assertEquals(actions.map(([tag]) => tag), [
  //   { action: "test", parameters: { _: [] } as any },
  // ]);

  const messages = await collectAll(decoder.messages);

  assertEquals(messages, [
    { choices: [{ delta: { content: "Hello" } }] },
    { choices: [{ delta: { content: " world!\n```rungpt:action\ntest()\n```\n" } }] },
  ]);
});

function mockDeltaMessagesSSEStream(messages: DeltaMessage[]): ReadableStream {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const message of messages) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
      }
      controller.close();
    }
  });
}
