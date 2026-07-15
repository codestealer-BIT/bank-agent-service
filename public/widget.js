(() => {
  const script = document.currentScript;
  const apiBase = script?.dataset.apiBase ?? "";
  const userId = script?.dataset.userId ?? "demo-user-a";
  let conversationId = null;

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;right:24px;bottom:24px;z-index:2147483647";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      *{box-sizing:border-box} button,input{font:inherit}
      .bubble{width:58px;height:58px;border:0;border-radius:50%;background:#1457d9;color:#fff;
        box-shadow:0 10px 30px #142d5f55;cursor:pointer;font-size:25px}
      .panel{display:none;position:absolute;right:0;bottom:72px;width:min(380px,calc(100vw - 32px));
        height:min(570px,calc(100vh - 120px));background:#fff;border:1px solid #dfe5ef;border-radius:18px;
        box-shadow:0 18px 55px #17203333;overflow:hidden;font:14px system-ui,sans-serif;color:#172033}
      .panel.open{display:flex;flex-direction:column}.head{padding:16px 18px;background:#0f3f9e;color:#fff}
      .head b{display:block;font-size:16px}.head span{opacity:.8;font-size:12px}
      .messages{flex:1;overflow:auto;padding:14px;background:#f6f8fb}
      .msg{max-width:88%;padding:10px 12px;margin:8px 0;border-radius:13px;white-space:pre-wrap;line-height:1.45}
      .user{margin-left:auto;background:#1457d9;color:#fff}.assistant{background:#fff;border:1px solid #e3e8f0}
      .form{display:flex;gap:8px;padding:12px;border-top:1px solid #e3e8f0}.form input{flex:1;border:1px solid #ccd5e2;
        border-radius:10px;padding:10px}.send{border:0;border-radius:10px;background:#1457d9;color:#fff;padding:0 14px;cursor:pointer}
      .send:disabled{opacity:.5}
    </style>
    <section class="panel" aria-label="行内智能助手">
      <header class="head"><b>行内智能助手</b><span>Private Letta Agent · 本地 MemFS</span></header>
      <div class="messages"><div class="msg assistant">你好，我是你的专属行内助手。不同用户的记忆彼此隔离。</div></div>
      <form class="form"><input maxlength="32000" placeholder="请输入问题…" /><button class="send">发送</button></form>
    </section>
    <button class="bubble" aria-label="打开行内智能助手">✦</button>`;
  document.body.append(host);

  const panel = root.querySelector(".panel");
  const bubble = root.querySelector(".bubble");
  const form = root.querySelector(".form");
  const input = root.querySelector("input");
  const send = root.querySelector(".send");
  const messages = root.querySelector(".messages");
  bubble.addEventListener("click", () => panel.classList.toggle("open"));

  const append = (content, role) => {
    const element = document.createElement("div");
    element.className = `msg ${role}`;
    element.textContent = content;
    messages.append(element);
    messages.scrollTop = messages.scrollHeight;
    return element;
  };

  const api = async (path, options = {}) => {
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", "X-User-Id": userId, ...(options.headers ?? {}) },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail ?? body.error ?? `HTTP ${response.status}`);
    return body;
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || send.disabled) return;
    input.value = "";
    append(text, "user");
    const waiting = append("正在思考…", "assistant");
    send.disabled = true;
    try {
      if (!conversationId) {
        const created = await api("/v1/conversations", { method: "POST", body: "{}" });
        conversationId = created.id;
      }
      const result = await api(`/v1/conversations/${conversationId}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: text, request_id: crypto.randomUUID() }),
      });
      waiting.textContent = result.answer || "（Agent 没有返回文本）";
    } catch (error) {
      waiting.textContent = `请求失败：${error.message}`;
    } finally {
      send.disabled = false;
      input.focus();
    }
  });
})();
