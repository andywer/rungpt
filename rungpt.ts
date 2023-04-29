// Import necessary modules
import "https://deno.land/std@0.184.0/dotenv/load.ts";
import { parse } from "https://deno.land/std@0.184.0/flags/mod.ts";
import { JsonStringifyStream } from "https://deno.land/std@0.184.0/json/mod.ts";
import { Application, Router, send } from "https://deno.land/x/oak@v12.1.0/mod.ts";
import { ChatMessage, PluginInstance } from "./plugins.d.ts";
import { installAction } from "./lib/actions.ts";
import { AutoInitialMessages, InMemoryChatHistory, eventStreamFromChatHistory } from "./lib/chat_history.ts";
import { SSEEncoder } from "./lib/stream_transformers.ts";
import { ChatRole } from "./lib/rungpt_chat_api.ts";
import { AccessControlList, PluginContext, PluginSet } from "./lib/plugins.ts";
import { PluginLoader } from "./lib/plugin_loader.ts";
import { fail } from "https://deno.land/std@0.184.0/testing/asserts.ts";

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

const loadAllPlugins = async (loader: PluginLoader): Promise<PluginInstance[]> => {
  const plugins: PluginInstance[] = [];
  for await (const plugin of loader.loadPlugins()) {
    plugins.push(plugin);
  }
  return plugins;
};

const pluginLoader = new PluginLoader(pluginsDir);
pluginLoader.events.on("plugin/discovered", (path) => console.debug(`Plugin discovered: ${path}`));
pluginLoader.events.on("plugin/loaded", (plugin) => console.debug(`Plugin ${plugin.metadata.name_for_model} loaded.`));
const enabledPlugins = new PluginSet(await loadAllPlugins(pluginLoader));

const chatHistory = AutoInitialMessages(
  new InMemoryChatHistory(),
  [{
    content: `
Hello GPT-3.5!

Execute sandboxed Linux shell commands using triple backtick sh;rungpt snippets. You have full access and permission for data fetching, internet usage, and APIs.

    Example:
\`\`\`sh;rungpt
cat "/tmp/test.txt"
\`\`\`
`.trim(),
    role: ChatRole.System,
  }],
);

const acl: AccessControlList = [
  { resource: ["filesystem", Deno.cwd()], permissions: ["read"] },
  { resource: ["filesystem", "/etc/*"], permissions: ["read"] },
];

const pluginContext = new PluginContext(enabledPlugins, chatHistory, acl);
await pluginContext.secrets.store("api.openai.com", await getApiKey());

const runtime = pluginContext.enabledPlugins.runtimes.get("default") || fail("Default runtime not found");

// Get the port number from the arguments or use the default value
const port = (args.port || args.p || 8080) as number;

console.log(`HTTP server is running on http://localhost:${port}/`);

const app = new Application();
const router = new Router();

router.get("/api/chat", (ctx) => {
  ctx.response.body = chatHistory.getMessages();
});

router.get("/api/chat/events", (ctx) => {
  const output = eventStreamFromChatHistory(chatHistory)
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

  // FIXME: Derive a context for every request and set request-specific values there
  pluginContext.chatConfig.set("engine", engine);

  // Add user message to chat history
  chatHistory.addMessage(message);

  ctx.response.status = 200;
  ctx.response.headers.set("Cache-Control", "no-cache");
  ctx.response.headers.set("Content-Type", "text/event-stream");
  ctx.response.body = (await runtime.userMessageReceived!(message, pluginContext))!
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
