const chatBox = document.getElementById("chat-box");
const chatForm = document.getElementById("chat-form");
const inputMessage = document.getElementById("input-message");

const messages = [];

function formatTime(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function renderNewMessage(message) {
  const { text, role } = message.message;
  const createdAt = new Date(message.createdAt);
  let classPrefix = "system";

  if (role === "user") {
    classPrefix = "user";
  } else if (role === "assistant") {
    classPrefix = "assistant";
  } else if (role === "system") {
    classPrefix = "system";
  } else if (role === "error") {
    classPrefix = "error";
  } else {
    console.error(`Unrecognized type: ${type}`);
  }

  const messageElement = document.createElement("div");
  messageElement.classList.add("chat-message");
  messageElement.classList.add(`${classPrefix}-message`);

  const timestampElement = document.createElement("span");
  timestampElement.classList.add("timestamp");
  timestampElement.textContent = formatTime(createdAt);
  messageElement.appendChild(timestampElement);

  const contentElement = document.createElement("span");
  contentElement.classList.add("content");
  messageElement.appendChild(contentElement);

  if (role === "assistant") {
    const actionsListElement = document.createElement("ul");
    actionsListElement.classList.add("actions");
    contentElement.appendChild(actionsListElement);

    for (const action of message.actions) {
      renderNewAction(action, actionsListElement);
    }
  }

  const textElement = document.createElement("span");
  textElement.classList.add("text");
  textElement.innerHTML = "…";
  textElement.textContent = text;
  contentElement.appendChild(textElement);

  if (role === "assistant") {
    const spinner = document.createElement("span");
    spinner.classList.add("lds-dual-ring");
    spinner.classList.add("spinner");
    contentElement.appendChild(spinner);
  }

  chatBox.appendChild(messageElement);
  chatBox.scrollTop = chatBox.scrollHeight;

  return {
    actions: message.actions,
    contentElement,
    messageElement,
    textElement,
  };
}

function renderNewAction(action, actionsListElement) {
  const actionElement = document.createElement("li");
  actionElement.classList.add("action");

  const toolElement = document.createElement("span");
  toolElement.classList.add("tool");
  toolElement.textContent = action.tool;

  const inputElement = document.createElement("span");
  inputElement.classList.add("input");
  inputElement.textContent = action.input;

  actionElement.appendChild(toolElement);
  actionElement.appendChild(inputElement);
  actionsListElement.appendChild(actionElement);

  if (action.result) {
    const outputElement = document.createElement("span");
    outputElement.classList.add("output");
    outputElement.textContent = action.result;

    actionElement.appendChild(outputElement);
  }
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const message = inputMessage.value.trim();
  if (message.length === 0) {
    return;
  }

  // Clear the input field
  inputMessage.value = "";

  (async () => {
    if (!window.currentChat) {
      // Create a new chat session first
      const sessionID = String(Math.random()).slice(-8);
      const response = await fetch(`/api/session/${sessionID}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chain: "chat",
          model: "chatgpt-3.5",
          tools: ["*"],
        }),
      });

      if (!response.ok) {
        throw new Error(`Unexpected response for POST /api/session/${sessionID}: ${response.status}`);
      }

      const session = await response.json();
      dispatchEvent(new ChatSessionCreationEvent(session));
      dispatchEvent(new ChatSessionSelectionEvent(session));
    }

    // Send message to server
    const response = await fetch(`/api/session/${window.currentChat.id}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          text: message,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Unexpected response for POST /api/session/${sessionID}: ${response.status}`);
    }
  })().catch((error) => console.error(error));
});

inputMessage.addEventListener("keypress", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.dispatchEvent(new Event("submit"));
  }
});

function SSEDecoder() {
  let buffer = "";
  const decoder = new TextDecoder();

  // Define a custom transform function for the TransformStream
  const transform = (chunk, controller) => {
    const chunkStr = decoder.decode(chunk);
    buffer += chunkStr;

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data:")) {
        const data = line.slice(5).trim();
        controller.enqueue(data);
      }
    }
  };

  // Define a custom flush function to handle any remaining data in the buffer
  const flush = (controller) => {
    if (buffer && buffer.startsWith("data:")) {
      const data = buffer.slice(5).trim();
      controller.enqueue(data);
    }
  };

  return new TransformStream({ transform, flush });
}

async function initializeMessages(sessionID) {
  const response = await fetch(`/api/session/${sessionID}`);

  if (!response.ok) {
    throw new Error(`Unexpected response for GET /api/chat: ${response.status}`);
  }

  const session = await response.json();
  chatBox.innerHTML = "";

  for (const message of session.messages) {
    const msg = renderNewMessage(message);
    messages.push(msg);
  }

  chatBox.scrollTop = chatBox.scrollHeight - chatBox.clientHeight;
}

async function subscribeToChatEvents(sessionID) {
  const response = await fetch(`/api/session/${sessionID}/events`);

  if (!response.ok) {
    throw new Error(`Unexpected response for GET /api/chat: ${response.status}`);
  }

  let read;
  const stream = response.body;
  const reader = stream.pipeThrough(SSEDecoder()).getReader();

  while (!(read = await reader.read()).done) {
    if (window.currentChat?.id !== sessionID) {
      return;
    }

    const isScrolledDown = chatBox.scrollTop >= chatBox.scrollHeight - chatBox.clientHeight;
    const event = JSON.parse(read.value);
    console.debug("Received chat event:", event);

    if (event.type === "message/added" || event.type === "message/updated" || event.type === "message/finalized") {
      let message;
      if (event.payload.index >= messages.length) {
        message = renderNewMessage(event.payload);
        messages[event.payload.index] = message;
      } else {
        message = messages[event.payload.index];
        message.textElement.textContent = event.payload.message.text;
      }
      if (event.payload.message.role === "assistant" && event.type === "message/added") {
        message.contentElement.classList.add("loading");
      }
      if (event.payload.message.role === "assistant" && event.payload.message.text) {
        message.contentElement.classList.remove("loading");
      }
      if (event.type === "message/finalized") {
        message.contentElement.classList.remove("loading");
      }

      if (message.actions.length > 0 && !message.actions[message.actions.length - 1].result && event.payload.actions[message.actions.length - 1].result) {
        // Trigger re-rendering of the last action
        message.actions = message.actions.slice(0, -1);
        message.contentElement.querySelector(".tool").remove();
      }

      const newActions = event.payload.actions.slice(message.actions.length);
      for (const action of newActions) {
        renderNewAction(action, message.contentElement.querySelector(".actions"));
      }
      message.actions = event.payload.actions;
    } else if (event.type === "chain/run/error") {
      console.error(event.payload.error);
    } else {
      console.warn(`Unrecognized event:`, event);
    }

    if (isScrolledDown) {
      chatBox.scrollTop = chatBox.scrollHeight - chatBox.clientHeight;
    }
  }
}

addEventListener("chatSessionSelected", (event) => {
  window.currentChat = event.session;
  initializeMessages(event.session.id).catch((error) => console.error(error));
  subscribeToChatEvents(event.session.id).catch((error) => console.error(error));
});
