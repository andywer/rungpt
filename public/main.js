const chatBox = document.getElementById("chat-box");
const chatForm = document.getElementById("chat-form");
const inputMessage = document.getElementById("input-message");

let messages = [];

function formatTime(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function renderNewMessage(content, role) {
  const messageElement = document.createElement("div");
  messageElement.classList.add("chat-message");
  messageElement.classList.add(`${role}-message`);

  const timestampElement = document.createElement("span");
  timestampElement.classList.add("timestamp");
  timestampElement.textContent = formatTime(new Date());
  messageElement.appendChild(timestampElement);

  const contentElement = document.createElement("span");
  contentElement.classList.add("content");
  contentElement.innerHTML = "…";
  contentElement.textContent = content;
  messageElement.appendChild(contentElement);

  chatBox.appendChild(messageElement);
  chatBox.scrollTop = chatBox.scrollHeight;

  return {
    contentElement,
    messageElement,
  };
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
          content: message,
          role: "user",
        },
      }),
    });

    await handleErrorSSEStream(response.body);
  })().catch((error) => console.error(error));
});

inputMessage.addEventListener("input", (event) => {
  // Remove leading and trailing whitespace
  event.target.value = event.target.value.trimStart().replace(/\s\s+/g, " ");
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

async function handleErrorSSEStream(stream) {
  let read;
  const reader = stream.pipeThrough(SSEDecoder()).getReader();

  while (!(read = await reader.read()).done) {
    const event = JSON.parse(read.value);
    console.error(`Received error event:`, event.data.message);
  }
}

async function initializeMessages() {
  const response = await fetch("/api/chat");

  if (!response.ok) {
    throw new Error(`Unexpected response for GET /api/chat: ${response.status}`);
  }

  for (const { content, role } of await response.json()) {
    const msg = renderNewMessage(content, role);
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
      if (event.data.index >= messages.length) {
        const msg = renderNewMessage(event.data.append, event.data.role);
        messages[event.data.index] = msg;
      } else {
        const message = messages[event.data.index];
        message.contentElement.textContent += event.data.append;
      }
    } else if (event.type === "error") {
      console.error(event);
    } else {
      console.warn(`Unrecognized event:`, event);
    }
  }
}

initializeMessages().catch((error) => console.error(error));
subscribeToChatEvents().catch((error) => console.error(error));
