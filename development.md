# Development of RunGPT

RunGPT is largely being planned and implemented by GPT-4 itself.

## Initial planning kick-off prompt

```
Let's create a deno application called "rungpt" that is a CLI program running a local HTTP server, serving a web app that offers an alternative user interface to use ChatGPT via the OpenAI API.

Our application shall provide an important additional functionality: It allows to install and use plugins. A plugin is essentially a GitHub repository containing a metadata file and a web assembly module. It specifies the APIs that the wasm module needs, qualified via a specifier like `<namespace>:<api>`. The namespace can be a plugin identifier or a special namespace for the built-in APIs that come with the runner, like filesystem access.

Each plugin describes parameterised actions that it provides to GPT. GPT can include a snippet marked with a special action-specific tag to invoke the plugin action. GPT knows about the availability of these actions and how to use them, since rungpt sends some system messages about the available actions at the beginning of each new GPT chat. Once rungpt receives output from GPT including such action snippets, it invokes the wasm module of the plugin that provides the action according to the plugin metadata. The (potentially asynchronous) output returned by the wasm module is then sent back to GPT in a new message.

Let's start by planning the development in iterative steps. Each step is either an "epic" or a "story". A story is one atomic feature that can be implemented with a few source code diffs that should ideally not total more than 3,000 tokens. An epic is a larger piece of correlated work, containing other epics or stories. Both epics and stories have a short title and a longer description. Each epic and story have a unique serial number, starting at 1, sharing a common namespace.

We start by formulating the root epic, describing the overall app and the epics/stories it contains (non-recursively). Formulate it as YAML.

You will need to be able to perform the task stated by each story just by the information contained in the story later in a fresh new chat without additional information. The information included in each epic must be enough to formulate the epic's stories with few additional information available.

Mark the end of your full response with "--COMPLETE--". You can pause and ask for further information at any time.
```

## Major updates

### Docker containers for plugins

```
Here is our entire application development plan. Update it to reflect that plugins will not be implemented as wasm modules anymore, but we will rather think in easy-to-create actions as scripts executed in a docker container.

New actions concept:

* Run a docker container and message it to execute an action
  * `/rungpt/actions/<namespace>/<action>/{manifest.json,run}`
  * Run a slim web service that can list and invoke actions
  * Add tool/script to install all actions' required packages
* Actions can be implemented in Python, Node, Deno, … (just install the necessary packages)
* GPT can freely manipulate the container without putting the host machine at risk
* Can selectively share host directories with the container
* Should be able to run additional docker containers that the actions container can access for more specific tasks

Development plan:

<complete initial development plan>
```

```
Feel free to change epic 4, 5 and 6 and their stories, so the development plan makes sense again. Also, actions don't have required APIs, only a setup script or list of required system packages.

The examples in epic 8 can also changed or replaced by better fitting ones.```

```
Rethink epic 6: It could now cover implementing built-in actions for rungpt, like filesystem actions (read file, write file, read directory, …), web actions (browse page, google query, …), system actions (execute shell command, get time and date, …).

The examples in epic 8 don't seem ideal. Actions are intended to be used by the GPT LLM itself to augment its capabilities. A text-to-speech or text-to-image action would make a lot more sense.
```

## Development Plan

```yaml
epic: 1
title: "Develop the rungpt Deno application"
description: "Create a Deno application called 'rungpt' that is a CLI program running a local HTTP server, serving a web app that offers an alternative user interface to use ChatGPT via the OpenAI API. The application should support installing and using actions. An action is essentially a GitHub repository containing a metadata file and a script that runs in a Docker container. Each action describes parameterized tasks that it provides to GPT. GPT can include a snippet marked with a special action-specific tag to invoke the action. Once rungpt receives output from GPT including such action snippets, it runs the Docker container and executes the script of the action according to the action metadata. The (potentially asynchronous) output returned by the Docker container is then sent back to GPT in a new message."
epics:
  - id: 2
  - id: 3
  - id: 4
  - id: 5
  - id: 6
  - id: 8
stories:
  - id: 7
    title: "System messages for available actions"
    description: "Implement a mechanism to automatically send system messages to GPT at the beginning of each new chat session. These messages should inform GPT about the available actions, their parameters, and any constraints. The information should be gathered by parsing the metadata of all installed actions and constructing a system message that represents the actions and their usage."
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
title: "Action system infrastructure"
description: "Design and implement the infrastructure for installing and using actions, including the support for metadata and Docker containers. Actions are specified as '<user>/<repo>' and optionally a version, and installation means cloning the repository to the local filesystem."
stories:
  - id: 17
    title: "Action installation process"
    description: "Implement a process for installing actions from GitHub repositories using the '<user>/<repo>' format and an optional version. Cloning the repository to the local filesystem is the installation process."
  - id: 18
    title: "Action metadata retrieval and validation"
    description: "Create a system for retrieving the action metadata from the cloned GitHub repositories and validating its format and contents."
  - id: 19
    title: "Docker container management"
    description: "Implement a system for managing Docker containers associated with installed actions, including container creation, execution, and cleanup."
  - id: 20
    title: "Setup script or system package requirements"
    description: "Develop a mechanism for handling setup scripts or system package requirements specified in the action metadata, ensuring the necessary dependencies are installed in the Docker container."
```

```yaml
epic: 5
title: "Action invocation"
description: "Implement the mechanism to invoke an action when a special action-specific tag is included in GPT's output."
stories:
  - id: 21
    title: "Action-specific tag parsing"
    description: "Develop a system for detecting and parsing action-specific tags in GPT's output, extracting the relevant action information."
  - id: 22
    title: "Action execution in Docker container"
    description: "Implement a mechanism for executing the specified action's script in the appropriate Docker container based on the parsed action-specific tag."
  - id: 23
    title: "Handling action output"
    description: "Develop a process for handling the (potentially asynchronous) output returned by a Docker container executing an action and forwarding it to GPT in a new message."
```

```yaml
epic: 6
title: "Built-in actions for rungpt"
description: "Develop a set of built-in actions that can be used by the GPT LLM to augment its capabilities, covering filesystem, web, and system actions."
stories:
  - id: 24
    title: "Filesystem actions"
    description: "Implement built-in actions for filesystem access, such as reading and writing files, reading directories, and managing files and directories."
  - id: 25
    title: "Web actions"
    description: "Create built-in actions for web-related tasks, such as browsing web pages, performing Google queries, and interacting with web services and APIs."
  - id: 26
    title: "System actions"
    description: "Develop built-in actions for system-related tasks, such as executing shell commands, retrieving system information, and getting the current time and date."
```

```yaml
epic: 8
title: "Documentation and examples"
description: "Create comprehensive documentation and example actions to demonstrate the functionality and usage of rungpt."
stories:
  - id: 27
    title: "User guide and API documentation"
    description: "Write a user guide covering the installation and usage of rungpt, along with detailed API documentation for action development."
  - id: 28
    title: "Example action: Text-to-speech"
    description: "Create an example action that converts text to speech using a third-party API, demonstrating how the GPT LLM can use actions to augment its capabilities with real-time text-to-speech functionality."
  - id: 29
    title: "Example action: Text-to-image"
    description: "Develop an example action that generates an image based on a textual description, showcasing how the GPT LLM can use actions to create visual representations of text descriptions."
  - id: 30
    title: "Tutorials and best practices"
    description: "Write tutorials on creating custom actions for rungpt and provide best practices for action development, testing, and deployment."
```
