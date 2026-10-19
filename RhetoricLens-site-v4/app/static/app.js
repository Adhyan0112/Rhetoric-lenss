const MIC_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="1.5" width="8" height="13" rx="4" fill="currentColor"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3.5M8.5 21.5h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const state = {
  scores: {"Speaker A": 100, "Speaker B": 100},
  ws: null,
  demoTimer: null,
  demoRunning: false,
  pendingAnalyses: 0,
  providerLabel: "",
  providerMode: "",
  mic: {active: false, context: null, source: null, processor: null, stream: null, inputRate: 48000},
  speech: {recognition: null, active: false},
};

const $ = (id) => document.getElementById(id);

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  state.ws = new WebSocket(`${proto}://${location.host}/ws`);
  state.ws.binaryType = "arraybuffer";
  state.ws.onopen = () => {
    setConnectionStatus(true, "Connected");
    setMicMessage("Ready for live audio");
  };
  state.ws.onclose = () => {
    setConnectionStatus(false, "Disconnected");
    state.pendingAnalyses = 0;
    updateAnalyzeButton();
    setMicMessage("WebSocket disconnected");
    setTimeout(connect, 1200);
  };
  state.ws.onerror = () => setMicMessage("WebSocket error");
  state.ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "state") renderState(msg.data);
    if (msg.type === "detection") handleDetection(msg.data);
    if (msg.type === "transcript") handleTranscript(msg.data || msg);
    if (msg.type === "audio_status") handleAudioStatus(msg);
    if (msg.type === "speech_started") setMicMessage("Speech detected…");
    if (msg.type === "stt_error") handleAudioStatus({status:"error", message:msg.message});
  };
}

function setConnectionStatus(connected, text) {
  $("statusDot").style.background = connected ? "#27F0EB" : "#D86155";
  $("statusText").textContent = text;
}

function setMicMessage(text) {
  const el = $("micMessage");
  if (el) el.textContent = text;
}

function sendAnalyze(text, speaker = $("speakerSelect").value, scriptedDemo = false) {
  if (!text.trim()) return;
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.pendingAnalyses += 1;
    updateAnalyzeButton();
    state.ws.send(JSON.stringify({ type: "analyze", data: { speaker, text, timestamp: Date.now() / 1000, ...(scriptedDemo ? {scripted_demo: true} : {}) } }));
  } else {
    setMicMessage("Not connected yet. Try again in a moment.");
    return;
  }
  $("inputText").value = "";
}

function updateAnalyzeButton() {
  const button = $("sendBtn");
  if (!button) return;
  const busy = state.pendingAnalyses > 0;
  button.classList.toggle("is-thinking", busy);
  button.setAttribute("aria-busy", String(busy));
  button.querySelector(".analyze-text").textContent = busy ? "Analyzing" : "Analyze";
}

function renderState(snapshot) {
  state.scores = snapshot.scores || state.scores;
  updateScore();
  $("feed").innerHTML = "";
  $("timeline").innerHTML = "";
  (snapshot.events || []).forEach(addEventToFeed);
}

function updateScore() {
  const sel = $("speakerSelect").value;
  ["A", "B"].forEach((k) => {
    const name = "Speaker " + k;
    const sc = state.scores[name] ?? 100;
    const ring = $("ring-" + k);
    ring.style.setProperty("--p", sc);
    ring.dataset.level = sc >= 80 ? "good" : sc >= 60 ? "warn" : "bad";
    animateScore($("score-" + k), sc);
    const st = $("state-" + k);
    if (st) { st.textContent = sc >= 80 ? "HEALTHY" : sc >= 60 ? "WATCH" : "CRITICAL"; st.style.color = sc >= 80 ? "var(--gold)" : sc >= 60 ? "var(--amber)" : "var(--red)"; }
    $("card-" + k).classList.toggle("active", name === sel);
  });
}

