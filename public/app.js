import { normalizeForSpeech, pauseAfter, splitSpeechText, toneForSegment } from "/prosody.js";

const storyInput = document.querySelector("#story-input");
const storyStatus = document.querySelector("#story-status");
const voiceButton = document.querySelector("#story-voice");
const voiceMode = document.querySelector("#voice-mode");
const speedInput = document.querySelector("#story-speed");
const browserVoice = document.querySelector("#browser-voice");
const speechEngine = document.querySelector("#speech-engine");
const browserVoiceSetting = document.querySelector("#browser-voice-setting");
const voiceboxUrlSetting = document.querySelector("#voicebox-url-setting");
const voiceboxUrl = document.querySelector("#voicebox-url");
const naturalProsody = document.querySelector("#natural-prosody");
const canSpeak = "speechSynthesis" in window;
let availableBrowserVoices = [];
let activeStory = null;
let activeVoicebox = null;
let browserVoiceChosenByUser = false;
const voiceboxPlayer = new Audio();

function cleanRoleName(value) {
  return value.replace(/^(?:一位|那位|這位|的)/, "").trim();
}

function actorAtStart(context) {
  const match = context.match(
    /^\s*([\u4e00-\u9fff]{2,5}?)(?=(?:邊|站|指|看|回|對|低|大|笑|慢|喊|說|問|答|叫|道|叮嚀|默念|表示|正|降|抬|皺|露|在))/
  );
  return match ? cleanRoleName(match[1]) : "";
}

function actorInContext(context) {
  const pattern = /([\u4e00-\u9fff]{2,5}?)(?=(?:邊|站|指|看|回頭|回|對|低頭|大喊|大罵|回嗆|叮嚀|默念|說|喊|問|答|叫|道|表示|笑))/g;
  const nonNames = new Set(["笑著", "邊走", "回頭", "看著", "站在", "指著", "低頭", "大喊", "大罵", "回嗆", "叮嚀", "默念", "說著"]);
  const matches = [...context.matchAll(pattern)]
    .map((match) => cleanRoleName(match[1]))
    .filter((candidate) => !nonNames.has(candidate));
  return matches.at(-1) || "";
}

function inferSpeaker(before, after, previousSpeaker) {
  return actorAtStart(after) || actorInContext(after) || actorInContext(before) || previousSpeaker || "對話";
}

function usingNaturalProsody() {
  return naturalProsody.checked;
}

function createStorySegments(story) {
  const natural = usingNaturalProsody();
  const paragraphs = story.split(/\n\s*\n/).map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  const segments = [];
  let previousSpeaker = "";

  function append(role, text, context = "") {
    const content = natural ? normalizeForSpeech(text) : text.trim();
    if (!content) return;
    for (const chunk of splitSpeechText(content, natural ? 220 : 260)) {
      const roleChanged = segments.length > 0 && segments.at(-1).role !== role;
      segments.push({
        role,
        text: chunk,
        tone: natural ? toneForSegment({ role, text: chunk, context }) : { rate: 1, pitch: 1 },
        pause: natural ? pauseAfter(chunk, { roleChanged }) : 0
      });
    }
  }

  for (const paragraph of paragraphs) {
    const quotePattern = /「([^」]+)」/g;
    let quote;
    let cursor = 0;
    while ((quote = quotePattern.exec(paragraph))) {
      append("旁白", paragraph.slice(cursor, quote.index));
      const before = paragraph.slice(Math.max(0, cursor - 100), quote.index);
      const after = paragraph.slice(quote.index + quote[0].length, quote.index + quote[0].length + 140);
      const role = inferSpeaker(before, after, previousSpeaker);
      append(role, quote[1], `${before.slice(-60)} ${after}`);
      if (role !== "對話") previousSpeaker = role;
      cursor = quote.index + quote[0].length;
    }
    append("旁白", paragraph.slice(cursor));
    const last = segments.at(-1);
    if (natural && last) last.pause += 260;
  }

  return segments;
}

function browserVoiceLabel(voice) {
  return `${voice.name} (${voice.lang})${voice.localService ? " · 本機" : ""}`;
}

function populateBrowserVoices() {
  if (!canSpeak) return;
  availableBrowserVoices = window.speechSynthesis.getVoices();
  const selected = browserVoice.value;
  browserVoice.replaceChildren();
  if (!availableBrowserVoices.length) {
    browserVoice.add(new Option("正在載入本機語音…", ""));
    browserVoice.disabled = true;
    return;
  }

  browserVoice.disabled = false;
  for (const voice of availableBrowserVoices) {
    browserVoice.add(new Option(browserVoiceLabel(voice), voice.voiceURI));
  }
  const googleTaiwan = availableBrowserVoices.find(
    (voice) => /google/i.test(voice.name) && /(國語|mandarin|chinese)/i.test(voice.name) && /(台灣|臺灣|taiwan)/i.test(voice.name)
  );
  const taiwanChinese = availableBrowserVoices.find(
    (voice) => /^zh-(TW|Hant-TW)$/i.test(voice.lang) || /(國語|台灣|臺灣|taiwan)/i.test(voice.name)
  );
  const chinese = availableBrowserVoices.find((voice) => /^zh/i.test(voice.lang));
  const currentVoice = availableBrowserVoices.find((voice) => voice.voiceURI === selected);
  const preferred = browserVoiceChosenByUser && currentVoice
    ? currentVoice
    : (googleTaiwan || taiwanChinese || chinese || availableBrowserVoices[0]);
  browserVoice.value = preferred.voiceURI;
}

