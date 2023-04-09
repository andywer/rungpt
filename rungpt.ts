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

const apiKey = await getApiKey();

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

  sock.onmessage = errorHandled(async (ev) => {
    // Handle text message from the client
    console.log("Received message:", ev);
    try {
      const chatGPTResponse = await sendMessageToChatGPT(apiKey, ev.data);
      sock.send(chatGPTResponse);
    } catch (err) {
      console.error(`Failed to send message to ChatGPT: ${err}`);
      sock.send(`Error: ${err.message}`);
    }
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

async function sendMessageToChatGPT(apiKey: string, message: string): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/engines/gpt-4/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: "You are ChatGPT, a large language model trained by OpenAI, based on the GPT-4 architecture." },
        { role: "user", content: message },
      ],
      max_tokens: 150,
      n: 1,
      stop: null,
      temperature: 0.5,
    }),
  });

  const data = await response.json();

  if (response.ok) {
    return data.choices[0].message.content.trim();
  } else {
    throw new Error(`Error in ChatGPT API: ${data.error.message}`);
  }
}

async function getApiKey(): Promise<string> {
  const apiKey = Deno.env.get("RUNGPT_API_KEY");

  if (apiKey) {
    return apiKey;
  } else {
    console.log("Please enter your OpenAI API key:");
    const input = new TextEncoder().encode("RUNGPT_API_KEY=");
    await Deno.stdout.write(input);
    const apiKeyBuffer = new Uint8Array(64); // Assuming a 64-character long API key
    await Deno.stdin.read(apiKeyBuffer);
    const apiKeyString = new TextDecoder().decode(apiKeyBuffer).trim();
    Deno.env.set("RUNGPT_API_KEY", apiKeyString);
    return apiKeyString;
  }
}
