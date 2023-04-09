const chatBox = document.getElementById("chat-box");
const chatForm = document.getElementById("chat-form");
const inputMessage = document.getElementById("input-message");

const socket = new WebSocket("ws://localhost:8080/ws");

socket.onopen = (event) => {
  console.log("WebSocket connection established:", event);
};

socket.onmessage = (event) => {
  console.debug("WebSocket message received:", event);

  const messageData = JSON.parse(event.data);
  const { role, content } = messageData;
  const messageElement = document.createElement("div");

  if (role === "user") {
    messageElement.textContent = `You: ${content}`;
  } else {
    messageElement.textContent = `GPT: ${content}`;
  }

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
