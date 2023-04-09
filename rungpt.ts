// Import necessary modules
import { serve } from "https://deno.land/std@0.114.0/http/server.ts";
import { acceptWebSocket, isWebSocketCloseEvent, isWebSocketPingEvent, WebSocket } from "https://deno.land/std@0.114.0/ws/mod.ts";
import { parse } from "https://deno.land/std/flags/mod.ts";

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
  console.log("WebSocket connection established");
  try {
    for await (const ev of sock) {
      if (typeof ev === "string") {
        // Handle text message from the client
        console.log("Received message:", ev);
      } else if (isWebSocketPingEvent(ev)) {
        const [, body] = ev;
        // Respond to WebSocket ping event
        console.log("WebSocket ping:", body);
      } else if (isWebSocketCloseEvent(ev)) {
        // Handle WebSocket close event
        const { code, reason } = ev;
        console.log("WebSocket closed:", code, reason);
      }
    }
  } catch (err) {
    console.error(`Failed to handle WebSocket connection: ${err}`);
  } finally {
    await sock.close(1000).catch(console.error);
  }
}

console.log(`HTTP server is running on http://localhost:${port}/`);
const handler = async (req: Request): Promise<Response> => {
  try {
    const { url, headers } = req;
    const upgrade = headers.get("upgrade");

    if (upgrade && upgrade.toLowerCase() === "websocket") {
      // Handle WebSocket connection
      const { conn, r: bufReader, w: bufWriter } = req as any;
      const ws = await acceptWebSocket({
        conn,
        bufReader,
        bufWriter,
        headers,
      });

      await handleWs(ws);
      return new Response(null, { status: 101 });
    } else {
      // Handle other types of requests
      return new Response("Not found", { status: 404 });
    }
  } catch (error) {
    console.error("Error while handling request:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
};
serve(handler, { addr: `:${port}` });
