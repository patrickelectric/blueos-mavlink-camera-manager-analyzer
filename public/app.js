/**
 * CPU Analyzer Dashboard - Frontend
 *
 * Connects via WebSocket to the Bun backend, receives real-time snapshots,
 * and renders 6 Chart.js visualizations plus a sortable thread detail table.
 */

// ── State ──

let snapshots = [];
let categoryColors = {};
let categoryLabels = {};
let charts = {};
let filterIdle = true;
let sortCol = "cpuPercent";
let sortDir = "desc";
let configLoaded = false;
let wsConnected = false;
let activeTab = "tab-realtime";
let selectedStatsTids = new Set(); // TIDs selected in the stats tab

// Per-thread accumulated stats for averages/max
const threadAccum = new Map(); // tid -> { cpuSum, maxCpu, count }

// Track which datasets the user has hidden via legend clicks, keyed by chart id -> Set of labels
const hiddenDatasets = new Map();

// ── Bootstrap ──

async function init() {
  // Load category config
  try {
    const res = await fetch("/api/config");
    const config = await res.json();
    categoryColors = config.colors;
    categoryLabels = config.labels;
    configLoaded = true;
  } catch (e) {
    console.error("Failed to load config:", e);
    // Use fallback colors
    configLoaded = true;
  }

  initCharts();
  initStatsCharts();
  connectWebSocket();
  setupEventListeners();
}

// ── WebSocket ──

function connectWebSocket() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onopen = () => {
    wsConnected = true;
    document.getElementById("ws-status").classList.add("connected");
    document.getElementById("ws-label").textContent = "Connected";
  };

  ws.onclose = () => {
    wsConnected = false;
    document.getElementById("ws-status").classList.remove("connected");
    document.getElementById("ws-label").textContent = "Disconnected";
    // Reconnect after 2 seconds
    setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = () => {
    ws.close();
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === "history") {
      snapshots = msg.data;
      // Ensure chronological order (guards against any collection race)
      snapshots.sort((a, b) => a.timestamp - b.timestamp);
      // Rebuild accumulators from history
      threadAccum.clear();
      for (const snap of snapshots) {
        accumulateSnapshot(snap);
      }
      showDashboard();
      updateAll();
    } else if (msg.type === "snapshot") {
      snapshots.push(msg.data);
      // Keep max 1200 in frontend (20 minutes at 1s)
      if (snapshots.length > 1200) snapshots.shift();
      accumulateSnapshot(msg.data);
      showDashboard();
      updateAll();
    }
  };
}

function accumulateSnapshot(snap) {
  for (const t of snap.threads) {
    let acc = threadAccum.get(t.tid);
    if (!acc) {
      acc = { cpuSum: 0, maxCpu: 0, count: 0 };
      threadAccum.set(t.tid, acc);
    }
    acc.cpuSum += t.cpuPercent;
    acc.maxCpu = Math.max(acc.maxCpu, t.cpuPercent);
    acc.count++;
  }
}

function showDashboard() {
  const noData = document.getElementById("no-data");
  const dashboard = document.getElementById("dashboard");
  if (noData.style.display === "none") return; // Already shown
  noData.style.display = "none";
  dashboard.style.display = "block";
  // Charts were initialized while hidden; force resize so they pick up container dimensions
  requestAnimationFrame(() => {
    for (const chart of Object.values(charts)) {
      chart.resize();
    }
  });
}

// ── Chart initialization ──

