// Start: load the project, build the tabs, open the page in the URL (#tab/arg).
(async () => {
  await Lab.load();
  document.getElementById("projectName").textContent = Lab.project.name;
  document.title = `Sound Lab · ${Lab.project.name}`;
  const nav = document.getElementById("tabs");
  for (const name of Lab.order) {
    const b = document.createElement("button"), page = Lab.tabs[name];
    b.textContent = page.title; b.dataset.tab = name;
    b.disabled = page.enabled ? !page.enabled() : false;
    b.onclick = () => Lab.go(name);
    nav.appendChild(b);
  }
  document.getElementById("helpBtn").onclick = () => document.getElementById("help").classList.toggle("show");
  Lab.status();
  const [tab, arg] = location.hash.slice(1).split("/");
  Lab.go(tab || "sounds", arg ? decodeURIComponent(arg) : undefined);
})();
