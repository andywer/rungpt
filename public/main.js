const chatBox = document.getElementById("chat-box");
const chatForm = document.getElementById("chat-form");
const inputMessage = document.getElementById("input-message");

const socket = new WebSocket("ws://localhost:8080/ws");

socket.onopen = (event) => {
  console.log("WebSocket connection established:", event);
};

socket.onmessage = (event) => {
  const message = event.data;
  const messageElement = document.createElement("div");
  messageElement.textContent = `GPT: ${message}`;
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
  socket.send(message);

  // Add the message to the chat box
  const messageElement = document.createElement("div");
  messageElement.textContent = `You: ${message}`;
  chatBox.appendChild(messageElement);
  chatBox.scrollTop = chatBox.scrollHeight;

  // Clear the input field
  inputMessage.value = "";
});

inputMessage.addEventListener("input", (event) => {
  // Remove leading and trailing whitespace
  event.target.value = event.target.value.trimStart().replace(/\s\s+/g, " ");
});