function initCharts() {
  Chart.defaults.color = "#8b8fa3";
  Chart.defaults.borderColor = "#2e3348";
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.animation.duration = 0;
  Chart.defaults.elements.point.radius = 0;
  Chart.defaults.elements.line.borderWidth = 1.5;

  // 1. Thread CPU Timeline
  charts.timeline = new Chart(document.getElementById("chart-timeline"), {
    type: "line",
    data: { datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: { boxWidth: 10, padding: 8, font: { size: 10 } },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`,
          },
        },
      },
      scales: {
        x: {
          type: "time",
          time: { unit: "second", displayFormats: { second: "HH:mm:ss" } },
          ticks: { maxTicksLimit: 15 },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: "CPU %" },
        },
      },
    },
  });

  // 2. CPU by Category (stacked area)
  charts.category = new Chart(document.getElementById("chart-category"), {
    type: "line",
    data: { datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: { boxWidth: 10, padding: 6, font: { size: 10 } },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`,
          },
        },
      },
      scales: {
        x: {
          type: "time",
          time: { unit: "second", displayFormats: { second: "HH:mm:ss" } },
          ticks: { maxTicksLimit: 10 },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          title: { display: true, text: "CPU %" },
        },
      },
    },
  });

  // 3. Current Distribution (doughnut)
  charts.doughnut = new Chart(document.getElementById("chart-doughnut"), {
    type: "doughnut",
    data: { labels: [], datasets: [{ data: [], backgroundColor: [] }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: "right",
          labels: { boxWidth: 10, padding: 6, font: { size: 10 } },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${ctx.parsed.toFixed(1)}%`,
          },
        },
      },
    },
  });

  // 4. Context Switches (bar)
  charts.ctxsw = new Chart(document.getElementById("chart-ctxsw"), {
    type: "bar",
    data: {
      labels: [],
      datasets: [
        {
          label: "Voluntary /s",
          data: [],
          backgroundColor: "rgba(99, 102, 241, 0.7)",
        },
        {
          label: "Involuntary /s",
          data: [],
          backgroundColor: "rgba(239, 68, 68, 0.7)",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: { boxWidth: 10, padding: 8, font: { size: 10 } },
        },
      },
      scales: {
        x: { stacked: true, beginAtZero: true, title: { display: true, text: "Switches / interval" } },
        y: { stacked: true },
      },
    },
  });

  // 5. Process Overview (multi-axis line)
  charts.overview = new Chart(document.getElementById("chart-overview"), {
    type: "line",
    data: { datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: { boxWidth: 10, padding: 8, font: { size: 10 } },
        },
      },
      scales: {
        x: {
          type: "time",
          time: { unit: "second", displayFormats: { second: "HH:mm:ss" } },
          ticks: { maxTicksLimit: 10 },
        },
        yCpu: {
          type: "linear",
          position: "left",
          beginAtZero: true,
          title: { display: true, text: "CPU %" },
        },
        yMem: {
          type: "linear",
          position: "right",
          beginAtZero: true,
          title: { display: true, text: "RSS (MB)" },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });

  // 6. Top CPU bar chart
  charts.topbar = new Chart(document.getElementById("chart-topbar"), {
    type: "bar",
    data: {
      labels: [],
      datasets: [{
        label: "CPU %",
        data: [],
        backgroundColor: [],
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.parsed.x.toFixed(1)}%`,
          },
        },
      },
      scales: {
        x: { beginAtZero: true, title: { display: true, text: "CPU %" } },
        y: {},
      },
    },
  });
}

// ── Update functions ──

function updateAll() {
  if (snapshots.length === 0) return;

  const latest = snapshots[snapshots.length - 1];

  // Update header stats
  document.getElementById("total-cpu").textContent = latest.totalCpuPercent.toFixed(1) + "%";
  document.getElementById("total-rss").textContent = (latest.process.rssKb / 1024).toFixed(1) + " MB";
  document.getElementById("total-threads").textContent = latest.threads.length.toString();
  document.getElementById("total-samples").textContent = snapshots.length.toString();

  if (activeTab === "tab-realtime") {
    updateTimeline();
    updateCategory();
    updateDoughnut(latest);
    updateContextSwitches(latest);
    updateOverview();
    updateTopBar(latest);
    updateTable(latest);
  } else if (activeTab === "tab-stats") {
    updateStatsTab();
  }
}

function getTimeWindow() {
  const sel = document.getElementById("timeline-window");
  const secs = parseInt(sel.value, 10);
  if (secs === 0) return snapshots;
  const cutoff = Date.now() - secs * 1000;
  return snapshots.filter((s) => s.timestamp >= cutoff);
}

