const weekdayNames = ["日", "一", "二", "三", "四", "五", "六"];

const dateInput = document.querySelector("#date");
const slotsBox = document.querySelector("#slots");
const dayHint = document.querySelector("#day-hint");
const form = document.querySelector("#form");
const chosen = document.querySelector("#chosen");
const submit = document.querySelector("#submit");
const resultBox = document.querySelector("#result");
const errorBox = document.querySelector("#error");
const picker = document.querySelector("#picker");

let settings = null;
let selectedTime = null;

function showError(message) {
  errorBox.textContent = message || "";
  errorBox.hidden = !message;
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "請求失敗，請稍後再試。");
  return payload;
}

function weekdayOf(dateText) {
  const [year, month, day] = dateText.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function renderSlots(slots) {
  slotsBox.replaceChildren();
  if (slots.length === 0) {
    slotsBox.classList.add("empty");
    slotsBox.textContent = "這天沒有開放時段，請選擇其他日期。";
    return;
  }
  slotsBox.classList.remove("empty");
  for (const slot of slots) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "slot";
    button.textContent = slot.time;
    button.disabled = !slot.available;
    button.setAttribute("aria-pressed", "false");
    if (!slot.available) {
      button.title = slot.reason === "too-soon" ? "太接近現在，無法預約" : "已被預約";
    }
    button.addEventListener("click", () => selectSlot(slot, button));
    slotsBox.append(button);
  }
}

function selectSlot(slot, button) {
  selectedTime = slot.time;
  for (const other of slotsBox.querySelectorAll(".slot")) other.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-pressed", "true");
  chosen.textContent = `${dateInput.value}（週${weekdayNames[weekdayOf(dateInput.value)]}）${slot.time} – ${new Date(slot.endIso).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", timeZone: settings.timeZone })}`;
  form.hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function loadDay() {
  showError("");
  form.hidden = true;
  selectedTime = null;
  if (!dateInput.value) return;
  dayHint.textContent = `週${weekdayNames[weekdayOf(dateInput.value)]}`;
  slotsBox.classList.add("empty");
  slotsBox.textContent = "查詢可預約時段中…";
  try {
    const payload = await requestJson(`/api/availability?date=${encodeURIComponent(dateInput.value)}`);
    renderSlots(payload.slots);
  } catch (error) {
    slotsBox.textContent = "";
    showError(error.message);
  }
}

function showConfirmation(booking, warning) {
  picker.hidden = true;
  resultBox.hidden = false;
  const cancelUrl = `${location.origin}/?cancel=${booking.id}&token=${booking.manageToken}`;
  resultBox.innerHTML = `
    <div class="card">
      <h2>預約完成</h2>
      <p>${booking.date}（週${weekdayNames[weekdayOf(booking.date)]}）${booking.time} – ${booking.endTime}（${booking.timeZone}）</p>
      <p>姓名：${booking.name}<br />Email：${booking.email}</p>
      ${warning ? `<p class="error">${warning}</p>` : ""}
      <p class="muted">需要取消時請使用這個連結：<br /><a href="${cancelUrl}">${cancelUrl}</a></p>
    </div>`;
}

async function submitBooking(event) {
  event.preventDefault();
  showError("");
  submit.disabled = true;
  try {
    const payload = await requestJson("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: dateInput.value,
        time: selectedTime,
        name: document.querySelector("#name").value,
        email: document.querySelector("#email").value,
        phone: document.querySelector("#phone").value,
        note: document.querySelector("#note").value
      })
    });
    showConfirmation(payload.booking, payload.warning);
  } catch (error) {
    showError(error.message);
    await loadDay();
  } finally {
    submit.disabled = false;
  }
}

async function handleCancelLink() {
  const params = new URLSearchParams(location.search);
  const id = params.get("cancel");
  const token = params.get("token");
  if (!id || !token) return false;
  picker.hidden = true;
  resultBox.hidden = false;
  resultBox.innerHTML = "<p>取消預約中…</p>";
  try {
    const payload = await requestJson(
      `/api/bookings?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`,
      { method: "DELETE" }
    );
    resultBox.innerHTML = `<div class="card"><h2>預約已取消</h2><p>${payload.booking.date} ${payload.booking.time} 的預約已取消。</p><p><a href="/">重新預約</a></p></div>`;
  } catch (error) {
    resultBox.innerHTML = "";
    showError(error.message);
  }
  return true;
}

async function start() {
  settings = await requestJson("/api/settings");
  document.title = settings.title;
  document.querySelector("#title").textContent = settings.title;
  const openDays = settings.openWeekdays.map((weekday) => `週${weekdayNames[weekday]}`).join("、");
  document.querySelector("#intro").textContent =
    `每個時段 ${settings.slotMinutes} 分鐘，開放時間為 ${openDays}，時區 ${settings.timeZone}。` +
    (settings.calendarConnected ? "預約後會直接寫入 Google 日曆。" : "（目前未連接 Google 日曆，僅記錄於本機。）");

  if (await handleCancelLink()) return;

  dateInput.min = settings.firstDate;
  dateInput.max = settings.lastDate;
  dateInput.value = settings.firstDate;
  dateInput.addEventListener("change", loadDay);
  form.addEventListener("submit", submitBooking);
  await loadDay();
}

start().catch((error) => showError(error.message));
