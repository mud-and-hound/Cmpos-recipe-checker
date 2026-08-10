// ==========================================================
// ตั้งค่าตรงนี้ก่อนใช้งานจริง
// ==========================================================
const API_BASE = "https://Cmpos-recipe-checker.mobile1234.site";   // ผ่าน tunnel/reverse proxy -> localhost:9009 (https แล้ว ไม่เจอ Mixed Content)
const API_KEY = "recipe2026check";           // ต้องตรงกับ RECIPE_API_KEY ฝั่ง backend

// ==========================================================
let currentToken = null;
let currentSummary = null;

// ---------- ค้นหา + หน้าต่างเลื่อนแบบ conveyor (fade ตามตำแหน่ง scroll จริง) ----------
let allGroups = [];          // ข้อมูลทั้งหมดที่ backend ส่งมา (หลัง filter สถานะแล้ว)
let filteredGroups = [];     // หลังผ่านช่องค้นหาอีกชั้น
let pageSize = 10;           // จำนวน "แถว" ที่มองเห็นพร้อมกันในกล่อง (ความสูงกล่อง = pageSize x ความสูงแถว)
let searchTerm = "";
let rowFadeObserver = null;
let searchDebounceTimer = null;

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
    // เก็บลง sessionStorage — ไว้กลับมาที่หน้านี้จากหน้าอื่น (เช่น /log/) แล้วข้อมูลยังอยู่ ไม่ต้องอัปโหลดใหม่
    sessionStorage.setItem("cmposChecker.token", currentToken);
    sessionStorage.setItem("cmposChecker.summary", JSON.stringify(currentSummary));
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
  allGroups = data.groups;
  applySearchAndReset();
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