function updateTimeline() {
  const windowed = getTimeWindow();
  if (windowed.length === 0) return;

  // Collect all unique threads
  const threadMap = new Map(); // tid -> { name, category, data: [{x, y}] }
  for (const snap of windowed) {
    for (const t of snap.threads) {
      if (!threadMap.has(t.tid)) {
        threadMap.set(t.tid, { name: t.name, category: t.category, data: [] });
      }
      threadMap.get(t.tid).data.push({ x: snap.timestamp, y: t.cpuPercent });
    }
  }

  // Ensure each thread's data points are sorted by timestamp
  for (const thread of threadMap.values()) {
    thread.data.sort((a, b) => a.x - b.x);
  }

  // Filter idle threads if enabled
  let threads = Array.from(threadMap.values());
  if (filterIdle) {
    threads = threads.filter((t) => {
      const avg = t.data.reduce((s, d) => s + d.y, 0) / t.data.length;
      return avg > 1.0;
    });
  }

  // Sort by average CPU descending for legend ordering
  threads.sort((a, b) => {
    const avgA = a.data.reduce((s, d) => s + d.y, 0) / a.data.length;
    const avgB = b.data.reduce((s, d) => s + d.y, 0) / b.data.length;
    return avgB - avgA;
  });

  saveHidden("timeline");
  charts.timeline.data.datasets = threads.map((t) => ({
    label: t.name,
    data: t.data,
    borderColor: getCategoryColor(t.category),
    backgroundColor: getCategoryColor(t.category) + "20",
    tension: 0.2,
    fill: false,
  }));
  restoreHidden("timeline");
  charts.timeline.update("none");
}

function updateCategory() {
  const windowed = getTimeWindow();
  if (windowed.length === 0) return;

  // Group by category, sum CPU per snapshot
  const categories = new Set();
  for (const snap of windowed) {
    for (const t of snap.threads) categories.add(t.category);
  }

  const catData = new Map(); // category -> [{x, y}]
  for (const cat of categories) catData.set(cat, []);

  for (const snap of windowed) {
    const catSum = new Map();
    for (const t of snap.threads) {
      catSum.set(t.category, (catSum.get(t.category) || 0) + t.cpuPercent);
    }
    for (const cat of categories) {
      catData.get(cat).push({
        x: snap.timestamp,
        y: Math.round((catSum.get(cat) || 0) * 10) / 10,
      });
    }
  }

  // Sort categories by total CPU
  const sortedCats = Array.from(categories).sort((a, b) => {
    const sumA = catData.get(a).reduce((s, d) => s + d.y, 0);
    const sumB = catData.get(b).reduce((s, d) => s + d.y, 0);
    return sumB - sumA;
  });

  saveHidden("category");
  charts.category.data.datasets = sortedCats.map((cat) => ({
    label: getCategoryLabel(cat),
    data: catData.get(cat),
    borderColor: getCategoryColor(cat),
    backgroundColor: getCategoryColor(cat) + "60",
    fill: true,
    tension: 0.2,
  }));
  restoreHidden("category");
  charts.category.options.scales.x.stacked = true;
  charts.category.update("none");
}

function updateDoughnut(latest) {
  // Group by category
  const catCpu = new Map();
  for (const t of latest.threads) {
    catCpu.set(t.category, (catCpu.get(t.category) || 0) + t.cpuPercent);
  }

  // Filter out zero categories and sort
  const entries = Array.from(catCpu.entries())
    .filter(([, v]) => v > 0.1)
    .sort((a, b) => b[1] - a[1]);

  saveHidden("doughnut");
  charts.doughnut.data.labels = entries.map(([k]) => getCategoryLabel(k));
  charts.doughnut.data.datasets[0].data = entries.map(([, v]) => Math.round(v * 10) / 10);
  charts.doughnut.data.datasets[0].backgroundColor = entries.map(([k]) => getCategoryColor(k));
  restoreHidden("doughnut");
  charts.doughnut.update("none");
}

function updateContextSwitches(latest) {
  // Show top 15 threads by context switch rate
  const threads = latest.threads
    .filter((t) => t.voluntaryCtxSwitchesDelta > 0 || t.involuntaryCtxSwitchesDelta > 0)
    .sort((a, b) =>
      (b.voluntaryCtxSwitchesDelta + b.involuntaryCtxSwitchesDelta) -
      (a.voluntaryCtxSwitchesDelta + a.involuntaryCtxSwitchesDelta)
    )
    .slice(0, 15);

  saveHidden("ctxsw");
  charts.ctxsw.data.labels = threads.map((t) => t.name);
  charts.ctxsw.data.datasets[0].data = threads.map((t) => t.voluntaryCtxSwitchesDelta);
  charts.ctxsw.data.datasets[1].data = threads.map((t) => t.involuntaryCtxSwitchesDelta);
  restoreHidden("ctxsw");
  charts.ctxsw.update("none");
}

