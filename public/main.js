const chatBox = document.getElementById("chat-box");
const chatForm = document.getElementById("chat-form");
const inputMessage = document.getElementById("input-message");

const messages = [];

function formatTime(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function renderNewMessage(message, actions, createdAt) {
  const { text, type, role } = message;
  let classPrefix = "system";

  if (type === "human") {
    classPrefix = "user";
  } else if (type === "ai") {
    classPrefix = "assistant";
  } else if (type === "system") {
    classPrefix = "system";
  } else if (type === "generic") {
    classPrefix = role === "error" ? "error" : "system";
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

  if (type === "ai") {
    const actionsListElement = document.createElement("ul");
    actionsListElement.classList.add("actions");
    contentElement.appendChild(actionsListElement);

    for (const action of actions) {
      renderNewAction(action, actionsListElement);
    }
  }

  const textElement = document.createElement("span");
  textElement.classList.add("text");
  textElement.innerHTML = "…";
  textElement.textContent = text;
  contentElement.appendChild(textElement);

  if (type === "ai") {
    const spinner = document.createElement("span");
    spinner.classList.add("lds-dual-ring");
    spinner.classList.add("spinner");
    contentElement.appendChild(spinner);
  }

  chatBox.appendChild(messageElement);
  chatBox.scrollTop = chatBox.scrollHeight;

  return {
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
    // Send message to server
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          text: message,
          type: "human",
        },
      }),
    });

    await handleSubmissionSSEStream(response.body);
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

async function handleSubmissionSSEStream(stream) {
  let read;
  const reader = stream.pipeThrough(SSEDecoder()).getReader();

  while (!(read = await reader.read()).done) {
    const event = JSON.parse(read.value);
    console.debug(`Received event after message submission:`, event.data);
  }
}

async function initializeMessages() {
  const response = await fetch("/api/chat");

  if (!response.ok) {
    throw new Error(`Unexpected response for GET /api/chat: ${response.status}`);
  }

  for (const { actions = [], createdAt, message } of await response.json()) {
    const msg = renderNewMessage(message, actions, new Date(createdAt));
    messages.push(msg);
  }
}

async function subscribeToChatEvents() {
  const response = await fetch("/api/chat/events");

  if (!response.ok) {
    throw new Error(`Unexpected response for GET /api/chat: ${response.status}`);
  }

  let read;
  const stream = response.body;
  const reader = stream.pipeThrough(SSEDecoder()).getReader();

  while (!(read = await reader.read()).done) {
    const event = JSON.parse(read.value);
    console.debug("Received chat event:", event);

    if (event.type === "message/append") {
      let message;
      if (event.data.messageIndex >= messages.length) {
        message = renderNewMessage({ ...event.data, text: event.data.append }, [], new Date());
        messages[event.data.messageIndex] = message;
      } else {
        message = messages[event.data.messageIndex];
        message.textElement.textContent += event.data.append;
      }
      if (event.data.type === "ai") {
        message.contentElement.classList[event.data.append ? "remove" : "add"]("loading");
      }
    } else if (event.type === "message/finalize") {
      let message;
      if (event.data.messageIndex >= messages.length) {
        message = renderNewMessage(event.data, event.data.actions, new Date());
        messages[event.data.messageIndex] = message;
      } else {
        message = messages[event.data.messageIndex];
        message.textElement.textContent = event.data.text;
      }
      message.contentElement.classList.remove("loading");
    } else if (event.type === "agent/action") {
      const message = messages[event.data.messageIndex];
      renderNewAction(event.data, message.contentElement.querySelector(".actions"));
    } else if (event.type === "error") {
      console.error(event);
    } else {
      console.warn(`Unrecognized event:`, event);
    }
  }
}

initializeMessages().catch((error) => console.error(error));
subscribeToChatEvents().catch((error) => console.error(error));
