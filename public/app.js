(() => {
  const authGate = document.querySelector("#authGate");
  const appShell = document.querySelector("#appShell");
  const loginForm = document.querySelector("#loginForm");
  const loginIdentifier = document.querySelector("#loginIdentifier");
  const password = document.querySelector("#password");
  const loginButton = document.querySelector("#loginButton");
  const loginError = document.querySelector("#loginError");
  const accountMenuButton = document.querySelector("#accountMenuButton");
  const accountMenu = document.querySelector("#accountMenu");

  const navInfrastructure = document.querySelector("#navInfrastructure");
  const navVendors = document.querySelector("#navVendors");
  const navAssistant = document.querySelector("#navAssistant");
  const infrastructurePage = document.querySelector("#infrastructurePage");
  const vendorsPage = document.querySelector("#vendorsPage");
  const assistantPage = document.querySelector("#assistantPage");

  const machineRows = document.querySelector("#machineRows");
  const emptyState = document.querySelector("#emptyState");
  const datacenterFilters = document.querySelector("#datacenterFilters");
  const statusFilter = document.querySelector("#statusFilter");
  const machineSearch = document.querySelector("#machineSearch");
  const selectedDatacenters = new Set();
  const vendorCards = document.querySelector("#vendorCards");
  const vendorSearch = document.querySelector("#vendorSearch");
  const vendorEmptyState = document.querySelector("#vendorEmptyState");

  const assistantSchedulesTab = document.querySelector("#assistantSchedulesTab");
  const assistantNewChat = document.querySelector("#assistantNewChat");
  const chatConversations = document.querySelector("#chatConversations");
  const chatWorkspace = document.querySelector("#chatWorkspace");
  const scheduleWorkspace = document.querySelector("#scheduleWorkspace");
  const conversationHeading = document.querySelector("#conversationHeading");
  const messages = document.querySelector("#messages");
  const suggestions = document.querySelector("#assistantSuggestions");
  const chatComposer = document.querySelector("#chatComposer");
  const chatInput = document.querySelector("#chatInput");
  const sendButton = document.querySelector("#sendButton");
  const attachmentInput = document.querySelector("#attachmentInput");
  const attachButton = document.querySelector("#attachButton");
  const attachmentMenu = document.querySelector("#attachmentMenu");
  const attachmentPreview = document.querySelector("#attachmentPreview");
  const skillPalette = document.querySelector("#skillPalette");
  const skillPaletteList = document.querySelector("#skillPaletteList");

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
  const scheduleRecurrenceKind = document.querySelector("#scheduleRecurrenceKind");
  const scheduleWeekday = document.querySelector("#scheduleWeekday");
  const scheduleTime = document.querySelector("#scheduleTime");
  const scheduleEmailRecipient = document.querySelector("#scheduleEmailRecipient");
  const scheduleSenderEmail = document.querySelector("#scheduleSenderEmail");
  const scheduleSenderAuthCode = document.querySelector("#scheduleSenderAuthCode");
  const recurrenceKindField = document.querySelector("#recurrenceKindField");
  const weekdayField = document.querySelector("#weekdayField");
  const timeField = document.querySelector("#timeField");
  const emailRecipientField = document.querySelector("#emailRecipientField");
  const emailSenderField = document.querySelector("#emailSenderField");
  const emailAuthCodeField = document.querySelector("#emailAuthCodeField");
  const emailAuthCodeHint = document.querySelector("#emailAuthCodeHint");
  const stepUpModal = document.querySelector("#stepUpModal");
  const stepUpForm = document.querySelector("#stepUpForm");
  const stepUpPassword = document.querySelector("#stepUpPassword");
  const stepUpError = document.querySelector("#stepUpError");
  const closeStepUpModal = document.querySelector("#closeStepUpModal");
  const cancelStepUpButton = document.querySelector("#cancelStepUpButton");
  const submitStepUpButton = document.querySelector("#submitStepUpButton");

  const pageStateKey = "bank-agent:current-page";
  const assistantViewStateKey = "bank-agent:assistant-view";
  const conversationStateKey = "bank-agent:conversation-id";
  const storedPage = window.sessionStorage.getItem(pageStateKey);
  const storedAssistantView = window.sessionStorage.getItem(assistantViewStateKey);

  let currentUser = null;
  let currentPage = ["infrastructure", "vendors", "assistant"].includes(storedPage)
    ? storedPage
    : "infrastructure";
  let assistantView = ["schedules", "chat"].includes(storedAssistantView)
    ? storedAssistantView
    : "schedules";
  let datacenters = [];
  let vendors = [];
  let searchTimer = null;
  let infrastructureRefreshTimer = null;
  let conversationId = null;
  let creatingConversation = false;
  let conversations = [];
  let pendingConversationIds = new Set();
  const conversationStreams = new Map();
  const conversationTurnCache = new Map();
  const streamAnimationFrames = new Map();
  let conversationLoadVersion = 0;
  let schedules = [];
  let templates = [];
  let scheduleFilter = "all";
  let suppressMessageAutoScroll = false;
  let pageIsUnloading = false;
  let pendingAttachments = [];
  const activeAttachmentReaders = new Set();
  const activeAttachmentRequests = new Set();
  let skills = [];
  let visibleSkills = [];
  let skillSelectionIndex = 0;
  let pendingStepUpTemplate = null;
  let emailScheduleReauthToken = null;

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

  const loadSkills = async () => {
    const result = await request("/v1/skills");
    skills = Array.isArray(result.skills) ? result.skills : [];
  };

  const closeSkillPalette = () => {
    skillPalette.hidden = true;
    visibleSkills = [];
    skillSelectionIndex = 0;
  };

  const selectSkill = (skill) => {
    chatInput.value = `/${skill.name} `;
    closeSkillPalette();
    chatInput.focus();
    chatInput.style.height = "auto";
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
    updateComposerState();
  };

  const renderSkillPalette = () => {
    skillPaletteList.replaceChildren();
    visibleSkills.forEach((skill, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "skill-palette-item";
      button.classList.toggle("active", index === skillSelectionIndex);
      button.setAttribute("role", "option");
      button.setAttribute(
        "aria-selected",
        index === skillSelectionIndex ? "true" : "false",
      );

      const icon = document.createElement("span");
      icon.className = "skill-palette-icon";
      icon.textContent = "◇";
      const content = document.createElement("span");
      content.className = "skill-palette-content";
      const heading = document.createElement("span");
      heading.className = "skill-palette-name";
      heading.textContent = skill.display_name;
      const description = document.createElement("span");
      description.className = "skill-palette-description";
      description.textContent = skill.short_description;
      const command = document.createElement("code");
      command.textContent = `/${skill.name}`;
      content.append(heading, description);
      button.append(icon, content, command);
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => selectSkill(skill));
      skillPaletteList.append(button);
    });
  };

  const updateSkillPalette = () => {
    const match = chatInput.value.match(/^\/([^\s]*)$/);
    if (!match || !skills.length) {
      closeSkillPalette();
      return;
    }
    const query = match[1].toLowerCase();
    visibleSkills = skills.filter((skill) =>
      [skill.name, skill.display_name, skill.short_description]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
    if (!visibleSkills.length) {
      closeSkillPalette();
      return;
    }
    skillSelectionIndex = Math.min(
      skillSelectionIndex,
      visibleSkills.length - 1,
    );
    renderSkillPalette();
    skillPalette.hidden = false;
  };

  const wait = (milliseconds) =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds));

  const createRequestId = () =>
    globalThis.crypto?.randomUUID?.() ??
    `request-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const streamRequest = async (path, payload, onEvent) => {
    const maximumAttempts = 4;
    let response = null;

    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      try {
        response = await fetch(path, {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        if (attempt === maximumAttempts) throw error;
        await wait(700 * 2 ** (attempt - 1));
        continue;
      }

      if (response.ok) break;

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      const isFrpFallback = response.status === 404 && contentType.includes("text/html");
      const isTemporaryGatewayFailure = [502, 503, 504].includes(response.status);
      const shouldRetry = isFrpFallback || isTemporaryGatewayFailure;

      if (shouldRetry && attempt < maximumAttempts) {
        await response.text().catch(() => "");
        await wait(700 * 2 ** (attempt - 1));
        continue;
      }

      const body = contentType.includes("json")
        ? await response.json().catch(() => ({}))
        : {};
      throw Object.assign(new Error(body?.error ?? `HTTP ${response.status}`), {
        status: response.status,
      });
    }

    if (!response?.ok) {
      throw new Error("连接智能助手失败，请稍后重试");
    }
    if (!response.body) {
      const body = await response.json();
      onEvent(body);
      return body;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalEvent = null;

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        finalEvent = event.type === "final" ? event : finalEvent;
        await onEvent(event);
      }
      if (done) break;
    }

    if (buffer.trim()) {
      const event = JSON.parse(buffer);
      finalEvent = event.type === "final" ? event : finalEvent;
      await onEvent(event);
    }

    return finalEvent;
  };

  const gatewayRequest = async (path, options = {}, maximumAttempts = 10) => {
    let lastError = null;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      try {
        const response = await fetch(path, {
          credentials: "same-origin",
          ...options,
          headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.headers ?? {}),
          },
        });
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        const isFrpFallback = response.status === 404 && contentType.includes("text/html");
        const isTemporaryGatewayFailure = [502, 503, 504].includes(response.status);
        if ((isFrpFallback || isTemporaryGatewayFailure) && attempt < maximumAttempts) {
          await response.text().catch(() => "");
          await wait(Math.min(2_000, 350 * attempt));
          continue;
        }

        const body = contentType.includes("json")
          ? await response.json().catch(() => ({}))
          : {};
        if (!response.ok) {
          throw Object.assign(new Error(body?.error ?? `HTTP ${response.status}`), {
            status: response.status,
          });
        }
        return body;
      } catch (error) {
        lastError = error;
        if (error?.status || attempt === maximumAttempts) throw error;
        await wait(Math.min(2_000, 350 * attempt));
      }
    }
    throw lastError ?? new Error("连接智能助手失败，请稍后重试");
  };

  const pollMessageJobRequest = async (jobId, onEvent) => {
    let cursor = 0;
    let finalEvent = null;
    const deadline = Date.now() + 15 * 60 * 1000;
    while (Date.now() < deadline) {
      const snapshot = await gatewayRequest(
        `/v1/message-jobs/${encodeURIComponent(jobId)}?after=${cursor}`,
        {},
        12,
      );
      for (const event of snapshot.events ?? []) {
        cursor += 1;
        if (event.type === "final") finalEvent = event;
        await onEvent(event);
      }
      if (snapshot.status === "completed") return finalEvent;
      if (snapshot.status === "failed") {
        const error = new Error(snapshot.error || "智能助手处理失败");
        error.jobFailed = true;
        throw error;
      }
      cursor = Math.max(cursor, Number(snapshot.next_cursor) || cursor);
      await wait(500);
    }
    throw new Error("智能助手处理超时，请稍后刷新会话查看结果");
  };

  const runMessageJobRequest = async (path, payload, onEvent) => {
    const accepted = await gatewayRequest(
      path,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      12,
    );
    const jobId = accepted.job_id;
    if (!jobId) throw new Error("服务未返回任务编号");
    return pollMessageJobRequest(jobId, onEvent);
  };

  const resumedMessageJobs = new Set();

  const applyConversationJobEvent = async (
    targetConversationId,
    requestId,
    event,
  ) => {
    const state = conversationStreams.get(targetConversationId);
    if (!state || state.requestId !== requestId) return false;
    if (event.type === "delta") {
      enqueueConversationDelta(targetConversationId, requestId, event.text || "");
      return false;
    }
    if (event.type === "final") {
      const finalAnswer = event.answer || state.receivedText || state.text;
      await finishConversationStream(targetConversationId, requestId, finalAnswer);
      updateCachedTurn(targetConversationId, requestId, {
        assistant_message: finalAnswer,
        status: "completed",
        error: null,
      });
      return true;
    }
    if (event.type === "error") {
      const error = new Error(event.error || "Agent job failed");
      error.jobFailed = true;
      throw error;
    }
    return false;
  };

  const resumeConversationJob = async (targetConversationId, requestId) => {
    if (!targetConversationId || !requestId || resumedMessageJobs.has(requestId)) return;
    resumedMessageJobs.add(requestId);
    pendingConversationIds.add(targetConversationId);
    conversationStreams.set(targetConversationId, {
      requestId,
      status: "pending",
      text: "",
      receivedText: "",
      pendingCharacters: [],
      finalAnswer: null,
      resolveAnimation: null,
      answer: "",
      error: "",
      waitingText: "正在查询智能体…",
    });
    updateComposerState();
    renderConversationGroups();
    renderConversationStream(targetConversationId, true);

    try {
      await pollMessageJobRequest(requestId, (event) =>
        applyConversationJobEvent(targetConversationId, requestId, event),
      );
      await refreshConversations();
      if (conversationId === targetConversationId) {
        const result = await request(`/v1/conversations/${targetConversationId}/messages`);
        if (conversationId === targetConversationId) {
          conversationTurnCache.set(targetConversationId, result.messages ?? []);
          renderTurns(result.messages ?? []);
        }
      }
    } catch (error) {
      const state = conversationStreams.get(targetConversationId);
      if (state?.requestId === requestId) {
        cancelStreamAnimation(requestId);
        state.pendingCharacters = [];
        state.status = "failed";
        state.error = error.jobFailed
          ? `处理失败：${error.message}`
          : `连接中断：${error.message}。刷新页面可继续恢复。`;
        if (error.jobFailed) {
          updateCachedTurn(targetConversationId, requestId, {
            assistant_message: "",
            status: "failed",
            error: state.error,
          });
        }
        renderConversationStream(targetConversationId);
      }
      if (error.status === 401) showLogin();
    } finally {
      pendingConversationIds.delete(targetConversationId);
      resumedMessageJobs.delete(requestId);
      updateComposerState();
      renderConversationGroups();
    }
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
      hour12: false,
      timeZone: "Asia/Shanghai",
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

  const stripLegacyAttachmentSummary = (content) =>
    String(content ?? "")
      .replace(/\n{2,}\[\u9644\u4ef6\]\n(?:- [^\n]+(?:\n|$))+/u, "")
      .trim();

  const appendMessage = (
    content,
    role,
    extra = "",
    shouldScroll = false,
    messageAttachments = [],
  ) => {
    const element = document.createElement("div");
    element.className = `msg ${role} ${extra}`.trim();
    if (role === "assistant" && !extra) {
      if (window.BankMarkdown?.render) {
        window.BankMarkdown.render(element, content);
      } else {
        element.textContent = content;
      }
    } else if (role === "user") {
      const visibleContent = stripLegacyAttachmentSummary(content);
      if (messageAttachments.length) {
        element.classList.add("has-attachments");
        renderMessageAttachments(element, messageAttachments);
      }
      if (visibleContent) {
        const text = document.createElement("div");
        text.className = "message-text";
        text.textContent = visibleContent;
        element.append(text);
      }
    } else {
      element.textContent = content;
    }
    messages.append(element);
    if (shouldScroll && !suppressMessageAutoScroll) {
      scrollConversationToBottom();
    }
    return element;
  };

  const scrollConversationToBottom = () => {
    messages.scrollTop = messages.scrollHeight;
  };

  const scrollPromptToReadingPosition = (element) => {
    if (!element) return;
    const targetTop = Math.max(0, element.offsetTop - messages.clientHeight * 0.32);
    messages.scrollTop = targetTop;
  };

  const findStreamMessage = (requestId) =>
    [...messages.querySelectorAll("[data-stream-request-id]")].find(
      (element) => element.dataset.streamRequestId === requestId,
    ) ?? null;

  const renderConversationStream = (targetConversationId, shouldScroll = false) => {
    if (assistantView !== "chat" || conversationId !== targetConversationId) return;
    const state = conversationStreams.get(targetConversationId);
    if (!state) return;

    let element = findStreamMessage(state.requestId);
    if (!element) {
      messages.querySelector(".thread-empty")?.remove();
      element = appendMessage("", "assistant", "", false);
      element.dataset.streamRequestId = state.requestId;
    }

    if (state.status === "failed") {
      element.className = "msg assistant error";
      element.textContent = state.error || "智能体请求失败";
    } else if (state.status === "completed") {
      element.className = "msg assistant";
      const answer = state.answer || state.text || "智能体暂时没有返回文字。";
      if (window.BankMarkdown?.render) {
        window.BankMarkdown.render(element, answer);
      } else {
        element.textContent = answer;
      }
    } else if (state.text) {
      element.className = "msg assistant";
      if (window.BankMarkdown?.render) {
        window.BankMarkdown.render(element, state.text);
      } else {
        element.textContent = state.text;
      }
    } else {
      element.className = "msg assistant waiting";
      element.textContent = state.waitingText;
    }

    if (shouldScroll && !suppressMessageAutoScroll) {
      scrollConversationToBottom();
    }
  };

  const streamCharactersPerFrame = (backlog) => {
    if (backlog > 2_000) return 48;
    if (backlog > 800) return 24;
    if (backlog > 300) return 12;
    if (backlog > 120) return 6;
    if (backlog > 40) return 3;
    return 1;
  };

  const cancelStreamAnimation = (requestId) => {
    const frame = streamAnimationFrames.get(requestId);
    if (frame) window.cancelAnimationFrame(frame);
    streamAnimationFrames.delete(requestId);
  };

  const animateConversationStream = (targetConversationId, requestId) => {
    if (streamAnimationFrames.has(requestId)) return;

    const draw = () => {
      streamAnimationFrames.delete(requestId);
      const state = conversationStreams.get(targetConversationId);
      if (!state || state.requestId !== requestId || state.status === "failed") return;

      const backlog = state.pendingCharacters?.length ?? 0;
      if (backlog > 0) {
        const count = streamCharactersPerFrame(backlog);
        state.text += state.pendingCharacters.splice(0, count).join("");
        renderConversationStream(targetConversationId);
      }

      if (state.pendingCharacters?.length) {
        streamAnimationFrames.set(requestId, window.requestAnimationFrame(draw));
        return;
      }

      if (state.finalAnswer !== null && state.finalAnswer !== undefined) {
        state.status = "completed";
        state.answer = state.finalAnswer;
        renderConversationStream(targetConversationId);
        state.resolveAnimation?.();
        state.resolveAnimation = null;
      }
    };

    streamAnimationFrames.set(requestId, window.requestAnimationFrame(draw));
  };

  const enqueueConversationDelta = (targetConversationId, requestId, text) => {
    if (!text) return;
    const state = conversationStreams.get(targetConversationId);
    if (!state || state.requestId !== requestId) return;
    state.receivedText += text;
    state.pendingCharacters.push(...Array.from(text));
    animateConversationStream(targetConversationId, requestId);
  };

  const finishConversationStream = (targetConversationId, requestId, answer) => {
    const state = conversationStreams.get(targetConversationId);
    if (!state || state.requestId !== requestId) return Promise.resolve();

    const finalAnswer = answer || state.receivedText || state.text;
    if (finalAnswer.startsWith(state.receivedText)) {
      const remainder = finalAnswer.slice(state.receivedText.length);
      if (remainder) {
        state.receivedText += remainder;
        state.pendingCharacters.push(...Array.from(remainder));
      }
    }
    state.finalAnswer = finalAnswer;
    state.status = "finishing";

    if (!state.pendingCharacters.length) {
      state.status = "completed";
      state.answer = finalAnswer;
      renderConversationStream(targetConversationId);
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      state.resolveAnimation = resolve;
      animateConversationStream(targetConversationId, requestId);
    });
  };

  const formatBytes = (bytes = 0) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const readAsDataUrl = (file, onProgress = () => {}) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      activeAttachmentReaders.add(reader);
      reader.addEventListener("load", () => {
        activeAttachmentReaders.delete(reader);
        resolve(String(reader.result));
      });
      reader.addEventListener("error", () => {
        activeAttachmentReaders.delete(reader);
        reject(reader.error);
      });
      reader.addEventListener("abort", () => {
        activeAttachmentReaders.delete(reader);
        reject(new Error("附件读取已取消"));
      });
      reader.addEventListener("progress", (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total);
      });
      reader.readAsDataURL(file);
    });

  const uploadAttachment = (attachment, onProgress) =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      activeAttachmentRequests.add(xhr);
      xhr.open("POST", "/v1/attachment-uploads");
      xhr.withCredentials = true;
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total);
      });
      xhr.addEventListener("load", () => {
        activeAttachmentRequests.delete(xhr);
        let body = {};
        try {
          body = JSON.parse(xhr.responseText || "{}");
        } catch {
          body = {};
        }
        if (xhr.status >= 200 && xhr.status < 300 && body.upload_id) {
          resolve(body.upload_id);
          return;
        }
        reject(Object.assign(new Error(body.error || `HTTP ${xhr.status}`), {
          status: xhr.status,
        }));
      });
      xhr.addEventListener("error", () => {
        activeAttachmentRequests.delete(xhr);
        reject(new Error("附件上传失败"));
      });
      xhr.addEventListener("abort", () => {
        activeAttachmentRequests.delete(xhr);
        reject(new Error("附件上传已取消"));
      });
      xhr.send(JSON.stringify(attachment));
    });

  const discardAttachmentUpload = (uploadId) => {
    if (!uploadId) return;
    void request(`/v1/attachment-uploads/${encodeURIComponent(uploadId)}`, {
      method: "DELETE",
    }).catch(() => null);
  };

  const supportedDocumentPattern =
    /\.(pdf|docx|pptx|xlsx|odt|ods|odp|rtf|epub|txt|md|log|csv|tsv|json|jsonl|yaml|yml|xml|html?|sql|py|js|mjs|cjs|jsx|ts|tsx|java|c|h|cpp|hpp|go|rs|sh|ps1|ini|conf|properties)$/i;

  const isSupportedDocument = (file) => supportedDocumentPattern.test(file.name);

  const isPdfFile = (file) =>
    file.type === "application/pdf" || /\.pdf$/i.test(file.name);

  const attachmentIcon = (attachment) => {
    if (attachment.kind === "image") return "IMG";
    const extension = attachment.name.split(".").pop()?.toUpperCase() ?? "FILE";
    return extension.slice(0, 5);
  };

  let imagePreviewLightbox = null;

  const ensureImagePreviewLightbox = () => {
    if (imagePreviewLightbox) return imagePreviewLightbox;

    const backdrop = document.createElement("div");
    backdrop.className = "image-lightbox";
    backdrop.hidden = true;

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "image-lightbox-close";
    closeButton.setAttribute("aria-label", "Close image preview");
    closeButton.textContent = "×";

    const image = document.createElement("img");
    image.className = "image-lightbox-img";
    image.alt = "";

    backdrop.append(closeButton, image);
    document.body.append(backdrop);

    const close = () => {
      backdrop.hidden = true;
      image.removeAttribute("src");
      document.body.classList.remove("image-lightbox-open");
    };

    closeButton.addEventListener("click", close);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close();
    });
    document.addEventListener("keydown", (event) => {
      if (!backdrop.hidden && event.key === "Escape") close();
    });

    imagePreviewLightbox = { backdrop, image };
    return imagePreviewLightbox;
  };

  const openImagePreview = (attachment) => {
    const source = attachment.previewUrl || attachment.url;
    if (!source) return;
    const lightbox = ensureImagePreviewLightbox();
    lightbox.image.src = source;
    lightbox.image.alt = attachment.name;
    lightbox.backdrop.hidden = false;
    document.body.classList.add("image-lightbox-open");
  };

  const renderMessageAttachments = (container, attachments) => {
    const images = attachments.filter(
      (attachment) =>
        attachment.kind === "image" &&
        (attachment.previewUrl || attachment.url),
    );
    const files = attachments.filter((attachment) => attachment.kind !== "image");

    if (images.length) {
      const grid = document.createElement("div");
      grid.className = `message-image-grid count-${Math.min(images.length, 4)}`;
      images.forEach((attachment) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "message-image-button";
        button.setAttribute("aria-label", `查看图片 ${attachment.name}`);
        button.title = attachment.name;

        const image = document.createElement("img");
        image.src = attachment.previewUrl || attachment.url;
        image.alt = attachment.name;
        image.loading = "lazy";
        image.decoding = "async";
        button.append(image);
        button.addEventListener("click", () => openImagePreview(attachment));
        grid.append(button);
      });
      container.append(grid);
    }

    if (files.length) {
      const list = document.createElement("div");
      list.className = "message-file-list";
      files.forEach((attachment) => {
        const file = document.createElement("div");
        file.className = "message-file-card";
        const icon = document.createElement("span");
        icon.className = "attachment-file-icon";
        icon.textContent = attachmentIcon(attachment);
        const meta = document.createElement("span");
        meta.className = "message-file-meta";
        const name = document.createElement("strong");
        name.textContent = attachment.name;
        const size = document.createElement("small");
        size.textContent = formatBytes(attachment.size);
        meta.append(name, size);
        file.append(icon, meta);
        list.append(file);
      });
      container.append(list);
    }
  };

  const updateAttachmentProgress = (attachment) => {
    const item = [...attachmentPreview.querySelectorAll("[data-attachment-local-id]")]
      .find((element) => element.dataset.attachmentLocalId === attachment.localId);
    if (!item) return;
    const progress = item.querySelector(".attachment-upload-progress");
    const detail = item.querySelector(".attachment-chip-detail");
    const value = Math.max(4, Math.min(100, attachment.progress || 0));
    progress?.style.setProperty("--attachment-progress", String(value));
    progress?.setAttribute("aria-valuenow", String(Math.round(attachment.progress || 0)));
    if (detail) detail.textContent = `上传中 ${Math.round(attachment.progress || 0)}%`;
  };

  const renderAttachmentPreview = () => {
    attachmentPreview.innerHTML = "";
    attachmentPreview.hidden = pendingAttachments.length === 0;
    pendingAttachments.forEach((attachment, index) => {
      const item = document.createElement("div");
      item.className = `attachment-chip ${attachment.kind}`;
      item.dataset.attachmentLocalId = attachment.localId;
      if (attachment.loading) {
        const progress = document.createElement("span");
        progress.className = "attachment-upload-progress";
        progress.style.setProperty(
          "--attachment-progress",
          String(Math.max(4, Math.min(100, attachment.progress || 0))),
        );
        progress.setAttribute("role", "progressbar");
        progress.setAttribute("aria-valuemin", "0");
        progress.setAttribute("aria-valuemax", "100");
        progress.setAttribute("aria-valuenow", String(Math.round(attachment.progress || 0)));
        item.append(progress);
      } else if (attachment.kind === "image") {
        const previewButton = document.createElement("button");
        previewButton.type = "button";
        previewButton.className = "attachment-image-preview";
        previewButton.setAttribute("aria-label", `Preview ${attachment.name}`);
        const image = document.createElement("img");
        image.src = attachment.previewUrl;
        image.alt = attachment.name;
        previewButton.append(image);
        previewButton.addEventListener("click", () => openImagePreview(attachment));
        item.append(previewButton);
      } else {
        const icon = document.createElement("span");
        icon.className = "attachment-file-icon";
        icon.textContent = attachmentIcon(attachment);
        item.append(icon);
      }
      const meta = document.createElement("span");
      meta.className = "attachment-chip-meta";
      const name = document.createElement("strong");
      name.textContent = attachment.name;
      const detail = document.createElement("small");
      detail.className = "attachment-chip-detail";
      detail.textContent = attachment.loading
        ? `上传中 ${Math.round(attachment.progress || 0)}%`
        : `${attachmentIcon(attachment)} · ${formatBytes(attachment.size)}`;
      meta.append(name, detail);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `移除 ${attachment.name}`);
      remove.addEventListener("click", () => {
        const [removed] = pendingAttachments.splice(index, 1);
        discardAttachmentUpload(removed?.uploadId);
        renderAttachmentPreview();
        updateComposerState();
      });
      item.append(meta, remove);
      attachmentPreview.append(item);
    });
  };

  const showAttachmentError = (message) => {
    const chip = document.createElement("div");
    chip.className = "attachment-error";
    chip.textContent = message;
    attachmentPreview.hidden = false;
    attachmentPreview.append(chip);
    setTimeout(() => {
      if (chip.isConnected) chip.remove();
      if (!pendingAttachments.length && !attachmentPreview.children.length) {
        attachmentPreview.hidden = true;
      }
    }, 3600);
  };

  const addFiles = async (files) => {
    const selected = [...files];
    const errors = [];
    const uploads = [];
    let totalBytes = pendingAttachments.reduce(
      (sum, attachment) => sum + (attachment.size || 0),
      0,
    );
    for (const file of selected) {
      if (pendingAttachments.length >= 4) {
        errors.push("一次最多添加 4 个附件。");
        break;
      }
      try {
        if (!file.size) {
          errors.push(`${file.name} 是空文件，无法发送。`);
          continue;
        }
        if (totalBytes + file.size > 20 * 1024 * 1024) {
          errors.push("附件总大小不能超过 20MB。");
          continue;
        }
        let kind;
        let mediaType;
        if (file.type.startsWith("image/")) {
          if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) {
            errors.push(`${file.name} 不是支持的图片格式。`);
            continue;
          }
          if (file.size > 4 * 1024 * 1024) {
            errors.push(`${file.name} 超过 4MB，无法发送。`);
            continue;
          }
          kind = "image";
          mediaType = file.type;
        } else if (isPdfFile(file)) {
          if (file.size > 20 * 1024 * 1024) {
            errors.push(`${file.name} 超过 20MB，无法解析。`);
            continue;
          }
          kind = "pdf";
          mediaType = "application/pdf";
        } else if (isSupportedDocument(file)) {
          if (file.size > 20 * 1024 * 1024) {
            errors.push(`${file.name} 超过 20MB，无法解析。`);
            continue;
          }
          kind = "document";
          mediaType = file.type || "application/octet-stream";
        } else {
          errors.push(
            `${file.name} 暂不支持，请转换为 PDF、DOCX、PPTX、XLSX、ODT、RTF、EPUB 或纯文本格式。`,
          );
          continue;
        }

        const attachment = {
          localId: createRequestId(),
          kind,
          name: file.name,
          media_type: mediaType,
          size: file.size,
          loading: true,
          progress: 0,
        };
        pendingAttachments.push(attachment);
        uploads.push({ file, attachment });
        totalBytes += file.size;
      } catch (error) {
        errors.push(`${file.name} 读取失败：${error.message || "未知错误"}`);
      }
    }
    renderAttachmentPreview();
    updateComposerState();

    await Promise.all(
      uploads.map(async ({ file, attachment }) => {
        let lastProgressPaint = 0;
        const setProgress = (value) => {
          const nextProgress = Math.max(0, Math.min(100, Math.round(value)));
          if (nextProgress === attachment.progress) return;
          attachment.progress = nextProgress;
          const now = performance.now();
          if (
            !pageIsUnloading &&
            pendingAttachments.includes(attachment) &&
            (nextProgress >= 100 || now - lastProgressPaint >= 100)
          ) {
            lastProgressPaint = now;
            updateAttachmentProgress(attachment);
          }
        };
        try {
          const dataUrl = await readAsDataUrl(file, (progress) =>
            setProgress(progress * 20),
          );
          const [, data = ""] = dataUrl.split(",");
          const payload = {
            kind: attachment.kind,
            name: attachment.name,
            media_type: attachment.media_type,
            data,
            size: attachment.size,
          };
          const uploadId = await uploadAttachment(payload, (progress) =>
            setProgress(20 + progress * 80),
          );
          if (!pendingAttachments.includes(attachment)) {
            discardAttachmentUpload(uploadId);
            return;
          }
          attachment.uploadId = uploadId;
          attachment.loading = false;
          attachment.progress = 100;
          if (attachment.kind === "image") attachment.previewUrl = dataUrl;
        } catch (error) {
          const index = pendingAttachments.indexOf(attachment);
          if (index >= 0) pendingAttachments.splice(index, 1);
          errors.push(`${file.name} 上传失败：${error.message || "未知错误"}`);
        } finally {
          if (!pageIsUnloading) {
            renderAttachmentPreview();
            updateComposerState();
          }
        }
      }),
    );
    if (!pageIsUnloading) errors.forEach(showAttachmentError);
  };

  const displayAttachments = (attachments) =>
    attachments.map(({ data, text, ...attachment }) => attachment);

  const clearPendingAttachments = () => {
    pendingAttachments.forEach((attachment) =>
      discardAttachmentUpload(attachment.uploadId),
    );
    pendingAttachments = [];
    renderAttachmentPreview();
    updateComposerState();
  };

  const updateHeader = () => {
    const headerAvatar = document.querySelector("#headerAvatar");
    const headerName = document.querySelector("#headerName");
    const headerUsername = document.querySelector("#headerUsername");
    headerAvatar.className = avatarClass(currentUser);
    headerAvatar.textContent = currentUser.display_name.slice(0, 1);
    headerName.textContent = currentUser.display_name;
    headerUsername.textContent = currentUser.email || `@${currentUser.username}`;
    const profileAvatar = document.querySelector("#profileAvatar");
    profileAvatar.className = avatarClass(currentUser);
    profileAvatar.textContent = currentUser.display_name.slice(0, 1);
    document.querySelector("#profileName").textContent = currentUser.display_name;
    document.querySelector("#profileUsername").textContent = `@${currentUser.username}`;
    document.querySelector("#profileEmail").textContent = currentUser.email || "未绑定";
    document.querySelector("#profilePhone").textContent = currentUser.phone || "未绑定";
    const status = document.querySelector("#profileMailStatus");
    status.textContent = currentUser.mail_auth_configured ? "已配置" : "未配置";
    status.classList.toggle("configured", currentUser.mail_auth_configured);
  };

  const closeAccountMenu = () => {
    accountMenu.hidden = true;
    accountMenuButton.setAttribute("aria-expanded", "false");
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
        machine.maintenance_vendor_name,
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
      heartbeat.textContent = `${formatAbsolute(machine.last_heartbeat)}（北京时间）`;

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

  const renderVendors = () => {
    const keyword = vendorSearch.value.trim().toLowerCase();
    const filtered = vendors.filter((vendor) => {
      const searchable = [
        vendor.name,
        vendor.short_name,
        vendor.service_level,
        vendor.hotline,
        vendor.email,
        ...(vendor.service_scope ?? []),
        ...(vendor.contacts ?? []).flatMap((contact) => [
          contact.name,
          contact.title,
          contact.mobile,
          contact.email,
          contact.service_region,
        ]),
      ]
        .join(" ")
        .toLowerCase();
      return !keyword || searchable.includes(keyword);
    });

    vendorCards.innerHTML = "";
    vendorEmptyState.hidden = filtered.length > 0;
    filtered.forEach((vendor, vendorIndex) => {
      const card = document.createElement("article");
      card.className = "vendor-card";

      const heading = document.createElement("div");
      heading.className = "vendor-card-heading";
      const mark = document.createElement("span");
      mark.className = `vendor-mark vendor-mark-${(vendorIndex % 3) + 1}`;
      mark.textContent = vendor.short_name.slice(0, 1);
      const identity = document.createElement("div");
      const name = document.createElement("h2");
      name.textContent = vendor.name;
      const level = document.createElement("p");
      level.textContent = vendor.service_level;
      identity.append(name, level);
      heading.append(mark, identity);

      const meta = document.createElement("div");
      meta.className = "vendor-meta";
      const hotline = document.createElement("a");
      hotline.href = `tel:${vendor.hotline.replaceAll("-", "")}`;
      const hotlineLabel = document.createElement("small");
      hotlineLabel.textContent = "统一服务热线";
      const hotlineValue = document.createElement("strong");
      hotlineValue.textContent = vendor.hotline;
      hotline.append(hotlineLabel, hotlineValue);
      const email = document.createElement("a");
      email.href = `mailto:${vendor.email}`;
      const emailLabel = document.createElement("small");
      emailLabel.textContent = "服务邮箱";
      const emailValue = document.createElement("strong");
      emailValue.textContent = vendor.email;
      email.append(emailLabel, emailValue);
      meta.append(hotline, email);

      const scopes = document.createElement("div");
      scopes.className = "vendor-scopes";
      (vendor.service_scope ?? []).forEach((scope) => {
        const tag = document.createElement("span");
        tag.textContent = scope;
        scopes.append(tag);
      });

      const contactTitle = document.createElement("h3");
      contactTitle.textContent = "维保联系人";
      const contacts = document.createElement("div");
      contacts.className = "vendor-contacts";
      (vendor.contacts ?? []).forEach((contact) => {
        const item = document.createElement("section");
        item.className = "vendor-contact";
        const avatar = document.createElement("span");
        avatar.className = "vendor-contact-avatar";
        avatar.textContent = contact.name.slice(0, 1);
        const details = document.createElement("div");
        const contactName = document.createElement("strong");
        contactName.textContent = contact.name;
        const role = document.createElement("small");
        role.textContent = `${contact.title} · ${contact.service_region}`;
        const links = document.createElement("div");
        const mobile = document.createElement("a");
        mobile.href = `tel:${contact.mobile.replaceAll(" ", "")}`;
        mobile.textContent = contact.mobile;
        const contactEmail = document.createElement("a");
        contactEmail.href = `mailto:${contact.email}`;
        contactEmail.textContent = contact.email;
        links.append(mobile, contactEmail);
        const availability = document.createElement("span");
        availability.className = "vendor-availability";
        availability.textContent = contact.availability;
        details.append(contactName, role, links, availability);
        item.append(avatar, details);
        contacts.append(item);
      });

      card.append(heading, meta, scopes, contactTitle, contacts);
      vendorCards.append(card);
    });
  };

  const loadVendors = async () => {
    try {
      if (!vendors.length) {
        const result = await request("/v1/infrastructure/vendors");
        vendors = result.vendors ?? [];
      }
      document.querySelector("#vendorCount").textContent = vendors.length;
      renderVendors();
    } catch (error) {
      vendorCards.innerHTML = "";
      vendorEmptyState.hidden = false;
      vendorEmptyState.textContent = `维保厂商数据加载失败：${error.message}`;
    }
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
    pendingAttachments = [];
    renderAttachmentPreview();
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
      chatConversations,
      conversations,
      "暂时还没有会话。",
    );
  };

  const isSupersededProcessingTurn = (turn, index, turns) =>
    turn?.status === "processing" && index < turns.length - 1;

  const mergeTurnsWithLocalPending = (conversationId, loadedTurns) => {
    const loadedRequestIds = new Set(
      loadedTurns.map((turn) => turn.request_id).filter(Boolean),
    );
    const localPendingTurns = (conversationTurnCache.get(conversationId) ?? []).filter(
      (turn) => turn.request_id && !loadedRequestIds.has(turn.request_id),
    );
    return [...loadedTurns, ...localPendingTurns];
  };

  const updateCachedTurn = (targetConversationId, requestId, patch) => {
    const cachedTurns = conversationTurnCache.get(targetConversationId);
    if (!cachedTurns) return;
    conversationTurnCache.set(
      targetConversationId,
      cachedTurns.map((turn) =>
        turn.request_id === requestId ? { ...turn, ...patch } : turn,
      ),
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
    turns.forEach((turn, index) => {
      appendMessage(
        turn.user_message ?? "",
        "user",
        "",
        false,
        turn.attachments ?? [],
      );
      let assistantMessage;
      if (turn.status === "completed") {
        assistantMessage = appendMessage(turn.assistant_message ?? "", "assistant");
      } else if (turn.status === "failed") {
        assistantMessage = appendMessage(turn.error || "处理失败", "assistant", "error");
      } else if (isSupersededProcessingTurn(turn, index, turns)) {
        assistantMessage = appendMessage(
          turn.error || "这条请求已中断，可继续发送新消息。",
          "assistant",
          "error",
        );
      } else {
        assistantMessage = appendMessage(
          turn.assistant_message || "这条消息仍在处理中。",
          "assistant",
          "waiting",
        );
      }
      if (turn.request_id) assistantMessage.dataset.streamRequestId = turn.request_id;
    });
    suppressMessageAutoScroll = false;
    scrollConversationToBottom();
  };

  const updateComposerState = () => {
    const busy = (!conversationId && creatingConversation) ||
      (conversationId && pendingConversationIds.has(conversationId)) ||
      pendingAttachments.some((attachment) => attachment.loading);
    sendButton.disabled =
      !currentUser || busy || (!chatInput.value.trim() && !pendingAttachments.length);
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
    const loadVersion = ++conversationLoadVersion;
    clearPendingAttachments();
    conversationId = id;
    assistantView = "chat";
    window.sessionStorage.setItem(assistantViewStateKey, assistantView);
    window.sessionStorage.setItem(conversationStateKey, id);
    updateAssistantButtons();
    renderConversationGroups();
    const currentConversation = conversations.find((item) => item.id === id);
    conversationHeading.textContent = summarizeTitle(currentConversation);
    const cachedTurns = conversationTurnCache.get(id);
    if (cachedTurns) {
      renderTurns(cachedTurns);
    } else {
      messages.innerHTML = '<div class="thread-empty">正在加载会话...</div>';
    }
    renderConversationStream(id, true);
    try {
      const result = await request(`/v1/conversations/${id}/messages`);
      if (loadVersion !== conversationLoadVersion || conversationId !== id) return;
      const loadedTurns = mergeTurnsWithLocalPending(id, result.messages ?? []);
      conversationTurnCache.set(id, loadedTurns);
      renderTurns(loadedTurns);
      const resumableTurn = [...loadedTurns]
        .reverse()
        .find(
          (turn, reverseIndex) =>
            turn.request_id &&
            turn.status === "processing" &&
            !isSupersededProcessingTurn(
              turn,
              loadedTurns.length - 1 - reverseIndex,
              loadedTurns,
            ),
        );
      const currentStream = conversationStreams.get(id);
      if (
        resumableTurn &&
        !resumedMessageJobs.has(resumableTurn.request_id) &&
        !["pending", "finishing"].includes(currentStream?.status)
      ) {
        void resumeConversationJob(id, resumableTurn.request_id);
      }
      const activeStream = conversationStreams.get(id);
      const activeTurnIndex = loadedTurns.findIndex(
        (turn) => turn.request_id && turn.request_id === activeStream?.requestId,
      );
      const activeTurn = activeTurnIndex >= 0 ? loadedTurns[activeTurnIndex] : null;
      const activeTurnIsStillCurrent =
        activeTurn?.status === "processing" &&
        !isSupersededProcessingTurn(activeTurn, activeTurnIndex, loadedTurns);
      const activeTurnIsKnownStale =
        activeTurn && activeTurn.status !== "processing";
      const activeTurnWasSuperseded =
        activeTurn && isSupersededProcessingTurn(activeTurn, activeTurnIndex, loadedTurns);
      const activeStreamAlreadyEndedWithoutTurn =
        !activeTurn && ["completed", "failed"].includes(activeStream?.status);
      if (
        activeStream &&
        !activeTurnIsStillCurrent &&
        (activeTurnIsKnownStale || activeTurnWasSuperseded || activeStreamAlreadyEndedWithoutTurn)
      ) {
        cancelStreamAnimation(activeStream.requestId);
        conversationStreams.delete(id);
        pendingConversationIds.delete(id);
        updateComposerState();
        renderConversationGroups();
        return;
      }
      renderConversationStream(id, false);
      if (conversationStreams.get(id)?.status !== "pending") {
        conversationStreams.delete(id);
      }
    } catch (error) {
      if (loadVersion !== conversationLoadVersion || conversationId !== id) return;
      if (!conversationTurnCache.has(id) && !conversationStreams.has(id)) {
        messages.innerHTML = `<div class="thread-empty">读取会话失败：${error.message}</div>`;
      }
    }
  };

  const createNewConversationDraft = () => {
    conversationLoadVersion += 1;
    clearPendingAttachments();
    conversationId = null;
    assistantView = "chat";
    window.sessionStorage.setItem(assistantViewStateKey, assistantView);
    window.sessionStorage.removeItem(conversationStateKey);
    updateAssistantButtons();
    conversationHeading.textContent = "新建会话";
    renderConversationGroups();
    resetChatMessages();
    updateComposerState();
    chatInput.focus();
  };

  async function submitMessage(rawText) {
    const text = rawText.trim();
    const attachments = [...pendingAttachments];
    if (attachments.some((attachment) => attachment.loading)) return;
    if ((!text && !attachments.length) || !currentUser) return;
    if ((!conversationId && creatingConversation) || pendingConversationIds.has(conversationId)) {
      return;
    }

    assistantView = "chat";
    window.sessionStorage.setItem(assistantViewStateKey, assistantView);
    updateAssistantButtons();
    const messageText = text || "请分析我上传的附件。";
    const userMessage = appendMessage(
      text,
      "user",
      "",
      false,
      displayAttachments(attachments),
    );
    const waiting = appendMessage("正在查询智能体…", "assistant", "waiting");
    const requestId = createRequestId();
    waiting.dataset.streamRequestId = requestId;
    scrollPromptToReadingPosition(userMessage);
    let targetConversationId = conversationId;

    chatInput.value = "";
    chatInput.style.height = "auto";
    pendingAttachments = [];
    renderAttachmentPreview();

    if (!targetConversationId) {
      creatingConversation = true;
      updateComposerState();
      const created = await request("/v1/conversations", {
        method: "POST",
        body: JSON.stringify({ title: messageText.slice(0, 40) }),
      });
      targetConversationId = created.id;
      conversationId = created.id;
      window.sessionStorage.setItem(conversationStateKey, created.id);
      creatingConversation = false;
      conversations = [created, ...conversations.filter((item) => item.id !== created.id)];
      renderConversationGroups();
    }

    pendingConversationIds.add(targetConversationId);
    const optimisticTurn = {
      request_id: requestId,
      user_message: text,
      attachments: displayAttachments(attachments),
      assistant_message: "",
      status: "processing",
      error: null,
    };
    conversationTurnCache.set(targetConversationId, [
      ...(conversationTurnCache.get(targetConversationId) ?? []),
      optimisticTurn,
    ]);
    conversationStreams.set(targetConversationId, {
      requestId,
      status: "pending",
      text: "",
      receivedText: "",
      pendingCharacters: [],
      finalAnswer: null,
      resolveAnimation: null,
      answer: "",
      error: "",
      waitingText: waiting.textContent,
    });
    updateComposerState();
    try {
      let streamCompleted = false;
      await runMessageJobRequest(
        `/v1/conversations/${targetConversationId}/message-jobs`,
        {
          message: messageText,
          display_message: text,
          attachment_upload_ids: attachments.map((attachment) => attachment.uploadId),
          request_id: requestId,
        },
        async (event) => {
          streamCompleted =
            (await applyConversationJobEvent(
              targetConversationId,
              requestId,
              event,
            )) || streamCompleted;
        },
      );
      const state = conversationStreams.get(targetConversationId);
      if (!streamCompleted && state?.text) {
        const finalAnswer = state.receivedText || state.text;
        await finishConversationStream(
          targetConversationId,
          requestId,
          finalAnswer,
        );
        updateCachedTurn(targetConversationId, requestId, {
          assistant_message: finalAnswer,
          status: "completed",
          error: null,
        });
      }
      await refreshConversations();
    } catch (error) {
      const state = conversationStreams.get(targetConversationId);
      if (state?.requestId === requestId) {
        cancelStreamAnimation(requestId);
        state.pendingCharacters = [];
        state.status = "failed";
        state.error =
          error.status === 401 ? "登录已失效，请重新登录。" : `请求失败：${error.message}`;
        if (error.jobFailed) {
          updateCachedTurn(targetConversationId, requestId, {
            assistant_message: "",
            status: "failed",
            error: state.error,
          });
        }
        renderConversationStream(targetConversationId);
      }
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
          <div><span>默认规则</span><b>${template.recurrence_kind === "daily" ? "每天" : template.recurrence_kind === "weekdays" ? "工作日" : "每周"}</b></div>
          <div><span>推荐时间</span><b>${String(template.hour).padStart(2, "0")}:${String(template.minute).padStart(2, "0")}</b></div>
        </div>
        <div class="template-card-actions">
          <button type="button" class="primary-inline">使用此安排</button>
        </div>
      `;
      article.querySelector("button").addEventListener("click", () => {
        if (template.key === "daily-email-report") {
          pendingStepUpTemplate = template;
          emailScheduleReauthToken = null;
          stepUpPassword.value = "";
          stepUpError.textContent = "";
          stepUpModal.hidden = false;
          window.setTimeout(() => stepUpPassword.focus(), 50);
          return;
        }
        openScheduleModal(template);
      });
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
        let targetConversationId = null;
        let requestId = null;
        try {
          await streamRequest(
            `/v1/schedules/${schedule.id}/trigger/stream`,
            {},
            async (streamEvent) => {
              if (streamEvent.type === "start") {
                targetConversationId = streamEvent.conversation_id;
                requestId = streamEvent.request_id;
                pendingConversationIds.add(targetConversationId);
                conversationStreams.set(targetConversationId, {
                  requestId,
                  status: "pending",
                  text: "",
                  answer: "",
                  error: "",
                  waitingText: "正在执行日常安排…",
                });
                await refreshConversations();
                assistantView = "chat";
                window.sessionStorage.setItem(assistantViewStateKey, assistantView);
                updateAssistantButtons();
                await openConversation(targetConversationId);
                return;
              }

              if (!targetConversationId || !requestId) return;
              const state = conversationStreams.get(targetConversationId);
              if (!state || state.requestId !== requestId) return;
              if (streamEvent.type === "delta") {
                state.text += streamEvent.text || "";
                renderConversationStream(targetConversationId);
              }
              if (streamEvent.type === "final") {
                state.status = "completed";
                state.answer = streamEvent.answer || state.text;
                renderConversationStream(targetConversationId);
              }
              if (streamEvent.type === "error") {
                throw new Error(streamEvent.error || "日常安排执行失败");
              }
            },
          );
          await Promise.all([refreshConversations(), loadSchedules()]);
        } catch (error) {
          if (targetConversationId && requestId) {
            const state = conversationStreams.get(targetConversationId);
            if (state?.requestId === requestId) {
              state.status = "failed";
              state.error = `日常安排执行失败：${error.message}`;
              renderConversationStream(targetConversationId);
            }
          } else {
            button.textContent = "执行失败";
            setTimeout(() => setButtonBusy(button, false), 900);
          }
          return;
        } finally {
          if (targetConversationId) pendingConversationIds.delete(targetConversationId);
          renderConversationGroups();
          updateComposerState();
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

  const syncScheduleFields = () => {
    const emailSchedule = scheduleTemplateKey.value.includes("email");
    recurrenceKindField.hidden = false;
    timeField.hidden = false;
    weekdayField.hidden = scheduleRecurrenceKind.value !== "weekly";
    scheduleTime.required = true;
    emailRecipientField.hidden = !emailSchedule;
    emailSenderField.hidden = !emailSchedule;
    emailAuthCodeField.hidden = !emailSchedule;
    scheduleEmailRecipient.required = emailSchedule;
    scheduleSenderAuthCode.required = emailSchedule && !currentUser?.mail_auth_configured;

  };

  const openScheduleModal = (source = null) => {
    scheduleError.textContent = "";
    setButtonBusy(deleteScheduleButton, false);
    setButtonBusy(submitScheduleButton, false);
    scheduleModal.hidden = false;
    scheduleEnvironment.value = "bank-runtime";
    scheduleConversation.value = "new";
    scheduleSenderEmail.value = currentUser?.email || "";
    scheduleSenderAuthCode.value = "";
    emailAuthCodeHint.textContent = currentUser?.mail_auth_configured
      ? "已安全保存授权码；如需更换可重新输入，否则留空。"
      : "首次创建邮件安排时需填写，授权码会加密保存。";

    if (source?.id) {
      scheduleModalTitle.textContent = "编辑安排";
      submitScheduleButton.textContent = "保存修改";
      deleteScheduleButton.hidden = false;
      scheduleId.value = source.id;
      scheduleTemplateKey.value = source.category || "";
      scheduleName.value = source.name;
      scheduleDescription.value = source.description || "";
      schedulePrompt.value = source.prompt;
      scheduleRecurrenceKind.value = source.recurrence_kind || "daily";
      scheduleWeekday.value = String(source.weekday ?? 1);
      scheduleTime.value = `${String(source.hour).padStart(2, "0")}:${String(source.minute).padStart(2, "0")}`;
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
      scheduleRecurrenceKind.value = template?.recurrence_kind ?? "daily";
      scheduleWeekday.value = String(template?.weekday ?? 1);
      scheduleTime.value = `${String(template?.hour ?? 9).padStart(2, "0")}:${String(template?.minute ?? 0).padStart(2, "0")}`;
      scheduleEmailRecipient.value = "";
    }

    syncScheduleFields();
  };

  const closeScheduleEditor = () => {
    scheduleModal.hidden = true;
  };

  const schedulePayload = () => {
    const [hour, minute] = scheduleTime.value.split(":").map(Number);
    const payload = {
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
      schedule_type: "recurring",
      recurrence_kind: scheduleRecurrenceKind.value,
      weekday:
        scheduleRecurrenceKind.value === "weekly"
          ? Number(scheduleWeekday.value)
          : null,
      hour: Number.isNaN(hour) ? 9 : hour,
      minute: Number.isNaN(minute) ? 0 : minute,
      scheduled_for: null,
      recipient_email: scheduleTemplateKey.value.includes("email")
        ? scheduleEmailRecipient.value.trim()
        : null,
      timezone: "Asia/Shanghai",
      enabled: true,
    };
    if (scheduleTemplateKey.value === "daily-email-report" && !scheduleId.value) {
      payload.reauth_token = emailScheduleReauthToken;
    }
    if (
      scheduleTemplateKey.value.includes("email") &&
      scheduleSenderAuthCode.value.trim()
    ) {
      payload.sender_auth_code = scheduleSenderAuthCode.value.trim();
    }
    return payload;
  };

  const showPage = async (page) => {
    currentPage = page;
    window.sessionStorage.setItem(pageStateKey, page);
    const assistant = page === "assistant";
    const infrastructure = page === "infrastructure";
    const vendorDirectory = page === "vendors";
    navInfrastructure.classList.toggle("active", infrastructure);
    navVendors.classList.toggle("active", vendorDirectory);
    navAssistant.classList.toggle("active", assistant);
    infrastructurePage.classList.toggle("active", infrastructure);
    vendorsPage.classList.toggle("active", vendorDirectory);
    assistantPage.classList.toggle("active", assistant);
    infrastructurePage.hidden = !infrastructure;
    vendorsPage.hidden = !vendorDirectory;
    assistantPage.hidden = !assistant;

    if (assistant) {
      updateAssistantButtons();
      await Promise.all([refreshConversations(), loadSchedules(), loadTemplates()]);
    } else if (vendorDirectory) {
      await loadVendors();
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
    void loadSkills().catch(() => {
      skills = [];
    });
    await showPage(currentPage);
    if (!infrastructureRefreshTimer) {
      infrastructureRefreshTimer = window.setInterval(() => {
        if (
          currentUser &&
          currentPage === "infrastructure" &&
          document.visibilityState === "visible"
        ) {
          void loadInfrastructure();
        }
      }, 60_000);
    }
    if (currentPage === "assistant" && assistantView === "chat") {
      const restoredConversationId = window.sessionStorage.getItem(conversationStateKey);
      if (
        restoredConversationId &&
        conversations.some((conversation) => conversation.id === restoredConversationId)
      ) {
        await openConversation(restoredConversationId);
      }
    }
  };

  function showLogin() {
    currentUser = null;
    if (infrastructureRefreshTimer) {
      window.clearInterval(infrastructureRefreshTimer);
      infrastructureRefreshTimer = null;
    }
    authGate.hidden = false;
    appShell.hidden = true;
    conversations = [];
    schedules = [];
    pendingConversationIds = new Set();
    conversationStreams.clear();
    conversationLoadVersion += 1;
    conversationId = null;
    creatingConversation = false;
    clearPendingAttachments();
    closeAccountMenu();
    setTimeout(() => loginIdentifier.focus(), 50);
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
          identifier: loginIdentifier.value,
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

  document.querySelectorAll("[data-demo-identifier]").forEach((button) => {
    button.addEventListener("click", () => {
      loginIdentifier.value = button.dataset.demoIdentifier;
      password.value = "";
      loginError.textContent = "";
      password.focus();
    });
  });

  document.querySelector("#logoutButton").addEventListener("click", async () => {
    await request("/v1/auth/logout", { method: "POST", body: "{}" }).catch(() => null);
    window.sessionStorage.removeItem(pageStateKey);
    window.sessionStorage.removeItem(assistantViewStateKey);
    window.sessionStorage.removeItem(conversationStateKey);
    showLogin();
  });

  accountMenuButton.addEventListener("click", () => {
    const opening = accountMenu.hidden;
    accountMenu.hidden = !opening;
    accountMenuButton.setAttribute("aria-expanded", String(opening));
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".account-menu-wrap")) closeAccountMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !accountMenu.hidden) {
      closeAccountMenu();
      accountMenuButton.focus();
    }
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
  navVendors.addEventListener("click", () => void showPage("vendors"));
  navAssistant.addEventListener("click", () => void showPage("assistant"));
  vendorSearch.addEventListener("input", renderVendors);
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
    window.sessionStorage.setItem(assistantViewStateKey, assistantView);
    updateAssistantButtons();
    await loadSchedules();
  });

  assistantNewChat.addEventListener("click", () => {
    createNewConversationDraft();
  });

  chatComposer.addEventListener("submit", (event) => {
    event.preventDefault();
    closeSkillPalette();
    void submitMessage(chatInput.value);
  });

  chatInput.addEventListener("keydown", (event) => {
    if (!skillPalette.hidden) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        skillSelectionIndex =
          (skillSelectionIndex + direction + visibleSkills.length) %
          visibleSkills.length;
        renderSkillPalette();
        skillPaletteList
          .querySelector(".skill-palette-item.active")
          ?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeSkillPalette();
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        selectSkill(visibleSkills[skillSelectionIndex]);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      chatComposer.requestSubmit();
    }
  });

  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
    updateSkillPalette();
    updateComposerState();
  });

  attachButton.addEventListener("click", (event) => {
    event.stopPropagation();
    attachmentMenu.hidden = !attachmentMenu.hidden;
  });

  attachmentMenu.querySelectorAll("[data-attach-kind]").forEach((button) => {
    button.addEventListener("click", () => {
      attachmentMenu.hidden = true;
      attachmentInput.click();
    });
  });

  attachmentInput.addEventListener("change", () => {
    void addFiles(attachmentInput.files ?? []);
    attachmentInput.value = "";
  });

  chatInput.addEventListener("paste", (event) => {
    const files = [...(event.clipboardData?.files ?? [])];
    if (!files.length) return;
    event.preventDefault();
    void addFiles(files);
  });

  document.addEventListener("click", (event) => {
    if (!attachmentMenu.hidden && !event.target.closest(".attach-wrap")) {
      attachmentMenu.hidden = true;
    }
  });

  const hasDraggedFiles = (event) =>
    [...(event.dataTransfer?.types ?? [])].includes("Files");
  let dragDepth = 0;

  chatWorkspace.addEventListener("dragenter", (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    messages.classList.add("drag-over");
  });

  chatWorkspace.addEventListener("dragover", (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    messages.classList.add("drag-over");
  });

  chatWorkspace.addEventListener("dragleave", (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      messages.classList.remove("drag-over");
    }
  });

  chatWorkspace.addEventListener("drop", (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    messages.classList.remove("drag-over");
    void addFiles(event.dataTransfer?.files ?? []);
  });

  scheduleTabs.forEach((button) => {
    button.addEventListener("click", () => {
      scheduleFilter = button.dataset.filter;
      scheduleTabs.forEach((item) => item.classList.toggle("active", item === button));
      renderSchedules();
    });
  });

  const closeStepUpDialog = () => {
    stepUpModal.hidden = true;
    stepUpPassword.value = "";
    stepUpError.textContent = "";
    pendingStepUpTemplate = null;
  };

  closeStepUpModal.addEventListener("click", closeStepUpDialog);
  cancelStepUpButton.addEventListener("click", closeStepUpDialog);
  stepUpModal.addEventListener("click", (event) => {
    if (event.target === stepUpModal) closeStepUpDialog();
  });
  stepUpForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    stepUpError.textContent = "";
    setButtonBusy(submitStepUpButton, true, "正在验证...");
    try {
      const result = await request("/v1/auth/step-up", {
        method: "POST",
        body: JSON.stringify({
          password: stepUpPassword.value,
          purpose: "create_daily_email_schedule",
        }),
      });
      const template = pendingStepUpTemplate;
      emailScheduleReauthToken = result.token;
      closeStepUpDialog();
      openScheduleModal(template);
    } catch (error) {
      stepUpError.textContent = error.message;
      stepUpPassword.select();
    } finally {
      setButtonBusy(submitStepUpButton, false);
    }
  });

  createScheduleButton.addEventListener("click", () => openScheduleModal());
  closeScheduleModal.addEventListener("click", closeScheduleEditor);
  cancelScheduleButton.addEventListener("click", closeScheduleEditor);
  scheduleModal.addEventListener("click", (event) => {
    if (event.target === scheduleModal) closeScheduleEditor();
  });
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

    if (
      scheduleTemplateKey.value.includes("email") &&
      !scheduleEmailRecipient.value.trim()
    ) {
      scheduleError.textContent = "请输入收件人的邮箱地址。";
      scheduleEmailRecipient.focus();
      return;
    }

    if (
      scheduleTemplateKey.value.includes("email") &&
      !currentUser?.email
    ) {
      scheduleError.textContent = "当前账号尚未绑定发件邮箱。";
      return;
    }

    if (
      scheduleTemplateKey.value.includes("email") &&
      !currentUser?.mail_auth_configured &&
      !scheduleSenderAuthCode.value.trim()
    ) {
      scheduleError.textContent = "请输入当前发件邮箱的授权码。";
      scheduleSenderAuthCode.focus();
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
        if (payload.reauth_token) emailScheduleReauthToken = null;
      }
      if (payload.sender_auth_code) {
        currentUser.mail_auth_configured = true;
        updateHeader();
      }
      closeScheduleEditor();
      await loadSchedules();
    } catch (error) {
      scheduleError.textContent = error.message;
    } finally {
      setButtonBusy(submitScheduleButton, false);
    }
  });

  window.addEventListener("pagehide", () => {
    pageIsUnloading = true;
    activeAttachmentReaders.forEach((reader) => {
      if (reader.readyState === FileReader.LOADING) reader.abort();
    });
    activeAttachmentRequests.forEach((xhr) => {
      if (xhr.readyState !== XMLHttpRequest.DONE) xhr.abort();
    });
    pendingAttachments.forEach((attachment) => {
      attachment.previewUrl = null;
    });
    pendingAttachments = [];
    activeAttachmentReaders.clear();
    activeAttachmentRequests.clear();
  });

  window.addEventListener("pageshow", () => {
    pageIsUnloading = false;
  });

  request("/v1/auth/me")
    .then((result) => showWorkspace(result.user))
    .catch(() => showLogin());
})();
