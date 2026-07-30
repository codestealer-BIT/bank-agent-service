(() => {
  let conversationId = null;
  let currentUser = null;
  let creatingConversation = false;
  let viewVersion = 0;
  let historyOpen = false;
  let conversations = [];
  const pendingConversationIds = new Set();

  const host = document.createElement("div");
  host.style.cssText =
    "display:none;position:fixed;right:24px;bottom:24px;z-index:2147483647";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      *{box-sizing:border-box}
      button,textarea{font:inherit}
      .launcher{position:relative;width:66px;height:66px;border:0;border-radius:22px;color:#fff;cursor:pointer;background:linear-gradient(145deg,#5d4adc,#9d55df 68%,#ee6aa8);box-shadow:0 16px 38px #4f3fc55c;transition:.22s}
      .launcher:hover{transform:translateY(-4px) rotate(-2deg);box-shadow:0 22px 45px #4f3fc570}
      .launcher span{font-size:29px}
      .launcher i{position:absolute;right:4px;top:4px;width:12px;height:12px;border:2px solid #fff;border-radius:50%;background:#30d39c;box-shadow:0 0 0 3px #30d39c40}
      .panel{display:none;position:absolute;right:0;bottom:80px;width:min(430px,calc(100vw - 28px));height:min(680px,calc(100vh - 110px));overflow:hidden;border:1px solid #ffffff90;border-radius:26px;background:#fff;box-shadow:0 28px 80px #2d25594f;font:14px Inter,"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#1b1d35}
      .panel.open{display:flex;flex-direction:column;animation:rise .2s ease-out}
      @keyframes rise{from{opacity:0;transform:translateY(12px) scale(.98)}}
      .head{padding:20px;color:#fff;background:radial-gradient(circle at 90% 10%,#ff9e6a 0,transparent 28%),linear-gradient(115deg,#36268e,#6852df 62%,#994fd3)}
      .head-row{display:flex;align-items:center;gap:11px}
      .agent-avatar{width:43px;height:43px;border-radius:15px;display:grid;place-items:center;background:#ffffff1f;border:1px solid #ffffff33;font-size:22px}
      .agent-title{display:flex;flex-direction:column}
      .agent-title b{font-size:15px}
      .agent-title span{font-size:10px;color:#ddd7ff;margin-top:3px}
      .head-actions{margin-left:auto;display:flex;gap:6px}
      .head-actions button{width:34px;height:34px;border:1px solid #ffffff25;border-radius:11px;color:#fff;background:#ffffff12;cursor:pointer}
      .user-line{display:flex;align-items:center;gap:7px;margin-top:14px;padding-top:12px;border-top:1px solid #ffffff1c;color:#e6e2ff;font-size:10px}
      .user-dot{width:6px;height:6px;border-radius:50%;background:#4de0b3}
      .body{position:relative;display:flex;flex:1;min-height:0;background:linear-gradient(180deg,#f7f6fc,#fbfbfe)}
      .history-backdrop{position:absolute;inset:0;background:#1c16371f;opacity:0;pointer-events:none;transition:.2s;z-index:2}
      .history-backdrop.open{opacity:1;pointer-events:auto}
      .history-pane{position:absolute;left:0;top:0;bottom:0;width:min(290px,86%);display:flex;flex-direction:column;background:linear-gradient(180deg,#ffffff,#f6f4ff);border-right:1px solid #ece8ff;box-shadow:14px 0 40px #1f173b14;transform:translateX(-102%);transition:.22s ease;z-index:3}
      .history-pane.open{transform:translateX(0)}
      .history-head{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 10px}
      .history-head b{font-size:13px;color:#2f275d}
      .history-head span{font-size:10px;color:#8a85b4}
      .history-refresh{border:1px solid #e5e1fb;border-radius:10px;background:#fff;color:#665ab9;padding:6px 9px;cursor:pointer;font-size:10px}
      .history-list{padding:0 10px 12px;overflow:auto}
      .history-item{width:100%;display:block;text-align:left;border:1px solid #ece8ff;border-radius:16px;background:#fff;padding:12px 12px 11px;margin:8px 0;cursor:pointer;box-shadow:0 8px 18px #32285a08}
      .history-item.active{border-color:#7a67e6;background:linear-gradient(135deg,#f6f1ff,#fff)}
      .history-item-title{display:block;font-size:12px;font-weight:700;color:#2f275d;line-height:1.4}
      .history-item-meta{display:flex;justify-content:space-between;gap:8px;margin-top:7px;font-size:10px;color:#8d88b6}
      .history-empty,.history-error{margin:12px 6px 0;border:1px dashed #ddd6ff;border-radius:16px;padding:14px;font-size:11px;line-height:1.6;background:#fff;color:#78749b}
      .history-error{color:#b04d70;border-color:#f0cad6;background:#fff7f9}
      .main{display:flex;flex:1;min-width:0;flex-direction:column}
      .messages{flex:1;overflow:auto;padding:18px}
      .welcome{padding:17px;border:1px solid #e9e5fa;border-radius:18px;background:linear-gradient(135deg,#fff,#f5f1ff);box-shadow:0 8px 22px #51439c0c}
      .welcome b{display:block;font-size:14px;color:#4f43bd}
      .welcome p{margin:7px 0 0;font-size:11px;line-height:1.65;color:#74778e}
      .suggestions{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0 18px}
      .suggestions button{border:1px solid #e4e1f3;border-radius:99px;padding:7px 10px;background:#fff;color:#665ab9;font-size:10px;cursor:pointer}
      .suggestions button:hover{border-color:#8e82df;background:#f4f1ff}
      .msg{max-width:88%;padding:11px 13px;margin:9px 0;border-radius:15px;white-space:pre-wrap;line-height:1.55;font-size:12px;box-shadow:0 5px 15px #2720460a}
      .user{margin-left:auto;background:linear-gradient(135deg,#5d50d8,#8560e5);color:#fff;border-bottom-right-radius:5px}
      .assistant{background:#fff;border:1px solid #e7e7f0;border-bottom-left-radius:5px}
      .assistant.waiting{color:#7a70c2}
      .assistant.error{color:#c63c68;background:#fff5f8;border-color:#f3d3de}
      .thread-empty{margin-top:14px;padding:16px;border:1px dashed #ded9f4;border-radius:18px;background:#fff;color:#7b769d;font-size:11px;line-height:1.6}
      .composer-wrap{padding:12px 14px 14px;background:#fff;border-top:1px solid #ececf3}
      .composer{display:flex;align-items:end;gap:8px;padding:7px 7px 7px 13px;border:1px solid #dedfec;border-radius:16px;background:#fbfbfe;transition:.2s}
      .composer:focus-within{border-color:#8879e8;box-shadow:0 0 0 4px #7667dc12}
      .composer textarea{flex:1;resize:none;max-height:120px;min-height:36px;padding:8px 0;border:0;outline:0;background:transparent;color:#1c1e35;line-height:1.4}
      .send{width:40px;height:40px;border:0;border-radius:12px;background:linear-gradient(135deg,#5b4bd5,#9356dc);color:#fff;cursor:pointer;font-size:17px}
      .send:disabled{opacity:.45;cursor:wait}
      .hint{text-align:center;color:#aaaabb;font-size:9px;margin:7px 0 0}
      @media(max-width:520px){
        :host{right:14px!important;bottom:14px!important}
        .panel{position:fixed;inset:10px;width:auto;height:auto;max-height:none}
        .launcher{width:60px;height:60px;border-radius:20px}
        .history-pane{width:calc(100% - 32px)}
      }
    </style>
    <section class="panel" aria-label="行内智能助手">
      <header class="head">
        <div class="head-row">
          <div class="agent-avatar">✦</div>
          <div class="agent-title">
            <b>澄川智能运维助手</b>
            <span>共享 Letta Agent · 资产查询</span>
          </div>
          <div class="head-actions">
            <button class="history-toggle" title="历史会话" aria-label="历史会话">≡</button>
            <button class="new" title="新建会话" aria-label="新建会话">＋</button>
            <button class="close" title="关闭" aria-label="关闭">×</button>
          </div>
        </div>
        <div class="user-line">
          <i class="user-dot"></i>
          <span class="identity">共享 Agent 已连接</span>
        </div>
      </header>
      <div class="body">
        <div class="history-backdrop"></div>
        <aside class="history-pane" aria-label="历史会话列表">
          <div class="history-head">
            <div>
              <b>历史会话</b>
              <span>仅显示当前账号的记录</span>
            </div>
            <button class="history-refresh" type="button">刷新</button>
          </div>
          <div class="history-list"></div>
        </aside>
        <div class="main">
          <div class="messages"></div>
          <div class="composer-wrap">
            <form class="composer">
              <textarea rows="1" maxlength="32000" placeholder="输入你的问题…"></textarea>
              <button class="send" aria-label="发送">↑</button>
            </form>
            <p class="hint">演示环境 · 重要操作与外发内容仍需确认</p>
          </div>
        </div>
      </div>
    </section>
    <button class="launcher" aria-label="打开行内智能助手"><span>✦</span><i></i></button>
  `;
  document.body.append(host);

  const panel = root.querySelector(".panel");
  const launcher = root.querySelector(".launcher");
  const messages = root.querySelector(".messages");
  const form = root.querySelector(".composer");
  const input = root.querySelector("textarea");
  const send = root.querySelector(".send");
  const identity = root.querySelector(".identity");
  const historyPane = root.querySelector(".history-pane");
  const historyBackdrop = root.querySelector(".history-backdrop");
  const historyList = root.querySelector(".history-list");
  const historyToggle = root.querySelector(".history-toggle");
  const historyRefresh = root.querySelector(".history-refresh");

  const request = async (path, options = {}) => {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
    const body =
      response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(
        new Error(body?.error ?? `HTTP ${response.status}`),
        { status: response.status },
      );
    }
    return body;
  };

  const formatWhen = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    return sameDay
      ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      : date.toLocaleDateString("zh-CN", {
          month: "numeric",
          day: "numeric",
        });
  };

  const summarizeTitle = (conversation) =>
    (conversation?.title || "未命名会话").trim() || "未命名会话";

  const append = (content, role, extra = "") => {
    const element = document.createElement("div");
    element.className = `msg ${role} ${extra}`.trim();
    element.textContent = content;
    messages.append(element);
    messages.scrollTop = messages.scrollHeight;
    return element;
  };

  const setHistoryOpen = (open) => {
    historyOpen = open;
    historyPane.classList.toggle("open", open);
    historyBackdrop.classList.toggle("open", open);
  };

  const updateComposerState = () => {
    const currentConversationIsPending = conversationId
      ? pendingConversationIds.has(conversationId)
      : creatingConversation;
    send.disabled = !currentUser || currentConversationIsPending;
    send.title = currentConversationIsPending
      ? "当前会话正在处理中，你仍可切换到其他会话"
      : "发送";
  };

  const renderSuggestions = () => {
    messages.querySelectorAll("[data-text]").forEach((button) => {
      button.addEventListener("click", () => submitMessage(button.dataset.text));
    });
  };

  const resetMessages = () => {
    messages.innerHTML = `
      <div class="welcome">
        <b>你好，${currentUser?.display_name ?? "同事"}</b>
        <p>我是共享智能运维助手。每位用户可以拥有多个独立会话，我可以查询演示机房、机器状态并汇总异常情况。</p>
      </div>
      <div class="suggestions">
        <button data-text="请汇总所有机房的机器运行情况">全部机房概览</button>
        <button data-text="列出目前所有告警和离线的机器">查看异常机器</button>
        <button data-text="北京核心机房有多少台机器？">统计北京机房</button>
      </div>
      <div class="thread-empty">可以从左上角查看当前账号的历史会话，或直接开始新的资产查询。</div>
    `;
    renderSuggestions();
  };

  const renderConversationList = (status = "ready", message = "") => {
    if (status === "loading") {
      historyList.innerHTML =
        '<div class="history-empty">正在读取当前账号的历史会话…</div>';
      return;
    }
    if (status === "error") {
      historyList.innerHTML = `<div class="history-error">${message}</div>`;
      return;
    }
    if (!conversations.length) {
      historyList.innerHTML =
        '<div class="history-empty">还没有历史会话。你发出的第一条消息会自动创建新会话。</div>';
      return;
    }

    historyList.innerHTML = "";
    conversations.forEach((conversation) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `history-item${
        conversation.id === conversationId ? " active" : ""
      }`;
      button.innerHTML = `
        <span class="history-item-title">${summarizeTitle(conversation)}</span>
        <span class="history-item-meta">
          <span>${
            pendingConversationIds.has(conversation.id)
              ? "正在回复…"
              : conversation.letta_conversation_id
                ? "继续对话"
                : "仅已创建"
          }</span>
          <span>${formatWhen(conversation.updated_at)}</span>
        </span>
      `;
      button.addEventListener("click", () => void openConversation(conversation.id));
      historyList.append(button);
    });
  };

  const renderTurns = (turns) => {
    messages.innerHTML = "";
    if (!turns.length) {
      messages.innerHTML =
        '<div class="thread-empty">这个会话还没有消息。现在发一条，我们就从这里接着聊。</div>';
      return;
    }
    turns.forEach((turn) => {
      append(turn.user_message ?? "", "user");
      if (turn.status === "completed") {
        append(turn.assistant_message ?? "", "assistant");
      } else if (turn.status === "failed") {
        append(turn.error || "这条消息处理失败。", "assistant", "error");
      } else {
        append(turn.assistant_message || "这条消息还在处理中。", "assistant", "waiting");
      }
    });
  };

  const refreshConversations = async () => {
    if (!currentUser) return;
    renderConversationList("loading");
    try {
      const result = await request("/v1/conversations");
      conversations = result.conversations ?? [];
      renderConversationList();
    } catch (error) {
      renderConversationList(
        "error",
        `读取历史会话失败：${error.message || "未知错误"}`,
      );
    }
  };

  const open = () => {
    panel.classList.add("open");
    void refreshConversations();
    setTimeout(() => input.focus(), 100);
  };

  const newConversation = () => {
    viewVersion += 1;
    conversationId = null;
    setHistoryOpen(false);
    renderConversationList();
    resetMessages();
    updateComposerState();
    open();
  };

  const openConversation = async (id) => {
    if (!currentUser) return;
    const requestedViewVersion = ++viewVersion;
    conversationId = id;
    setHistoryOpen(false);
    renderConversationList();
    updateComposerState();
    messages.innerHTML =
      '<div class="thread-empty">正在加载这段历史会话…</div>';
    try {
      const result = await request(`/v1/conversations/${id}/messages`);
      if (conversationId !== id || viewVersion !== requestedViewVersion) return;
      renderTurns(result.messages ?? []);
      input.focus();
    } catch (error) {
      if (conversationId !== id || viewVersion !== requestedViewVersion) return;
      messages.innerHTML = "";
      append(`读取历史失败：${error.message}`, "assistant", "error");
    }
  };

  async function submitMessage(rawText) {
    const text = rawText?.trim();
    if (!text || !currentUser) return;
    if (
      (!conversationId && creatingConversation) ||
      (conversationId && pendingConversationIds.has(conversationId))
    ) {
      return;
    }

    const submissionViewVersion = viewVersion;
    let targetConversationId = conversationId;
    input.value = "";
    input.style.height = "auto";
    append(text, "user");
    const waiting = append("正在查询共享 Agent…", "assistant", "waiting");
    if (targetConversationId) {
      pendingConversationIds.add(targetConversationId);
    } else {
      creatingConversation = true;
    }
    updateComposerState();
    renderConversationList();
    setHistoryOpen(false);

    try {
      if (!targetConversationId) {
        const created = await request("/v1/conversations", {
          method: "POST",
          body: JSON.stringify({ title: text.slice(0, 40) }),
        });
        targetConversationId = created.id;
        creatingConversation = false;
        pendingConversationIds.add(targetConversationId);
        if (conversationId === null && viewVersion === submissionViewVersion) {
          conversationId = targetConversationId;
        }
        conversations = [created, ...conversations.filter((item) => item.id !== created.id)];
        renderConversationList();
        updateComposerState();
      }

      const result = await request(
        `/v1/conversations/${targetConversationId}/messages`,
        {
          method: "POST",
          body: JSON.stringify({
            message: text,
            request_id:
              globalThis.crypto?.randomUUID?.() ??
              `request-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          }),
        },
      );
      if (conversationId === targetConversationId && waiting.isConnected) {
        waiting.className = "msg assistant";
        waiting.textContent = result.answer || "Agent 暂时没有返回文字。";
      } else if (conversationId === targetConversationId) {
        await openConversation(targetConversationId);
      }
      await refreshConversations();
    } catch (error) {
      if (conversationId === targetConversationId && waiting.isConnected) {
        waiting.className = "msg assistant error";
        waiting.textContent =
          error.status === 401
            ? "登录已失效，请重新登录。"
            : `请求失败：${error.message}`;
      }
      if (error.status === 401) window.BankAgentWidget.reset();
    } finally {
      creatingConversation = false;
      if (targetConversationId) pendingConversationIds.delete(targetConversationId);
      renderConversationList();
      updateComposerState();
      if (panel.classList.contains("open")) input.focus();
    }
  }

  launcher.addEventListener("click", () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) void refreshConversations();
  });
  historyToggle.addEventListener("click", () => {
    if (!panel.classList.contains("open")) open();
    setHistoryOpen(!historyOpen);
  });
  historyBackdrop.addEventListener("click", () => setHistoryOpen(false));
  historyRefresh.addEventListener("click", () => void refreshConversations());
  root.querySelector(".close").addEventListener("click", () => {
    panel.classList.remove("open");
    setHistoryOpen(false);
  });
  root.querySelector(".new").addEventListener("click", newConversation);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitMessage(input.value);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  });
  window.addEventListener("bank-agent:open", open);
  window.addEventListener("bank-agent:new", newConversation);
  window.addEventListener("bank-agent:prompt", (event) => {
    open();
    void submitMessage(event.detail);
  });

  window.BankAgentWidget = {
    async refreshAuth() {
      try {
        const result = await request("/v1/auth/me");
        currentUser = result.user;
        identity.textContent = `${currentUser.display_name} · @${currentUser.username}`;
        conversationId = null;
        viewVersion += 1;
        resetMessages();
        host.style.display = "block";
        updateComposerState();
        await refreshConversations();
      } catch {
        this.reset();
      }
    },
    reset() {
      currentUser = null;
      conversationId = null;
      creatingConversation = false;
      pendingConversationIds.clear();
      viewVersion += 1;
      conversations = [];
      historyOpen = false;
      panel.classList.remove("open");
      host.style.display = "none";
      messages.innerHTML = "";
      historyList.innerHTML = "";
      setHistoryOpen(false);
      updateComposerState();
    },
  };
})();
