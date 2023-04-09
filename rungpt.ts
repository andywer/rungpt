// Import necessary modules
import { parse } from "https://deno.land/std/flags/mod.ts";
import { Application, Router, send } from "https://deno.land/x/oak/mod.ts";

// Parse command line arguments
const args = parse(Deno.args);

// Define help text
const helpText = `
RunGPT: Program for running ChatGPT with local plugins

Usage:
  rungpt [options]

Options:
  --help, -h          Show this help message and exit.
  --port, -p <port>   Set the port number for the HTTP server to listen on (default: 8080).
`;

// Check if help flag is present
if (args.help || args.h) {
  console.log(helpText);
  Deno.exit(0);
}

// Get the port number from the arguments or use the default value
const port = args.port || args.p || 8080;

async function handleWs(sock: WebSocket): Promise<void> {
  const errorHandled = <F extends (...args: any[]) => any>(fn: F): F => {
    return ((...args: any[]) => {
      try {
        return fn(...args);
      } catch (err) {
        console.error(`Failed to handle WebSocket event: ${err}`);
      }
    }) as F;
  };

  sock.onopen = errorHandled(() => {
    console.log("WebSocket connection established");
  });

  sock.onmessage = errorHandled((ev) => {
    // Handle text message from the client
    console.log("Received message:", ev);
  });

  sock.onclose = (ev) => {
    // Handle WebSocket close event
    const { code, reason } = ev;
    console.log("WebSocket closed:", code, reason);
  };
}

console.log(`HTTP server is running on http://localhost:${port}/`);

const app = new Application();
const router = new Router();

router.get("/ws", async (ctx) => {
  try {
    if (!ctx.isUpgradable) {
      ctx.throw(501);
    }
    const socket = ctx.upgrade();
    await handleWs(socket);
  } catch (err) {
    console.error(`Failed to upgrade websocket: ${err}`);
    ctx.response.body = "Websocket request was not valid.";
    ctx.response.status = 400;
  }
});

app.use(async (ctx, next) => {
  const { request, response } = ctx;
  if (request.url.pathname.startsWith("/ws")) {
    await next();
  } else {
    // Serve static assets
    await send(ctx, request.url.pathname, {
      root: `${Deno.cwd()}/public`,
      index: "index.html",
    });
  }
});

app.use(router.routes());
app.use(router.allowedMethods());

await app.listen({ port: port });
