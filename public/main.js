const chatBox = document.getElementById("chat-box");
const chatForm = document.getElementById("chat-form");
const inputMessage = document.getElementById("input-message");

function formatTime(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

async function renderMessage(messageData) {
  const { role, content } = messageData;
  const messageElement = document.createElement("div");
  messageElement.classList.add("chat-message");
  messageElement.classList.add(role === "user" ? "user-message" : "gpt-message");

  const timestampElement = document.createElement("span");
  timestampElement.classList.add("timestamp");
  timestampElement.textContent = formatTime(new Date());
  messageElement.appendChild(timestampElement);

  const contentElement = document.createElement("span");
  contentElement.classList.add("content");
  contentElement.innerHTML = "…";
  messageElement.appendChild(contentElement);

  chatBox.appendChild(messageElement);
  chatBox.scrollTop = chatBox.scrollHeight;

  if (content instanceof ReadableStream) {
    let read;
    const decoder = new TextDecoder();
    const reader = content.getReader();
    contentElement.textContent = "";

    while (!(read = await reader.read()).done) {
      const chunk = decoder.decode(read.value);
      const lines = chunk.split("\n").filter((line) => line.startsWith("data:"));
      for (const line of lines) {
        const data = JSON.parse(line.replace(/^data:\s*/, ""));
        const { content } = data.choices[0].delta;
        contentElement.textContent += content ?? "";
      }
    }
  } else {
    contentElement.textContent = content;
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
    // Render user message
    await renderMessage({ role: "user", content: message });

    // Send message to server
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    });

    await renderMessage({ role: "gpt", content: response.body });
  })().catch((error) => console.error(error));
});

inputMessage.addEventListener("input", (event) => {
  // Remove leading and trailing whitespace
  event.target.value = event.target.value.trimStart().replace(/\s\s+/g, " ");
});
