const state = {
  scores: {"Speaker A": 100, "Speaker B": 100},
  ws: null,
  demoTimer: null,
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
  $("statusDot").style.background = connected ? "#14d9ff" : "#ff5c68";
  $("statusText").textContent = text;
}

function setMicMessage(text) {
  const el = $("micMessage");
  if (el) el.textContent = text;
}

function sendAnalyze(text, speaker = $("speakerSelect").value) {
  if (!text.trim()) return;
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: "analyze", data: { speaker, text, timestamp: Date.now() / 1000 } }));
  }
  $("inputText").value = "";
}

function renderState(snapshot) {
  state.scores = snapshot.scores || state.scores;
  updateScore();
  $("feed").innerHTML = "";
  $("timeline").innerHTML = "";
  (snapshot.events || []).forEach(addEventToFeed);
}

function updateScore() {
  const speaker = $("speakerSelect").value;
  const score = state.scores[speaker] ?? 100;
  $("score").textContent = score;
  $("meterFill").style.width = `${score}%`;
}

function handleDetection(e) {
  state.scores[e.speaker] = e.new_score;
  updateScore();
  addEventToFeed(e);
  if (e.accepted) showAlert(e);
}

function handleTranscript(msg) {
  const text = msg.text || "";
  if (!text) return;
  $("liveTranscript").textContent = text;
  $("liveTranscript").classList.toggle("interim", !msg.final);
  if (msg.final) setMicMessage(msg.speech_final ? "Sentence finished — analyzing…" : "Listening…");
}

function handleAudioStatus(msg) {
  if (msg.status === "started") {
    $("micBtn").textContent = "■ Stop microphone";
    $("micBtn").classList.add("recording");
    state.mic.active = true;
    setMicMessage(`Live STT: ${msg.provider || "Deepgram"}`);
  } else if (msg.status === "stopped") {
    $("micBtn").textContent = "● Start microphone";
    $("micBtn").classList.remove("recording");
    state.mic.active = false;
    setMicMessage("Microphone stopped");
  } else if (msg.status === "error") {
    $("micBtn").textContent = "● Start microphone";
    $("micBtn").classList.remove("recording");
    state.mic.active = false;
    setMicMessage(msg.message || "Live STT unavailable");
  }
}

function addEventToFeed(e) {
  const div = document.createElement("div");
  div.className = "item";
  const dt = new Date(e.timestamp * 1000);
  div.innerHTML = `
    <div class="item-time">${dt.toLocaleTimeString()}<br>${escapeHtml(e.speaker)}</div>
    <div>
      <div class="item-text">${escapeHtml(e.text)}</div>
      ${e.accepted ? `<div class="item-flag">⚠ ${escapeHtml(e.fallacy_type)} · −${e.deduction}</div>` : `<div class="item-flag noflag">NO FLAG</div>`}
    </div>`;
  $("feed").prepend(div);
  if (e.accepted) {
    const flag = document.createElement("div");
    flag.className = "flag";
    flag.innerHTML = `${escapeHtml(e.fallacy_type)} <span>−${e.deduction} · ${e.new_score}</span>`;
    $("timeline").prepend(flag);
  }
}

function showAlert(e) {
  $("alert").classList.remove("hidden");
  $("alertType").textContent = e.fallacy_type.toUpperCase();
  $("alertPenalty").textContent = `−${e.deduction} · SCORE ${e.new_score}`;
  $("alertQuote").textContent = `“${e.quote}”`;
  $("alertExplanation").textContent = e.explanation;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>'"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
}

async function reset() {
  await stopMicrophone();
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({ type: "reset" }));
  $("alert").classList.add("hidden");
  $("feed").innerHTML = "";
  $("timeline").innerHTML = "";
  $("liveTranscript").textContent = "Waiting for speech…";
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
  state.ws.send(JSON.stringify({type:"audio_start", speaker}));
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

async function stopMicrophone() {
  if (!state.mic.context && !state.mic.stream) return;
  state.mic.active = false;
  try { state.mic.processor?.disconnect(); } catch (_) {}
  try { state.mic.source?.disconnect(); } catch (_) {}
  try { await state.mic.context?.close(); } catch (_) {}
  state.mic.stream?.getTracks().forEach(t => t.stop());
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify({type:"audio_stop"}));
  state.mic = {active:false, context:null, source:null, processor:null, stream:null, inputRate:48000};
  $("micBtn").textContent = "● Start microphone";
  $("micBtn").classList.remove("recording");
}

async function toggleMicrophone() {
  if (state.mic.active) {
    await stopMicrophone();
    setMicMessage("Microphone stopped");
  } else {
    try {
      await startMicrophone();
    } catch (err) {
      setMicMessage(`Microphone error: ${err.message}`);
    }
  }
}

// ---- Browser Speech Recognition fallback (no Deepgram key required) ----
function toggleBrowserSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    setMicMessage("Browser speech recognition is unavailable. Use Deepgram.");
    return;
  }
  if (state.speech.active) {
    state.speech.recognition?.stop();
    return;
  }
  const recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";
  recognition.onstart = () => {
    state.speech.active = true;
    $("browserSpeechBtn").textContent = "■ Stop browser speech";
    setMicMessage("Browser speech recognition active");
  };
  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0].transcript.trim();
      handleTranscript({text, final: result.isFinal});
      if (result.isFinal && text) sendAnalyze(text);
    }
  };
  recognition.onerror = (event) => setMicMessage(`Browser speech: ${event.error}`);
  recognition.onend = () => {
    state.speech.active = false;
    $("browserSpeechBtn").textContent = "Use browser speech fallback";
  };
  state.speech.recognition = recognition;
  recognition.start();
}

const demos = {
  clean: ["The proposal has three parts, and each one can be evaluated independently."],
  ad_hominem: [
    "Your proposal does not address the budget data.",
    "You don't understand economics, so your argument is meaningless."
  ],
  false_dilemma: [
    "There are several ways to lower the cost.",
    "Either we completely cancel the program or everything will fail."
  ],
  straw_man: [
    "I support regulating harmful content while keeping ordinary discussion open.",
    "So you want to ban everything people say online."
  ],
  mixed: [
    "Our plan has a measurable target and three implementation stages.",
    "You're not qualified to talk about this, so your point can be ignored.",
    "Either we adopt this exact plan or the whole project collapses.",
    "So basically you want to ban every platform on the internet."
  ],
};

function runDemo(name) {
  if (state.demoTimer) clearTimeout(state.demoTimer);
  const lines = demos[name] || [];
  let i = 0;
  const tick = () => {
    if (i >= lines.length) return;
    sendAnalyze(lines[i++]);
    state.demoTimer = setTimeout(tick, 1700);
  };
  tick();
}

$("sendBtn").onclick = () => sendAnalyze($("inputText").value);
$("micBtn").onclick = toggleMicrophone;
$("browserSpeechBtn").onclick = toggleBrowserSpeech;
$("resetBtn").onclick = reset;
$("speakerSelect").onchange = updateScore;
document.querySelectorAll("[data-demo]").forEach(btn => btn.onclick = () => runDemo(btn.dataset.demo));

connect();
