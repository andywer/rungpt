const chatBox = document.getElementById("chat-box");
const chatForm = document.getElementById("chat-form");
const inputMessage = document.getElementById("input-message");

const socket = new WebSocket("ws://localhost:8080/ws");

socket.onopen = (event) => {
  console.log("WebSocket connection established:", event);
};

function formatTime(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

socket.onmessage = (event) => {
  console.debug("WebSocket message received:", event);

  const messageData = JSON.parse(event.data);
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
  contentElement.textContent = role === "user" ? `You: ${content}` : `GPT: ${content}`;
  messageElement.appendChild(contentElement);

  chatBox.appendChild(messageElement);
  chatBox.scrollTop = chatBox.scrollHeight;
};

socket.onclose = (event) => {
  console.log("WebSocket connection closed:", event);
};

socket.onerror = (error) => {
  console.log("WebSocket error:", error);
};

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = inputMessage.value.trim();
  if (message.length === 0) {
    return;
  }

  // Send the message to the server
  socket.send(JSON.stringify({ role: "user", content: message }));

  // Clear the input field
  inputMessage.value = "";
});

inputMessage.addEventListener("input", (event) => {
  // Remove leading and trailing whitespace
  event.target.value = event.target.value.trimStart().replace(/\s\s+/g, " ");
});
