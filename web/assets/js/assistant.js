import { getAuthenticatedContext } from "./auth-session.js";

const form = document.querySelector("#assistant-form");
const questionInput = document.querySelector("#assistant-question");
const sendButton = document.querySelector("#assistant-send");
const messages = document.querySelector("#assistant-messages");
const status = document.querySelector("#assistant-status");
const suggestions = document.querySelector("#assistant-suggestions");

function setStatus(message) {
  status.textContent = message;
  status.hidden = false;
}

function appendMessage(text, role) {
  const article = document.createElement("article");
  article.className = `assistant-message assistant-message-${role}`;
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  article.append(paragraph);
  messages.append(article);
  messages.scrollTop = messages.scrollHeight;
}

async function ask(question) {
  const cleanQuestion = question.trim();
  if (!cleanQuestion) return;

  status.hidden = true;
  appendMessage(cleanQuestion, "user");
  questionInput.value = "";
  sendButton.disabled = true;
  sendButton.textContent = "Thinking...";
  appendMessage("Checking this pharmacy's records...", "bot");
  const thinkingMessage = messages.lastElementChild;

  try {
    const context = await getAuthenticatedContext();
    if (!context) return;

    const { data, error } = await context.client.functions.invoke(
      "pharmacy-assistant",
      {
        body: { question: cleanQuestion },
      },
    );
    if (error) {
      let message = "The assistant could not answer right now.";
      const response = error.context;
      if (response instanceof Response) {
        try {
          const result = await response.clone().json();
          if (result?.error) message = result.error;
        } catch {
          // Keep the generic message.
        }
      }
      throw new Error(message);
    }
    thinkingMessage.remove();
    appendMessage(data.answer, "bot");
  } catch (error) {
    if (thinkingMessage?.isConnected) thinkingMessage.remove();
    const message = error instanceof Error
      ? error.message
      : "The assistant could not answer right now.";
    setStatus(message);
  } finally {
    sendButton.disabled = false;
    sendButton.textContent = "Send";
    questionInput.focus();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void ask(questionInput.value);
});

suggestions.addEventListener("click", (event) => {
  const button = event.target.closest("[data-question]");
  if (!button) return;
  void ask(button.dataset.question || "");
});
