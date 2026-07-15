(() => {
  const authGate = document.querySelector("#authGate");
  const appShell = document.querySelector("#appShell");
  const loginForm = document.querySelector("#loginForm");
  const username = document.querySelector("#username");
  const password = document.querySelector("#password");
  const loginButton = document.querySelector("#loginButton");
  const loginError = document.querySelector("#loginError");

  const request = async (path, options = {}) => {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    });
    const body = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body?.error ?? `HTTP ${response.status}`), { status: response.status });
    return body;
  };

  const avatarClass = (user) => user.username.endsWith("b") ? "avatar avatar-b" : "avatar avatar-a";

  const showWorkspace = (user) => {
    authGate.hidden = true;
    appShell.hidden = false;
    document.querySelector("#headerName").textContent = user.display_name;
    document.querySelector("#headerUsername").textContent = `@${user.username}`;
    document.querySelector("#greetingName").textContent = `${user.display_name}，你好`;
    const avatar = document.querySelector("#headerAvatar");
    avatar.className = avatarClass(user);
    avatar.textContent = user.display_name.slice(0, 1);
    window.BankAgentWidget?.refreshAuth();
  };

  const showLogin = () => {
    appShell.hidden = true;
    authGate.hidden = false;
    window.BankAgentWidget?.reset();
    setTimeout(() => username.focus(), 50);
  };

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.textContent = "";
    loginButton.disabled = true;
    loginButton.firstElementChild.textContent = "正在验证身份…";
    try {
      const result = await request("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: username.value, password: password.value }),
      });
      password.value = "";
      showWorkspace(result.user);
    } catch (error) {
      loginError.textContent = error.message;
      password.select();
    } finally {
      loginButton.disabled = false;
      loginButton.firstElementChild.textContent = "安全登录";
    }
  });

  document.querySelector("#togglePassword").addEventListener("click", (event) => {
    const reveal = password.type === "password";
    password.type = reveal ? "text" : "password";
    event.currentTarget.textContent = reveal ? "隐藏" : "显示";
    event.currentTarget.setAttribute("aria-label", reveal ? "隐藏密码" : "显示密码");
  });

  document.querySelectorAll("[data-demo-user]").forEach((button) => {
    button.addEventListener("click", () => {
      username.value = button.dataset.demoUser;
      password.value = "LettaDemo@2026";
      loginError.textContent = "";
      loginButton.focus();
    });
  });

  document.querySelector("#logoutButton").addEventListener("click", async () => {
    await request("/v1/auth/logout", { method: "POST", body: "{}" }).catch(() => null);
    showLogin();
  });

  document.querySelectorAll("[data-open-agent]").forEach((button) => {
    button.addEventListener("click", () => window.dispatchEvent(new CustomEvent("bank-agent:open")));
  });
  document.querySelectorAll("[data-new-chat]").forEach((button) => {
    button.addEventListener("click", () => window.dispatchEvent(new CustomEvent("bank-agent:new")));
  });
  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => window.dispatchEvent(new CustomEvent("bank-agent:prompt", { detail: button.dataset.prompt })));
  });

  request("/v1/auth/me")
    .then((result) => showWorkspace(result.user))
    .catch(() => showLogin());
})();
