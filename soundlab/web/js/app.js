// Start: wire the top bar, load the project, open the page in the URL (#tab/arg), then watch for new takes.
(async () => {
  const $ = id => document.getElementById(id);
  $("searchIcon").outerHTML = Lab.icon("search");
  $("helpBtn").innerHTML = Lab.icon("keyboard");
  $("helpBtn").onclick = () => Lab.help.open();
  $("paletteBtn").onclick = () => Lab.palette.open();
  $("scrim").onclick = () => Lab.closeModal();
  $("fresh").onclick = () => Lab.applyPending();
  const vol = $("volume"), mute = $("mute");
  const syncVol = () => { mute.innerHTML = Lab.icon(Lab.prefs.muted || !Lab.prefs.volume ? "mute" : "volume"); mute.classList.toggle("on", Lab.prefs.muted); Lab.fillRange(vol); };
  vol.value = Lab.prefs.volume;
  vol.oninput = () => { Lab.prefs.volume = +vol.value; Lab.prefs.muted = false; Lab.applyVolume(); syncVol(); };
  vol.onchange = () => { Lab.savePrefs(); vol.blur(); };
  mute.onclick = () => Lab.toggleMute();
  const toggle = Lab.toggleMute;
  Lab.toggleMute = () => { toggle(); syncVol(); };
  syncVol();
  Lab.dock.init();

  try { await Lab.load(); }
  catch {  // (the server is down or the project file is broken: say so, rather than a blank page)
    Lab.showEmpty("x", "Couldn't load the project", `<p>The server didn't give the project's state. Check the terminal running <code>soundlab serve</code>, then reload.</p>
      <button class="btn" onclick="location.reload()">${Lab.icon("refresh")}Reload</button>`);
    return;
  }
  $("projectName").textContent = Lab.project.name;
  document.title = `${Lab.project.name} · SoundLab`;
  Lab.status();
  const [tab, arg] = location.hash.slice(1).split("/");
  Lab.go(tab || "sounds", arg ? decodeURIComponent(arg) : undefined);
  await Lab.stampSeen();
  setTimeout(Lab.poll, 3000);
})();
