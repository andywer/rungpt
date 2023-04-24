# RunGPT

Amplifying GPT's capabilities by giving it access to **locally executed plugins**.

Why? So you can control what GPT should have access to: Access to parts of the local filesystem, allow it to access the internet, give it a docker container to use.

🚧 **Under construction** 🚧

The idea is for Auto-GPT, MemoryGPT, BabyAGI & co to be plugins for RunGPT, providing their capabilities and more together under one common framework.

Since the chat I/O is augmented, you as a user can also use the same features, for example include file contents in your prompt:

```
Let's continue implementing the chat functionality. Here is what we have so far:

{{ read_file("./lib/chat.ts") }}
```

Basically a locally run proxy to the OpenAI API with a plugin system and its own locally served chat UI.

## Development

Planned and mostly coded by GPT-4 itself. Development progress is tracked here:

👉 [Development Tracking Issue #1](https://github.com/andywer/rungpt/issues/1)

Check out [development.md](./development.md) to see the current planning of the development as epics and stories and the prompts that created them.

## Installation

1. Install [Deno](https://deno.land/) if you haven't already.
2. Clone this repository.

## Usage

The RunGPT application requires the following permissions:

- `--allow-net`: To make HTTP requests to the OpenAI API and listen for incoming connections to the local HTTP server.
- `--allow-read`: To read the API key from the environment and access local files.
- `--allow-write`: To create the plugins directory and write plugin files.
- `--allow-env`: To access the environment variable containing the API key.
- `--allow-run`: To run external commands, such as `git`, for installing plugins.

Run the application with the required permissions:

```sh
deno run --allow-net --allow-read --allow-write --allow-env --allow-run rungpt.ts
```

Visit `http://localhost:8080` in your browser to use the web app.

## Development

```sh
make docker-build
make test
```
