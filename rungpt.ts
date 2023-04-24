// Import necessary modules
import "https://deno.land/std@0.184.0/dotenv/load.ts";
import { parse } from "https://deno.land/std@0.184.0/flags/mod.ts";
import { JsonStringifyStream } from "https://deno.land/std@0.184.0/json/mod.ts";
import { iterateReader, mergeReadableStreams, readableStreamFromIterable } from "https://deno.land/std@0.184.0/streams/mod.ts";
import { Application, Router, send } from "https://deno.land/x/oak@v12.1.0/mod.ts";
import { installAction } from "./lib/actions.ts";
import { ChatGPT, ChatMessage } from "./lib/chat_gpt_api.ts";
import { ChatHistory, applyChatEventToHistory } from "./lib/chat_history.ts";
import { ActionContainer, createActionContainer, getExistingActionContainer } from "./lib/docker_manager.ts";
import { ActionExecutionTransformer, ActionTagDecoder, ChatGPTSSEDecoder, DeltaMessageTransformer, ParsedActionTag, SSEEncoder } from "./lib/stream_transformers.ts";
import { ChatEvent, ChatRole, ErrorEvent, EventType, MessageAppendEvent } from "./lib/rungpt_chat_api.ts";

const appUrl = new URL(import.meta.url);
const appPath = await Deno.realPath(new URL(".", appUrl).pathname);
const actionsDir = `${appPath}/actions`;

const dockerImageName = "rungpt_actions:latest";

// Define help text
const helpText = `
RunGPT: Program for running ChatGPT with local plugins

Usage:
  rungpt [options]

Options:
  --help, -h          Show this help message and exit.
  --port, -p <port>   Set the port number for the HTTP server to listen on (default: 8080).
  --install, -i <user/repo>[@version]  Install an action from a GitHub repository using the '<user>/<repo>' format and an optional version.
`;

// Parse command line arguments
const args = parse(Deno.args, {
  alias: { help: "h", port: "p", install: "i" },
  string: ["install"],
});

// Check if help flag is present
if (args.help || args.h) {
  console.log(helpText);
  Deno.exit(0);
}

// Install action if flag is present
if (args.install) {
  const [repo, version] = args.install.split("@");

  if (!repo || !repo.match(/^[a-z0-9-]+\/[a-z0-9-]+$/i)) {
    console.error("Invalid action repository format. Use the '<user>/<repo>@<version>' format.");
    Deno.exit(1);
  }
  if (!version || !version.match(/^[a-z0-9\._-]+$/i)) {
    console.error("Invalid action version format. Use the '<user>/<repo>@<version>' format.");
    Deno.exit(1);
  }

  try {
    const targetDir = await installAction(actionsDir, repo, version);
    console.log(`Action '${repo}'@${version} installed in '${targetDir}'`);
  } catch (error) {
    console.error(`Failed to install action '${repo}': ${error.message}`);
  }
  Deno.exit(0);
}

const apiKey = await getApiKey();
const chatGPT = new ChatGPT(apiKey);

// Get the port number from the arguments or use the default value
const port = (args.port || args.p || 8080) as number;

console.log(`HTTP server is running on http://localhost:${port}/`);

const app = new Application();
const router = new Router();

const chatHistory = new ChatHistory();

router.get("/api/chat", (ctx) => {
  ctx.response.body = chatHistory.getMessages();
});

router.get("/api/chat/events", (ctx) => {
  const output = chatHistory.eventStream()
    .pipeThrough(new JsonStringifyStream())
    .pipeThrough(SSEEncoder());

  ctx.response.status = 200;
  ctx.response.headers.set("Cache-Control", "no-cache");
  ctx.response.headers.set("Content-Type", "text/event-stream");
  ctx.response.body = output;
});

