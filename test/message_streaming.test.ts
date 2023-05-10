// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "https://deno.land/std@0.184.0/testing/asserts.ts";
import { MarkdownCodeBlockDecoder, ParsedTaggedCodeBlock, TagInvocationBlockDecoder } from "../lib/stream_transformers.ts";
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
