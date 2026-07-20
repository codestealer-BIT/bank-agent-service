(() => {
  const authGate = document.querySelector("#authGate");
  const appShell = document.querySelector("#appShell");
  const loginForm = document.querySelector("#loginForm");
  const username = document.querySelector("#username");
  const password = document.querySelector("#password");
  const loginButton = document.querySelector("#loginButton");
  const loginError = document.querySelector("#loginError");

  const navInfrastructure = document.querySelector("#navInfrastructure");
  const navAssistant = document.querySelector("#navAssistant");
  const infrastructurePage = document.querySelector("#infrastructurePage");
  const assistantPage = document.querySelector("#assistantPage");

  const machineRows = document.querySelector("#machineRows");
  const emptyState = document.querySelector("#emptyState");
  const datacenterFilters = document.querySelector("#datacenterFilters");
  const statusFilter = document.querySelector("#statusFilter");
  const machineSearch = document.querySelector("#machineSearch");
  const selectedDatacenters = new Set();

  const assistantSchedulesTab = document.querySelector("#assistantSchedulesTab");
  const assistantNewChat = document.querySelector("#assistantNewChat");
  const pinnedConversations = document.querySelector("#pinnedConversations");
  const chatConversations = document.querySelector("#chatConversations");
  const chatWorkspace = document.querySelector("#chatWorkspace");
  const scheduleWorkspace = document.querySelector("#scheduleWorkspace");
  const chatRefreshButton = document.querySelector("#chatRefreshButton");
  const conversationHeading = document.querySelector("#conversationHeading");
  const messages = document.querySelector("#messages");
  const suggestions = document.querySelector("#assistantSuggestions");
  const chatComposer = document.querySelector("#chatComposer");
  const chatInput = document.querySelector("#chatInput");
  const sendButton = document.querySelector("#sendButton");

  const scheduleTabs = [...document.querySelectorAll(".schedule-tab")];
  const scheduleList = document.querySelector("#scheduleList");
  const scheduleTemplates = document.querySelector("#scheduleTemplates");
  const createScheduleButton = document.querySelector("#createScheduleButton");

  const scheduleModal = document.querySelector("#scheduleModal");
  const closeScheduleModal = document.querySelector("#closeScheduleModal");
  const cancelScheduleButton = document.querySelector("#cancelScheduleButton");
  const deleteScheduleButton = document.querySelector("#deleteScheduleButton");
  const scheduleForm = document.querySelector("#scheduleForm");
  const scheduleModalTitle = document.querySelector("#scheduleModalTitle");
  const submitScheduleButton = document.querySelector("#submitScheduleButton");
  const scheduleError = document.querySelector("#scheduleError");
  const scheduleId = document.querySelector("#scheduleId");
  const scheduleTemplateKey = document.querySelector("#scheduleTemplateKey");
  const scheduleName = document.querySelector("#scheduleName");
  const scheduleDescription = document.querySelector("#scheduleDescription");
  const schedulePrompt = document.querySelector("#schedulePrompt");
  const scheduleEnvironment = document.querySelector("#scheduleEnvironment");
  const scheduleConversation = document.querySelector("#scheduleConversation");
  const scheduleType = document.querySelector("#scheduleType");
  const scheduleRecurrenceKind = document.querySelector("#scheduleRecurrenceKind");
  const scheduleWeekday = document.querySelector("#scheduleWeekday");
  const scheduleTime = document.querySelector("#scheduleTime");
  const scheduleDateTime = document.querySelector("#scheduleDateTime");
  const scheduleEmailRecipient = document.querySelector("#scheduleEmailRecipient");
  const recurrenceKindField = document.querySelector("#recurrenceKindField");
  const weekdayField = document.querySelector("#weekdayField");
  const timeField = document.querySelector("#timeField");
  const oneOffField = document.querySelector("#oneOffField");
  const emailRecipientField = document.querySelector("#emailRecipientField");

  let currentUser = null;
  let currentPage = "infrastructure";
  let assistantView = "schedules";
  let datacenters = [];
  let searchTimer = null;
  let conversationId = null;
  let creatingConversation = false;
  let conversations = [];
  let pendingConversationIds = new Set();
  let schedules = [];
  let templates = [];
  let scheduleFilter = "all";
  let suppressMessageAutoScroll = false;

  const setButtonBusy = (button, busy, label = "") => {
    if (!button) return;
    if (busy) {
      button.dataset.originalLabel = button.textContent;
      if (label) button.textContent = label;
      button.disabled = true;
      button.classList.add("button-busy");
      return;
    }
    if (button.dataset.originalLabel) {
      button.textContent = button.dataset.originalLabel;
    }
    button.disabled = false;
    button.classList.remove("button-busy");
  };

  const request = async (path, options = {}) => {
    const headers = {
      ...(options.headers ?? {}),
    };
    if (options.body !== undefined && options.body !== null) {
      headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
    }
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers,
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
    user.username.endsWith("b") ? "avatar avatar-b" : "avatar";

  const statusLabels = {
    healthy: "正常",
    warning: "告警",
    offline: "离线",
  };

  const recurrenceLabelMap = {
    heart: "♡",
    spark: "✦",
    calendar: "⌕",
    note: "◫",
    mail: "✉",
  };

  const templateIconMap = {
    heart: "♡",
    spark: "✦",
    calendar: "⌕",
    note: "◫",
    mail: "✉",
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

  const formatAbsolute = (value) => {
    if (!value) return "待计算";
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Shanghai",
    }).format(new Date(value));
  };

  const summarizeTitle = (conversation) => {
    const title = (conversation?.title || "未命名会话").trim() || "未命名会话";
    return title.replace(/^\[Schedule\]/, "[安排]");
  };

  const metricCell = (value, status) => {
    const wrapper = document.createElement("div");
    wrapper.className = "metric-cell";
    const label = document.createElement("span");
    label.textContent = status === "offline" ? "--" : `${value}%`;
    const track = document.createElement("i");
    const fill = document.createElement("b");
    fill.style.width = `${Math.min(value, 100)}%`;
    if (value >= 80) fill.className = "high";
    track.append(fill);
    wrapper.append(label, track);
    return wrapper;
  };

  const appendMessage = (content, role, extra = "", shouldScroll = true) => {
    const element = document.createElement("div");
    element.className = `msg ${role} ${extra}`.trim();
    element.textContent = content;
    messages.append(element);
    if (shouldScroll && !suppressMessageAutoScroll) {
      messages.scrollTop = messages.scrollHeight;
    }
    return element;
  };

  const updateHeader = () => {
    const headerAvatar = document.querySelector("#headerAvatar");
    const headerName = document.querySelector("#headerName");
    const headerUsername = document.querySelector("#headerUsername");
    headerAvatar.className = avatarClass(currentUser);
    headerAvatar.textContent = currentUser.display_name.slice(0, 1);
    headerName.textContent = currentUser.display_name;
    headerUsername.textContent = `@${currentUser.username}`;
  };

  const renderMachines = (machines) => {
    machineRows.innerHTML = "";
    emptyState.hidden = machines.length > 0;
    machines.forEach((machine) => {
      const row = document.createElement("tr");

      const statusCell = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `status-badge ${machine.status}`;
      badge.textContent = statusLabels[machine.status];
      statusCell.append(badge);

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
      heartbeat.className = "heartbeat-cell";
      heartbeat.textContent =
        machine.status === "offline" ? "超过 1 小时" : relativeTime(machine.last_heartbeat);

      row.append(statusCell, ...cells, cpu, memory, heartbeat);
      machineRows.append(row);
    });
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

  const updateAssistantButtons = () => {
    assistantSchedulesTab.classList.toggle("active", assistantView === "schedules");
    assistantNewChat.classList.toggle("active", assistantView === "chat");
    scheduleWorkspace.classList.toggle("active", assistantView === "schedules");
    chatWorkspace.classList.toggle("active", assistantView === "chat");
    scheduleWorkspace.hidden = assistantView !== "schedules";
    chatWorkspace.hidden = assistantView !== "chat";
  };

  const renderSuggestions = () => {
    suggestions.innerHTML = "";
    [
      "请总结所有机房的机器运行情况",
      "列出当前所有告警和离线的机器",
      "北京核心机房有多少台机器？",
    ].forEach((text) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.addEventListener("click", () => void submitMessage(text));
      suggestions.append(button);
    });
  };

  const resetChatMessages = () => {
    messages.innerHTML = "";
    const welcome = document.createElement("div");
    welcome.className = "welcome";
    welcome.innerHTML = `
      <b>你好，${currentUser?.display_name ?? "同事"}</b>
      <p>我是共享智能运维助手。你可以创建多个独立会话来排查问题，也可以在日常安排中
      里安排定时巡检任务。</p>
    `;
    const empty = document.createElement("div");
    empty.className = "thread-empty";
    empty.textContent = "从左侧历史会话继续，或者点新建会话开启一段新对话。";
    messages.append(welcome);
    renderSuggestions();
    messages.append(suggestions);
    messages.append(empty);
  };

  const renderConversationGroups = (status = "ready", message = "") => {
    const writeGroup = (container, items, emptyCopy) => {
      container.innerHTML = "";
      if (status === "loading") {
        container.innerHTML = '<div class="conversation-empty">正在读取会话…</div>';
        return;
      }
      if (status === "error") {
        container.innerHTML = `<div class="conversation-empty">${message}</div>`;
        return;
      }
      if (!items.length) {
        container.innerHTML = `<div class="conversation-empty">${emptyCopy}</div>`;
        return;
      }
      items.forEach((conversation) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `conversation-item${
          conversation.id === conversationId ? " active" : ""
        }`;
        button.innerHTML = `
          <span class="conversation-item-title">${summarizeTitle(conversation)}</span>
          <span class="conversation-item-meta">
            <span>${
              pendingConversationIds.has(conversation.id)
                ? "处理中"
                : conversation.letta_conversation_id
                  ? "继续对话"
                  : "新建会话"
            }</span>
            <span>${formatAbsolute(conversation.updated_at)}</span>
          </span>
        `;
        button.addEventListener("click", () => void openConversation(conversation.id));
        container.append(button);
      });
    };

    writeGroup(
      pinnedConversations,
      conversations.slice(0, 1),
      "还没有置顶会话。第一段会话会显示在这里。",
    );
    writeGroup(
      chatConversations,
      conversations.slice(1),
      "暂时还没有更多会话。",
    );
  };

  const renderTurns = (turns) => {
    messages.innerHTML = "";
    if (!turns.length) {
      const empty = document.createElement("div");
      empty.className = "thread-empty";
      empty.textContent = "这个会话还没有消息。现在发一条，我们就从这里接着聊。";
      messages.append(empty);
      return;
    }

    suppressMessageAutoScroll = true;
    turns.forEach((turn) => {
      appendMessage(turn.user_message ?? "", "user");
      if (turn.status === "completed") {
        appendMessage(turn.assistant_message ?? "", "assistant");
      } else if (turn.status === "failed") {
        appendMessage(turn.error || "处理失败", "assistant", "error");
      } else {
        appendMessage(turn.assistant_message || "这条消息仍在处理中。", "assistant", "waiting");
      }
    });
    suppressMessageAutoScroll = false;
    messages.scrollTop = 0;
  };

  const updateComposerState = () => {
    const busy = (!conversationId && creatingConversation) ||
      (conversationId && pendingConversationIds.has(conversationId));
    sendButton.disabled = !currentUser || busy;
  };

  const refreshConversations = async () => {
    if (!currentUser) return;
    renderConversationGroups("loading");
    try {
      const result = await request("/v1/conversations");
      conversations = result.conversations ?? [];
      renderConversationGroups();
    } catch (error) {
      renderConversationGroups("error", `读取会话失败：${error.message}`);
    }
  };

  const openConversation = async (id) => {
    conversationId = id;
    assistantView = "chat";
    updateAssistantButtons();
    renderConversationGroups();
    const currentConversation = conversations.find((item) => item.id === id);
    conversationHeading.textContent = summarizeTitle(currentConversation);
    messages.innerHTML = '<div class="thread-empty">??????...</div>';
    try {
      const result = await request(`/v1/conversations/${id}/messages`);
      renderTurns(result.messages ?? []);
    } catch (error) {
      messages.innerHTML = `<div class="thread-empty">???????${error.message}</div>`;
    }
  };

  const createNewConversationDraft = () => {
    conversationId = null;
    assistantView = "chat";
    updateAssistantButtons();
    conversationHeading.textContent = "新建会话";
    renderConversationGroups();
    resetChatMessages();
    updateComposerState();
    chatInput.focus();
  };

  async function submitMessage(rawText) {
    const text = rawText.trim();
    if (!text || !currentUser) return;
    if ((!conversationId && creatingConversation) || pendingConversationIds.has(conversationId)) {
      return;
    }

    assistantView = "chat";
    updateAssistantButtons();
    appendMessage(text, "user");
    const waiting = appendMessage("正在查询智能体…", "assistant", "waiting");
    let targetConversationId = conversationId;

    chatInput.value = "";
    chatInput.style.height = "auto";

    if (!targetConversationId) {
      creatingConversation = true;
      updateComposerState();
      const created = await request("/v1/conversations", {
        method: "POST",
        body: JSON.stringify({ title: text.slice(0, 40) }),
      });
      targetConversationId = created.id;
      conversationId = created.id;
      creatingConversation = false;
      conversations = [created, ...conversations.filter((item) => item.id !== created.id)];
      renderConversationGroups();
    }

    pendingConversationIds.add(targetConversationId);
    updateComposerState();
    try {
      const result = await request(`/v1/conversations/${targetConversationId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          message: text,
          request_id: crypto.randomUUID(),
        }),
      });
      waiting.className = "msg assistant";
      waiting.textContent = result.answer || "智能体暂时没有返回文字。";
      await refreshConversations();
    } catch (error) {
      waiting.className = "msg assistant error";
      waiting.textContent =
        error.status === 401 ? "登录已失效，请重新登录。" : `请求失败：${error.message}`;
      if (error.status === 401) showLogin();
    } finally {
      pendingConversationIds.delete(targetConversationId);
      updateComposerState();
    }
  }

  const renderScheduleTemplates = () => {
    scheduleTemplates.innerHTML = "";
    templates.forEach((template) => {
      const article = document.createElement("article");
      article.className = "template-card";
      article.innerHTML = `
        <div class="template-card-head">
          <div class="template-icon accent-${template.accent}">${templateIconMap[template.icon] || "✦"}</div>
          <div>
            <h4 class="template-card-title">${template.name}</h4>
            <p class="template-card-copy">${template.description}</p>
          </div>
        </div>
        <div class="schedule-meta">
          <div><span>默认规则</span><b>${template.schedule_type === "one_off" ? "一次性" : template.recurrence_kind === "daily" ? "每天" : template.recurrence_kind === "weekdays" ? "工作日" : "每周"}</b></div>
          <div><span>推荐时间</span><b>${String(template.hour).padStart(2, "0")}:${String(template.minute).padStart(2, "0")}</b></div>
        </div>
        <div class="template-card-actions">
          <button type="button" class="primary-inline">使用此安排</button>
        </div>
      `;
      article.querySelector("button").addEventListener("click", () => openScheduleModal(template));
      scheduleTemplates.append(article);
    });
  };

  const filteredSchedules = () =>
    schedules.filter((schedule) =>
      scheduleFilter === "all" ? true : schedule.schedule_type === scheduleFilter,
    );

  const renderSchedules = () => {
    scheduleList.innerHTML = "";
    const items = filteredSchedules();
    if (!items.length) {
      scheduleList.innerHTML =
        '<div class="schedule-empty">当前筛选下还没有日常安排。你可以先从右上角新建，或直接使用下面的推荐安排。</div>';
      return;
    }

    items.forEach((schedule) => {
      const article = document.createElement("article");
      article.className = "schedule-card";
      article.innerHTML = `
        <div class="schedule-card-head">
          <div class="schedule-icon accent-${schedule.accent}">${recurrenceLabelMap[schedule.icon] || "✦"}</div>
          <div>
            <h4 class="schedule-card-title">${schedule.name}</h4>
            <p class="schedule-card-copy">${schedule.description || schedule.prompt}</p>
          </div>
        </div>
        <div class="schedule-meta">
          <div><span>执行规则</span><b>${schedule.schedule_label}</b></div>
          <div><span>下一次执行</span><b>${formatAbsolute(schedule.next_run_at)}</b></div>
          <div><span>状态</span><b>${schedule.enabled ? "已启用" : "已暂停"}</b></div>
          <div><span>最近执行</span><b>${schedule.last_run_at ? formatAbsolute(schedule.last_run_at) : "尚未执行"}</b></div>
        </div>
        <div class="schedule-card-actions">
          <button type="button" class="primary-inline" data-run>立即执行</button>
          <button type="button" data-edit>编辑</button>
          <button type="button" data-toggle>${schedule.enabled ? "暂停" : "启用"}</button>
        </div>
      `;
      article.querySelector("[data-run]").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        setButtonBusy(button, true, "正在执行...");
        try {
          const result = await request(`/v1/schedules/${schedule.id}/trigger`, {
            method: "POST",
            body: "{}",
          });
          await refreshConversations();
          if (result.conversation_id) {
            assistantView = "chat";
            updateAssistantButtons();
            await openConversation(result.conversation_id);
          }
        } catch (error) {
          button.textContent = "执行失败";
          setTimeout(() => setButtonBusy(button, false), 900);
          return;
        }
        setButtonBusy(button, false);
      });
      article.querySelector("[data-edit]").addEventListener("click", () => openScheduleModal(schedule));
      article.querySelector("[data-toggle]").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        setButtonBusy(button, true, schedule.enabled ? "正在暂停..." : "正在启用...");
        try {
          await request(`/v1/schedules/${schedule.id}`, {
            method: "PATCH",
            body: JSON.stringify({ enabled: !schedule.enabled }),
          });
          await loadSchedules();
        } catch (error) {
          button.textContent = "操作失败";
          setTimeout(() => setButtonBusy(button, false), 900);
        }
      });
      scheduleList.append(article);
    });
  };

  const loadTemplates = async () => {
    const result = await request("/v1/schedules/templates");
    templates = result.templates ?? [];
    renderScheduleTemplates();
  };

  const loadSchedules = async () => {
    if (!currentUser) return;
    const result = await request("/v1/schedules");
    schedules = result.schedules ?? [];
    renderSchedules();
  };

  const toLocalDateTimeInputValue = (date) => {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const nextOneOffDateTime = (hour = 9, minute = 0) => {
    const nextRun = new Date();
    nextRun.setDate(nextRun.getDate() + 1);
    nextRun.setHours(hour, minute, 0, 0);
    return toLocalDateTimeInputValue(nextRun);
  };

  const syncScheduleFields = () => {
    const recurring = scheduleType.value === "recurring";
    const emailSchedule = scheduleTemplateKey.value.includes("email");
    recurrenceKindField.hidden = !recurring;
    timeField.hidden = !recurring;
    oneOffField.hidden = recurring;
    weekdayField.hidden = !recurring || scheduleRecurrenceKind.value !== "weekly";
    scheduleTime.required = recurring;
    scheduleDateTime.required = !recurring;
    emailRecipientField.hidden = !emailSchedule;
    scheduleEmailRecipient.required = emailSchedule;

    if (!recurring) {
      const now = new Date();
      scheduleDateTime.min = toLocalDateTimeInputValue(now);
      if (!scheduleDateTime.value) {
        const [hour, minute] = scheduleTime.value.split(":").map(Number);
        scheduleDateTime.value = nextOneOffDateTime(
          Number.isNaN(hour) ? 9 : hour,
          Number.isNaN(minute) ? 0 : minute,
        );
      }
    }
  };

  const openScheduleModal = (source = null) => {
    scheduleError.textContent = "";
    setButtonBusy(deleteScheduleButton, false);
    setButtonBusy(submitScheduleButton, false);
    scheduleModal.hidden = false;
    scheduleEnvironment.value = "bank-runtime";
    scheduleConversation.value = "new";

    if (source?.id) {
      scheduleModalTitle.textContent = "编辑安排";
      submitScheduleButton.textContent = "保存修改";
      deleteScheduleButton.hidden = false;
      scheduleId.value = source.id;
      scheduleTemplateKey.value = source.category || "";
      scheduleName.value = source.name;
      scheduleDescription.value = source.description || "";
      schedulePrompt.value = source.prompt;
      scheduleType.value = source.schedule_type;
      scheduleRecurrenceKind.value = source.recurrence_kind || "daily";
      scheduleWeekday.value = String(source.weekday ?? 1);
      scheduleTime.value = `${String(source.hour).padStart(2, "0")}:${String(source.minute).padStart(2, "0")}`;
      scheduleDateTime.value = source.scheduled_for
        ? toLocalDateTimeInputValue(new Date(source.scheduled_for))
        : "";
      scheduleEmailRecipient.value = source.recipient_email || "";
    } else {
      const template = source?.key ? source : null;
      scheduleModalTitle.textContent = template ? "使用推荐安排" : "新建安排";
      submitScheduleButton.textContent = "新建安排";
      deleteScheduleButton.hidden = true;
      scheduleId.value = "";
      scheduleTemplateKey.value = template?.key ?? "";
      scheduleName.value = template?.name ?? "";
      scheduleDescription.value = template?.description ?? "";
      schedulePrompt.value = template?.prompt ?? "";
      scheduleType.value = template?.schedule_type ?? "recurring";
      scheduleRecurrenceKind.value = template?.recurrence_kind ?? "daily";
      scheduleWeekday.value = String(template?.weekday ?? 1);
      scheduleTime.value = `${String(template?.hour ?? 9).padStart(2, "0")}:${String(template?.minute ?? 0).padStart(2, "0")}`;
      scheduleDateTime.value =
        template?.schedule_type === "one_off"
          ? nextOneOffDateTime(template?.hour ?? 10, template?.minute ?? 0)
          : "";
      scheduleEmailRecipient.value = "";
    }

    syncScheduleFields();
  };

  const closeScheduleEditor = () => {
    scheduleModal.hidden = true;
  };

  const schedulePayload = () => {
    const [hour, minute] = scheduleTime.value.split(":").map(Number);
    return {
      name: scheduleName.value.trim(),
      description: scheduleDescription.value.trim(),
      prompt: schedulePrompt.value.trim(),
      category: scheduleTemplateKey.value || "custom",
      icon: scheduleTemplateKey.value.includes("email")
        ? "mail"
        : scheduleTemplateKey.value.includes("daily")
          ? "heart"
          : scheduleTemplateKey.value.includes("weekly")
            ? "spark"
            : scheduleTemplateKey.value.includes("weekday")
              ? "calendar"
              : "note",
      accent: scheduleTemplateKey.value.includes("email")
        ? "blue"
        : scheduleTemplateKey.value.includes("daily")
          ? "coral"
          : scheduleTemplateKey.value.includes("weekly")
            ? "mint"
            : scheduleTemplateKey.value.includes("weekday")
              ? "gold"
              : "blue",
      schedule_type: scheduleType.value,
      recurrence_kind: scheduleType.value === "recurring" ? scheduleRecurrenceKind.value : null,
      weekday:
        scheduleType.value === "recurring" && scheduleRecurrenceKind.value === "weekly"
          ? Number(scheduleWeekday.value)
          : null,
      hour: Number.isNaN(hour) ? 9 : hour,
      minute: Number.isNaN(minute) ? 0 : minute,
      scheduled_for:
        scheduleType.value === "one_off" && scheduleDateTime.value
          ? new Date(scheduleDateTime.value).toISOString()
          : null,
      recipient_email: scheduleTemplateKey.value.includes("email")
        ? scheduleEmailRecipient.value.trim()
        : null,
      timezone: "Asia/Shanghai",
      enabled: true,
    };
  };

  const showPage = async (page) => {
    currentPage = page;
    const assistant = page === "assistant";
    navInfrastructure.classList.toggle("active", !assistant);
    navAssistant.classList.toggle("active", assistant);
    infrastructurePage.classList.toggle("active", !assistant);
    assistantPage.classList.toggle("active", assistant);
    infrastructurePage.hidden = assistant;
    assistantPage.hidden = !assistant;

    if (assistant) {
      updateAssistantButtons();
      await Promise.all([refreshConversations(), loadSchedules(), loadTemplates()]);
    } else {
      await initializeInfrastructure();
    }
  };

  const showWorkspace = async (user) => {
    currentUser = user;
    authGate.hidden = true;
    appShell.hidden = false;
    updateHeader();
    resetChatMessages();
    await showPage("infrastructure");
  };

  function showLogin() {
    currentUser = null;
    authGate.hidden = false;
    appShell.hidden = true;
    conversations = [];
    schedules = [];
    pendingConversationIds = new Set();
    conversationId = null;
    creatingConversation = false;
    setTimeout(() => username.focus(), 50);
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.textContent = "";
    loginButton.disabled = true;
    loginButton.firstElementChild.textContent = "正在验证身份…";
    try {
      const result = await request("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: username.value,
          password: password.value,
        }),
      });
      password.value = "";
      await showWorkspace(result.user);
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

  navInfrastructure.addEventListener("click", () => void showPage("infrastructure"));
  navAssistant.addEventListener("click", () => void showPage("assistant"));
  document
    .querySelector("#openAssistantFromInfra")
    ?.addEventListener("click", () => void showPage("assistant"));
  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", async () => {
      await showPage("assistant");
      createNewConversationDraft();
      void submitMessage(button.dataset.prompt);
    });
  });

  assistantSchedulesTab.addEventListener("click", async () => {
    assistantView = "schedules";
    updateAssistantButtons();
    await loadSchedules();
  });

  assistantNewChat.addEventListener("click", () => {
    createNewConversationDraft();
  });

  chatRefreshButton.addEventListener("click", async () => {
    if (conversationId) {
      await openConversation(conversationId);
    } else {
      await refreshConversations();
    }
  });

  chatComposer.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitMessage(chatInput.value);
  });

  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      chatComposer.requestSubmit();
    }
  });

  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
  });

  scheduleTabs.forEach((button) => {
    button.addEventListener("click", () => {
      scheduleFilter = button.dataset.filter;
      scheduleTabs.forEach((item) => item.classList.toggle("active", item === button));
      renderSchedules();
    });
  });

  createScheduleButton.addEventListener("click", () => openScheduleModal());
  closeScheduleModal.addEventListener("click", closeScheduleEditor);
  cancelScheduleButton.addEventListener("click", closeScheduleEditor);
  scheduleModal.addEventListener("click", (event) => {
    if (event.target === scheduleModal) closeScheduleEditor();
  });
  scheduleType.addEventListener("change", syncScheduleFields);
  scheduleRecurrenceKind.addEventListener("change", syncScheduleFields);

  deleteScheduleButton.addEventListener("click", async () => {
    if (!scheduleId.value) return;
    scheduleError.textContent = "";
    setButtonBusy(deleteScheduleButton, true, "正在删除...");
    try {
      await request(`/v1/schedules/${scheduleId.value}`, {
        method: "DELETE",
      });
      setButtonBusy(deleteScheduleButton, false);
      closeScheduleEditor();
      await loadSchedules();
    } catch (error) {
      scheduleError.textContent = `删除失败：${error.message}`;
      setButtonBusy(deleteScheduleButton, false);
    }
  });

  scheduleForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    scheduleError.textContent = "";

    if (scheduleType.value === "one_off" && !scheduleDateTime.value) {
      scheduleError.textContent = "请选择一次安排的执行日期和时间。";
      scheduleDateTime.focus();
      return;
    }

    if (
      scheduleType.value === "one_off" &&
      new Date(scheduleDateTime.value).getTime() <= Date.now()
    ) {
      scheduleError.textContent = "一次安排的执行时间必须晚于当前时间。";
      scheduleDateTime.focus();
      return;
    }

    if (
      scheduleTemplateKey.value.includes("email") &&
      !scheduleEmailRecipient.value.trim()
    ) {
      scheduleError.textContent = "请输入收件人的邮箱地址。";
      scheduleEmailRecipient.focus();
      return;
    }

    const payload = schedulePayload();
    setButtonBusy(
      submitScheduleButton,
      true,
      scheduleId.value ? "正在保存..." : "正在新建...",
    );
    try {
      if (scheduleId.value) {
        await request(`/v1/schedules/${scheduleId.value}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await request("/v1/schedules", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      closeScheduleEditor();
      await loadSchedules();
    } catch (error) {
      scheduleError.textContent = error.message.includes("scheduled_for")
        ? "请选择一次安排的执行日期和时间。"
        : error.message;
    } finally {
      setButtonBusy(submitScheduleButton, false);
    }
  });

  request("/v1/auth/me")
    .then((result) => showWorkspace(result.user))
    .catch(() => showLogin());
})();
