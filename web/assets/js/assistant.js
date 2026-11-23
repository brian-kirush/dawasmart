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

function appendMessage(text, role, extras = {}) {
  const article = document.createElement("article");
  article.className = `assistant-message assistant-message-${role}`;
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  article.append(paragraph);
  if (extras.safetyNotice) {
    const notice = document.createElement("p");
    notice.className = "assistant-safety-note";
    notice.textContent = extras.safetyNotice;
    article.append(notice);
  }
  if (extras.serviceNotice) {
    const notice = document.createElement("p");
    notice.className = "assistant-safety-note";
    notice.textContent = extras.serviceNotice;
    article.append(notice);
  }
  if (Array.isArray(extras.sources) && extras.sources.length) {
    const sourceList = document.createElement("div");
    sourceList.className = "assistant-sources";
    for (const source of extras.sources) {
      if (
        typeof source?.title !== "string" ||
        typeof source?.url !== "string"
      ) continue;
      let url;
      try {
        url = new URL(source.url);
      } catch {
        continue;
      }
      if (
        url.protocol !== "https:" ||
        !["dailymed.nlm.nih.gov", "open.fda.gov"].includes(url.hostname)
      ) continue;
      const link = document.createElement("a");
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = source.title;
      sourceList.append(link);
    }
    if (sourceList.childElementCount) article.append(sourceList);
  }
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
          if (typeof result?.answer === "string") {
            thinkingMessage.remove();
            appendMessage(result.answer, "bot", {
              safetyNotice: result.safety_notice,
              serviceNotice: result.service_notice,
              sources: result.sources,
            });
            return;
          }
          if (typeof result?.error === "string") message = result.error;
        } catch {
          if (response.status === 404) {
            message =
              "The pharmacy-assistant function is not deployed in Supabase yet.";
          }
        }
      }
      throw new Error(message);
    }
    thinkingMessage.remove();
    appendMessage(data.answer, "bot", {
      safetyNotice: data.safety_notice,
      serviceNotice: data.service_notice,
      sources: data.sources,
    });
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
