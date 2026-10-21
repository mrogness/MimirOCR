document$.subscribe(() => {
  if (typeof mermaid === "undefined") {
    return;
  }

  const blocks = document.querySelectorAll("pre.mermaid");

  blocks.forEach((block) => {
    const code = block.querySelector("code");
    if (!code) {
      return;
    }

    const container = document.createElement("div");
    container.className = "mermaid";
    container.textContent = code.textContent || "";
    block.replaceWith(container);
  });

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
  });

  mermaid.run({
    querySelector: ".mermaid",
  });
});
