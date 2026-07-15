(() => {
  let conversationId = null;
  let currentUser = null;
  let busy = false;

  const host = document.createElement("div");
  host.style.cssText = "display:none;position:fixed;right:24px;bottom:24px;z-index:2147483647";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      *{box-sizing:border-box}button,textarea{font:inherit}.launcher{position:relative;width:66px;height:66px;border:0;border-radius:22px;color:#fff;cursor:pointer;background:linear-gradient(145deg,#5d4adc,#9d55df 68%,#ee6aa8);box-shadow:0 16px 38px #4f3fc55c;transition:.22s}.launcher:hover{transform:translateY(-4px) rotate(-2deg);box-shadow:0 22px 45px #4f3fc570}.launcher span{font-size:29px}.launcher i{position:absolute;right:4px;top:4px;width:12px;height:12px;border:2px solid #fff;border-radius:50%;background:#30d39c;box-shadow:0 0 0 3px #30d39c40}
      .panel{display:none;position:absolute;right:0;bottom:80px;width:min(430px,calc(100vw - 28px));height:min(680px,calc(100vh - 110px));overflow:hidden;border:1px solid #ffffff90;border-radius:26px;background:#fff;box-shadow:0 28px 80px #2d25594f;font:14px Inter,"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#1b1d35}.panel.open{display:flex;flex-direction:column;animation:rise .2s ease-out}@keyframes rise{from{opacity:0;transform:translateY(12px) scale(.98)}}
      .head{padding:20px;color:#fff;background:radial-gradient(circle at 90% 10%,#ff9e6a 0,transparent 28%),linear-gradient(115deg,#36268e,#6852df 62%,#994fd3)}.head-row{display:flex;align-items:center;gap:11px}.agent-avatar{width:43px;height:43px;border-radius:15px;display:grid;place-items:center;background:#ffffff1f;border:1px solid #ffffff33;font-size:22px}.agent-title{display:flex;flex-direction:column}.agent-title b{font-size:15px}.agent-title span{font-size:10px;color:#ddd7ff;margin-top:3px}.head-actions{margin-left:auto;display:flex;gap:6px}.head-actions button{width:34px;height:34px;border:1px solid #ffffff25;border-radius:11px;color:#fff;background:#ffffff12;cursor:pointer}.user-line{display:flex;align-items:center;gap:7px;margin-top:14px;padding-top:12px;border-top:1px solid #ffffff1c;color:#e6e2ff;font-size:10px}.user-dot{width:6px;height:6px;border-radius:50%;background:#4de0b3}
      .messages{flex:1;overflow:auto;padding:18px;background:linear-gradient(180deg,#f7f6fc,#fbfbfe)}.welcome{padding:17px;border:1px solid #e9e5fa;border-radius:18px;background:linear-gradient(135deg,#fff,#f5f1ff);box-shadow:0 8px 22px #51439c0c}.welcome b{display:block;font-size:14px;color:#4f43bd}.welcome p{margin:7px 0 0;font-size:11px;line-height:1.65;color:#74778e}.suggestions{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0 18px}.suggestions button{border:1px solid #e4e1f3;border-radius:99px;padding:7px 10px;background:#fff;color:#665ab9;font-size:10px;cursor:pointer}.suggestions button:hover{border-color:#8e82df;background:#f4f1ff}.msg{max-width:88%;padding:11px 13px;margin:9px 0;border-radius:15px;white-space:pre-wrap;line-height:1.55;font-size:12px;box-shadow:0 5px 15px #2720460a}.user{margin-left:auto;background:linear-gradient(135deg,#5d50d8,#8560e5);color:#fff;border-bottom-right-radius:5px}.assistant{background:#fff;border:1px solid #e7e7f0;border-bottom-left-radius:5px}.assistant.waiting{color:#7a70c2}.assistant.error{color:#c63c68;background:#fff5f8;border-color:#f3d3de}
      .composer-wrap{padding:12px 14px 14px;background:#fff;border-top:1px solid #ececf3}.composer{display:flex;align-items:end;gap:8px;padding:7px 7px 7px 13px;border:1px solid #dedfec;border-radius:16px;background:#fbfbfe;transition:.2s}.composer:focus-within{border-color:#8879e8;box-shadow:0 0 0 4px #7667dc12}.composer textarea{flex:1;resize:none;max-height:120px;min-height:36px;padding:8px 0;border:0;outline:0;background:transparent;color:#1c1e35;line-height:1.4}.send{width:40px;height:40px;border:0;border-radius:12px;background:linear-gradient(135deg,#5b4bd5,#9356dc);color:#fff;cursor:pointer;font-size:17px}.send:disabled{opacity:.45;cursor:wait}.hint{text-align:center;color:#aaaabb;font-size:9px;margin:7px 0 0}
      @media(max-width:520px){:host{right:14px!important;bottom:14px!important}.panel{position:fixed;inset:10px;width:auto;height:auto;max-height:none}.launcher{width:60px;height:60px;border-radius:20px}}
    </style>
    <section class="panel" aria-label="行内智能助手">
      <header class="head"><div class="head-row"><div class="agent-avatar">✦</div><div class="agent-title"><b>澄川智能助手</b><span>Letta · 本地长期记忆</span></div><div class="head-actions"><button class="new" title="新建会话" aria-label="新建会话">＋</button><button class="close" title="关闭" aria-label="关闭">×</button></div></div><div class="user-line"><i class="user-dot"></i><span class="identity">专属空间已连接</span></div></header>
      <div class="messages"></div>
      <div class="composer-wrap"><form class="composer"><textarea rows="1" maxlength="32000" placeholder="输入你的问题…"></textarea><button class="send" aria-label="发送">↑</button></form><p class="hint">AI 生成内容仅供参考 · 重要业务请核实</p></div>
    </section>
    <button class="launcher" aria-label="打开行内智能助手"><span>✦</span><i></i></button>`;
  document.body.append(host);

  const panel = root.querySelector(".panel");
  const launcher = root.querySelector(".launcher");
  const messages = root.querySelector(".messages");
  const form = root.querySelector(".composer");
  const input = root.querySelector("textarea");
  const send = root.querySelector(".send");
  const identity = root.querySelector(".identity");

  const request = async (path, options = {}) => {
    const response = await fetch(path, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json", ...(options.headers ?? {}) } });
    const body = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body?.error ?? `HTTP ${response.status}`), { status: response.status });
    return body;
  };

  const resetMessages = () => {
    messages.innerHTML = `<div class="welcome"><b>你好，${currentUser?.display_name ?? "朋友"} 👋</b><p>我是你的专属智能助手。不同账号拥有独立的 Agent、会话和长期记忆空间。</p></div><div class="suggestions"><button data-text="请介绍一下你能为我做什么">你能做什么？</button><button data-text="请总结我的工作偏好">我的工作偏好</button><button data-text="帮我制定今天的工作计划">生成工作计划</button></div>`;
    messages.querySelectorAll("[data-text]").forEach((button) => button.addEventListener("click", () => submitMessage(button.dataset.text)));
  };

  const append = (content, role, extra = "") => {
    const element = document.createElement("div");
    element.className = `msg ${role} ${extra}`.trim();
    element.textContent = content;
    messages.append(element);
    messages.scrollTop = messages.scrollHeight;
    return element;
  };

  const open = () => { panel.classList.add("open"); setTimeout(() => input.focus(), 100); };
  const newConversation = () => { conversationId = null; resetMessages(); open(); };

  async function submitMessage(rawText) {
    const text = rawText?.trim();
    if (!text || busy || !currentUser) return;
    input.value = "";
    input.style.height = "auto";
    append(text, "user");
    const waiting = append("正在连接你的专属 Agent…", "assistant", "waiting");
    busy = true; send.disabled = true;
    try {
      if (!conversationId) {
        const created = await request("/v1/conversations", { method: "POST", body: JSON.stringify({ title: text.slice(0, 40) }) });
        conversationId = created.id;
      }
      const result = await request(`/v1/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ message: text, request_id: crypto.randomUUID() }) });
      waiting.className = "msg assistant";
      waiting.textContent = result.answer || "Agent 暂时没有返回文字。";
    } catch (error) {
      waiting.className = "msg assistant error";
      waiting.textContent = error.status === 401 ? "登录已失效，请重新登录。" : `请求失败：${error.message}`;
      if (error.status === 401) window.BankAgentWidget.reset();
    } finally { busy = false; send.disabled = false; input.focus(); }
  }

  launcher.addEventListener("click", () => panel.classList.toggle("open"));
  root.querySelector(".close").addEventListener("click", () => panel.classList.remove("open"));
  root.querySelector(".new").addEventListener("click", newConversation);
  form.addEventListener("submit", (event) => { event.preventDefault(); submitMessage(input.value); });
  input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); form.requestSubmit(); } });
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 120)}px`; });
  window.addEventListener("bank-agent:open", open);
  window.addEventListener("bank-agent:new", newConversation);
  window.addEventListener("bank-agent:prompt", (event) => { open(); submitMessage(event.detail); });

  window.BankAgentWidget = {
    async refreshAuth() {
      try {
        const result = await request("/v1/auth/me");
        currentUser = result.user;
        identity.textContent = `${currentUser.display_name}的专属空间 · @${currentUser.username}`;
        conversationId = null;
        resetMessages();
        host.style.display = "block";
      } catch { this.reset(); }
    },
    reset() {
      currentUser = null; conversationId = null; panel.classList.remove("open"); host.style.display = "none"; messages.innerHTML = "";
    },
  };
})();
