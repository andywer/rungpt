// Import necessary modules
import { parse } from "https://deno.land/std/flags/mod.ts";
import { Application, Router, send } from "https://deno.land/x/oak/mod.ts";
import { ChatGPT } from "./chat_gpt_api.ts";

const appUrl = new URL(import.meta.url);
const appPath = await Deno.realPath(new URL(".", appUrl).pathname);

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
  await installPlugin(repo, version);
  Deno.exit(0);
}

const apiKey = await getApiKey();
const chatGPT = new ChatGPT(apiKey);

// Get the port number from the arguments or use the default value
const port = (args.port || args.p || 8080) as number;

console.log(`HTTP server is running on http://localhost:${port}/`);

const app = new Application();
const router = new Router();

router.post("/api/chat", async (ctx) => {
  const body = await ctx.request.body({ type: "json" }).value;
  const engine = body.engine as string ?? "gpt-3.5-turbo";
  const message = body.message as string ?? ctx.throw(400, "Missing body parameter: message");

  const gptResponse = await chatGPT.sendMessage(message, engine);

  if (!gptResponse.body) {
    return ctx.throw(500, "Failed to get response body from ChatGPT API call");
  }

  ctx.response.status = 200;
  ctx.response.headers.set("Cache-Control", "no-cache");
  ctx.response.headers.set("Content-Type", gptResponse.headers.get("Content-Type")!);
  ctx.response.body = gptResponse.body;
});

app.use(async (ctx, next) => {
  const { request, response } = ctx;
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
  const apiKey = Deno.env.get("RUNGPT_API_KEY");

  if (apiKey) {
    return apiKey;
  } else {
    console.log("Please enter your OpenAI API key:");
    const input = new TextEncoder().encode("RUNGPT_API_KEY=");
    await Deno.stdout.write(input);
    const apiKeyBuffer = new Uint8Array(51); // Assuming a 51-character long API key
    await Deno.stdin.read(apiKeyBuffer);
    const apiKeyString = new TextDecoder().decode(apiKeyBuffer).trim();
    Deno.env.set("RUNGPT_API_KEY", apiKeyString);
    return apiKeyString;
  }
}

async function installPlugin(repo: string, version?: string): Promise<void> {
  const [user, repoName] = repo.split("/");
  const versionString = version ? `#${version}` : "";
  const installUrl = `https://github.com/${user}/${repoName}.git${versionString}`;

  const pluginsDir = `${appPath}/plugins`;
  const targetDir = `${pluginsDir}/${user}_${repoName}${version ? `_${version}` : ""}`;

  try {
    await Deno.mkdir(pluginsDir, { recursive: true });
    await Deno.run({
      cmd: ["git", "clone", "--depth", "1", installUrl, targetDir],
    }).status();
    console.log(`Plugin '${repo}'${version ? `@${version}` : ""} installed in '${targetDir}'`);
  } catch (error) {
    console.error(`Failed to install plugin '${repo}': ${error.message}`);
  }
}