function selectedBrowserVoice() {
  return availableBrowserVoices.find((voice) => voice.voiceURI === browserVoice.value) || null;
}

function roleVoice(role, primaryVoice, assignments) {
  if (voiceMode.value === "single" || role === "旁白") return primaryVoice;
  if (assignments.has(role)) return assignments.get(role);
  const language = primaryVoice?.lang.split("-")[0];
  const choices = availableBrowserVoices.filter((voice) => voice.lang.startsWith(language));
  const candidate = choices[assignments.size % choices.length] || primaryVoice;
  assignments.set(role, candidate);
  return candidate;
}

function setEngineSettings() {
  const usingVoicebox = speechEngine.value === "voicebox";
  browserVoiceSetting.hidden = usingVoicebox;
  voiceboxUrlSetting.hidden = !usingVoicebox;
}

function showError(message) {
  storyStatus.textContent = message;
  storyStatus.classList.add("error");
}

function normalizedProfileName(profile) {
  return String(profile.name || "").trim().toLocaleLowerCase();
}

function voiceboxProfileForRole(sequence, role) {
  const exact = sequence.profiles.find((profile) => normalizedProfileName(profile) === role.toLocaleLowerCase());
  const narrator = sequence.profiles.find((profile) => /^(旁白|narrator|default|預設)$/i.test(String(profile.name || "")));
  if (voiceMode.value === "single" || role === "旁白") return narrator || exact || sequence.profiles[0];
  if (exact) return exact;
  if (sequence.assignments.has(role)) return sequence.assignments.get(role);
  const candidates = sequence.profiles.filter((profile) => profile.id !== narrator?.id);
  const profile = candidates[sequence.assignments.size % candidates.length] || narrator || sequence.profiles[0];
  sequence.assignments.set(role, profile);
  return profile;
}

async function voiceboxRequest(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Voicebox request failed.");
  }
  return response;
}

function finishVoicebox(message) {
  if (activeVoicebox?.objectUrl) URL.revokeObjectURL(activeVoicebox.objectUrl);
  activeVoicebox = null;
  voiceButton.textContent = "語音";
  storyStatus.textContent = message;
  storyStatus.classList.remove("error");
}

function queueNextSegment(sequence, pause, play) {
  window.clearTimeout(sequence.pauseTimer);
  sequence.index += 1;
  sequence.pauseTimer = window.setTimeout(() => play(sequence), pause);
}

function stopVoicebox(message = "已停止語音。") {
  if (!activeVoicebox) return;
  const sequence = activeVoicebox;
  activeVoicebox = null;
  window.clearTimeout(sequence.pauseTimer);
  voiceboxPlayer.pause();
  voiceboxPlayer.removeAttribute("src");
  voiceboxPlayer.load();
  if (sequence.objectUrl) URL.revokeObjectURL(sequence.objectUrl);
  voiceButton.textContent = "語音";
  storyStatus.textContent = message;
  storyStatus.classList.remove("error");
}

async function playVoiceboxNext(sequence) {
  if (activeVoicebox !== sequence) return;
  if (sequence.index >= sequence.segments.length) {
    finishVoicebox("Voicebox 多人語音朗讀完成。");
    return;
  }

  const segment = sequence.segments[sequence.index];
  const profile = voiceboxProfileForRole(sequence, segment.role);
  storyStatus.textContent = `正在產生：${segment.role}（${sequence.index + 1} / ${sequence.segments.length}）`;
  try {
    const response = await voiceboxRequest("/api/voicebox/speech", {
      voiceboxUrl: voiceboxUrl.value.trim(),
      profileId: profile.id,
      engine: profile.default_engine || profile.preset_engine || "qwen",
      text: segment.text
    });
    if (activeVoicebox !== sequence) return;
    if (sequence.objectUrl) URL.revokeObjectURL(sequence.objectUrl);
    sequence.objectUrl = URL.createObjectURL(await response.blob());
    voiceboxPlayer.src = sequence.objectUrl;
    voiceboxPlayer.playbackRate = Math.min(4, Math.max(0.25, sequence.speed * segment.tone.rate));
    voiceboxPlayer.onended = () => {
      if (activeVoicebox !== sequence) return;
      queueNextSegment(sequence, segment.pause, playVoiceboxNext);
    };
    voiceboxPlayer.onerror = () => {
      if (activeVoicebox === sequence) {
        stopVoicebox("Voicebox 音訊播放失敗，請檢查本機語音設定檔。");
        storyStatus.classList.add("error");
      }
    };
    await voiceboxPlayer.play();
  } catch (error) {
    if (activeVoicebox === sequence) {
      stopVoicebox(error.message || "Voicebox 語音產生失敗。");
      storyStatus.classList.add("error");
    }
  }
}

