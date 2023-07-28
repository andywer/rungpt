window.currentChat = null;

const chatList = document.getElementById("chat-list");

// deno-lint-ignore no-unused-vars
class ChatSessionCreationEvent extends Event {
  constructor(session) {
    super("chatSessionCreated", {});
    this.session = session;
  }
}

class ChatSessionSelectionEvent extends Event {
  constructor(session) {
    super("chatSessionSelected", {});
    this.session = session;
  }
}

function renderChatListItem(session) {
    const { id, title } = session;

    const chatListItem = document.createElement("li");
    chatListItem.classList.add("chat-list-item");
    chatListItem.dataset.id = id;
    chatListItem.setAttribute("role", "button");

    if (id === window.currentChat?.id) {
      chatListItem.classList.add("chat-list-item--selected");
    }

    chatListItem.addEventListener("click", () => {
      window.currentChat = session;
      dispatchEvent(new ChatSessionSelectionEvent(session));
    });

    const chatListItemName = document.createElement("div");
    chatListItemName.classList.add("chat-list-item-title");
    chatListItemName.textContent = title;
    chatListItem.appendChild(chatListItemName);

    chatList.appendChild(chatListItem);
}

function renderChatList(sessions) {
  chatList.innerHTML = "";

  for (const session of [...sessions].reverse()) {
    renderChatListItem(session);
  }

  if (sessions.length === 0) {
    const emptyChatList = document.createElement("li");
    emptyChatList.classList.add("empty-chat-list");
    emptyChatList.textContent = "No chats yet";
    chatList.appendChild(emptyChatList);
  }
}

async function loadChatList() {
  const response = await fetch("/api/app");
  const json = await response.json();

  renderChatList(json.state.sessions);
}

loadChatList();

addEventListener("chatSessionCreated", (event) => {
  renderChatListItem(event.session);
});

addEventListener("chatSessionSelected", (event) => {
  for (const item of chatList.querySelectorAll(".chat-list-item")) {
    item.classList.remove("chat-list-item--selected");
  }

  const item = chatList.querySelector(`[data-id="${event.session.id}"]`);
  item.classList.add("chat-list-item--selected");
});