function updateOverview() {
  const windowed = getTimeWindow();
  if (windowed.length === 0) return;

  saveHidden("overview");
  charts.overview.data.datasets = [
    {
      label: "Total CPU %",
      data: windowed.map((s) => ({ x: s.timestamp, y: s.totalCpuPercent })),
      borderColor: "#6366f1",
      backgroundColor: "#6366f120",
      yAxisID: "yCpu",
      tension: 0.2,
      fill: true,
    },
    {
      label: "RSS (MB)",
      data: windowed.map((s) => ({ x: s.timestamp, y: Math.round(s.process.rssKb / 1024 * 10) / 10 })),
      borderColor: "#22c55e",
      yAxisID: "yMem",
      tension: 0.2,
    },
  ];
  restoreHidden("overview");
  charts.overview.update("none");
}

function updateTopBar(latest) {
  // Top 15 threads by current CPU
  const threads = [...latest.threads]
    .filter((t) => t.cpuPercent > 0)
    .sort((a, b) => b.cpuPercent - a.cpuPercent)
    .slice(0, 15);

  charts.topbar.data.labels = threads.map((t) => t.name);
  charts.topbar.data.datasets[0].data = threads.map((t) => t.cpuPercent);
  charts.topbar.data.datasets[0].backgroundColor = threads.map((t) => getCategoryColor(t.category));
  charts.topbar.update("none");
}

function updateTable(latest) {
  const tbody = document.getElementById("thread-tbody");

  // Build row data with accumulated stats
  const rows = latest.threads.map((t) => {
    const acc = threadAccum.get(t.tid) || { cpuSum: 0, maxCpu: 0, count: 1 };
    return {
      tid: t.tid,
      name: t.name,
      category: t.category,
      cpuPercent: t.cpuPercent,
      avgCpu: Math.round((acc.cpuSum / acc.count) * 10) / 10,
      maxCpu: Math.round(acc.maxCpu * 10) / 10,
      volCtx: t.voluntaryCtxSwitches,
      involCtx: t.involuntaryCtxSwitches,
      volCtxDelta: t.voluntaryCtxSwitchesDelta,
      involCtxDelta: t.involuntaryCtxSwitchesDelta,
    };
  });

  // Sort
  rows.sort((a, b) => {
    const va = a[sortCol];
    const vb = b[sortCol];
    if (typeof va === "string") {
      return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    return sortDir === "asc" ? va - vb : vb - va;
  });

  tbody.innerHTML = rows
    .map((r) => {
      const color = getCategoryColor(r.category);
      const barWidth = Math.min(100, r.cpuPercent);
      return `<tr>
        <td>${r.tid}</td>
        <td>${r.name}</td>
        <td><span class="category-badge" style="background:${color}30; color:${color}">${getCategoryLabel(r.category)}</span></td>
        <td><span class="cpu-bar" style="width:${barWidth}px; background:${color}"></span>${r.cpuPercent.toFixed(1)}%</td>
        <td>${r.avgCpu.toFixed(1)}%</td>
        <td>${r.maxCpu.toFixed(1)}%</td>
        <td>${r.volCtx.toLocaleString()}</td>
        <td>${r.involCtx.toLocaleString()}</td>
        <td>${r.volCtxDelta}</td>
        <td>${r.involCtxDelta}</td>
      </tr>`;
    })
    .join("");
}

// ── Event listeners ──

function setupEventListeners() {
  // Tab switching
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchTab(btn.getAttribute("data-tab"));
    });
  });

  // Timeline window selector
  document.getElementById("timeline-window").addEventListener("change", () => {
    updateTimeline();
    updateCategory();
    updateOverview();
  });

  // Filter idle button
  const filterBtn = document.getElementById("timeline-filter-btn");
  filterBtn.classList.add("active"); // Start active since filterIdle defaults to true
  filterBtn.addEventListener("click", () => {
    filterIdle = !filterIdle;
    filterBtn.classList.toggle("active", filterIdle);
    updateTimeline();
  });

  // Table sorting
  document.querySelectorAll("#thread-table th").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.getAttribute("data-col");
      if (sortCol === col) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortCol = col;
        sortDir = "desc";
      }
      // Update sort indicators
      document.querySelectorAll("#thread-table th").forEach((h) => {
        h.classList.remove("sorted-asc", "sorted-desc");
      });
      th.classList.add(sortDir === "asc" ? "sorted-asc" : "sorted-desc");
      if (snapshots.length > 0) {
        updateTable(snapshots[snapshots.length - 1]);
      }
    });
  });

  // Stats tab: time window selector
  const statsWindow = document.getElementById("stats-window");
  if (statsWindow) {
    statsWindow.addEventListener("change", () => {
      if (activeTab === "tab-stats") updateStatsTab();
    });
  }

  // Stats tab: variance window size
  const varWin = document.getElementById("variance-window-size");
  if (varWin) {
    varWin.addEventListener("change", () => {
      if (activeTab === "tab-stats") {
        updateVarianceChart();
        updateStddevChart();
      }
    });
  }

  // Stats tab: select all / clear
  const selAll = document.getElementById("stats-select-all");
  const selNone = document.getElementById("stats-select-none");
  if (selAll) {
    selAll.addEventListener("click", () => {
      document.querySelectorAll("#stats-thread-chips .thread-chip").forEach((chip) => {
        const tid = parseInt(chip.getAttribute("data-tid"), 10);
        selectedStatsTids.add(tid);
        chip.classList.add("selected");
      });
      updateVarianceChart();
      updateStddevChart();
      updateDistributionChart();
      updateStatsSummary();
      updateStatsTable();
    });
  }
  if (selNone) {
    selNone.addEventListener("click", () => {
      selectedStatsTids.clear();
      document.querySelectorAll("#stats-thread-chips .thread-chip").forEach((chip) => {
        chip.classList.remove("selected");
      });
      updateVarianceChart();
      updateStddevChart();
      updateDistributionChart();
      updateStatsSummary();
      updateStatsTable();
    });
  }
}