// ---------- ค้นหา (fuzzy — ค้นทุกคอลัมน์พร้อมกัน) ----------
function rowMatchesSearch(group, row, term) {
  const haystack = [
    group.parent_code, group.parent_name, group.recipe_type,
    row.ingredient_code, row.ingredient_desc, row.item_name_db,
    row.excel_qty, row.excel_unit_raw, row.final_qty, row.final_unit,
    statusThLabel[row.status], row.status, row.note,
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(term);
}

function applySearchAndReset() {
  const term = searchTerm.trim().toLowerCase();
  if (!term) {
    filteredGroups = allGroups;
  } else {
    filteredGroups = allGroups
      .map((g) => {
        // ถ้าค้นเจอที่ระดับเมนู (รหัส/ชื่อเมนู) ให้เก็บทุกแถวของเมนูนั้นไว้ครบ (เห็น context เต็ม)
        const groupLevelMatch = `${g.parent_code} ${g.parent_name} ${g.recipe_type}`.toLowerCase().includes(term);
        const rows = groupLevelMatch ? g.rows : g.rows.filter((r) => rowMatchesSearch(g, r, term));
        return rows.length ? { ...g, rows } : null;
      })
      .filter(Boolean);
  }

  const countEl = document.getElementById("searchCount");
  const totalRows = filteredGroups.reduce((sum, g) => sum + g.rows.length, 0);
  countEl.textContent = term
    ? `พบ ${filteredGroups.length} เมนู (${totalRows} รายการ)`
    : "";

  const container = document.getElementById("groupsContainer");
  if (!filteredGroups.length) {
    container.innerHTML = `<p class="hint">ไม่พบรายการตามคำค้น/ตัวกรองนี้</p>`;
    return;
  }

  // render "ทุกแถว" ทีเดียวลงในกล่อง scroll เดียว — ตัวที่ทำให้เห็นแค่ pageSize แถว
  // คือความสูงกล่อง (.table-scroll) ที่ถูกจำกัดไว้ ไม่ใช่การโหลดข้อมูลทีละก้อนแบบเดิม
  let bodyHtml = "";
  filteredGroups.forEach((g, gi) => {
    bodyHtml += buildGroupRowsHtml(g, gi + 1);
  });

  container.innerHTML = `
    <div class="table-scroll" id="tableScroll">
    <table class="rows excel-style">
      <thead>
        <tr>
          <th>No.</th><th>Recipe</th><th>Name Menu</th><th>Item Code</th><th>Item Description</th>
          <th>QTY</th><th>Small Unit</th><th>สถานะ</th><th>ค่าที่ถูกต้อง</th><th>เหตุผล</th><th>📍</th>
        </tr>
      </thead>
      <tbody id="rowsTbody">${bodyHtml}</tbody>
    </table>
    </div>
  `;
  bindGroupCopyButtons(container);
  bindLocPopovers(container);
  setupFadeWindow();
}

function buildGroupRowsHtml(g, menuNo) {
  let html = "";
  g.rows.forEach((r, ri) => {
    const isFirstRow = ri === 0;
    const locId = `loc-${menuNo}-${ri}-${Math.random().toString(36).slice(2, 7)}`;
    html += `
      <tr class="fade-row ${isFirstRow ? "menu-start" : ""}">
        <td class="col-no">${isFirstRow ? menuNo : ""}</td>
        <td class="col-recipe">${isFirstRow ? `<span class="group-tag">${g.recipe_type}</span> <span class="code">${g.parent_code}</span>` : ""}</td>
        <td class="col-menuname">${isFirstRow ? (g.parent_name || "") : ""}</td>
        <td class="code">${r.ingredient_code}</td>
        <td>${r.ingredient_desc || ""}</td>
        <td class="qty-old">${Number(r.excel_qty).toFixed(4)}</td>
        <td>${r.excel_unit_raw || ""}</td>
        <td><span class="dot dot-${r.status}"></span>${statusThLabel[r.status] || r.status}</td>
        <td class="qty-new">${r.final_qty ?? "—"} ${r.final_unit || ""}</td>
        <td class="note">${r.note || ""}</td>
        <td class="col-loc" style="position:relative;">
          <button class="loc-btn" data-target="${locId}" title="ดูตำแหน่งในไฟล์ต้นฉบับ">ⓘ</button>
          <div class="loc-popover" id="${locId}" hidden>
            <div><b>ไฟล์:</b> ${r.source_file || "—"}</div>
            <div><b>ชีท:</b> ${r.sheet || "—"}</div>
            <div><b>แถวที่:</b> ${r.row_number ?? "—"}</div>
            <div><b>ประเภท:</b> ${g.recipe_type === "WIP" ? "🧪 WIP" : "🍳 Recipe (FG)"}</div>
          </div>
        </td>
      </tr>`;
  });
  html += `
    <tr class="fade-row menu-gap">
      <td colspan="8"></td>
      <td colspan="3" style="text-align:right;">
        <button class="group-copy" data-type="${g.recipe_type}" data-code="${g.parent_code}">คัดลอกสำหรับ Tampermonkey</button>
      </td>
    </tr>`;
  return html;
}

/** เปิด/ปิด popover ตำแหน่งไฟล์ — กันเปิดค้างหลายอันพร้อมกัน (ปิดอันเก่าก่อนเปิดอันใหม่) */
function bindLocPopovers(scope) {
  scope.querySelectorAll(".loc-btn").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const pop = document.getElementById(btn.dataset.target);
      const wasHidden = pop.hidden;
      document.querySelectorAll(".loc-popover").forEach((p) => (p.hidden = true));
      pop.hidden = !wasHidden;
    });
  });
  // คลิกที่อื่นแล้วปิด popover ทั้งหมด
  if (!document.body.dataset.locGlobalBound) {
    document.body.dataset.locGlobalBound = "1";
    document.addEventListener("click", () => {
      document.querySelectorAll(".loc-popover").forEach((p) => (p.hidden = true));
    });
  }
}


/**
 * หัวใจของ "หน้าต่างเลื่อนแบบ conveyor":
 * 1) จำกัดความสูงกล่อง .table-scroll ให้เท่ากับ pageSize x ความสูงแถวจริง (วัดจากแถวแรกที่ render จริง)
 *    -> ทำให้เห็นแค่ pageSize แถวพอดีโดยไม่ต้อง scroll ทั้งหน้า (scroll เฉพาะในกล่องนี้)
 * 2) ผูก IntersectionObserver ที่ root = กล่องนี้ ให้ทุกแถว โดยตั้ง threshold หลายระดับ (0%,5%,10%,...,100%)
 *    -> ทุกครั้งที่แถวโผล่/หายจากขอบกล่องแม้แค่บางส่วน จะได้ค่า intersectionRatio ที่ใช้เป็น opacity ตรงๆ
 *    -> แถวที่กำลังเลื่อนพ้นขอบบน/กำลังโผล่จากขอบล่าง จะจางตามสัดส่วนที่โผล่จริง (มี CSS transition ช่วยให้ลื่นขึ้น)
 */
