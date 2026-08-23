const DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const SMALL_UNITS = ["", "十", "百", "千"];
const GROUP_UNITS = ["", "萬", "億", "兆"];
const SENTENCE_END = /[。！？!?…]/;
const PAUSE_AFTER = { "。": 340, "！": 360, "？": 380, "…": 460, "；": 280, "：": 240, "，": 150, "、": 110, "—": 320 };

function readDigitByDigit(value) {
  return String(value).split("").map((digit) => DIGITS[Number(digit)] ?? digit).join("");
}

function readBelowTenThousand(value) {
  const digits = String(value).split("").map(Number);
  let text = "";
  let pendingZero = false;
  digits.forEach((digit, index) => {
    if (digit === 0) {
      pendingZero = text !== "";
      return;
    }
    if (pendingZero) text += "零";
    pendingZero = false;
    text += DIGITS[digit] + SMALL_UNITS[digits.length - index - 1];
  });
  return text.replace(/^一十/, "十");
}

function readInteger(value) {
  const digits = String(value).replace(/^0+(?=\d)/, "");
  if (digits === "0") return "零";
  if (digits.length > 16) return readDigitByDigit(digits);

  const groups = [];
  for (let end = digits.length; end > 0; end -= 4) groups.unshift(digits.slice(Math.max(0, end - 4), end));

  let text = "";
  groups.forEach((group, index) => {
    const amount = Number(group);
    if (amount === 0) {
      if (text && !text.endsWith("零")) text += "零";
      return;
    }
    if (text && group.padStart(4, "0").startsWith("0") && !text.endsWith("零")) text += "零";
    text += readBelowTenThousand(amount) + GROUP_UNITS[groups.length - index - 1];
  });
  return text.replace(/零+$/, "").replace(/零{2,}/g, "零") || "零";
}

function readNumber(value) {
  const [whole, fraction] = String(value).split(".");
  const spoken = readInteger(whole);
  return fraction ? `${spoken}點${readDigitByDigit(fraction)}` : spoken;
}

/** Rewrites text so a Mandarin voice reads symbols and numbers the way a person would say them. */
export function normalizeForSpeech(text) {
  let value = String(text);

  value = value
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}️]/gu, " ")
    .replace(/[*_`>#]+/g, " ")
    .replace(/\.{3,}/g, "…")
    .replace(/-{2,}/g, "—");

  value = value
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/(\d{4})(?=\s*年)/g, (match) => readDigitByDigit(match))
    .replace(/(\d{1,2})\s*[:：]\s*(\d{2})(?=\s*(?:分|$|\D))/g, (match, hour, minute) =>
      `${readNumber(hour)}點${minute === "00" ? "整" : `${readNumber(minute)}分`}`)
    .replace(/(\d+(?:\.\d+)?)\s*%/g, (match, amount) => `百分之${readNumber(amount)}`)
    .replace(/(\d)\s*[~～]\s*(?=\d)/g, "$1到")
    .replace(/(^|[\s(（，,。:：])[-−]\s*(?=\d)/g, "$1負")
    .replace(/\d{7,}/g, (match) => readDigitByDigit(match))
    .replace(/\d+(?:\.\d+)?/g, (match) => readNumber(match));

  value = value
    .replace(/\s*[℃]|°\s*C/g, "度")
    .replace(/\s*&\s*/g, "和")
    .replace(/\s*[+＋]\s*/g, "加")
    .replace(/([一-鿿])\s*,\s*/g, "$1，")
    .replace(/([一-鿿])\s*\.\s*/g, "$1。")
    .replace(/([一-鿿])\s*;\s*/g, "$1；")
    .replace(/([一-鿿])\s*:\s*/g, "$1：")
    .replace(/([一-鿿])\s*!\s*/g, "$1！")
    .replace(/([一-鿿])\s*\?\s*/g, "$1？");

  return value
    .replace(/([一-鿿])\s+(?=[一-鿿])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function splitClauses(sentence, maximumLength) {
  const clauses = sentence.match(/[^，,、；;：:]+[，,、；;：:]*/g) || [sentence];
  const pieces = [];
  let current = "";
  for (const clause of clauses) {
    if (current && current.length + clause.length > maximumLength) {
      pieces.push(current);
      current = "";
    }
    if (clause.length <= maximumLength) {
      current += clause;
      continue;
    }
    if (current) {
      pieces.push(current);
      current = "";
    }
    for (let index = 0; index < clause.length; index += maximumLength) {
      pieces.push(clause.slice(index, index + maximumLength));
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/**
 * Breaks text into speakable chunks at full sentences first, so intonation keeps
 * its natural rise and fall instead of stopping at every comma.
 */
export function splitSpeechText(text, maximumLength = 220) {
  const sentences = text.match(/[^。！？!?…]+(?:[。！？!?]+|…+)?/g) || [text];
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    const value = sentence.trim();
    if (!value) continue;
    if (current && current.length + value.length > maximumLength) {
      chunks.push(current);
      current = "";
    }
    if (value.length <= maximumLength) {
      current += value;
      continue;
    }
    if (current) {
      chunks.push(current);
      current = "";
    }
    chunks.push(...splitClauses(value, maximumLength));
  }
  if (current) chunks.push(current);
  return chunks;
}

function roleOffset(role) {
  let hash = 0;
  for (const character of role) hash = (hash * 31 + character.codePointAt(0)) % 997;
  return ((hash % 9) - 4) / 40;
}

const TONE_RULES = [
  { pattern: /(大喊|大叫|大罵|怒|吼|尖叫|咆哮|急忙|驚)/, rate: 1.12, pitch: 1.16 },
  { pattern: /(低聲|輕聲|小聲|喃喃|默念|嘆|悄悄|低頭)/, rate: 0.9, pitch: 0.9 },
  { pattern: /(哭|哽咽|悲|顫抖|虛弱)/, rate: 0.88, pitch: 0.96 },
  { pattern: /(笑|開心|興奮|雀躍)/, rate: 1.05, pitch: 1.12 },
  { pattern: /(冷冷|沉聲|嚴厲|命令|警告)/, rate: 0.96, pitch: 0.88 }
];

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Picks a delivery for one segment: narration stays even, dialogue takes on the mood around it. */
export function toneForSegment({ role, text, context = "" }) {
  const narration = role === "旁白";
  let rate = narration ? 0.98 : 1.03;
  let pitch = narration ? 1 : 1.05;

  if (!narration) {
    for (const rule of TONE_RULES) {
      if (rule.pattern.test(context) || rule.pattern.test(text)) {
        rate *= rule.rate;
        pitch *= rule.pitch;
        break;
      }
    }
    if (/[？?]\s*$/.test(text)) pitch += 0.08;
    if (/[！!]\s*$/.test(text)) rate *= 1.04;
    if (/[…—]\s*$/.test(text)) rate *= 0.94;
    pitch += roleOffset(role);
  }

  return { rate: clamp(rate, 0.5, 1.6), pitch: clamp(pitch, 0.6, 1.6) };
}

/** Silence to leave after a chunk, so sentences breathe and speaker changes register. */
export function pauseAfter(text, { roleChanged = false, paragraphEnd = false } = {}) {
  const ending = text.trim().slice(-1);
  let pause = PAUSE_AFTER[ending] ?? (SENTENCE_END.test(ending) ? 340 : 200);
  if (roleChanged) pause += 220;
  if (paragraphEnd) pause += 260;
  return pause;
}