router.post("/api/chat", async (ctx) => {
  const body = await ctx.request.body({ type: "json" }).value;
  const engine = body.engine as string ?? "gpt-3.5-turbo";
  const message = body.message as ChatMessage ?? ctx.throw(400, "Missing body parameter: messages");

  let actionContainer: ActionContainer | undefined;
  const inputActionErrors: ErrorEvent[] = [];

  const invokeAction = (action: ParsedActionTag, handleError: (error: Error) => void): ReadableStream<string> => {
    const decoder = new TextDecoder();
    const stream = new ReadableStream<string>({
      async start(controller) {
        try {
          actionContainer = actionContainer ?? await getExistingActionContainer() ?? await createActionContainer(dockerImageName, `${actionsDir}/installed`);
          await actionContainer.actions.invokeAction(action.action, action.parameters, async (process) => {
            const stdout = process.stdout;
            if (!stdout) {
              return;
            }
            for await (const stdoutChunk of iterateReader(stdout)) {
              controller.enqueue(decoder.decode(stdoutChunk));
            }
          });
        } catch (error) {
          handleError(error);
          controller.close();
        } finally {
          controller.close();
        }
      },
    });
    return stream;
  };

  // Add user message to chat history
  chatHistory.addMessage(message);

  if (message.role === ChatRole.User) {
    let read: ReadableStreamDefaultReadResult<ChatEvent>;
    const inputActions = readableStreamFromIterable([message.content])
      .pipeThrough(ActionTagDecoder())
      .pipeThrough(ActionExecutionTransformer(chatHistory, invokeAction));

    const reader = inputActions.getReader();
    while (!(read = await reader.read()).done) {
      const event = read.value;
      if (event.type === EventType.MessageAppend) {
        applyChatEventToHistory(event, chatHistory);
      } else if (event.type === EventType.Error) {
        inputActionErrors.push(event);
      }
    }
  }

  const gptResponse = await chatGPT.sendMessage(chatHistory.getMessages(), engine);

  if (!gptResponse.body) {
    return ctx.throw(500, "Failed to get response body from ChatGPT API call");
  }

  const responseMessageIndex = chatHistory.addMessage({ content: "", role: ChatRole.Assistant });

  const sseDecoder = ChatGPTSSEDecoder();
  const actionExecutor = ActionExecutionTransformer(chatHistory, invokeAction);
  const messageTransformer = DeltaMessageTransformer(chatHistory, responseMessageIndex, ChatRole.Assistant);

  const responseActionErrors = sseDecoder.actions.pipeThrough(actionExecutor);
  const deltaMsgErrors = sseDecoder.messages.pipeThrough(messageTransformer);

  const errorEvents = mergeReadableStreams(
    readableStreamFromIterable(inputActionErrors),
    responseActionErrors,
    deltaMsgErrors,
  );

  const output = errorEvents
    .pipeThrough(new JsonStringifyStream())
    .pipeThrough(SSEEncoder());

  ctx.response.status = 200;
  ctx.response.headers.set("Cache-Control", "no-cache");
  ctx.response.headers.set("Content-Type", "text/event-stream");
  ctx.response.body = output;

  gptResponse.body.pipeTo(sseDecoder.ingress);
});

app.use(async (ctx, next) => {
  const { request } = ctx;
  if (request.url.pathname === "/" || request.url.pathname.match(/\w+\.\w+$/)) {
    // Serve static assets
    await send(ctx, request.url.pathname, {
      root: `${Deno.cwd()}/public`,
      index: "index.html",
    });
  } else {
    // Continue to next middleware
    await next();
  }
});

app.use(router.routes());
app.use(router.allowedMethods());

await app.listen({ port: port });

async function getApiKey(): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");

  if (apiKey) {
    return apiKey;
  } else {
    console.log("Please enter your OpenAI API key:");
    const input = new TextEncoder().encode("OPENAI_API_KEY=");
    await Deno.stdout.write(input);
    const apiKeyBuffer = new Uint8Array(51); // Assuming a 51-character long API key
    await Deno.stdin.read(apiKeyBuffer);
    const apiKeyString = new TextDecoder().decode(apiKeyBuffer).trim();
    Deno.env.set("OPENAI_API_KEY", apiKeyString);
    return apiKeyString;
  }
}
