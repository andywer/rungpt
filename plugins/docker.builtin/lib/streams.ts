import { mergeReadableStreams } from "https://deno.land/std@0.184.0/streams/merge_readable_streams.ts";
import { AnsiStripper } from "./ansi.ts";

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
