(() => {
  const markedApi = window.marked;
  const purifier = window.DOMPurify;
  const renderMath = window.renderMathInElement;

  const mathOptions = Object.freeze({
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "\\[", right: "\\]", display: true },
      { left: "\\(", right: "\\)", display: false },
      { left: "$", right: "$", display: false },
    ],
    ignoredTags: [
      "script",
      "noscript",
      "style",
      "textarea",
      "pre",
      "code",
      "option",
    ],
    strict: false,
    throwOnError: false,
    trust: false,
  });

  const setPlainText = (element, value) => {
    element.textContent = String(value ?? "");
    element.classList.remove("markdown-body");
  };

  const normalizeMathDelimiters = (source) =>
    source
      .replace(/\\\[([\s\S]*?)\\\]/g, (_, expression) => `$$${expression}$$`)
      .replace(/\\\(([\s\S]*?)\\\)/g, (_, expression) => `$${expression}$`);

  const displayMathTokenPrefix = "BANKDISPLAYMATHBLOCK";

  const protectDisplayMathBlocks = (source) => {
    const blocks = [];
    const protectedSource = source.replace(
      /(^|\n)[ \t]*\$\$[ \t]*(?:\r?\n)?([\s\S]*?)(?:\r?\n)?[ \t]*\$\$[ \t]*(?=\n|$)/g,
      (match, prefix, expression) => {
        const token = `${displayMathTokenPrefix}${blocks.length}`;
        blocks.push(String(expression ?? "").trim());
        return `${prefix}\n\n${token}\n\n`;
      },
    );
    return { source: protectedSource, blocks };
  };

  const restoreDisplayMathBlocks = (element, blocks) => {
    if (!blocks.length) return;

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    textNodes.forEach((node) => {
      const text = node.nodeValue?.trim() ?? "";
      if (!text.startsWith(displayMathTokenPrefix)) return;
      const index = Number(text.slice(displayMathTokenPrefix.length));
      if (!Number.isInteger(index) || !blocks[index]) return;
      node.nodeValue = `$$${blocks[index]}$$`;
    });
  };

  const render = (element, value) => {
    const normalizedSource = normalizeMathDelimiters(String(value ?? ""));
    const { source, blocks } = protectDisplayMathBlocks(normalizedSource);
    if (!markedApi?.parse || !purifier?.sanitize) {
      setPlainText(element, normalizedSource);
      return;
    }

    try {
      const parsed = markedApi.parse(source, {
        async: false,
        breaks: true,
        gfm: true,
      });
      element.innerHTML = purifier.sanitize(parsed, {
        FORBID_TAGS: [
          "audio",
          "button",
          "canvas",
          "embed",
          "form",
          "iframe",
          "img",
          "input",
          "object",
          "script",
          "style",
          "svg",
          "textarea",
          "video",
        ],
        FORBID_ATTR: ["style", "srcset"],
      });
      element.classList.add("markdown-body");
      restoreDisplayMathBlocks(element, blocks);

      if (typeof renderMath === "function") {
        renderMath(element, mathOptions);
      }

      element.querySelectorAll("a[href]").forEach((link) => {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      });
    } catch {
      setPlainText(element, source);
    }
  };

  window.BankMarkdown = Object.freeze({
    render,
    setPlainText,
  });
})();