// ── Tab switching ──

function switchTab(tabId) {
  activeTab = tabId;
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tabId);
  });
  document.querySelectorAll(".tab-content").forEach((tc) => {
    tc.classList.toggle("active", tc.id === tabId);
  });
  // Resize charts in the newly visible tab
  requestAnimationFrame(() => {
    for (const chart of Object.values(charts)) {
      chart.resize();
    }
  });
  // Update the active tab
  if (snapshots.length > 0) {
    updateAll();
  }
}

// ── Stats Charts Initialization ──

function initStatsCharts() {
  // Variance over time (line chart)
  charts.variance = new Chart(document.getElementById("chart-variance"), {
    type: "line",
    data: { datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: { boxWidth: 10, padding: 8, font: { size: 10 } },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}`,
          },
        },
      },
      scales: {
        x: {
          type: "time",
          time: { unit: "second", displayFormats: { second: "HH:mm:ss" } },
          ticks: { maxTicksLimit: 15 },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: "Variance (CPU%\u00B2)" },
        },
      },
    },
  });

  // Standard deviation over time (line chart)
  charts.stddev = new Chart(document.getElementById("chart-stddev"), {
    type: "line",
    data: { datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: { boxWidth: 10, padding: 8, font: { size: 10 } },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}%`,
          },
        },
      },
      scales: {
        x: {
          type: "time",
          time: { unit: "second", displayFormats: { second: "HH:mm:ss" } },
          ticks: { maxTicksLimit: 15 },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: "Std Dev (CPU%)" },
        },
      },
    },
  });

  // Distribution (histogram + normal overlay) -- mixed bar + line
  charts.distribution = new Chart(document.getElementById("chart-distribution"), {
    type: "bar",
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: { boxWidth: 10, padding: 8, font: { size: 10 } },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              if (ctx.dataset.type === "line") {
                return `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(3)}`;
              }
              return `${ctx.dataset.label}: ${ctx.parsed.y} samples`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: "CPU %" },
        },
        yHist: {
          type: "linear",
          position: "left",
          beginAtZero: true,
          title: { display: true, text: "Frequency (count)" },
        },
        yNorm: {
          type: "linear",
          position: "right",
          beginAtZero: true,
          title: { display: true, text: "Probability Density" },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });
}

// ── Stats Tab Update ──

function updateStatsTab() {
  if (snapshots.length < 3) return;
  updateStatsThreadChips();
  updateVarianceChart();
  updateStddevChart();
  updateDistributionChart();
  updateStatsSummary();
  updateStatsTable();
}

