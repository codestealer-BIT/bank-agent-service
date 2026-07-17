(() => {
  const authGate = document.querySelector("#authGate");
  const appShell = document.querySelector("#appShell");
  const loginForm = document.querySelector("#loginForm");
  const username = document.querySelector("#username");
  const password = document.querySelector("#password");
  const loginButton = document.querySelector("#loginButton");
  const loginError = document.querySelector("#loginError");
  const machineRows = document.querySelector("#machineRows");
  const emptyState = document.querySelector("#emptyState");
  const datacenterFilters = document.querySelector("#datacenterFilters");
  const statusFilter = document.querySelector("#statusFilter");
  const machineSearch = document.querySelector("#machineSearch");
  const selectedDatacenters = new Set();
  let datacenters = [];
  let searchTimer = null;

  const request = async (path, options = {}) => {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    });
    const body = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error(body?.error ?? `HTTP ${response.status}`), {
        status: response.status,
      });
    }
    return body;
  };

  const avatarClass = (user) =>
    user.username.endsWith("b") ? "avatar avatar-b" : "avatar avatar-a";

  const statusLabels = {
    healthy: "正常",
    warning: "告警",
    offline: "离线",
  };

  const relativeTime = (value) => {
    const timestamp = new Date(value).getTime();
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 60) return `${seconds || 1} 秒前`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟前`;
    return new Date(value).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const metricCell = (value, status) => {
    const wrapper = document.createElement("div");
    wrapper.className = "metric-cell";
    const valueElement = document.createElement("span");
    valueElement.textContent = status === "offline" ? "--" : `${value}%`;
    const track = document.createElement("i");
    const fill = document.createElement("b");
    fill.style.width = `${Math.min(value, 100)}%`;
    if (value >= 80) fill.className = "high";
    track.append(fill);
    wrapper.append(valueElement, track);
    return wrapper;
  };

  const renderMachines = (machines) => {
    machineRows.innerHTML = "";
    emptyState.hidden = machines.length > 0;
    machines.forEach((machine) => {
      const row = document.createElement("tr");

      const status = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `status-badge ${machine.status}`;
      badge.textContent = statusLabels[machine.status];
      status.append(badge);

      const values = [
        machine.ip,
        machine.hostname,
        machine.datacenter_name,
        machine.rack,
        machine.role,
      ];
      const cells = values.map((value, index) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        if (index === 0) cell.className = "ip-cell";
        if (index === 1) cell.className = "hostname-cell";
        return cell;
      });

      const cpu = document.createElement("td");
      cpu.append(metricCell(machine.cpu_percent, machine.status));
      const memory = document.createElement("td");
      memory.append(metricCell(machine.memory_percent, machine.status));
      const heartbeat = document.createElement("td");
      heartbeat.textContent =
        machine.status === "offline" ? "超过 1 小时" : relativeTime(machine.last_heartbeat);
      heartbeat.className = "heartbeat-cell";

      row.append(status, ...cells, cpu, memory, heartbeat);
      machineRows.append(row);
    });
    document.querySelector("#resultCount").textContent = `共 ${machines.length} 台机器`;
  };

  const renderDatacenterFilters = () => {
    datacenterFilters.innerHTML = "";
    datacenters.forEach((datacenter) => {
      const label = document.createElement("label");
      label.className = "datacenter-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = datacenter.id;
      checkbox.checked = selectedDatacenters.has(datacenter.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedDatacenters.add(datacenter.id);
        else selectedDatacenters.delete(datacenter.id);
        void loadInfrastructure();
      });
      const name = document.createElement("span");
      name.textContent = datacenter.name;
      label.append(checkbox, name);
      datacenterFilters.append(label);
    });
  };

  const loadInfrastructure = async () => {
    const datacenterIds = [...selectedDatacenters];
    const params = new URLSearchParams();
    if (datacenterIds.length) params.set("datacenter_ids", datacenterIds.join(","));
    if (statusFilter.value) params.set("status", statusFilter.value);
    if (machineSearch.value.trim()) params.set("keyword", machineSearch.value.trim());
    const summaryParams = new URLSearchParams();
    if (datacenterIds.length) {
      summaryParams.set("datacenter_ids", datacenterIds.join(","));
    }
    document.querySelector("#resultCount").textContent = "正在加载…";
    try {
      const [machineResult, summary] = await Promise.all([
        request(`/v1/infrastructure/machines?${params}`),
        request(`/v1/infrastructure/summary?${summaryParams}`),
      ]);
      renderMachines(machineResult.machines ?? []);
      document.querySelector("#datacenterCount").textContent = summary.datacenter_count;
      document.querySelector("#machineCount").textContent = summary.machine_count;
      document.querySelector("#healthyCount").textContent = summary.healthy_count;
      document.querySelector("#issueCount").textContent =
        summary.warning_count + summary.offline_count;
    } catch (error) {
      machineRows.innerHTML = "";
      emptyState.hidden = false;
      emptyState.textContent = `资产数据加载失败：${error.message}`;
      document.querySelector("#resultCount").textContent = "加载失败";
    }
  };

  const initializeInfrastructure = async () => {
    if (!datacenters.length) {
      const result = await request("/v1/infrastructure/datacenters");
      datacenters = result.datacenters ?? [];
      datacenters.forEach((item) => selectedDatacenters.add(item.id));
      renderDatacenterFilters();
    }
    await loadInfrastructure();
  };

  const showWorkspace = (user) => {
    authGate.hidden = true;
    appShell.hidden = false;
    document.querySelector("#headerName").textContent = user.display_name;
    document.querySelector("#headerUsername").textContent = `@${user.username}`;
    const avatar = document.querySelector("#headerAvatar");
    avatar.className = avatarClass(user);
    avatar.textContent = user.display_name.slice(0, 1);
    window.BankAgentWidget?.refreshAuth();
    void initializeInfrastructure();
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

  document.querySelector("#selectAllDatacenters").addEventListener("click", () => {
    datacenters.forEach((item) => selectedDatacenters.add(item.id));
    renderDatacenterFilters();
    void loadInfrastructure();
  });

  document.querySelector("#clearDatacenters").addEventListener("click", () => {
    selectedDatacenters.clear();
    renderDatacenterFilters();
    void loadInfrastructure();
  });

  statusFilter.addEventListener("change", () => void loadInfrastructure());
  machineSearch.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadInfrastructure(), 220);
  });

  document.querySelectorAll("[data-open-agent]").forEach((button) => {
    button.addEventListener("click", () =>
      window.dispatchEvent(new CustomEvent("bank-agent:open")),
    );
  });
  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () =>
      window.dispatchEvent(
        new CustomEvent("bank-agent:prompt", { detail: button.dataset.prompt }),
      ),
    );
  });

  request("/v1/auth/me")
    .then((result) => showWorkspace(result.user))
    .catch(() => showLogin());
})();
