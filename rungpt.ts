// Import necessary modules
import "std/dotenv/load.ts";
import { parse } from "std/flags/mod.ts";
import { JsonStringifyStream } from "std/json/mod.ts";
import { Application, Router, send } from "oak/mod.ts";
import { z } from "zod";
import { SSEEncoder } from "./lib/stream_transformers.ts";
import { installPlugin } from "./lib/plugins.ts";
import { loadRuntime } from "./lib/runtime.ts";
import { ChatRole } from "./types/chat.d.ts";
import { ISODateTimeString, SessionID } from "./types/types.d.ts";

const appUrl = new URL(import.meta.url);
const appPath = await Deno.realPath(new URL(".", appUrl).pathname);
const appStateFile = `${appPath}/app_state.json`;
const pluginsDir = `${appPath}/plugins`;
const sessionsRootDir = `${appPath}/sessions`;

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
    const targetDir = await installPlugin(pluginsDir, repo, version);
    console.log(`Plugin '${repo}'@${version} installed in '${targetDir}'`);
  } catch (error) {
    console.error(`Failed to install plugin '${repo}': ${error.message}`);
  }
  Deno.exit(0);
}

const runtime = await loadRuntime(appStateFile, sessionsRootDir);
await runtime.init(pluginsDir);

console.debug(`Loaded plugins:${runtime.plugins.map((plugin) => `\n  - ${plugin.metadata.name}`).join("") || "\n  (None)"}`);
console.debug(`Available chains:${Array.from(runtime.features.chains.keys()).map((id) => `\n  - ${id}`).join("") || "\n  (None)"}`);
console.debug(`Available models:${Array.from(runtime.features.models.keys()).map((id) => `\n  - ${id}`).join("") || "\n  (None)"}`);
console.debug(`Available tools:${Array.from(runtime.features.tools.keys()).map((toolName) => `\n  - ${toolName}`).join("") || "\n  (None)"}`);

// Get the port number from the arguments or use the default value
const port = (args.port || args.p || 8080) as number;

console.log(`HTTP server is running on http://localhost:${port}/`);

const app = new Application();
const router = new Router();

router.get("/api/app", (ctx) => {
  ctx.response.body = {
    features: {
      chains: Array.from(runtime.features.chains.keys()),
      models: Array.from(runtime.features.models.keys()),
      tools: Array.from(runtime.features.tools.keys()),
    },
    plugins: Object.fromEntries(
      runtime.plugins.map((plugin) => [plugin.metadata.name, plugin.metadata])
    ),
    state: runtime.store.getState(),
  };
});

router.get("/api/session/:id", async (ctx) => {
  const session = await runtime.readSession(ctx.params.id as SessionID);
  if (!session) {
    return ctx.throw(404, "Session not found");
  }

  ctx.response.body = session.store.getState();
});

router.get("/api/session/:id/events", async (ctx) => {
  let unsubscribe: (() => void) | undefined;
  const session = await runtime.readSession(ctx.params.id as SessionID) || ctx.throw(404, "Session not found");

  const stream = new ReadableStream<Record<string, unknown>>({
    start(controller) {
      unsubscribe = session.store.subscribe((_state, event) => {
        controller.enqueue(event);
      });
    },
    cancel() {
      if (unsubscribe) {
        unsubscribe();
      }
    }
  });

  const output = stream
    .pipeThrough(new JsonStringifyStream())
    .pipeThrough(SSEEncoder());

  ctx.response.status = 200;
  ctx.response.headers.set("Cache-Control", "no-cache");
  ctx.response.headers.set("Content-Type", "text/event-stream");
  ctx.response.body = output;
});

router.post("/api/session/:id", async (ctx) => {
  const body = await ctx.request.body({ type: "json" }).value;

  const config = z.object({
    chain: z.string().brand("ChainID"),
    model: z.string().brand("ModelID"),
    tools: z.array(z.union([
      z.string().brand("ToolID"),
      z.literal("*"),
    ])),
  }).parse(body);

  if (!body.chain) {
    ctx.throw(400, "Missing body parameter: chain");
  }
  if (!body.model) {
    ctx.throw(400, "Missing body parameter: model");
  }
  if (!body.tools) {
    ctx.throw(400, "Missing body parameter: tools");
  }

  const session = await runtime.createSession(ctx.params.id as SessionID, config);
  ctx.response.body = session.store.getState();
});

router.post("/api/session/:id/message", async (ctx) => {
  const body = await ctx.request.body({ type: "json" }).value;
  const message = z.object({
    role: z.string().default("user").transform((role) => role as ChatRole),
    text: z.string(),
  }).parse(body.message);

  const session = await runtime.readSession(ctx.params.id as SessionID) || ctx.throw(404, "Session not found");
  const prevMessages = session.store.getState().messages;

  const [_updatedState, execution] = session.store.dispatch({
    type: "message/added",
    payload: {
      actions: [],
      createdAt: new Date().toISOString() as ISODateTimeString,
      index: prevMessages.length,
      message,
    },
  });

  await execution;

  ctx.response.status = 204;
  ctx.response.body = "";
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
