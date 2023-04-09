# Development of RunGPT

RunGPT is largely being planned and implemented by GPT-4 itself.

## Initial planning kick-off prompt

```
Let's create a deno application called "rungpt" that is a CLI program running a local HTTP server, serving a web app that offers an alternative user interface to use ChatGPT via the OpenAI API.

Our application shall provide an important additional functionality: It allows to install and use plugins. A plugin is essentially a GitHub repository containing a YAML metadata file and a web assembly module. It specifies the APIs that the wasm module needs, qualified via a specifier like `<namespace>:<api>`. The namespace can be a plugin identifier or a special namespace for the built-in APIs that come with the runner, like filesystem access.

Each plugin describes parameterised actions that it provides to GPT. GPT can include a snippet marked with a special action-specific tag to invoke the plugin action. GPT knows about the availability of these actions and how to use them, since rungpt sends some system messages about the available actions at the beginning of each new GPT chat. Once rungpt receives output from GPT including such action snippets, it invokes the wasm module of the plugin that provides the action according to the plugin metadata. The (potentially asynchronous) output returned by the wasm module is then sent back to GPT in a new message.

Let's start by planning the development in iterative steps. Each step is either an "epic" or a "story". A story is one atomic feature that can be implemented with a few source code diffs that should ideally not total more than 3,000 tokens. An epic is a larger piece of correlated work, containing other epics or stories. Both epics and stories have a short title and a longer description. Each epic and story have a unique serial number, starting at 1, sharing a common namespace.

We start by formulating the root epic, describing the overall app and the epics/stories it contains (non-recursively). Formulate it as YAML.

You will need to be able to perform the task stated by each story just by the information contained in the story later in a fresh new chat without additional information. The information included in each epic must be enough to formulate the epic's stories with few additional information available.

Mark the end of your full response with "--COMPLETE--". You can pause and ask for further information at any time.
```

## Development Plan

```yaml
epic: 1
title: "Develop the rungpt Deno application"
description: "Create a Deno application called 'rungpt' that is a CLI program running a local HTTP server, serving a web app that offers an alternative user interface to use ChatGPT via the OpenAI API. The application should support installing and using plugins. A plugin is essentially a GitHub repository containing a YAML metadata file and a web assembly module. Each plugin describes parameterized actions that it provides to GPT. GPT can include a snippet marked with a special action-specific tag to invoke the plugin action. Once rungpt receives output from GPT including such action snippets, it invokes the wasm module of the plugin that provides the action according to the plugin metadata. The (potentially asynchronous) output returned by the wasm module is then sent back to GPT in a new message."
epics:
  - id: 2
  - id: 3
  - id: 4
  - id: 5
  - id: 6
  - id: 8
stories:
  - id: 7
  - title: "System messages for available actions"
  - description: "Implement a mechanism to automatically send system messages to GPT at the beginning of each new chat session. These messages should inform GPT about the available plugin actions, their parameters, and any constraints. The information should be gathered by parsing the metadata of all installed plugins and constructing a system message that represents the actions and their usage."

```

```yaml
epic: 2
title: "Create a basic CLI program and local HTTP server"
description: "Implement a Deno CLI program that runs a local HTTP server and serves a basic web app."
stories:
  - id: 9
    title: "Setup Deno CLI program"
    description: "Create a Deno CLI program with command line argument parsing and basic help documentation."
  - id: 10
    title: "Implement local HTTP server"
    description: "Create a local HTTP server using Deno's standard library, listening on a configurable port."
  - id: 11
    title: "Serve static web app assets"
    description: "Setup the HTTP server to serve static web app assets, such as HTML, CSS, and JavaScript files."
  - id: 12
    title: "Basic web app structure"
    description: "Design and implement a basic web app structure with a user interface to initiate and display ChatGPT conversations."
```

