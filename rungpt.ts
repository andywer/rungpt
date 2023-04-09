// Import necessary modules
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
