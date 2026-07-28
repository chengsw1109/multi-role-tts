const storyInput = document.querySelector("#story-input");
const storyStatus = document.querySelector("#story-status");
const voiceButton = document.querySelector("#story-voice");
const voiceMode = document.querySelector("#voice-mode");
const speedInput = document.querySelector("#story-speed");
const browserVoice = document.querySelector("#browser-voice");
const canSpeak = "speechSynthesis" in window;
let availableBrowserVoices = [];
let activeStory = null;

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

function createStorySegments(story) {
  const paragraphs = story.split(/\n\s*\n/).map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  const segments = [];
  let previousSpeaker = "";

  function append(role, text) {
    const content = text.trim();
    if (!content) return;
    segments.push({ role, text: content });
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
      append(role, quote[1]);
      if (role !== "對話") previousSpeaker = role;
      cursor = quote.index + quote[0].length;
    }
    append("旁白", paragraph.slice(cursor));
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
  const preferred = availableBrowserVoices.find((voice) => /^zh/i.test(voice.lang));
  browserVoice.value = availableBrowserVoices.some((voice) => voice.voiceURI === selected)
    ? selected
    : (preferred || availableBrowserVoices[0]).voiceURI;
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

function finishStory(message) {
  activeStory = null;
  voiceButton.textContent = "語音";
  storyStatus.textContent = message;
  storyStatus.classList.remove("error");
}

function stopStory(message = "已停止語音。") {
  if (!activeStory) return;
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
  utterance.rate = sequence.speed;
  utterance.onend = () => {
    if (activeStory !== sequence) return;
    sequence.index += 1;
    speakNext(sequence);
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
if (canSpeak) {
  window.speechSynthesis.addEventListener("voiceschanged", populateBrowserVoices);
  populateBrowserVoices();
} else {
  browserVoice.add(new Option("此瀏覽器不支援內建語音", ""));
  browserVoice.disabled = true;
}
