// ==========================================================
// ตั้งค่าตรงนี้ก่อนใช้งานจริง
// ==========================================================
const API_BASE = "https://Cmpos-recipe-checker.mobile1234.site";   // ผ่าน tunnel/reverse proxy -> localhost:9009 (https แล้ว ไม่เจอ Mixed Content)
const API_KEY = "recipe2026check";           // ต้องตรงกับ RECIPE_API_KEY ฝั่ง backend

// ==========================================================
let currentToken = null;
let currentSummary = null;

const statusThLabel = {
  green: "ตรงกับ CM POS", yellow: "แปลงหน่วยอัตโนมัติ",
  orange: "ประมาณจากไฟล์ Excel", red: "ต้องเช็คมือ", missing: "ไม่พบใน CM POS",
};

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

function setHint(msg, isError = false) {
  const h = document.getElementById("statusHint");
  h.textContent = msg;
  h.classList.toggle("error", isError);
}

// ---------- Orb panel open/close ----------
document.querySelectorAll(".orb").forEach((orb) => {
  orb.addEventListener("click", (e) => {
    e.stopPropagation();
    const wrap = orb.closest(".orb-wrap");
    const isOpen = wrap.classList.contains("open");
    document.querySelectorAll(".orb-wrap.open").forEach((w) => {
      w.classList.remove("open");
      w.querySelector(".orb").setAttribute("aria-expanded", "false");
    });
    if (!isOpen) {
      wrap.classList.add("open");
      orb.setAttribute("aria-expanded", "true");
    }
  });
});
document.addEventListener("click", () => {
  document.querySelectorAll(".orb-wrap.open").forEach((w) => w.classList.remove("open"));
});
document.querySelectorAll(".panel").forEach((p) => p.addEventListener("click", (e) => e.stopPropagation()));

// ---------- File chooser ----------
document.querySelectorAll(".panel-choose").forEach((btn) => {
  btn.addEventListener("click", () => document.getElementById(btn.dataset.for).click());
});
["food", "beverage", "dessert"].forEach((key) => {
  const input = document.getElementById(`file-${key}`);
  input.addEventListener("change", () => {
    const fnEl = document.getElementById(`filename-${key}`);
    const orb = document.querySelector(`.orb[data-target="panel-${key}"]`);
    if (input.files.length) {
      fnEl.textContent = input.files[0].name;
      orb.classList.add("has-file");
    } else {
      fnEl.textContent = "ยังไม่ได้เลือกไฟล์";
      orb.classList.remove("has-file");
    }
  });
});

