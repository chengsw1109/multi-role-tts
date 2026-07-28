const lines = document.querySelector("#lines");
const template = document.querySelector("#line-template");
const addLineButton = document.querySelector("#add-line");
const generateAllButton = document.querySelector("#generate-all");

const initialLines = [
  { role: "旁白", voice: "alloy", text: "雨後的城市，空氣裡帶著一點清新的味道。" },
  { role: "小安", voice: "nova", text: "我們終於到了！這裡比我想像中的還漂亮。" },
  { role: "阿哲", voice: "onyx", text: "先別急，這趟旅程才正要開始。" }
];

function safeFilename(value) {
  return (value || "speech").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
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
    card.remove();
  });
  card.querySelector(".generate-one").addEventListener("click", () => generate(card));
  lines.append(card);
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
generateAllButton.addEventListener("click", async () => {
  const cards = [...lines.querySelectorAll(".line-card")];
  generateAllButton.disabled = true;
  for (const card of cards) await generate(card);
  generateAllButton.disabled = false;
});

initialLines.forEach(addLine);

