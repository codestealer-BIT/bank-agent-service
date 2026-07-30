(() => {
  const authGate = document.querySelector("#authGate");
  const appShell = document.querySelector("#appShell");
  const loginForm = document.querySelector("#loginForm");
  const username = document.querySelector("#username");
  const password = document.querySelector("#password");
  const loginButton = document.querySelector("#loginButton");
  const loginError = document.querySelector("#loginError");

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
  let vendors = [];
  let searchTimer = null;
  let conversationId = null;
  let creatingConversation = false;
  let conversations = [];
  let pendingConversationIds = new Set();
  const conversationStreams = new Map();
  const streamAnimationFrames = new Map();
  let conversationLoadVersion = 0;
  let schedules = [];
  let templates = [];
  let scheduleFilter = "all";
  let suppressMessageAutoScroll = false;
  let pendingAttachments = [];
  let skills = [];
  let visibleSkills = [];
  let skillSelectionIndex = 0;

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
        throw new Error(snapshot.error || "智能助手处理失败");
      }
      cursor = Math.max(cursor, Number(snapshot.next_cursor) || cursor);
      await wait(500);
    }
    throw new Error("智能助手处理超时，请稍后刷新会话查看结果");
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

  const appendMessage = (content, role, extra = "", shouldScroll = false) => {
    const element = document.createElement("div");
    element.className = `msg ${role} ${extra}`.trim();
    if (role === "assistant" && !extra) {
      if (window.BankMarkdown?.render) {
        window.BankMarkdown.render(element, content);
      } else {
        element.textContent = content;
      }
    } else {
      element.textContent = content;
    }
    messages.append(element);
    if (shouldScroll && !suppressMessageAutoScroll) {
      messages.scrollTop = messages.scrollHeight;
    }
    return element;
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
      messages.scrollTop = messages.scrollHeight;
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

  const readAsDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result)));
      reader.addEventListener("error", () => reject(reader.error));
      reader.readAsDataURL(file);
    });

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
    if (!attachment.previewUrl) return;
    const lightbox = ensureImagePreviewLightbox();
    lightbox.image.src = attachment.previewUrl;
    lightbox.image.alt = attachment.name;
    lightbox.backdrop.hidden = false;
    document.body.classList.add("image-lightbox-open");
  };

  const renderAttachmentPreview = () => {
    attachmentPreview.innerHTML = "";
    attachmentPreview.hidden = pendingAttachments.length === 0;
    pendingAttachments.forEach((attachment, index) => {
      const item = document.createElement("div");
      item.className = `attachment-chip ${attachment.kind}`;
      if (attachment.kind === "image") {
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
      meta.textContent = `${attachment.name} · ${formatBytes(attachment.size)}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `移除 ${attachment.name}`);
      remove.addEventListener("click", () => {
        pendingAttachments.splice(index, 1);
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
        const totalBytes = pendingAttachments.reduce(
          (sum, attachment) => sum + (attachment.size || 0),
          0,
        );
        if (totalBytes + file.size > 20 * 1024 * 1024) {
          errors.push("附件总大小不能超过 20MB。");
          continue;
        }
        if (file.type.startsWith("image/")) {
          if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type)) {
            errors.push(`${file.name} 不是支持的图片格式。`);
            continue;
          }
          if (file.size > 4 * 1024 * 1024) {
            errors.push(`${file.name} 超过 4MB，无法发送。`);
            continue;
          }
          const dataUrl = await readAsDataUrl(file);
          const [, data = ""] = dataUrl.split(",");
          pendingAttachments.push({
            kind: "image",
            name: file.name,
            media_type: file.type,
            data,
            size: file.size,
            previewUrl: dataUrl,
          });
        } else if (isPdfFile(file)) {
          if (file.size > 20 * 1024 * 1024) {
            errors.push(`${file.name} 超过 20MB，无法解析。`);
            continue;
          }
          const dataUrl = await readAsDataUrl(file);
          const [, data = ""] = dataUrl.split(",");
          pendingAttachments.push({
            kind: "pdf",
            name: file.name,
            media_type: "application/pdf",
            data,
            size: file.size,
          });
        } else if (isSupportedDocument(file)) {
          if (file.size > 20 * 1024 * 1024) {
            errors.push(`${file.name} 超过 20MB，无法解析。`);
            continue;
          }
          const dataUrl = await readAsDataUrl(file);
          const [, data = ""] = dataUrl.split(",");
          pendingAttachments.push({
            kind: "document",
            name: file.name,
            media_type: file.type || "application/octet-stream",
            data,
            size: file.size,
          });
        } else {
          errors.push(
            `${file.name} 暂不支持，请转换为 PDF、DOCX、PPTX、XLSX、ODT、RTF、EPUB 或纯文本格式。`,
          );
        }
      } catch (error) {
        errors.push(`${file.name} 读取失败：${error.message || "未知错误"}`);
      }
    }
    renderAttachmentPreview();
    errors.forEach(showAttachmentError);
    updateComposerState();
  };

  const attachmentSummary = (attachments) =>
    attachments.length
      ? `\n\n[附件]\n${attachments
          .map((attachment) => `- ${attachment.name} (${attachment.media_type})`)
          .join("\n")}`
      : "";

  const serializeAttachments = (attachments) =>
    attachments.map(({ previewUrl, ...attachment }) => attachment);

  const clearPendingAttachments = () => {
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
      let assistantMessage;
      if (turn.status === "completed") {
        assistantMessage = appendMessage(turn.assistant_message ?? "", "assistant");
      } else if (turn.status === "failed") {
        assistantMessage = appendMessage(turn.error || "处理失败", "assistant", "error");
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
    messages.scrollTop = 0;
  };

  const updateComposerState = () => {
    const busy = (!conversationId && creatingConversation) ||
      (conversationId && pendingConversationIds.has(conversationId));
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
    updateAssistantButtons();
    renderConversationGroups();
    const currentConversation = conversations.find((item) => item.id === id);
    conversationHeading.textContent = summarizeTitle(currentConversation);
    messages.innerHTML = '<div class="thread-empty">??????...</div>';
    try {
      const result = await request(`/v1/conversations/${id}/messages`);
      if (loadVersion !== conversationLoadVersion || conversationId !== id) return;
      renderTurns(result.messages ?? []);
      renderConversationStream(id, false);
      if (conversationStreams.get(id)?.status !== "pending") {
        conversationStreams.delete(id);
      }
    } catch (error) {
      if (loadVersion !== conversationLoadVersion || conversationId !== id) return;
      messages.innerHTML = `<div class="thread-empty">???????${error.message}</div>`;
    }
  };

  const createNewConversationDraft = () => {
    conversationLoadVersion += 1;
    clearPendingAttachments();
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
    const attachments = [...pendingAttachments];
    if ((!text && !attachments.length) || !currentUser) return;
    if ((!conversationId && creatingConversation) || pendingConversationIds.has(conversationId)) {
      return;
    }

    assistantView = "chat";
    updateAssistantButtons();
    const messageText = text || "请分析我上传的附件。";
    appendMessage(`${messageText}${attachmentSummary(attachments)}`, "user");
    const waiting = appendMessage("正在查询智能体…", "assistant", "waiting");
    const requestId = createRequestId();
    waiting.dataset.streamRequestId = requestId;
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
      creatingConversation = false;
      conversations = [created, ...conversations.filter((item) => item.id !== created.id)];
      renderConversationGroups();
    }

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
      waitingText: waiting.textContent,
    });
    updateComposerState();
    try {
      let streamCompleted = false;
      await streamRequest(
        `/v1/conversations/${targetConversationId}/messages/stream`,
        {
          message: messageText,
          attachments: serializeAttachments(attachments),
          request_id: requestId,
        },
        async (event) => {
          const state = conversationStreams.get(targetConversationId);
          if (!state || state.requestId !== requestId) return;
          if (event.type === "delta") {
            enqueueConversationDelta(
              targetConversationId,
              requestId,
              event.text || "",
            );
          }
          if (event.type === "final") {
            streamCompleted = true;
            await finishConversationStream(
              targetConversationId,
              requestId,
              event.answer || state.receivedText,
            );
          }
          if (event.type === "error") {
            throw new Error(event.error || "Agent stream failed");
          }
        },
      );
      const state = conversationStreams.get(targetConversationId);
      if (!streamCompleted && state?.text) {
        await finishConversationStream(
          targetConversationId,
          requestId,
          state.receivedText || state.text,
        );
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
    await loadSkills();
    await showPage("infrastructure");
  };

  function showLogin() {
    currentUser = null;
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