// ---------- Run ----------
document.getElementById("btnRun").addEventListener("click", async () => {
  const btn = document.getElementById("btnRun");
  const fd = new FormData();
  let hasAny = false;
  for (const key of ["food", "beverage", "dessert"]) {
    const input = document.getElementById(`file-${key}`);
    if (input.files.length) {
      fd.append(`file_${key}`, input.files[0]);
      hasAny = true;
    }
  }
  if (!hasAny) {
    setHint("กรุณาเลือกไฟล์อย่างน้อย 1 ไฟล์ก่อน", true);
    return;
  }

  btn.disabled = true;
  setHint("กำลังอัปโหลด + เทียบกับ CM POS... อาจใช้เวลาสักครู่");

  try {
    const res = await fetch(`${API_BASE}/api/upload`, {
      method: "POST",
      headers: { "x-api-key": API_KEY },
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.error || "เกิดข้อผิดพลาด");

    currentToken = data.token;
    currentSummary = data.summary;
    setHint(`เช็คเสร็จแล้ว — ${data.summary.total_rows} รายการ ใน ${data.summary.total_groups} เมนู/สูตร`);
    await loadResults("all");
    document.getElementById("resultsSection").hidden = false;
    document.getElementById("resultsSection").scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    console.error(err);
    let msg = err.message;
    if (err instanceof TypeError) {
      msg = "เชื่อมต่อ API ไม่ได้ — เช็คว่า backend รันอยู่ และเปิดจากเครื่องที่เข้าถึงวง LAN ร้านได้ไหม " +
            "(ถ้าเว็บนี้เป็น https แต่ API เป็น http เบราว์เซอร์อาจบล็อกไว้ — ดู README)";
    }
    setHint(msg, true);
  } finally {
    btn.disabled = false;
  }
});

// ---------- Results rendering ----------
async function loadResults(status) {
  const res = await fetch(`${API_BASE}/api/result/${currentToken}?status=${status}`, {
    headers: { "x-api-key": API_KEY },
  });
  const data = await res.json();
  renderSummary(data.summary, status);
  renderGroups(data.groups);
}

function renderSummary(summary, activeStatus) {
  const row = document.getElementById("summaryRow");
  const items = [
    ["all", "ทั้งหมด", summary.total_rows, ""],
    ["green", "ตรงกัน", summary.green, "s-green"],
    ["yellow", "แปลงอัตโนมัติ", summary.yellow, "s-yellow"],
    ["orange", "ประมาณการ", summary.orange, "s-orange"],
    ["red", "เช็คมือ", summary.red, "s-red"],
    ["missing", "ไม่พบ", summary.missing, "s-missing"],
  ];
  row.innerHTML = items.map(([key, label, num, cls]) => `
    <div class="summary-item ${cls}">
      <div class="summary-num">${num}</div>
      <div class="summary-label">${label}</div>
    </div>`).join("");

  const filterRow = document.getElementById("filterRow");
  filterRow.innerHTML = items.map(([key, label]) => `
    <button class="filter-pill ${key === activeStatus ? "active" : ""}" data-status="${key}">${label}</button>
  `).join("");
  filterRow.querySelectorAll(".filter-pill").forEach((p) => {
    p.addEventListener("click", () => loadResults(p.dataset.status));
  });
}

function renderGroups(groups) {
  const container = document.getElementById("groupsContainer");
  if (!groups.length) {
    container.innerHTML = `<p class="hint">ไม่พบรายการตามตัวกรองนี้</p>`;
    return;
  }
  container.innerHTML = groups.map((g) => `
    <div class="group">
      <div class="group-head">
        <div>
          <span class="group-tag">${g.recipe_type}</span>
          <span class="group-code">${g.parent_code}</span>
          <span class="group-name">${g.parent_name || ""}</span>
        </div>
        <button class="group-copy" data-type="${g.recipe_type}" data-code="${g.parent_code}">คัดลอกสำหรับ Tampermonkey</button>
      </div>
      <table class="rows">
        <thead>
          <tr><th>สถานะ</th><th>Code</th><th>ค่าในไฟล์</th><th>ค่าที่ถูกต้อง</th><th>เหตุผล</th></tr>
        </thead>
        <tbody>
          ${g.rows.map((r) => `
            <tr>
              <td><span class="dot dot-${r.status}"></span>${statusThLabel[r.status] || r.status}</td>
              <td class="code">${r.ingredient_code}</td>
              <td class="qty-old">${r.excel_qty} ${r.excel_unit_raw || ""}</td>
              <td class="qty-new">${r.final_qty ?? "—"} ${r.final_unit || ""}</td>
              <td class="note">${r.note || ""}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `).join("");

  container.querySelectorAll(".group-copy").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const res = await fetch(`${API_BASE}/api/group_text/${currentToken}/${encodeURIComponent(btn.dataset.type)}/${encodeURIComponent(btn.dataset.code)}`, {
        headers: { "x-api-key": API_KEY },
      });
      const data = await res.json();
      if (data.text) {
        await navigator.clipboard.writeText(data.text);
        showToast("คัดลอกแล้ว — วางใน Tampermonkey ได้เลย");
      } else {
        showToast(data.detail || "คัดลอกไม่สำเร็จ");
      }
    });
  });
}

// ---------- Export ----------
document.getElementById("btnExport").addEventListener("click", async () => {
  if (!currentToken) {
    showToast("ยังไม่มีผลลัพธ์ให้ export");
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/export/${currentToken}.csv`, {
      headers: { "x-api-key": API_KEY },
    });
    if (!res.ok) throw new Error("export ไม่สำเร็จ");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cmpos_recipe_check_result.csv";
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast(err.message);
  }
});