function setupFadeWindow() {
  const scrollBox = document.getElementById("tableScroll");
  const firstRow = scrollBox?.querySelector("tbody tr");
  if (!scrollBox || !firstRow) return;

  const rowHeight = firstRow.getBoundingClientRect().height || 42;
  scrollBox.style.maxHeight = `${Math.round(rowHeight * pageSize)}px`;

  if (rowFadeObserver) rowFadeObserver.disconnect();
  const thresholds = Array.from({ length: 21 }, (_, i) => i / 20); // 0%, 5%, ..., 100%
  rowFadeObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        entry.target.style.opacity = entry.intersectionRatio.toFixed(2);
      });
    },
    { root: scrollBox, threshold: thresholds }
  );
  scrollBox.querySelectorAll(".fade-row").forEach((row) => rowFadeObserver.observe(row));
}

function bindGroupCopyButtons(scope) {
  scope.querySelectorAll(".group-copy").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
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

// ---------- ช่องค้นหา + page size ----------
document.getElementById("searchInput").addEventListener("input", (e) => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    searchTerm = e.target.value;
    applySearchAndReset();
  }, 250); // debounce กันเรียก re-render ถี่เกินไปตอนพิมพ์เร็ว
});

document.getElementById("pageSizeSelect").addEventListener("change", (e) => {
  pageSize = parseInt(e.target.value, 10);
  applySearchAndReset();
});

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

// ==========================================================
// Font Picker — โหลดฟอนต์จาก Google Fonts แบบ on-demand + จำค่าไว้
// ==========================================================
const FONT_STORAGE_KEY = "cmposRecipeChecker.fonts";
const loadedFontLinks = {}; // ชื่อฟอนต์ -> <link> element กันโหลดซ้ำ

function loadGoogleFont(familyName) {
  if (loadedFontLinks[familyName]) return;
  const urlName = familyName.trim().replace(/ /g, "+");
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${urlName}:wght@300;400;500;600;700&display=swap`;
  document.head.appendChild(link);
  loadedFontLinks[familyName] = link;
}

function applyFont(kind, familyName) {
  loadGoogleFont(familyName);
  document.documentElement.style.setProperty(
    kind === "display" ? "--font-display" : "--font-body",
    kind === "display" ? `'${familyName}', serif` : `'${familyName}', sans-serif`
  );
}

function saveFontPrefs(displayFont, bodyFont) {
  localStorage.setItem(FONT_STORAGE_KEY, JSON.stringify({ display: displayFont, body: bodyFont }));
}

function loadFontPrefs() {
  try {
    return JSON.parse(localStorage.getItem(FONT_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

(function initFontPicker() {
  const btn = document.getElementById("settingsBtn");
  const panel = document.getElementById("settingsPanel");
  const selDisplay = document.getElementById("fontDisplay");
  const selBody = document.getElementById("fontBody");
  const btnReset = document.getElementById("settingsReset");
  if (!btn || !panel) return;

  // โหลดค่าที่เคยเลือกไว้ (ถ้ามี)
  const saved = loadFontPrefs();
  if (saved) {
    if (saved.display) { selDisplay.value = saved.display; applyFont("display", saved.display); }
    if (saved.body) { selBody.value = saved.body; applyFont("body", saved.body); }
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = panel.classList.toggle("open");
    btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });
  document.addEventListener("click", () => panel.classList.remove("open"));
  panel.addEventListener("click", (e) => e.stopPropagation());

  selDisplay.addEventListener("change", () => {
    applyFont("display", selDisplay.value);
    saveFontPrefs(selDisplay.value, selBody.value);
  });
  selBody.addEventListener("change", () => {
    applyFont("body", selBody.value);
    saveFontPrefs(selDisplay.value, selBody.value);
  });

  btnReset.addEventListener("click", () => {
    localStorage.removeItem(FONT_STORAGE_KEY);
    selDisplay.value = "Cormorant Garamond";
    selBody.value = "Sarabun";
    applyFont("display", "Cormorant Garamond");
    applyFont("body", "Sarabun");
  });
})();

// ---------- คืนค่าผลลัพธ์เดิมจาก sessionStorage (ถ้ามี) — เผื่อกลับมาจากหน้า /log/ ----------
(function restoreFromSession() {
  const savedToken = sessionStorage.getItem("cmposChecker.token");
  const savedSummaryRaw = sessionStorage.getItem("cmposChecker.summary");
  if (!savedToken || !savedSummaryRaw) return;
  try {
    currentToken = savedToken;
    currentSummary = JSON.parse(savedSummaryRaw);
    loadResults("all").then(() => {
      document.getElementById("resultsSection").hidden = false;
    });
  } catch (e) {
    // sessionStorage เสีย/parse ไม่ได้ — ปล่อยผ่าน ให้ผู้ใช้อัปโหลดใหม่ตามปกติ
    sessionStorage.removeItem("cmposChecker.token");
    sessionStorage.removeItem("cmposChecker.summary");
  }
})();