async function speakVoiceboxStory() {
  const story = storyInput.value.trim();
  if (!story) {
    showError("請先貼上故事內容。");
    return;
  }
  const speed = Number(speedInput.value);
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
    showError("語速必須介於 0.25 和 4 之間。");
    return;
  }
  voiceButton.disabled = true;
  storyStatus.textContent = "正在連線到本機 Voicebox…";
  storyStatus.classList.remove("error");
  try {
    const response = await voiceboxRequest("/api/voicebox/profiles", { voiceboxUrl: voiceboxUrl.value.trim() });
    const { profiles = [] } = await response.json();
    if (!profiles.length) throw new Error("Voicebox 找不到語音設定檔。請先建立旁白或角色聲音。" );
    const sequence = { segments: createStorySegments(story), profiles, index: 0, assignments: new Map(), objectUrl: "", speed };
    activeVoicebox = sequence;
    voiceButton.textContent = "停止語音";
    await playVoiceboxNext(sequence);
  } catch (error) {
    showError(error.message || "無法連線到本機 Voicebox。");
  } finally {
    voiceButton.disabled = false;
  }
}

function finishStory(message) {
  activeStory = null;
  voiceButton.textContent = "語音";
  storyStatus.textContent = message;
  storyStatus.classList.remove("error");
}

function stopStory(message = "已停止語音。") {
  if (!activeStory) return;
  window.clearTimeout(activeStory.pauseTimer);
  activeStory = null;
  window.speechSynthesis.cancel();
  voiceButton.textContent = "語音";
  storyStatus.textContent = message;
  storyStatus.classList.remove("error");
}

function speakNext(sequence) {
  if (activeStory !== sequence) return;
  if (sequence.index >= sequence.segments.length) {
    finishStory("語音朗讀完成。");
    return;
  }

  const segment = sequence.segments[sequence.index];
  const utterance = new SpeechSynthesisUtterance(segment.text);
  const voice = roleVoice(segment.role, sequence.primaryVoice, sequence.assignments);
  utterance.voice = voice;
  utterance.lang = voice?.lang || "zh-TW";
  utterance.rate = Math.min(10, Math.max(0.1, sequence.speed * segment.tone.rate));
  utterance.pitch = segment.tone.pitch;
  utterance.onend = () => {
    if (activeStory !== sequence) return;
    queueNextSegment(sequence, segment.pause, speakNext);
  };
  utterance.onerror = () => {
    if (activeStory !== sequence) return;
    finishStory("語音朗讀中斷，請改選另一個瀏覽器語音後再試。");
    storyStatus.classList.add("error");
  };
  storyStatus.textContent = `正在朗讀：${segment.role}（${sequence.index + 1} / ${sequence.segments.length}）`;
  window.speechSynthesis.speak(utterance);
}

function speakStory() {
  if (speechEngine.value === "voicebox") {
    if (activeVoicebox) {
      stopVoicebox();
      return;
    }
    if (activeStory) stopStory();
    speakVoiceboxStory();
    return;
  }
  if (activeVoicebox) stopVoicebox();
  if (!canSpeak) {
    storyStatus.textContent = "此瀏覽器不支援內建語音。";
    storyStatus.classList.add("error");
    return;
  }
  if (activeStory) {
    stopStory();
    return;
  }
  const story = storyInput.value.trim();
  if (!story) {
    storyStatus.textContent = "請先貼上故事內容。";
    storyStatus.classList.add("error");
    return;
  }
  const primaryVoice = selectedBrowserVoice();
  if (!primaryVoice) {
    storyStatus.textContent = "正在載入瀏覽器語音，請稍候再試。";
    storyStatus.classList.add("error");
    return;
  }
  const speed = Number(speedInput.value);
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
    storyStatus.textContent = "語速必須介於 0.25 和 4 之間。";
    storyStatus.classList.add("error");
    return;
  }

  const segments = createStorySegments(story);
  activeStory = { segments, index: 0, speed, primaryVoice, assignments: new Map() };
  voiceButton.textContent = "停止語音";
  storyStatus.classList.remove("error");
  speakNext(activeStory);
}

voiceButton.addEventListener("click", speakStory);
speechEngine.addEventListener("change", () => {
  if (activeStory) stopStory();
  if (activeVoicebox) stopVoicebox();
  setEngineSettings();
});
browserVoice.addEventListener("change", () => {
  browserVoiceChosenByUser = true;
});
if (canSpeak) {
  window.speechSynthesis.addEventListener("voiceschanged", populateBrowserVoices);
  populateBrowserVoices();
} else {
  browserVoice.add(new Option("此瀏覽器不支援內建語音", ""));
  browserVoice.disabled = true;
}
setEngineSettings();