```yaml
epic: 3
title: "Implement ChatGPT API integration"
description: "Add the ability to communicate with the ChatGPT API from the web app and display the conversation."
stories:
  - id: 13
    title: "API key configuration"
    description: "Implement a method for configuring and securely storing the OpenAI API key required for ChatGPT API access."
  - id: 14
    title: "ChatGPT API wrapper"
    description: "Develop a wrapper around the ChatGPT API for easier interaction and handling of API requests and responses."
  - id: 15
    title: "Web app integration with ChatGPT API"
    description: "Integrate the ChatGPT API wrapper with the web app, enabling users to send messages and receive responses from ChatGPT."
  - id: 16
    title: "Display conversation in web app"
    description: "Implement a user interface component in the web app to display the conversation with ChatGPT, including messages sent by the user and responses from ChatGPT."
```

```yaml
epic: 4
title: "Plugin system infrastructure"
description: "Design and implement the infrastructure for installing and using plugins, including the support for metadata and wasm modules. Plugins are specified as '<user>/<repo>' and optionally a version, and installation means cloning the repository to the local filesystem."
stories:
  - id: 17
    title: "Plugin installation process"
    description: "Implement a process for installing plugins from GitHub repositories using the '<user>/<repo>' format and an optional version. Cloning the repository to the local filesystem is the installation process."
  - id: 18
    title: "Plugin metadata retrieval and validation"
    description: "Create a system for retrieving the plugin metadata from the cloned GitHub repositories and validating its format and contents."
  - id: 19
    title: "Wasm module loading and management"
    description: "Implement a system for loading and managing wasm modules from the cloned GitHub repositories associated with installed plugins."
  - id: 20
    title: "Plugin API registration and access"
    description: "Develop a mechanism for registering and accessing the APIs required by plugins, as specified in the plugin metadata."
```

```yaml
epic: 5
title: "Plugin action invocation"
description: "Implement the mechanism to invoke a plugin's action when a special action-specific tag is included in GPT's output."
stories:
  - id: 21
    title: "Action-specific tag parsing"
    description: "Develop a system for detecting and parsing action-specific tags in GPT's output, extracting the relevant plugin and action information."
  - id: 22
    title: "Plugin action execution"
    description: "Implement a mechanism for executing the specified action from the appropriate plugin's wasm module based on the parsed action-specific tag."
  - id: 23
    title: "Handling action output"
    description: "Develop a process for handling the (potentially asynchronous) output returned by a plugin action's wasm module and forwarding it to GPT in a new message."
```

```yaml
epic: 6
title: "Built-in APIs for plugins"
description: "Develop a set of built-in APIs that can be used by plugins, such as filesystem access."
stories:
  - id: 24
    title: "Filesystem access API"
    description: "Implement a built-in API for providing filesystem access to plugins, including operations like reading and writing files."
  - id: 25
    title: "Networking API"
    description: "Create a built-in API for networking operations, allowing plugins to perform HTTP requests and other network-related tasks."
  - id: 26
    title: "Plugin configuration API"
    description: "Develop a built-in API to handle plugin-specific configuration, such as reading and writing plugin configuration files."
  - id: 27
    title: "API registration and management"
    description: "Implement a system for registering and managing built-in APIs, allowing plugins to declare the APIs they require and access them at runtime."
```

```yaml
epic: 8
title: "Documentation and examples"
description: "Create comprehensive documentation and example plugins to demonstrate the functionality and usage of rungpt."
stories:
  - id: 28
    title: "User guide and API documentation"
    description: "Write a user guide covering the installation and usage of rungpt, along with detailed API documentation for plugin development."
  - id: 29
    title: "Example plugin: Text transformation"
    description: "Create an example plugin that performs text transformation, such as converting text to uppercase or lowercase, demonstrating the use of plugin actions and built-in APIs."
  - id: 30
    title: "Example plugin: Weather information"
    description: "Develop an example plugin that fetches weather information based on user input, showcasing the use of plugin actions and networking API."
  - id: 31
    title: "Tutorials and best practices"
    description: "Write tutorials on creating custom plugins for rungpt and provide best practices for plugin development, testing, and deployment."
```