function getStatsTimeWindow() {
  const sel = document.getElementById("stats-window");
  if (!sel) return snapshots;
  const secs = parseInt(sel.value, 10);
  if (secs === 0) return snapshots;
  const cutoff = Date.now() - secs * 1000;
  return snapshots.filter((s) => s.timestamp >= cutoff);
}

/** Build or refresh the clickable thread chips */
function updateStatsThreadChips() {
  const container = document.getElementById("stats-thread-chips");
  const windowed = getStatsTimeWindow();
  if (windowed.length === 0) return;

  // Find non-idle threads (avg > 0.5%)
  const threadMap = new Map();
  for (const snap of windowed) {
    for (const t of snap.threads) {
      if (!threadMap.has(t.tid)) {
        threadMap.set(t.tid, { name: t.name, category: t.category, cpuSum: 0, count: 0 });
      }
      const e = threadMap.get(t.tid);
      e.cpuSum += t.cpuPercent;
      e.count++;
    }
  }

  const activeThreads = Array.from(threadMap.entries())
    .filter(([, v]) => v.cpuSum / v.count > 0.5)
    .sort((a, b) => (b[1].cpuSum / b[1].count) - (a[1].cpuSum / a[1].count));

  // Auto-select top 5 on first visit
  if (selectedStatsTids.size === 0 && activeThreads.length > 0) {
    for (const [tid] of activeThreads.slice(0, 5)) {
      selectedStatsTids.add(tid);
    }
  }

  container.innerHTML = activeThreads
    .map(([tid, info]) => {
      const color = getCategoryColor(info.category);
      const selected = selectedStatsTids.has(tid) ? "selected" : "";
      const avg = (info.cpuSum / info.count).toFixed(1);
      return `<div class="thread-chip ${selected}" data-tid="${tid}">
        <span class="chip-dot" style="background:${color}"></span>
        ${info.name} <span style="color:var(--text-dim)">(${avg}%)</span>
      </div>`;
    })
    .join("");

  // Re-attach click handlers
  container.querySelectorAll(".thread-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const tid = parseInt(chip.getAttribute("data-tid"), 10);
      if (selectedStatsTids.has(tid)) {
        selectedStatsTids.delete(tid);
        chip.classList.remove("selected");
      } else {
        selectedStatsTids.add(tid);
        chip.classList.add("selected");
      }
      updateVarianceChart();
      updateStddevChart();
      updateDistributionChart();
      updateStatsSummary();
      updateStatsTable();
    });
  });
}

/** Extract per-thread CPU% time series from windowed snapshots */
function getThreadTimeSeries(windowed) {
  const series = new Map(); // tid -> { name, category, points: [{ts, cpu}] }
  for (const snap of windowed) {
    for (const t of snap.threads) {
      if (!selectedStatsTids.has(t.tid)) continue;
      if (!series.has(t.tid)) {
        series.set(t.tid, { name: t.name, category: t.category, points: [] });
      }
      series.get(t.tid).points.push({ ts: snap.timestamp, cpu: t.cpuPercent });
    }
  }
  // Sort each by timestamp
  for (const s of series.values()) {
    s.points.sort((a, b) => a.ts - b.ts);
  }
  return series;
}

/** Compute rolling variance/stddev for one series */
function rollingStats(points, windowSize) {
  const result = [];
  for (let i = windowSize - 1; i < points.length; i++) {
    const window = points.slice(i - windowSize + 1, i + 1);
    const values = window.map((p) => p.cpu);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    result.push({ ts: points[i].ts, variance, stddev: Math.sqrt(variance), mean });
  }
  return result;
}

function updateVarianceChart() {
  const windowed = getStatsTimeWindow();
  const series = getThreadTimeSeries(windowed);
  const winSize = parseInt(document.getElementById("variance-window-size")?.value || "30", 10);

  const datasets = [];
  for (const [, info] of series) {
    const stats = rollingStats(info.points, winSize);
    if (stats.length === 0) continue;
    datasets.push({
      label: info.name,
      data: stats.map((s) => ({ x: s.ts, y: Math.round(s.variance * 100) / 100 })),
      borderColor: getCategoryColor(info.category),
      backgroundColor: getCategoryColor(info.category) + "20",
      tension: 0.3,
      fill: false,
    });
  }

  saveHidden("variance");
  charts.variance.data.datasets = datasets;
  restoreHidden("variance");
  charts.variance.update("none");
}

