// Import necessary modules
import "https://deno.land/std@0.184.0/dotenv/load.ts";
import { parse } from "https://deno.land/std@0.184.0/flags/mod.ts";
import { JsonStringifyStream } from "https://deno.land/std@0.184.0/json/mod.ts";
import { readableStreamFromIterable } from "https://deno.land/std@0.184.0/streams/readable_stream_from_iterable.ts";
import { Application, Router, send } from "https://deno.land/x/oak@v12.1.0/mod.ts";
import { ChatMessage, MessageType } from "https://esm.sh/langchain/schema";
import { HumanChatMessage } from "https://esm.sh/langchain/schema";
import { ChatMessage as ChatMessageT, ChatRole } from "./chat.d.ts";
import { PluginInstance } from "./plugins.d.ts";
import { installAction } from "./lib/actions.ts";
import { eventStreamFromChatHistory } from "./lib/chat_history.ts";
import { SSEEncoder } from "./lib/stream_transformers.ts";
import { PluginContext, PluginSet } from "./lib/plugins.ts";
import { PluginLoader } from "./lib/plugin_loader.ts";
import { ChatGPTRuntime } from "./lib/runtime.ts";

const appUrl = new URL(import.meta.url);
const appPath = await Deno.realPath(new URL(".", appUrl).pathname);
const pluginsDir = `${appPath}/plugins`;

// Define help text
const helpText = `
RunGPT: Program for running ChatGPT with local plugins

Usage:
  rungpt [options]

Options:
  --help, -h          Show this help message and exit.
  --port, -p <port>   Set the port number for the HTTP server to listen on (default: 8080).
  --install, -i <user/repo>[@version]  Install a plugin from a GitHub repository using the '<user>/<repo>' format and an optional version.
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

// Install plugin if flag is present
if (args.install) {
  const [repo, version] = args.install.split("@");

  if (!repo || !repo.match(/^[a-z0-9-]+\/[a-z0-9-]+$/i)) {
    console.error("Invalid plugin repository format. Use the '<user>/<repo>@<version>' format.");
    Deno.exit(1);
  }
  if (!version || !version.match(/^[a-z0-9\._-]+$/i)) {
    console.error("Invalid plugin version format. Use the '<user>/<repo>@<version>' format.");
    Deno.exit(1);
  }

  try {
    const targetDir = await installAction(pluginsDir, repo, version);
    console.log(`Plugin '${repo}'@${version} installed in '${targetDir}'`);
  } catch (error) {
    console.error(`Failed to install plugin '${repo}': ${error.message}`);
  }
  Deno.exit(0);
}

const loaderContext = new PluginContext(new PluginSet([]));

const loadAllPlugins = async (loader: PluginLoader): Promise<PluginInstance[]> => {
  const plugins: PluginInstance[] = [];
  for await (const plugin of loader.loadPlugins(loaderContext)) {
    plugins.push(plugin);
  }
  return plugins;
};

const pluginLoader = new PluginLoader(pluginsDir);
pluginLoader.events.on("plugin/discovered", (path) => console.debug(`Plugin discovered: ${path}`));
pluginLoader.events.on("plugin/loaded", (plugin) => console.debug(`Plugin ${plugin.metadata.name_for_model} loaded.`));
const enabledPlugins = new PluginSet(await loadAllPlugins(pluginLoader));

const pluginContext = new PluginContext(enabledPlugins);
await pluginContext.secrets.store("api.openai.com", await getApiKey());

console.debug(`Loaded plugins:${enabledPlugins.plugins.map((plugin) => `\n  - ${plugin.metadata.name_for_model}`).join("") || "\n  (None)"}`);
console.debug(`Available tools:${enabledPlugins.tools.list().map((toolName) => `\n  - ${toolName}`).join("") || "\n  (None)"}`);

const runtime = new ChatGPTRuntime();

// Get the port number from the arguments or use the default value
const port = (args.port || args.p || 8080) as number;

console.log(`HTTP server is running on http://localhost:${port}/`);

const app = new Application();
const router = new Router();

const session = await runtime.handleChatCreation(pluginContext);

router.get("/api/chat", (ctx) => {
  const messageHistory = session ? session.chatHistory.getMessages() : [];

  ctx.response.body = messageHistory
    .map(({ actions, createdAt, message }): ChatMessageT => ({
      actions,
      createdAt: createdAt.toISOString(),
      message: {
        ...message,
        role: (message as ChatMessage).role as ChatRole,
        type: message._getType(),
      },
    }));
});

router.get("/api/chat/events", (ctx) => {
  const stream = session
    ? eventStreamFromChatHistory(session.chatHistory)
    : readableStreamFromIterable([]);

  const output = stream
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
  const messageData = body.message as { text: string, type: MessageType } ?? ctx.throw(400, "Missing body parameter: messages");

  session.chatConfig.set("engine", engine);

  const message = new HumanChatMessage(messageData.text);

  ctx.response.status = 200;
  ctx.response.headers.set("Cache-Control", "no-cache");
  ctx.response.headers.set("Content-Type", "text/event-stream");
  ctx.response.body = (await runtime.handleUserMessage(message, session))!
    .pipeThrough(new JsonStringifyStream())
    .pipeThrough(SSEEncoder());
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