function animateScore(element, target) {
  const from = Number(element.textContent) || 0;
  if (from === target || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    element.textContent = target;
    return;
  }
  if (element.scoreFrame) cancelAnimationFrame(element.scoreFrame);
  const started = performance.now();
  const duration = 560;
  const step = (now) => {
    const progress = Math.min(1, (now - started) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = Math.round(from + (target - from) * eased);
    if (progress < 1) element.scoreFrame = requestAnimationFrame(step);
  };
  element.scoreFrame = requestAnimationFrame(step);
}

function pulse(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function handleDetection(e) {
  state.pendingAnalyses = Math.max(0, state.pendingAnalyses - 1);
  updateAnalyzeButton();
  state.scores[e.speaker] = e.new_score;
  updateScore();
  addEventToFeed(e);
  const card = document.getElementById("card-" + e.speaker.slice(-1));
  if (e.accepted && card) pulse(card, "hit");
  if (e.accepted) showAlert(e);
}

function handleTranscript(msg) {
  const text = msg.text || "";
  if (!text) return;
  $("liveTranscript").textContent = text;
  $("stage").classList.remove("stage-dimmed");
  $("stageCaption").textContent = "Live transcript";
  $("liveTranscript").classList.toggle("interim", !msg.final);
  if (msg.final) setMicMessage(msg.speech_final ? "Sentence finished — analyzing…" : "Listening…");
}

function handleAudioStatus(msg) {
  if (msg.status === "started") {
    if (!state.mic.context) {
      if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({type:"audio_stop"}));
      return;
    }
    $("micBtn").innerHTML = '<span class="mic-glyph">' + MIC_SVG + '</span><span class="mic-listening-label">Listening</span><span class="mic-sound-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>';
    $("micBtn").classList.add("recording");
    $("micBtn").classList.remove("starting");
    $("micBtn").setAttribute("aria-label", "Stop microphone");
    $("micBtn").setAttribute("aria-pressed", "true");
    state.mic.active = true;
    setMicMessage(`Live STT: ${msg.provider || "Deepgram"}`);
  } else if (msg.status === "stopped") {
    resetMicButton();
    state.mic.active = false;
    setMicMessage("Microphone stopped");
  } else if (msg.status === "error") {
    stopMicrophone(false).then(() => setMicMessage(msg.message || "Live STT unavailable"));
  }
}

function resetMicButton() {
  $("micBtn").innerHTML = MIC_SVG + '<span class="mic-idle-label">Mic</span>';
  $("micBtn").classList.remove("recording", "starting");
  $("micBtn").setAttribute("aria-label", "Start microphone");
  $("micBtn").setAttribute("aria-pressed", "false");
}

function markQuote(text, quote) {
  const i = quote ? text.toLowerCase().indexOf(quote.toLowerCase()) : -1;
  if (i < 0) return escapeHtml(text);
  const j = i + quote.length;
  return escapeHtml(text.slice(0, i)) + '<span class="flagged-phrase">' + escapeHtml(text.slice(i, j)) + "</span>" + escapeHtml(text.slice(j));
}

function addEventToFeed(e) {
  const sp = e.speaker.slice(-1);
  const t = new Date(e.timestamp * 1000).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", hour12: false});
  const down = (e.reason || "").startsWith("Classifier unavailable");
  const note = e.accepted
    ? `↳ ${escapeHtml(e.fallacy_type)} · −${e.deduction} points · ${escapeHtml(e.explanation)}`
    : (down ? "AI unavailable, skipped" : "No structural flag on this line");
  const row = document.createElement("article");
  row.className = "transcript-row";
  row.innerHTML = `<time>${t}</time><span class="speaker-tag ${sp === "B" ? "speaker-b" : "speaker-a"}">${escapeHtml(sp)}</span>
    <div class="transcript-copy"><p>${e.accepted ? markQuote(e.text, e.quote) : escapeHtml(e.text)}</p>
    <span class="row-note ${e.accepted ? "flag-note" : "quiet-note"}">${note}</span></div>`;
  $("feed").prepend(row);
  if (e.accepted) {
    const chip = document.createElement("span");
    chip.className = "timeline-chip";
    chip.innerHTML = `<b>${t}</b> — ${escapeHtml(e.fallacy_type)} <em>${escapeHtml(sp)} · ${e.new_score}</em>`;
    $("timeline").prepend(chip);
  }
}

function showAlert(e) {
  const panel = $("alert");
  panel.dataset.state = "quiet";
  void panel.offsetWidth;
  panel.dataset.state = "flagged";
  $("alertType").textContent = e.fallacy_type;
  $("alertPenalty").textContent = `−${e.deduction}`;
  $("alertQuote").textContent = `“${e.quote}”`;
  $("alertExplanation").textContent = e.explanation;
  const live = $("liveTranscript");
  live.innerHTML = markQuote(e.text, e.quote);
  live.classList.remove("interim");
  $("stage").classList.add("stage-dimmed");
  $("stageCaption").innerHTML = `${escapeHtml(e.speaker)} <span class="caption-divider">/</span> <span style="color:var(--red)">flag detected</span>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>'"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
}

function stopDemo() {
  if (state.demoTimer) clearTimeout(state.demoTimer);
  state.demoTimer = null;
  state.demoRunning = false;
  if (state.providerLabel) {
    $("modeBadge").textContent = state.providerLabel;
    $("modeBadge").dataset.mode = state.providerMode;
  }
  document.querySelectorAll("[data-demo]").forEach((button) => {
    button.classList.remove("demo-playing");
    const label = button.querySelector(".demo-label");
    if (label) label.textContent = "Play demo";
  });
}

async function reset(options = {}) {
  if (!options.keepDemo) stopDemo();
  await stopMicrophone();
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: "reset" }));
  $("alert").dataset.state = "quiet";
  $("stage").classList.remove("stage-dimmed");
  $("stageCaption").textContent = "Live transcript";
  $("feed").innerHTML = "";
  $("timeline").innerHTML = "";
  $("liveTranscript").textContent = "Waiting for speech…";
  $("speakerSelect").value = "Speaker A";
  updateScore();
}

// ---- microphone -> PCM16 @ 16k -> FastAPI WebSocket -> Deepgram ----
async function startMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setMicMessage("Microphone API unavailable in this browser");
    return;
  }
  if (state.ws?.readyState !== WebSocket.OPEN) {
    setMicMessage("Waiting for WebSocket connection…");
    return;
  }

  const speaker = $("speakerSelect").value;
  const stream = await navigator.mediaDevices.getUserMedia({audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  }});
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);

  state.mic = {active: true, context, source, processor, stream, inputRate: context.sampleRate};
  $("micBtn").classList.add("starting");
  $("micBtn").innerHTML = MIC_SVG + '<span class="mic-starting-label">Starting…</span>';
  $("micBtn").setAttribute("aria-label", "Microphone starting");
  $("micBtn").setAttribute("aria-pressed", "true");
  state.ws.send(JSON.stringify({type:"audio_start", speaker, language: $("langSelect").value}));
  setMicMessage(`Starting live STT at ${context.sampleRate} Hz input…`);

  processor.onaudioprocess = (evt) => {
    if (!state.mic.active || state.ws?.readyState !== WebSocket.OPEN) return;
    const input = evt.inputBuffer.getChannelData(0);
    const pcm = downsampleTo16k(input, context.sampleRate);
    state.ws.send(pcm.buffer);
  };
}

function downsampleTo16k(buffer, sampleRate) {
  const targetRate = 16000;
  if (sampleRate === targetRate) return floatTo16BitPCM(buffer);
  const ratio = sampleRate / targetRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Int16Array(newLength);
  let offset = 0;
  for (let i = 0; i < newLength; i++) {
    const nextOffset = Math.min(buffer.length, Math.round((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = offset; j < nextOffset; j++) {
      sum += buffer[j];
      count++;
    }
    const sample = count ? sum / count : 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    result[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    offset = nextOffset;
  }
  return result;
}

function floatTo16BitPCM(buffer) {
  const result = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    const s = Math.max(-1, Math.min(1, buffer[i]));
    result[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return result;
}

async function stopMicrophone(notifyServer = true) {
  if (!state.mic.context && !state.mic.stream) {
    state.mic.active = false;
    resetMicButton();
    return;
  }
  state.mic.active = false;
  try { state.mic.processor?.disconnect(); } catch (_) {}
  try { state.mic.source?.disconnect(); } catch (_) {}
  try { await state.mic.context?.close(); } catch (_) {}
  state.mic.stream?.getTracks().forEach(t => t.stop());
  if (notifyServer && state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({type:"audio_stop"}));
  state.mic = {active:false, context:null, source:null, processor:null, stream:null, inputRate:48000};
  resetMicButton();
}

async function toggleMicrophone() {
  if (state.mic.active) {
    await stopMicrophone();
    setMicMessage("Microphone stopped");
  } else {
    try {
      await startMicrophone();
    } catch (err) {
      await stopMicrophone();
      setMicMessage(`Microphone error: ${err.message}`);
    }
  }
}

// ---- Browser Speech Recognition fallback (no Deepgram key required) ----
const demos = {
  debate: [
    {speaker: "Speaker A", text: "The city should test two evening bus routes because several neighborhoods have no service after eight."},
    {speaker: "Speaker B", text: "A short pilot could show whether those routes help before the city commits to a permanent change."},
    {speaker: "Speaker A", text: "You're not qualified to talk about this, so your argument is meaningless."},
    {speaker: "Speaker B", text: "Either the city funds the pilot this year or evening riders will be left stranded."},
    {speaker: "Speaker A", text: "So basically you want to ban every evening route in the city."},
    {speaker: "Speaker B", text: "I suggested testing two routes, not ending evening service."},
    {speaker: "Speaker A", text: "We can review the rider data before deciding whether to expand it."},
  ],
  clean: [{speaker: "Speaker A", text: "The proposal has three parts, and each one can be evaluated independently."}],
  ad_hominem: [
    {speaker: "Speaker A", text: "Your proposal does not address the budget data."},
    {speaker: "Speaker B", text: "You don't understand economics, so your argument is meaningless."}
  ],
  false_dilemma: [
    {speaker: "Speaker A", text: "There are several ways to lower the cost."},
    {speaker: "Speaker B", text: "Either we completely cancel the program or everything will fail."}
  ],
  straw_man: [
    {speaker: "Speaker A", text: "I support regulating harmful content while keeping ordinary discussion open."},
    {speaker: "Speaker B", text: "So you want to ban everything people say online."}
  ],
};

async function runDemo(name, button) {
  stopDemo();
  await reset({keepDemo: true});
  state.demoRunning = true;
  $("modeBadge").textContent = "Deterministic scripted demo";
  $("modeBadge").dataset.mode = "demo";
  button?.classList.add("demo-playing");
  const demoLabel = button?.querySelector(".demo-label");
  if (demoLabel) demoLabel.textContent = "Playing demo…";
  const lines = demos[name] || [];
  let i = 0;
  const tick = () => {
    if (i >= lines.length) {
      stopDemo();
      return;
    }
    const line = lines[i++];
    $("speakerSelect").value = line.speaker;
    updateScore();
    sendAnalyze(line.text, line.speaker, true);
    state.demoTimer = setTimeout(tick, 2100);
  };
  tick();
}

$("sendBtn").onclick = () => sendAnalyze($("inputText").value);
$("micBtn").onclick = toggleMicrophone;

$("resetBtn").onclick = reset;
$("speakerSelect").onchange = updateScore;
document.querySelectorAll("[data-demo]").forEach(btn => btn.onclick = () => runDemo(btn.dataset.demo, btn));

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const rect = button.getBoundingClientRect();
  button.style.setProperty("--click-x", `${event.clientX ? event.clientX - rect.left : rect.width / 2}px`);
  button.style.setProperty("--click-y", `${event.clientY ? event.clientY - rect.top : rect.height / 2}px`);
  button.classList.remove("ignition-click");
  void button.offsetWidth;
  button.classList.add("ignition-click");
  button.addEventListener("animationend", (animationEvent) => {
    if (animationEvent.animationName === "ignition-ripple") button.classList.remove("ignition-click");
  }, {once: true});
});

["A", "B"].forEach((k) => {
  $("card-" + k).onclick = () => { $("speakerSelect").value = "Speaker " + k; updateScore(); };
});
fetch("/api/config").then((r) => r.json()).then((c) => {
  const live = c.provider === "GroqProvider";
  state.providerLabel = live ? "Live AI classifier" : "Scripted demo mode";
  state.providerMode = live ? "live" : "demo";
  if (!state.demoRunning) {
    $("modeBadge").textContent = state.providerLabel;
    $("modeBadge").dataset.mode = state.providerMode;
  }
}).catch(() => { $("modeBadge").textContent = "Mode unknown"; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setUpload = (t) => { $("uploadStatus").textContent = t; };
$("uploadBtn").onclick = () => $("fileInput").click();
$("fileInput").onchange = async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = "";
  if (!file) return;
  if (file.size > 100 * 1024 * 1024) { setUpload("File too large (max 100 MB)"); return; }
  if (state.ws?.readyState !== WebSocket.OPEN) { setUpload("Not connected yet. Try again in a moment."); return; }
  setUpload("Transcribing " + file.name + "…");
  const fd = new FormData();
  fd.append("file", file);
  fd.append("language", $("langSelect").value);
  try {
    const r = await fetch("/api/transcribe", { method: "POST", body: fd });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
    const { utterances } = await r.json();
    if (!utterances.length) { setUpload("No speech found in that file"); return; }
    const base = Date.now() / 1000;
    for (let i = 0; i < utterances.length; i++) {
      const u = utterances[i];
      setUpload(`Analyzing ${i + 1} of ${utterances.length}…`);
      $("liveTranscript").textContent = u.text;
      $("stage").classList.remove("stage-dimmed");
      state.ws.send(JSON.stringify({ type: "analyze", data: { speaker: u.speaker, text: u.text, timestamp: base + u.start } }));
      await sleep(900);
    }
    setUpload(`Done: ${utterances.length} segments from ${file.name}`);
  } catch (e) { setUpload("Upload failed: " + e.message); }
};

connect();