function updateStddevChart() {
  const windowed = getStatsTimeWindow();
  const series = getThreadTimeSeries(windowed);
  const winSize = parseInt(document.getElementById("variance-window-size")?.value || "30", 10);

  const datasets = [];
  for (const [, info] of series) {
    const stats = rollingStats(info.points, winSize);
    if (stats.length === 0) continue;
    datasets.push({
      label: info.name,
      data: stats.map((s) => ({ x: s.ts, y: Math.round(s.stddev * 100) / 100 })),
      borderColor: getCategoryColor(info.category),
      backgroundColor: getCategoryColor(info.category) + "20",
      tension: 0.3,
      fill: false,
    });
  }

  saveHidden("stddev");
  charts.stddev.data.datasets = datasets;
  restoreHidden("stddev");
  charts.stddev.update("none");
}

/** Normal (Gaussian) PDF */
function normalPdf(x, mean, stddev) {
  if (stddev === 0) return x === mean ? 1 : 0;
  const exp = -0.5 * ((x - mean) / stddev) ** 2;
  return (1 / (stddev * Math.sqrt(2 * Math.PI))) * Math.exp(exp);
}

function updateDistributionChart() {
  const windowed = getStatsTimeWindow();
  const series = getThreadTimeSeries(windowed);

  // Determine global bin range across all selected threads
  let globalMin = Infinity, globalMax = -Infinity;
  for (const [, info] of series) {
    for (const p of info.points) {
      if (p.cpu < globalMin) globalMin = p.cpu;
      if (p.cpu > globalMax) globalMax = p.cpu;
    }
  }

  if (!isFinite(globalMin) || globalMin === globalMax) {
    charts.distribution.data.labels = [];
    charts.distribution.data.datasets = [];
    charts.distribution.update("none");
    return;
  }

  // Create bins
  const numBins = 30;
  const binWidth = (globalMax - globalMin) / numBins || 1;
  const binEdges = [];
  for (let i = 0; i <= numBins; i++) {
    binEdges.push(globalMin + i * binWidth);
  }
  const binLabels = binEdges.slice(0, numBins).map((e) =>
    (e + binWidth / 2).toFixed(1)
  );

  const datasets = [];

  for (const [, info] of series) {
    const values = info.points.map((p) => p.cpu);
    const n = values.length;
    if (n < 2) continue;

    // Histogram counts
    const counts = new Array(numBins).fill(0);
    for (const v of values) {
      let bin = Math.floor((v - globalMin) / binWidth);
      if (bin >= numBins) bin = numBins - 1;
      if (bin < 0) bin = 0;
      counts[bin]++;
    }

    const color = getCategoryColor(info.category);

    // Histogram bars
    datasets.push({
      type: "bar",
      label: `${info.name} (hist)`,
      data: counts,
      backgroundColor: color + "50",
      borderColor: color,
      borderWidth: 1,
      yAxisID: "yHist",
      barPercentage: 0.9,
      categoryPercentage: 0.8 / Math.max(1, series.size),
    });

    // Normal fit overlay
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const stddev = Math.sqrt(variance);

    if (stddev > 0) {
      const normalData = binLabels.map((label) => {
        const x = parseFloat(label);
        return Math.round(normalPdf(x, mean, stddev) * 1000) / 1000;
      });

      datasets.push({
        type: "line",
        label: `${info.name} (N \u03BC=${mean.toFixed(1)} \u03C3=${stddev.toFixed(1)})`,
        data: normalData,
        borderColor: color,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.4,
        fill: false,
        yAxisID: "yNorm",
      });
    }
  }

  saveHidden("distribution");
  charts.distribution.data.labels = binLabels;
  charts.distribution.data.datasets = datasets;
  restoreHidden("distribution");
  charts.distribution.update("none");
}

