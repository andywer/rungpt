import { assertEquals } from "https://deno.land/std@0.184.0/testing/asserts.ts";
import { ActionTagDecoder, ChatGPTSSEDecoder, DeltaMessage, ParsedActionTag } from "../lib/stream_transformers.ts";

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

function toStream(text: string): ReadableStream {
  return new ReadableStream<string>({
    start(controller) {
      controller.enqueue(text);
      controller.close();
    }
  });
}

Deno.test("tag substitution works", async (t) => {
  const transform = async (input: string): Promise<ParsedActionTag[]> => {
    const decoder = ActionTagDecoder();
    toStream(input).pipeTo(decoder.writable);
    const captured = await collectAll(decoder.readable);
    return captured;
  };

  await t.step("can substitute a single tag", async () => {
    assertEquals(
      await transform(`Hello {{concat("World")}}!`),
      [{ action: "concat", parameters: { _: ["World"] }, source: `{{concat("World")}}` }],
    );
  });

  await t.step("can substitute different kinds of parameters", async () => {
    assertEquals(
      await transform(`Hello {{test()}}!`),
      [{ action: "test", parameters: { _: [] }, source: `{{test()}}` }],
    );
    assertEquals(
      await transform(`{{concat("Hello", "World", delimiter="_")}}`),
      [{ action: "concat", parameters: { _: ["Hello", "World"], delimiter: "_" }, source: `{{concat("Hello", "World", delimiter="_")}}` }],
    );
    assertEquals(
      await transform(`{{add(1, -2, 5)}}`),
      [{ action: "add", parameters: { _: [1, -2, 5] }, source: `{{add(1, -2, 5)}}` }],
    );
  });
});

Deno.test("SSE stream parsing works", async () => {
  const sse = mockDeltaMessagesSSEStream([
    { choices: [{ delta: { content: "Hello" } }] },
    { choices: [{ delta: { content: " world!" } }] },
    { choices: [{ delta: { content: " {{test()}}" } }] },
  ]);

  const decoder = ChatGPTSSEDecoder();
  sse.pipeTo(decoder.ingress);

  const [actions, messages] = await Promise.all([
    collectAll(decoder.actions),
    collectAll(decoder.messages),
  ]);

  assertEquals(actions, [
    { action: "test", parameters: { _: [] }, source: `{{test()}}` },
  ]);

  assertEquals(messages, [
    { choices: [{ delta: { content: "Hello" } }] },
    { choices: [{ delta: { content: " world!" } }] },
    { choices: [{ delta: { content: " {{test()}}" } }] },
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
