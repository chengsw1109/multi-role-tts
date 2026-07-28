const lines = document.querySelector("#lines");
const template = document.querySelector("#line-template");
const addLineButton = document.querySelector("#add-line");
const generateAllButton = document.querySelector("#generate-all");
const storyInput = document.querySelector("#story-input");
const analyzeStoryButton = document.querySelector("#analyze-story");
const storyStatus = document.querySelector("#story-status");
const canPreview = "speechSynthesis" in window;
let availableBrowserVoices = [];
let activePreview = null;
const roleVoices = ["nova", "onyx", "shimmer", "echo", "fable"];

const initialLines = [
  { role: "旁白", voice: "alloy", text: "雨後的城市，空氣裡帶著一點清新的味道。" },
  { role: "小安", voice: "nova", text: "我們終於到了！這裡比我想像中的還漂亮。" },
  { role: "阿哲", voice: "onyx", text: "先別急，這趟旅程才正要開始。" }
];

function safeFilename(value) {
  return (value || "speech").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
}

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
  const voiceByRole = new Map([["旁白", "alloy"]]);

  function voiceFor(role) {
    if (!voiceByRole.has(role)) {
      voiceByRole.set(role, roleVoices[(voiceByRole.size - 1) % roleVoices.length]);
    }
    return voiceByRole.get(role);
  }

  function append(role, text) {
    const content = text.trim();
    if (!content) return;
    segments.push({ role, voice: voiceFor(role), text: content });
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

function analyzeStory() {
  const story = storyInput.value.trim();
  if (!story) {
    storyStatus.textContent = "請先貼上故事內容。";
    storyStatus.classList.add("error");
    return;
  }

  const segments = createStorySegments(story);
  if (!segments.length) {
    storyStatus.textContent = "找不到可建立的段落，請確認故事內容。";
    storyStatus.classList.add("error");
    return;
  }

  stopPreview("已停止免費試聽。");
  for (const player of lines.querySelectorAll(".player")) {
    if (player.src.startsWith("blob:")) URL.revokeObjectURL(player.src);
  }
  lines.replaceChildren();
  segments.forEach(addLine);
  storyStatus.textContent = `已建立 ${segments.length} 個段落。請檢查對話角色，再免費試聽或產生 MP3。`;
  storyStatus.classList.remove("error");
}

function browserVoiceLabel(voice) {
  return `${voice.name} (${voice.lang})${voice.localService ? " · 本機" : ""}`;
}

function populateBrowserVoiceOptions(scope = document) {
  if (!canPreview) return;
  availableBrowserVoices = window.speechSynthesis.getVoices();
  for (const select of scope.querySelectorAll(".browser-voice")) {
    const selected = select.value;
    select.replaceChildren();
    if (!availableBrowserVoices.length) {
      select.add(new Option("正在載入本機語音…", ""));
      select.disabled = true;
      continue;
    }

    select.disabled = false;
    for (const voice of availableBrowserVoices) {
      select.add(new Option(browserVoiceLabel(voice), voice.voiceURI));
    }
    const preferred = availableBrowserVoices.find((voice) => /^zh/i.test(voice.lang));
    select.value = availableBrowserVoices.some((voice) => voice.voiceURI === selected)
      ? selected
      : (preferred || availableBrowserVoices[0]).voiceURI;
  }
}

function stopPreview(message = "已停止免費試聽。") {
  if (!activePreview) return;
  const { card, button, utterance } = activePreview;
  utterance.onend = null;
  utterance.onerror = null;
  window.speechSynthesis.cancel();
  button.textContent = "免費試聽";
  if (card.isConnected) setStatus(card, message);
  activePreview = null;
}

function preview(card) {
  const text = card.querySelector(".text").value.trim();
  const button = card.querySelector(".preview");
  if (!canPreview) {
    setStatus(card, "此瀏覽器不支援免費試聽。", true);
    return;
  }
  if (!text) {
    setStatus(card, "請先輸入台詞。", true);
    return;
  }
  if (activePreview?.card === card) {
    stopPreview();
    return;
  }

  stopPreview();
  const selectedVoice = availableBrowserVoices.find(
    (voice) => voice.voiceURI === card.querySelector(".browser-voice").value
  );
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = selectedVoice || null;
  utterance.lang = selectedVoice?.lang || "zh-TW";
  utterance.rate = Number(card.querySelector(".speed").value) || 1;
  utterance.onend = () => {
    if (activePreview?.utterance !== utterance) return;
    button.textContent = "免費試聽";
    setStatus(card, "免費試聽完成");
    activePreview = null;
  };
  utterance.onerror = () => {
    if (activePreview?.utterance !== utterance) return;
    button.textContent = "免費試聽";
    setStatus(card, "免費試聽失敗，請改選另一個本機語音。", true);
    activePreview = null;
  };

  activePreview = { card, button, utterance };
  button.textContent = "停止試聽";
  setStatus(card, "正在免費試聽…");
  window.speechSynthesis.speak(utterance);
}

function addLine(data = {}) {
  const card = template.content.firstElementChild.cloneNode(true);
  card.querySelector(".role").value = data.role || "角色";
  card.querySelector(".voice").value = data.voice || "alloy";
  card.querySelector(".speed").value = data.speed || 1;
  card.querySelector(".text").value = data.text || "";
  card.querySelector(".remove").addEventListener("click", () => {
    const audio = card.querySelector(".player");
    if (audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
    if (activePreview?.card === card) stopPreview("已停止免費試聽。");
    card.remove();
  });
  card.querySelector(".preview").addEventListener("click", () => preview(card));
  card.querySelector(".generate-one").addEventListener("click", () => generate(card));
  lines.append(card);
  populateBrowserVoiceOptions(card);
  return card;
}

function setStatus(card, message, isError = false) {
  const status = card.querySelector(".status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

async function generate(card) {
  const button = card.querySelector(".generate-one");
  const role = card.querySelector(".role").value.trim();
  const text = card.querySelector(".text").value.trim();
  const voice = card.querySelector(".voice").value;
  const speed = Number(card.querySelector(".speed").value);
  const player = card.querySelector(".player");
  const download = card.querySelector(".download");

  if (!text) {
    setStatus(card, "請先輸入台詞。", true);
    return;
  }

  button.disabled = true;
  setStatus(card, "正在產生語音…");
  try {
    const response = await fetch("/api/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: text, voice, speed })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "語音產生失敗。請稍後再試。");
    }

    const url = URL.createObjectURL(await response.blob());
    if (player.src.startsWith("blob:")) URL.revokeObjectURL(player.src);
    player.src = url;
    player.hidden = false;
    download.href = url;
    download.download = `${safeFilename(role)}.mp3`;
    download.hidden = false;
    setStatus(card, "完成");
  } catch (error) {
    setStatus(card, error.message, true);
  } finally {
    button.disabled = false;
  }
}

addLineButton.addEventListener("click", () => addLine());
analyzeStoryButton.addEventListener("click", analyzeStory);
generateAllButton.addEventListener("click", async () => {
  const cards = [...lines.querySelectorAll(".line-card")];
  generateAllButton.disabled = true;
  for (const card of cards) await generate(card);
  generateAllButton.disabled = false;
});

initialLines.forEach(addLine);
if (canPreview) {
  window.speechSynthesis.addEventListener("voiceschanged", () => populateBrowserVoiceOptions());
  populateBrowserVoiceOptions();
}