function updateStatsSummary() {
  const container = document.getElementById("stats-summary");
  const windowed = getStatsTimeWindow();
  const series = getThreadTimeSeries(windowed);

  if (series.size === 0) {
    container.innerHTML = "";
    return;
  }

  // Compute aggregate stats across all selected threads
  let allValues = [];
  for (const [, info] of series) {
    allValues = allValues.concat(info.points.map((p) => p.cpu));
  }

  if (allValues.length === 0) {
    container.innerHTML = "";
    return;
  }

  const mean = allValues.reduce((s, v) => s + v, 0) / allValues.length;
  const variance = allValues.reduce((s, v) => s + (v - mean) ** 2, 0) / allValues.length;
  const stddev = Math.sqrt(variance);
  const sorted = [...allValues].sort((a, b) => a - b);

  const cards = [
    { label: "Selected Threads", value: series.size },
    { label: "Total Samples", value: allValues.length },
    { label: "Overall Mean", value: mean.toFixed(2) + "%" },
    { label: "Overall Std Dev", value: stddev.toFixed(2) + "%" },
    { label: "Overall Min", value: sorted[0].toFixed(1) + "%" },
    { label: "Overall Max", value: sorted[sorted.length - 1].toFixed(1) + "%" },
  ];

  container.innerHTML = cards
    .map((c) => `<div class="stat-card">
      <div class="stat-card-label">${c.label}</div>
      <div class="stat-card-value">${c.value}</div>
    </div>`)
    .join("");
}

function updateStatsTable() {
  const tbody = document.getElementById("stats-tbody");
  const windowed = getStatsTimeWindow();
  const series = getThreadTimeSeries(windowed);

  const rows = [];
  for (const [, info] of series) {
    const values = info.points.map((p) => p.cpu);
    const n = values.length;
    if (n < 2) continue;

    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const stddev = Math.sqrt(variance);
    const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
    const p5 = sorted[Math.floor(n * 0.05)];
    const p95 = sorted[Math.floor(n * 0.95)];

    // Skewness: E[(X-mu)^3] / sigma^3
    const skewness = stddev > 0
      ? values.reduce((s, v) => s + ((v - mean) / stddev) ** 3, 0) / n
      : 0;

    // Excess kurtosis: E[(X-mu)^4] / sigma^4 - 3
    const kurtosis = stddev > 0
      ? values.reduce((s, v) => s + ((v - mean) / stddev) ** 4, 0) / n - 3
      : 0;

    const color = getCategoryColor(info.category);
    rows.push({
      name: info.name,
      category: info.category,
      color,
      mean,
      median,
      stddev,
      variance,
      min: sorted[0],
      max: sorted[n - 1],
      p5,
      p95,
      skewness,
      kurtosis,
      n,
    });
  }

  // Sort by mean CPU descending
  rows.sort((a, b) => b.mean - a.mean);

  tbody.innerHTML = rows
    .map((r) => `<tr>
      <td>${r.name}</td>
      <td><span class="category-badge" style="background:${r.color}30; color:${r.color}">${getCategoryLabel(r.category)}</span></td>
      <td>${r.mean.toFixed(2)}%</td>
      <td>${r.median.toFixed(2)}%</td>
      <td>${r.stddev.toFixed(2)}%</td>
      <td>${r.variance.toFixed(2)}</td>
      <td>${r.min.toFixed(1)}%</td>
      <td>${r.max.toFixed(1)}%</td>
      <td>${r.p5.toFixed(1)}%</td>
      <td>${r.p95.toFixed(1)}%</td>
      <td>${r.skewness.toFixed(3)}</td>
      <td>${r.kurtosis.toFixed(3)}</td>
      <td>${r.n}</td>
    </tr>`)
    .join("");
}

// ── Legend visibility helpers ──

/**
 * Save which dataset labels the user has hidden on a chart.
 * Call BEFORE replacing chart.data.datasets.
 */
function saveHidden(chartKey) {
  const chart = charts[chartKey];
  if (!chart) return;
  const set = new Set();
  chart.data.datasets.forEach((ds, i) => {
    const meta = chart.getDatasetMeta(i);
    if (meta.hidden === true) {
      set.add(ds.label);
    }
  });
  hiddenDatasets.set(chartKey, set);
}

/**
 * Restore hidden state after datasets have been replaced.
 * Call AFTER setting chart.data.datasets but BEFORE chart.update().
 */
function restoreHidden(chartKey) {
  const chart = charts[chartKey];
  const set = hiddenDatasets.get(chartKey);
  if (!chart || !set || set.size === 0) return;
  chart.data.datasets.forEach((ds, i) => {
    if (set.has(ds.label)) {
      chart.getDatasetMeta(i).hidden = true;
    }
  });
}

// ── Helpers ──

function getCategoryColor(category) {
  return categoryColors[category] || "#7f8c8d";
}

function getCategoryLabel(category) {
  return categoryLabels[category] || category;
}

// ── Start ──

init();
