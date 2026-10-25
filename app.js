(() => {
  "use strict";

  const STORAGE_KEY = "jinri-yijin.state.v1";
  const VIEWS = new Set(["today", "progress", "review", "notes"]);
  const MERCHANT_STAGES = [
    { key: "target", label: "目标商家" },
    { key: "contacted", label: "已联系" },
    { key: "replied", label: "有回复" },
    { key: "quoted", label: "已报价" },
    { key: "paid", label: "已付费" },
    { key: "delivered", label: "已交付" },
  ];
  const BUSINESS_STAGES = [
    { key: "sample", label: "案例" },
    { key: "outreach", label: "获客" },
    { key: "quote", label: "报价" },
    { key: "first-order", label: "首单" },
    { key: "delivery", label: "交付" },
    { key: "repeat", label: "复购" },
  ];
  const NOTE_TYPES = {
    note: "学习",
    prompt: "提示词",
    feedback: "客户反馈",
    method: "方法",
  };

  const app = document.querySelector("#app");
  const todayLabel = document.querySelector("#todayLabel");
  const modalBackdrop = document.querySelector("#modalBackdrop");
  const modalTitle = document.querySelector("#modalTitle");
  const sheetForm = document.querySelector("#sheetForm");
  const toastNode = document.querySelector("#toast");
  const importFile = document.querySelector("#importFile");

  let state = loadState();
  let activeModal = null;
  let toastTimer = null;
  let lastTimerSecond = null;

  init();

  function init() {
    bindEvents();
    const hashView = location.hash.replace(/^#/, "");
    if (VIEWS.has(hashView)) state.currentView = hashView;
    if (state.focusSession) {
      const remaining = getFocusRemainingSeconds();
      if (remaining <= 0) completeFocus(true);
    }
    render();
    setInterval(updateTimer, 1000);
    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  function createInitialState() {
    const now = new Date().toISOString();
    const today = dateKey();
    return {
      version: 1,
      createdAt: now,
      currentView: "today",
      settings: {
        focusMinutes: 60,
        phoneCutoff: "23:00",
      },
      projects: [
        {
          id: "side-business",
          area: "挣钱",
          title: "AI 商品广告",
          goal: "3 个月完成首单，1 年固定交付流程",
          nextAction: "把收纳箱素材剪成一条完整的 15 秒广告",
          risk: "目前只有生成片段，还没有完整成片和客户验证",
          status: "active",
          businessStage: "sample",
          updatedAt: now,
        },
        {
          id: "work-itbp",
          area: "工作",
          title: "飞书项目落地",
          goal: "明确项目范围，完成可控收尾",
          nextAction: "整理项目范围和延期原因，提出下一版收尾方案",
          risk: "流程型组织改革仍在持续，需求可能继续变化",
          status: "active",
          businessStage: "",
          updatedAt: now,
        },
      ],
      actions: [
        {
          id: uid("task"),
          projectId: "side-business",
          title: "筛选 3 个可能合作的收纳类商家",
          date: today,
          done: false,
          createdAt: now,
        },
        {
          id: uid("task"),
          projectId: "work-itbp",
          title: "写下一个可以执行的项目收尾下一步",
          date: today,
          done: false,
          createdAt: now,
        },
      ],
      merchants: [],
      notes: [],
      dailyLogs: {
        [today]: {
          energy: 3,
          sleepHours: 7,
          note: "",
          updatedAt: now,
        },
      },
      focusSessions: [],
      focusSession: null,
      reviews: {},
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createInitialState();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return createInitialState();
      return {
        ...createInitialState(),
        ...parsed,
        settings: { ...createInitialState().settings, ...(parsed.settings || {}) },
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
        merchants: Array.isArray(parsed.merchants) ? parsed.merchants : [],
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
        focusSessions: Array.isArray(parsed.focusSessions) ? parsed.focusSessions : [],
        dailyLogs: parsed.dailyLogs && typeof parsed.dailyLogs === "object" ? parsed.dailyLogs : {},
        reviews: parsed.reviews && typeof parsed.reviews === "object" ? parsed.reviews : {},
      };
    } catch {
      return createInitialState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      showToast("本地保存失败，请先导出备份");
    }
  }

  function bindEvents() {
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.view));
    });

    document.querySelector("#openCapture").addEventListener("click", () => openCapture());
    document.querySelector("#openSettings").addEventListener("click", openSettings);
    document.querySelector("#closeModal").addEventListener("click", closeModal);
    modalBackdrop.addEventListener("click", (event) => {
      if (event.target === modalBackdrop) closeModal();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modalBackdrop.hidden) closeModal();
    });

    app.addEventListener("click", handleAppClick);
    app.addEventListener("change", handleAppChange);
    app.addEventListener("input", handleAppInput);
    app.addEventListener("submit", handleAppSubmit);

    sheetForm.addEventListener("click", handleSheetClick);
    sheetForm.addEventListener("submit", handleSheetSubmit);
    importFile.addEventListener("change", importBackup);
  }

  function handleAppClick(event) {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    const id = target.dataset.id;

    if (action === "set-energy") {
      const log = ensureTodayLog();
      log.energy = Number(target.dataset.value);
      log.updatedAt = new Date().toISOString();
      saveState();
      render();
    }

    if (action === "edit-project") openProjectModal(id);
    if (action === "edit-business-stage") openBusinessStageModal(id);
    if (action === "add-task") openTaskModal();
    if (action === "toggle-task") {
      const task = state.actions.find((item) => item.id === id);
      if (task) {
        task.done = !task.done;
        task.completedAt = task.done ? new Date().toISOString() : null;
        saveState();
        render();
      }
    }
    if (action === "edit-task") {
      const task = state.actions.find((item) => item.id === id);
      if (task) openTaskModal(task);
    }
    if (action === "delete-task") {
      if (!window.confirm("删除这条今日行动？")) return;
      state.actions = state.actions.filter((item) => item.id !== id);
      saveState();
      render();
      showToast("已删除行动");
    }
    if (action === "start-focus") startFocus();
    if (action === "end-focus") endFocus();
    if (action === "add-merchant") openMerchantModal();
    if (action === "edit-merchant") openMerchantModal(getMerchant(id));
    if (action === "set-business-stage") setBusinessStage(id, target.dataset.stage);
    if (action === "add-note") openNoteModal();
    if (action === "edit-note") openNoteModal(state.notes.find((note) => note.id === id));
    if (action === "scroll-capture") {
      setView("progress");
      window.setTimeout(() => openCapture("feedback"), 80);
    }
    if (action === "settings-export") exportBackup();
    if (action === "settings-import") importFile.click();
  }

  function handleAppChange(event) {
    const target = event.target;
    if (target.id === "sleepHours") {
      const log = ensureTodayLog();
      log.sleepHours = clamp(Number(target.value), 0, 16);
      log.updatedAt = new Date().toISOString();
      saveState();
      showToast("睡眠记录已更新");
    }
    if (target.id === "phoneCutoff") {
      state.settings.phoneCutoff = target.value || "23:00";
      saveState();
      render();
    }
    if (target.matches("[data-merchant-stage]")) {
      updateMerchantStage(target.dataset.id, target.value);
    }
  }

  function handleAppInput(event) {
    if (event.target.id !== "noteSearch") return;
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll("[data-note-id]").forEach((node) => {
      node.hidden = query.length > 0 && !node.dataset.search.includes(query);
    });
  }

  function handleAppSubmit(event) {
    if (event.target.id !== "reviewForm") return;
    event.preventDefault();
    const form = new FormData(event.target);
    const key = weekStartKey();
    state.reviews[key] = {
      output: String(form.get("output") || "").trim(),
      blocker: String(form.get("blocker") || "").trim(),
      next: String(form.get("next") || "").trim(),
      savedAt: new Date().toISOString(),
    };
    saveState();
    render();
    showToast("本周复盘已保存");
  }

  function handleSheetClick(event) {
    const target = event.target.closest("[data-sheet-action]");
    if (!target) return;
    const action = target.dataset.sheetAction;

    if (action === "close") closeModal();
    if (action === "capture-type" && activeModal?.kind === "capture") {
      activeModal.noteType = target.dataset.type;
      renderCaptureFields();
    }
    if (action === "delete-task" && activeModal?.kind === "task") {
      if (!window.confirm("删除这条行动？")) return;
      state.actions = state.actions.filter((task) => task.id !== activeModal.entityId);
      saveState();
      closeModal();
      render();
      showToast("已删除行动");
    }
    if (action === "delete-merchant" && activeModal?.kind === "merchant") {
      if (!window.confirm("删除这个商家记录？")) return;
      state.merchants = state.merchants.filter((item) => item.id !== activeModal.entityId);
      saveState();
      closeModal();
      render();
      showToast("已删除商家记录");
    }
    if (action === "delete-note" && activeModal?.kind === "note") {
      if (!window.confirm("删除这张知识卡？")) return;
      state.notes = state.notes.filter((item) => item.id !== activeModal.entityId);
      saveState();
      closeModal();
      render();
      showToast("已删除知识卡");
    }
    if (action === "export") exportBackup();
    if (action === "import") importFile.click();
  }

  function handleSheetSubmit(event) {
    event.preventDefault();
    if (!activeModal) return;
    const form = new FormData(sheetForm);
    const now = new Date().toISOString();

    if (activeModal.kind === "capture") {
      const noteType = activeModal.noteType || "note";
      if (noteType === "task") {
        const title = String(form.get("content") || "").trim();
        if (!title) return;
        state.actions.unshift({
          id: uid("task"),
          title,
          projectId: String(form.get("projectId") || "side-business"),
          date: String(form.get("date") || dateKey()),
          done: false,
          createdAt: now,
        });
        showToast("已加入今日行动");
      } else {
        const content = String(form.get("content") || "").trim();
        if (!content) return;
        state.notes.unshift({
          id: uid("note"),
          type: noteType,
          content,
          projectId: String(form.get("projectId") || ""),
          source: String(form.get("source") || "").trim(),
          createdAt: now,
        });
        showToast("已保存知识卡");
      }
      saveState();
      closeModal();
      render();
      return;
    }

    if (activeModal.kind === "task") {
      const title = String(form.get("title") || "").trim();
      if (!title) return;
      const task = state.actions.find((item) => item.id === activeModal.entityId);
      if (task) {
        task.title = title;
        task.projectId = String(form.get("projectId") || "side-business");
        task.date = String(form.get("date") || dateKey());
        task.updatedAt = now;
      } else {
        state.actions.unshift({
          id: uid("task"),
          title,
          projectId: String(form.get("projectId") || "side-business"),
          date: String(form.get("date") || dateKey()),
          done: false,
          createdAt: now,
        });
      }
      saveState();
      closeModal();
      render();
      showToast("行动已保存");
      return;
    }

    if (activeModal.kind === "project") {
      const project = state.projects.find((item) => item.id === activeModal.entityId);
      if (!project) return;
      project.title = String(form.get("title") || "").trim() || project.title;
      project.area = String(form.get("area") || project.area);
      project.goal = String(form.get("goal") || "").trim();
      project.nextAction = String(form.get("nextAction") || "").trim();
      project.risk = String(form.get("risk") || "").trim();
      project.status = String(form.get("status") || "active");
      project.updatedAt = now;
      saveState();
      closeModal();
      render();
      showToast("项目已更新");
      return;
    }

    if (activeModal.kind === "merchant") {
      const name = String(form.get("name") || "").trim();
      if (!name) return;
      const values = {
        name,
        product: String(form.get("product") || "").trim(),
        stage: String(form.get("stage") || "target"),
        nextFollowUp: String(form.get("nextFollowUp") || ""),
        amount: Math.max(0, Number(form.get("amount") || 0)),
        notes: String(form.get("notes") || "").trim(),
        updatedAt: now,
      };
      const merchant = getMerchant(activeModal.entityId);
      if (merchant) {
        Object.assign(merchant, values);
      } else {
        state.merchants.unshift({
          id: uid("merchant"),
          ...values,
          createdAt: now,
        });
      }
      saveState();
      closeModal();
      render();
      showToast("商家记录已保存");
      return;
    }

    if (activeModal.kind === "note") {
      const content = String(form.get("content") || "").trim();
      if (!content) return;
      const note = state.notes.find((item) => item.id === activeModal.entityId);
      if (note) {
        note.type = String(form.get("type") || "note");
        note.content = content;
        note.projectId = String(form.get("projectId") || "");
        note.source = String(form.get("source") || "").trim();
        note.updatedAt = now;
      }
      saveState();
      closeModal();
      render();
      showToast("知识卡已更新");
      return;
    }

    if (activeModal.kind === "business-stage") {
      const project = state.projects.find((item) => item.id === activeModal.entityId);
      if (!project) return;
      project.businessStage = String(form.get("businessStage") || "sample");
      project.updatedAt = now;
      saveState();
      closeModal();
      render();
      showToast("业务阶段已更新");
      return;
    }

    if (activeModal.kind === "settings") {
      state.settings.focusMinutes = clamp(Number(form.get("focusMinutes") || 60), 5, 180);
      state.settings.phoneCutoff =
        String(form.get("phoneCutoff") || "").trim() || state.settings.phoneCutoff;
      saveState();
      closeModal();
      render();
      showToast("设置已保存");
    }
  }

  function render() {
    const date = new Date();
    todayLabel.textContent = formatHeaderDate(date);
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.view === state.currentView);
    });

    if (state.currentView === "progress") app.innerHTML = renderProgress();
    else if (state.currentView === "review") app.innerHTML = renderReview();
    else if (state.currentView === "notes") app.innerHTML = renderNotes();
    else app.innerHTML = renderToday();
  }

  function renderToday() {
    const log = ensureTodayLog();
    const side = getProject("side-business");
    const work = getProject("work-itbp");
    const tasks = getTodayTasks();
    const doneTasks = tasks.filter((task) => task.done).length;
    const todayMinutes = getTodayFocusMinutes();
    const cutoff = getCutoffInfo();

    return `
      <div class="stack stack--lg">
        <section class="card card--flat">
          <div class="card__header">
            <div>
              <h2 class="card__title">今天有多少电？</h2>
              <p class="card__subtitle">不要求满格。按真实状态安排今天。</p>
            </div>
            <span class="pill pill--moss">${focusMinuteText(todayMinutes)}</span>
          </div>
          <div class="energy-row" aria-label="选择今日精力">
            ${[1, 2, 3, 4, 5]
              .map(
                (value) => `
                <button
                  class="energy-button ${Number(log.energy) === value ? "is-active" : ""}"
                  type="button"
                  data-action="set-energy"
                  data-value="${value}"
                  aria-label="${value} 格精力"
                >${value}</button>
              `,
              )
              .join("")}
          </div>
          <div class="field-grid" style="margin-top: 12px">
            <div class="field">
              <label for="sleepHours">昨晚睡眠（小时）</label>
              <input
                class="input"
                id="sleepHours"
                name="sleepHours"
                type="number"
                inputmode="decimal"
                min="0"
                max="16"
                step="0.5"
                value="${esc(log.sleepHours ?? 7)}"
              />
            </div>
            <div class="field">
              <label for="phoneCutoff">停止刷手机</label>
              <input
                class="input"
                id="phoneCutoff"
                type="time"
                value="${esc(state.settings.phoneCutoff)}"
              />
            </div>
          </div>
        </section>

        ${
          side
            ? `
            <section class="card card--ink">
              <div class="action-card">
                <div class="action-card__top">
                  <div>
                    <div class="action-card__meta">
                      <span class="pill">副业主线</span>
                      <span class="pill">${stageLabel(side.businessStage)}</span>
                    </div>
                    <h2 class="action-card__title">${esc(side.nextAction || "先写下一个可执行动作")}</h2>
                  </div>
                  <button class="icon-button icon-button--quiet" type="button" data-action="edit-project" data-id="${side.id}" aria-label="编辑副业项目" style="color: #fff">
                    ${dotsIcon()}
                  </button>
                </div>
                <p class="muted" style="margin: 0; font-size: 13px; line-height: 1.6">
                  ${esc(side.goal || "目标尚未填写")}
                </p>
                ${
                  state.focusSession
                    ? renderTimer(state.focusSession)
                    : `<button class="button button--accent button--wide" type="button" data-action="start-focus">投入 ${state.settings.focusMinutes} 分钟</button>`
                }
              </div>
            </section>
          `
            : ""
        }

        ${
          work
            ? `
            <section class="card">
              <div class="card__header">
                <div>
                  <p class="eyebrow">工作边界</p>
                  <h2 class="card__title" style="margin-top: 6px">${esc(work.nextAction || "今天没有工作下一步")}</h2>
                </div>
                <button class="icon-button icon-button--small" type="button" data-action="edit-project" data-id="${work.id}" aria-label="编辑工作项目">
                  ${dotsIcon()}
                </button>
              </div>
              <p class="helper">${esc(work.risk || "把工作放在一个可控边界里。")}</p>
            </section>
          `
            : ""
        }

        <section>
          <div class="card__header" style="margin: 0 2px 10px">
            <div>
              <p class="section-label">今日小步</p>
              <p class="helper" style="margin-top: 4px">${doneTasks}/${tasks.length} 已完成 · 只保留真正要推进的事</p>
            </div>
            <button class="button button--ghost" type="button" data-action="add-task">添加</button>
          </div>
          <div class="task-list">
            ${
              tasks.length
                ? tasks.map(renderTask).join("")
                : `
                  <div class="empty-state">
                    <strong>今天还没有小步</strong>
                    添加一个 10 分钟内能开始的动作。
                  </div>
                `
            }
          </div>
        </section>

        <section class="card ${cutoff.isNear ? "card--accent" : "card--flat"}">
          <div class="card__header">
            <div>
              <p class="eyebrow">收尾线</p>
              <h2 class="card__title" style="margin-top: 6px">${esc(state.settings.phoneCutoff)} 放下手机</h2>
            </div>
            <span class="pill">${cutoff.label}</span>
          </div>
          <p class="card__subtitle">${cutoff.hint}</p>
          <div class="progress" style="margin-top: 15px">
            <div class="progress__bar" style="width: ${cutoff.progress}%"></div>
          </div>
          <p class="helper" style="margin-top: 10px">睡觉也是副业的生产条件。娱乐可以安排，滑到停不下来不算休息。</p>
        </section>
      </div>
    `;
  }

  function renderTask(task) {
    const project = state.projects.find((item) => item.id === task.projectId);
    return `
      <article class="task-item ${task.done ? "is-complete" : ""}">
        <button class="check" type="button" data-action="toggle-task" data-id="${task.id}" aria-label="${task.done ? "标记未完成" : "标记完成"}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7l1.4 1.4L9.2 19.6 3.6 14 5 12.5Z"/></svg>
        </button>
        <div>
          <p class="task-title">${esc(task.title)}</p>
          <p class="task-meta">${esc(project?.area || "未分类")}${task.date && task.date !== dateKey() ? ` · ${formatShortDate(task.date)}` : ""}</p>
        </div>
        <button class="task-delete" type="button" data-action="edit-task" data-id="${task.id}" aria-label="编辑行动">
          ${dotsIcon()}
        </button>
      </article>
    `;
  }

  function renderProgress() {
    const side = getProject("side-business");
    const work = getProject("work-itbp");
    const stageIndex = Math.max(
      0,
      BUSINESS_STAGES.findIndex((stage) => stage.key === side?.businessStage),
    );
    const counts = getFunnelCounts();
    const merchants = [...state.merchants].sort((a, b) => {
      const aDate = a.nextFollowUp || "9999-99-99";
      const bDate = b.nextFollowUp || "9999-99-99";
      return aDate.localeCompare(bDate);
    });

    return `
      <div class="stack stack--lg">
        <section class="card card--ink">
          <div class="card__header">
            <div>
              <p class="eyebrow" style="color: rgba(255,253,248,.6)">90 天验证</p>
              <h2 class="card__title" style="margin-top: 6px">${esc(side?.title || "AI 商品广告")}</h2>
            </div>
            <button class="icon-button icon-button--small" type="button" data-action="edit-business-stage" data-id="${side?.id || "side-business"}" style="color: #fff; border-color: rgba(255,255,255,.14); background: rgba(255,255,255,.08)" aria-label="更新业务阶段">
              ${pencilIcon()}
            </button>
          </div>
          <div class="stage-track" aria-label="业务阶段">
            ${BUSINESS_STAGES.map(
              (stage, index) =>
                `<span class="${index <= stageIndex ? "is-done" : ""}" title="${stage.label}"></span>`,
            ).join("")}
          </div>
          <p class="muted" style="margin: 0 0 6px; font-size: 12px; font-weight: 700">
            当前：${BUSINESS_STAGES[stageIndex]?.label || "案例"} · 下一步
          </p>
          <h3 style="margin: 0; font-size: 19px; line-height: 1.45">${esc(side?.nextAction || "写下一个业务动作")}</h3>
          <div class="funnel" style="margin-top: 18px">
            <div class="funnel-step">
              <span class="funnel-step__value">${counts.contacted}</span>
              <span class="funnel-step__label">已联系 / 20</span>
            </div>
            <div class="funnel-step">
              <span class="funnel-step__value">${counts.replied}</span>
              <span class="funnel-step__label">有回复 / 5</span>
            </div>
            <div class="funnel-step">
              <span class="funnel-step__value">${counts.quoted}</span>
              <span class="funnel-step__label">已报价 / 2</span>
            </div>
            <div class="funnel-step">
              <span class="funnel-step__value">${counts.paid}</span>
              <span class="funnel-step__label">已付费 / 1</span>
            </div>
          </div>
        </section>

        <section>
          <div class="card__header" style="margin: 0 2px 10px">
            <div>
              <p class="section-label">商家推进</p>
              <p class="helper" style="margin-top: 4px">先验证有人愿意付钱，再优化生成效果。</p>
            </div>
            <button class="button button--ghost" type="button" data-action="add-merchant">添加商家</button>
          </div>
          <div class="merchant-list">
            ${
              merchants.length
                ? merchants.map(renderMerchant).join("")
                : `<div class="empty-state">
                    <strong>从 20 个目标商家开始</strong>
                    先记录店铺名和商品，不必等作品完美。
                    <div style="margin-top: 12px">
                      <button class="button button--soft" type="button" data-action="add-merchant">记录第一个商家</button>
                    </div>
                  </div>`
            }
          </div>
        </section>

        ${
          work
            ? `
            <section class="card">
              <div class="card__header">
                <div>
                  <p class="eyebrow">工作项目</p>
                  <h2 class="card__title" style="margin-top: 6px">${esc(work.title)}</h2>
                </div>
                <button class="icon-button icon-button--small" type="button" data-action="edit-project" data-id="${work.id}" aria-label="编辑工作项目">
                  ${dotsIcon()}
                </button>
              </div>
              <div class="stack stack--sm">
                <div class="metric" style="min-height: auto; padding: 13px; background: var(--surface-muted)">
                  <span class="metric__label">下一步</span>
                  <div style="margin-top: 5px; font-size: 15px; font-weight: 700; line-height: 1.5">${esc(work.nextAction || "尚未填写")}</div>
                </div>
                <div class="metric" style="min-height: auto; padding: 13px; background: #f6e5e1">
                  <span class="metric__label">主要风险</span>
                  <div style="margin-top: 5px; font-size: 13px; line-height: 1.55">${esc(work.risk || "尚未填写")}</div>
                </div>
              </div>
            </section>
          `
            : ""
        }

        <section class="card card--flat">
          <div class="card__header">
            <div>
              <h2 class="card__title">把反馈留下来</h2>
              <p class="card__subtitle">新的商家需求、拒绝理由和有效话术，都可以成为下次的依据。</p>
            </div>
          </div>
          <button class="button button--wide button--soft" type="button" data-action="scroll-capture">记录一条客户反馈</button>
        </section>
      </div>
    `;
  }

  function renderMerchant(merchant) {
    const stageIndex = Math.max(
      0,
      MERCHANT_STAGES.findIndex((stage) => stage.key === merchant.stage),
    );
    return `
      <article class="merchant-item">
        <div>
          <h3 class="merchant-title">${esc(merchant.name)}</h3>
          <p class="merchant-meta">
            ${esc(merchant.product || "未填写商品")}
            ${merchant.nextFollowUp ? ` · 下次 ${formatShortDate(merchant.nextFollowUp)}` : ""}
            ${Number(merchant.amount) > 0 ? ` · ¥${formatMoney(merchant.amount)}` : ""}
          </p>
          <div class="merchant-stage">
            <select class="stage-select" data-merchant-stage data-id="${merchant.id}" aria-label="更新 ${esc(merchant.name)} 的阶段">
              ${MERCHANT_STAGES.map(
                (stage, index) =>
                  `<option value="${stage.key}" ${index === stageIndex ? "selected" : ""}>${stage.label}</option>`,
              ).join("")}
            </select>
          </div>
        </div>
        <button class="merchant-more" type="button" data-action="edit-merchant" data-id="${merchant.id}" aria-label="编辑商家">
          ${dotsIcon()}
        </button>
      </article>
    `;
  }

  function renderReview() {
    const weekKey = weekStartKey();
    const sessions = state.focusSessions.filter((session) => dateKey(new Date(session.endedAt)) >= weekKey);
    const minutes = sessions.reduce((sum, session) => sum + Number(session.minutes || 0), 0);
    const merchantsTouched = state.merchants.filter((merchant) => {
      if (!merchant.updatedAt) return false;
      return dateKey(new Date(merchant.updatedAt)) >= weekKey;
    });
    const paid = state.merchants.filter((merchant) => {
      return ["paid", "delivered"].includes(merchant.stage) && merchant.updatedAt && dateKey(new Date(merchant.updatedAt)) >= weekKey;
    });
    const existing = state.reviews[weekKey] || {};
    const weekNotes = state.notes.filter((note) => dateKey(new Date(note.createdAt)) >= weekKey);

    return `
      <div class="stack stack--lg">
        <section class="card">
          <div class="card__header">
            <div>
              <p class="eyebrow">${formatWeekRange()}</p>
              <h2 class="card__title" style="margin-top: 6px">本周只问进展</h2>
            </div>
          </div>
          <div class="review-summary">
            <div class="review-stat">
              <strong>${formatDuration(minutes)}</strong>
              <span>专注投入</span>
            </div>
            <div class="review-stat">
              <strong>${merchantsTouched.length}</strong>
              <span>本周跟进</span>
            </div>
            <div class="review-stat">
              <strong>${paid.length}</strong>
              <span>本周付费</span>
            </div>
          </div>
        </section>

        <section class="card">
          <form id="reviewForm" class="stack">
            <div class="field">
              <label for="output">本周真正完成了什么？</label>
              <textarea class="textarea" id="output" name="output" placeholder="写看得见的产出，不写“学习了很多”。">${esc(existing.output || "")}</textarea>
            </div>
            <div class="field">
              <label for="blocker">现在最大的卡点是什么？</label>
              <textarea class="textarea" id="blocker" name="blocker" placeholder="例如：不敢联系商家，或商品一致性还不过关。">${esc(existing.blocker || "")}</textarea>
            </div>
            <div class="field">
              <label for="next">下周只保留哪三个动作？</label>
              <textarea class="textarea" id="next" name="next" placeholder="1.&#10;2.&#10;3.">${esc(existing.next || "")}</textarea>
            </div>
            <button class="button button--wide" type="submit">保存本周复盘</button>
          </form>
        </section>

        <section class="card card--flat">
          <div class="card__header">
            <div>
              <h2 class="card__title">专注流水</h2>
              <p class="card__subtitle">本周记录 ${sessions.length} 次。真实投入比计划更有参考价值。</p>
            </div>
          </div>
          <div class="timeline-list">
            ${
              sessions.length
                ? sessions
                    .slice()
                    .reverse()
                    .slice(0, 8)
                    .map(
                      (session) => `
                        <div class="timeline-item">
                          <div class="timeline-time">${formatClock(new Date(session.endedAt))}</div>
                          <div>
                            <p class="task-title">${formatDuration(session.minutes)} 专注</p>
                            <p class="task-meta">${formatShortDate(dateKey(new Date(session.endedAt)))}${session.completedEarly ? " · 提前结束" : ""}</p>
                          </div>
                        </div>
                      `,
                    )
                    .join("")
                : `<div class="empty-state"><strong>还没有专注记录</strong>从今天的 60 分钟开始。</div>`
            }
          </div>
        </section>

        <section class="card card--flat">
          <div class="card__header">
            <div>
              <h2 class="card__title">本周新增知识</h2>
              <p class="card__subtitle">${weekNotes.length} 张。复盘时只保留能改变下次行动的内容。</p>
            </div>
            <button class="button button--ghost" type="button" data-action="add-note">记录</button>
          </div>
          ${
            weekNotes.length
              ? `<div class="note-list">${weekNotes.slice(0, 3).map(renderNote).join("")}</div>`
              : `<div class="empty-state"><strong>这周还没有知识卡</strong>一次客户反馈、一个失败镜头，也值得留下。</div>`
          }
        </section>
      </div>
    `;
  }

  function renderNotes() {
    const notes = [...state.notes].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return `
      <div class="stack stack--lg">
        <section>
          <p class="section-label">经验卡</p>
          <h2 style="margin: 7px 0 7px; font-family: 'Songti SC','STSong',Georgia,serif; font-size: 26px; letter-spacing: -.03em">记下来，是为了下次少走一步</h2>
          <p class="helper" style="max-width: 460px">把学习、提示词和客户反馈关联到正在做的项目里。没有项目的笔记，先不急着记。</p>
        </section>

        <section class="card card--flat">
          <div class="button-row">
            <button class="button" type="button" data-action="add-note">新建知识卡</button>
            <button class="button button--soft" type="button" data-action="scroll-capture">记客户反馈</button>
          </div>
          <div class="field" style="margin-top: 14px">
            <label for="noteSearch">搜索内容</label>
            <input class="input" id="noteSearch" type="search" placeholder="输入关键词" autocomplete="off" />
          </div>
        </section>

        <section class="note-list">
          ${
            notes.length
              ? notes.map(renderNote).join("")
              : `<div class="empty-state">
                  <strong>知识卡还是空的</strong>
                  从一条真实反馈开始：“商家真正担心的是商品看起来不像实物。”
                  <div style="margin-top: 12px">
                    <button class="button button--soft" type="button" data-action="add-note">写下第一条</button>
                  </div>
                </div>`
          }
        </section>
      </div>
    `;
  }

  function renderNote(note) {
    const project = state.projects.find((item) => item.id === note.projectId);
    const searchText = `${note.content || ""} ${note.source || ""} ${project?.title || ""} ${NOTE_TYPES[note.type] || ""}`.toLowerCase();
    return `
      <article class="note-item" data-note-id="${note.id}" data-search="${esc(searchText)}">
        <div class="card__header" style="margin-bottom: 4px">
          <div>
            <span class="note-item__type">${esc(NOTE_TYPES[note.type] || "学习")}</span>
            <h3 class="note-title">${esc(project?.title || "未关联项目")}</h3>
          </div>
          <button class="icon-button icon-button--small" type="button" data-action="edit-note" data-id="${note.id}" aria-label="编辑知识卡">
            ${dotsIcon()}
          </button>
        </div>
        <p class="note-body">${esc(note.content || "")}</p>
        <p class="note-meta">
          ${note.source ? `来源：${esc(note.source)} · ` : ""}${formatShortDate(dateKey(new Date(note.createdAt)))}
        </p>
      </article>
    `;
  }

  function renderTimer(session) {
    const remaining = getFocusRemainingSeconds();
    const total = Math.max(1, Number(session.durationMinutes) * 60);
    const progress = clamp(((total - remaining) / total) * 100, 0, 100);
    return `
      <div>
        <div class="timer">
          <div>
            <div class="timer__display" data-timer>${formatTimer(remaining)}</div>
            <div class="timer__hint">这一小时只需要推进眼前的一步</div>
          </div>
          <button class="button button--accent" type="button" data-action="end-focus">结束</button>
        </div>
        <div class="progress">
          <div class="progress__bar" data-timer-progress style="width: ${progress}%"></div>
        </div>
      </div>
    `;
  }

  function renderCaptureFields() {
    const type = activeModal?.noteType || "note";
    const selectedProject = state.projects.find((project) => project.id === "side-business");
    const typeButtons = [
      { key: "task", label: "行动" },
      { key: "note", label: "学习" },
      { key: "prompt", label: "提示词" },
      { key: "feedback", label: "客户反馈" },
    ];
    const fields = sheetForm.querySelector("#captureFields");
    if (!fields) return;
    fields.innerHTML =
      type === "task"
        ? `
          <div class="field">
            <label for="captureContent">下一件要做什么？</label>
            <textarea class="textarea" id="captureContent" name="content" autofocus placeholder="写成可以马上开始的动宾句。"></textarea>
          </div>
          <div class="field-grid">
            <div class="field">
              <label for="captureProject">关联项目</label>
              <select class="select" id="captureProject" name="projectId">${projectOptions(selectedProject?.id)}</select>
            </div>
            <div class="field">
              <label for="captureDate">安排日期</label>
              <input class="input" id="captureDate" name="date" type="date" value="${dateKey()}" />
            </div>
          </div>
        `
        : `
          <div class="field">
            <label for="captureContent">${type === "feedback" ? "对方说了什么，说明了什么？" : "这张卡片要留下什么？"}</label>
            <textarea class="textarea" id="captureContent" name="content" autofocus placeholder="${
              type === "prompt"
                ? "记录可复用的提示词、参数或失败条件。"
                : type === "feedback"
                  ? "记录原话、场景，以及下次要调整的行动。"
                  : "写一条下次还能用上的经验。"
            }"></textarea>
          </div>
          <div class="field-grid">
            <div class="field">
              <label for="captureProject">关联项目</label>
              <select class="select" id="captureProject" name="projectId">${projectOptions(selectedProject?.id)}</select>
            </div>
            <div class="field">
              <label for="captureSource">来源（可选）</label>
              <input class="input" id="captureSource" name="source" placeholder="客户、课程、链接" />
            </div>
          </div>
        `;
  }

  function openCapture(initialType = "note") {
    activeModal = { kind: "capture", noteType: initialType };
    modalTitle.textContent = "快速记录";
    sheetForm.innerHTML = `
      <div class="segmented" role="group" aria-label="记录类型">
        ${[
          { key: "task", label: "行动" },
          { key: "note", label: "学习" },
          { key: "prompt", label: "提示词" },
          { key: "feedback", label: "客户反馈" },
        ]
          .map(
            (type) => `
              <button
                class="segment ${initialType === type.key ? "is-active" : ""}"
                type="button"
                data-sheet-action="capture-type"
                data-type="${type.key}"
              >${type.label}</button>
            `,
          )
          .join("")}
      </div>
      <div class="stack" id="captureFields"></div>
      <div class="sheet-actions">
        <button class="button button--soft" type="button" data-sheet-action="close">取消</button>
        <button class="button" type="submit">记下来</button>
      </div>
    `;
    renderCaptureFields();
    openModal();
  }

  function openTaskModal(task = null) {
    activeModal = { kind: "task", entityId: task?.id || "" };
    modalTitle.textContent = task ? "编辑今日行动" : "添加今日行动";
    sheetForm.innerHTML = `
      <div class="field">
        <label for="taskTitle">行动</label>
        <input class="input" id="taskTitle" name="title" value="${esc(task?.title || "")}" placeholder="例如：联系 5 个收纳类商家" autofocus />
      </div>
      <div class="field-grid">
        <div class="field">
          <label for="taskProject">项目</label>
          <select class="select" id="taskProject" name="projectId">${projectOptions(task?.projectId || "side-business")}</select>
        </div>
        <div class="field">
          <label for="taskDate">日期</label>
          <input class="input" id="taskDate" name="date" type="date" value="${esc(task?.date || dateKey())}" />
        </div>
      </div>
      <div class="sheet-actions">
        ${
          task
            ? `<button class="button button--danger" type="button" data-sheet-action="delete-task">删除</button>`
            : `<button class="button button--soft" type="button" data-sheet-action="close">取消</button>`
        }
        <button class="button" type="submit">保存</button>
      </div>
    `;
    openModal();
  }

  function openProjectModal(projectId) {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return;
    activeModal = { kind: "project", entityId: project.id };
    modalTitle.textContent = "编辑项目";
    sheetForm.innerHTML = `
      <div class="field-grid">
        <div class="field">
          <label for="projectTitle">项目名称</label>
          <input class="input" id="projectTitle" name="title" value="${esc(project.title)}" autofocus />
        </div>
        <div class="field">
          <label for="projectArea">所属领域</label>
          <select class="select" id="projectArea" name="area">
            ${["挣钱", "工作", "学习", "运动", "娱乐", "家庭"]
              .map((area) => `<option ${project.area === area ? "selected" : ""}>${area}</option>`)
              .join("")}
          </select>
        </div>
      </div>
      <div class="field">
        <label for="projectGoal">阶段目标</label>
        <input class="input" id="projectGoal" name="goal" value="${esc(project.goal || "")}" placeholder="用一句话描述做完什么" />
      </div>
      <div class="field">
        <label for="projectNext">下一步</label>
        <textarea class="textarea" id="projectNext" name="nextAction" placeholder="一个可以马上开始的动作">${esc(project.nextAction || "")}</textarea>
      </div>
      <div class="field">
        <label for="projectRisk">主要风险或卡点</label>
        <textarea class="textarea" id="projectRisk" name="risk" placeholder="不掩盖问题，下一次复盘会用到">${esc(project.risk || "")}</textarea>
      </div>
      <div class="field">
        <label for="projectStatus">状态</label>
        <select class="select" id="projectStatus" name="status">
          <option value="active" ${project.status === "active" ? "selected" : ""}>推进中</option>
          <option value="paused" ${project.status === "paused" ? "selected" : ""}>暂缓</option>
          <option value="done" ${project.status === "done" ? "selected" : ""}>已完成</option>
        </select>
      </div>
      <div class="sheet-actions">
        <button class="button button--soft" type="button" data-sheet-action="close">取消</button>
        <button class="button" type="submit">保存</button>
      </div>
    `;
    openModal();
  }

  function openBusinessStageModal(projectId) {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return;
    activeModal = { kind: "business-stage", entityId: project.id };
    modalTitle.textContent = "更新业务阶段";
    sheetForm.innerHTML = `
      <p class="helper">按真实证据推进，不按感觉推进。商家没有付款，就不算首单。</p>
      <div class="field">
        <label for="businessStage">当前阶段</label>
        <select class="select" id="businessStage" name="businessStage">
          ${BUSINESS_STAGES.map(
            (stage) =>
              `<option value="${stage.key}" ${project.businessStage === stage.key ? "selected" : ""}>${stage.label}</option>`,
          ).join("")}
        </select>
      </div>
      <div class="sheet-actions">
        <button class="button button--soft" type="button" data-sheet-action="close">取消</button>
        <button class="button" type="submit">保存</button>
      </div>
    `;
    openModal();
  }

  function openMerchantModal(merchant = null) {
    activeModal = { kind: "merchant", entityId: merchant?.id || "" };
    modalTitle.textContent = merchant ? "编辑商家记录" : "添加商家";
    sheetForm.innerHTML = `
      <div class="field-grid">
        <div class="field">
          <label for="merchantName">商家或店铺</label>
          <input class="input" id="merchantName" name="name" value="${esc(merchant?.name || "")}" placeholder="店铺名" autofocus />
        </div>
        <div class="field">
          <label for="merchantProduct">商品</label>
          <input class="input" id="merchantProduct" name="product" value="${esc(merchant?.product || "")}" placeholder="例如：折叠收纳箱" />
        </div>
      </div>
      <div class="field-grid">
        <div class="field">
          <label for="merchantStage">阶段</label>
          <select class="select" id="merchantStage" name="stage">
            ${MERCHANT_STAGES.map(
              (stage) =>
                `<option value="${stage.key}" ${(merchant?.stage || "target") === stage.key ? "selected" : ""}>${stage.label}</option>`,
            ).join("")}
          </select>
        </div>
        <div class="field">
          <label for="merchantFollowUp">下次跟进</label>
          <input class="input" id="merchantFollowUp" name="nextFollowUp" type="date" value="${esc(merchant?.nextFollowUp || "")}" />
        </div>
      </div>
      <div class="field">
        <label for="merchantAmount">金额（可选）</label>
        <input class="input" id="merchantAmount" name="amount" type="number" min="0" step="1" inputmode="decimal" value="${esc(merchant?.amount || "")}" placeholder="报价或回款金额" />
      </div>
      <div class="field">
        <label for="merchantNotes">沟通记录与反馈</label>
        <textarea class="textarea" id="merchantNotes" name="notes" placeholder="原话、顾虑、修改要求和下一步">${esc(merchant?.notes || "")}</textarea>
      </div>
      <div class="sheet-actions">
        ${
          merchant
            ? `<button class="button button--danger" type="button" data-sheet-action="delete-merchant">删除</button>`
            : `<button class="button button--soft" type="button" data-sheet-action="close">取消</button>`
        }
        <button class="button" type="submit">保存</button>
      </div>
    `;
    openModal();
  }

  function openNoteModal(note = null) {
    if (!note) {
      openCapture("note");
      return;
    }
    activeModal = { kind: "note", entityId: note.id };
    modalTitle.textContent = "编辑知识卡";
    sheetForm.innerHTML = `
      <div class="field">
        <label for="noteType">类型</label>
        <select class="select" id="noteType" name="type">
          ${Object.entries(NOTE_TYPES)
            .map(
              ([key, label]) =>
                `<option value="${key}" ${note.type === key ? "selected" : ""}>${label}</option>`,
            )
            .join("")}
        </select>
      </div>
      <div class="field">
        <label for="noteContent">内容</label>
        <textarea class="textarea" id="noteContent" name="content" placeholder="下次还能用上的经验">${esc(note.content || "")}</textarea>
      </div>
      <div class="field-grid">
        <div class="field">
          <label for="noteProject">关联项目</label>
          <select class="select" id="noteProject" name="projectId">${projectOptions(note.projectId, true)}</select>
        </div>
        <div class="field">
          <label for="noteSource">来源</label>
          <input class="input" id="noteSource" name="source" value="${esc(note.source || "")}" placeholder="客户、课程、链接" />
        </div>
      </div>
      <div class="sheet-actions">
        <button class="button button--danger" type="button" data-sheet-action="delete-note">删除</button>
        <button class="button" type="submit">保存</button>
      </div>
    `;
    openModal();
  }

  function openSettings() {
    activeModal = { kind: "settings" };
    modalTitle.textContent = "设置与备份";
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    sheetForm.innerHTML = `
      <div class="field-grid">
        <div class="field">
          <label for="focusMinutes">专注时长（分钟）</label>
          <input class="input" id="focusMinutes" name="focusMinutes" type="number" min="5" max="180" step="5" value="${state.settings.focusMinutes}" />
        </div>
        <div class="field">
          <label for="settingsCutoff">晚间停止刷手机</label>
          <input class="input" id="settingsCutoff" name="phoneCutoff" type="time" value="${esc(state.settings.phoneCutoff)}" />
        </div>
      </div>
      <hr class="divider" />
      <div class="button-row">
        <button class="button button--soft" type="button" data-sheet-action="export">导出备份</button>
        <button class="button button--soft" type="button" data-sheet-action="import">导入备份</button>
      </div>
      ${
        standalone
          ? `<p class="helper">当前已作为主屏幕应用运行。</p>`
          : `<p class="helper">iPhone：用 Safari 打开本页，点“分享”，选择“添加到主屏幕”。</p>`
      }
      <p class="helper">数据默认只保存在当前浏览器的本地空间。更换手机、清理 Safari 数据前，请先导出备份。</p>
      <div class="sheet-actions">
        <button class="button button--soft" type="button" data-sheet-action="close">关闭</button>
        <button class="button" type="submit">保存设置</button>
      </div>
    `;
    openModal();
  }

  function openModal() {
    modalBackdrop.hidden = false;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => {
      const firstInput = sheetForm.querySelector("input, textarea, select");
      if (firstInput) firstInput.focus({ preventScroll: true });
    }, 80);
  }

  function closeModal() {
    modalBackdrop.hidden = true;
    document.body.style.overflow = "";
    activeModal = null;
    sheetForm.innerHTML = "";
  }

  function setView(view) {
    if (!VIEWS.has(view)) return;
    state.currentView = view;
    if (location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
    saveState();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startFocus() {
    if (state.focusSession) return;
    state.focusSession = {
      id: uid("focus"),
      startedAt: new Date().toISOString(),
      durationMinutes: Number(state.settings.focusMinutes) || 60,
    };
    saveState();
    render();
    showToast("专注计时开始");
  }

  function endFocus(auto = false) {
    if (!state.focusSession) return;
    const started = new Date(state.focusSession.startedAt);
    const elapsedMinutes = Math.max(
      1,
      Math.min(
        Number(state.focusSession.durationMinutes) || 60,
        Math.round((Date.now() - started.getTime()) / 60000),
      ),
    );
    state.focusSessions.push({
      id: state.focusSession.id,
      startedAt: state.focusSession.startedAt,
      endedAt: new Date().toISOString(),
      minutes: elapsedMinutes,
      completedEarly:
        !auto && elapsedMinutes < Number(state.focusSession.durationMinutes),
    });
    state.focusSession = null;
    saveState();
    render();
    showToast(auto ? `${elapsedMinutes} 分钟完成，休息一下` : `已记录 ${elapsedMinutes} 分钟`);
  }

  function updateTimer() {
    if (!state.focusSession) return;
    const remaining = getFocusRemainingSeconds();
    if (remaining <= 0) {
      completeFocus(true);
      return;
    }
    if (remaining === lastTimerSecond) return;
    lastTimerSecond = remaining;
    const timer = document.querySelector("[data-timer]");
    const progress = document.querySelector("[data-timer-progress]");
    if (timer) timer.textContent = formatTimer(remaining);
    if (progress) {
      const total = Math.max(1, Number(state.focusSession.durationMinutes) * 60);
      progress.style.width = `${clamp(((total - remaining) / total) * 100, 0, 100)}%`;
    }
  }

  function completeFocus(auto) {
    if (!state.focusSession) return;
    const started = new Date(state.focusSession.startedAt);
    const elapsedMinutes = Math.max(
      1,
      Math.min(
        Number(state.focusSession.durationMinutes) || 60,
        Math.round((Date.now() - started.getTime()) / 60000),
      ),
    );
    state.focusSessions.push({
      id: state.focusSession.id,
      startedAt: state.focusSession.startedAt,
      endedAt: new Date().toISOString(),
      minutes: elapsedMinutes,
      completedEarly: false,
    });
    state.focusSession = null;
    saveState();
    render();
    if (auto) showToast(`${elapsedMinutes} 分钟完成，离开屏幕休息`);
  }

  function getFocusRemainingSeconds() {
    if (!state.focusSession) return 0;
    const end =
      new Date(state.focusSession.startedAt).getTime() +
      Number(state.focusSession.durationMinutes) * 60 * 1000;
    return Math.max(0, Math.ceil((end - Date.now()) / 1000));
  }

  function updateMerchantStage(id, stage) {
    const merchant = getMerchant(id);
    if (!merchant || !MERCHANT_STAGES.some((item) => item.key === stage)) return;
    merchant.stage = stage;
    merchant.updatedAt = new Date().toISOString();
    saveState();
    render();
    showToast("商家阶段已更新");
  }

  function setBusinessStage(projectId, stage) {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project || !BUSINESS_STAGES.some((item) => item.key === stage)) return;
    project.businessStage = stage;
    project.updatedAt = new Date().toISOString();
    saveState();
    render();
  }

  function getFunnelCounts() {
    const indexOf = (merchant) =>
      Math.max(
        0,
        MERCHANT_STAGES.findIndex((stage) => stage.key === merchant.stage),
      );
    return {
      contacted: state.merchants.filter((merchant) => indexOf(merchant) >= 1).length,
      replied: state.merchants.filter((merchant) => indexOf(merchant) >= 2).length,
      quoted: state.merchants.filter((merchant) => indexOf(merchant) >= 3).length,
      paid: state.merchants.filter((merchant) => indexOf(merchant) >= 4).length,
    };
  }

  function getProject(id) {
    return state.projects.find((project) => project.id === id);
  }

  function getMerchant(id) {
    return state.merchants.find((merchant) => merchant.id === id);
  }

  function getTodayTasks() {
    return state.actions
      .filter((task) => task.date === dateKey())
      .sort((a, b) => Number(a.done) - Number(b.done));
  }

  function getTodayFocusMinutes() {
    const today = dateKey();
    return state.focusSessions
      .filter((session) => dateKey(new Date(session.endedAt)) === today)
      .reduce((sum, session) => sum + Number(session.minutes || 0), 0);
  }

  function ensureTodayLog() {
    const key = dateKey();
    if (!state.dailyLogs[key]) {
      state.dailyLogs[key] = {
        energy: 3,
        sleepHours: 7,
        note: "",
        updatedAt: new Date().toISOString(),
      };
      saveState();
    }
    return state.dailyLogs[key];
  }

  function projectOptions(selectedId = "", allowEmpty = false) {
    return `${allowEmpty ? `<option value="">未关联</option>` : ""}${state.projects
      .map(
        (project) =>
          `<option value="${project.id}" ${selectedId === project.id ? "selected" : ""}>${esc(project.title)}</option>`,
      )
      .join("")}`;
  }

  function getCutoffInfo() {
    const now = new Date();
    const [hour, minute] = String(state.settings.phoneCutoff || "23:00")
      .split(":")
      .map(Number);
    const cutoff = new Date(now);
    cutoff.setHours(hour || 23, minute || 0, 0, 0);
    const diffMinutes = Math.round((cutoff.getTime() - now.getTime()) / 60000);
    const start = new Date(now);
    start.setHours(20, 0, 0, 0);
    const total = Math.max(1, cutoff.getTime() - start.getTime());
    const progress = clamp(((now.getTime() - start.getTime()) / total) * 100, 0, 100);
    let label = "收尾";
    let hint = "还有一段时间。把最想完成的一步做完，然后主动停下来。";
    if (diffMinutes <= 0) {
      label = "到点了";
      hint = "今晚的输入结束。给明天留一点精力，比再多刷十分钟更有用。";
    } else if (diffMinutes <= 45) {
      label = `${diffMinutes} 分钟`;
      hint = "开始收尾：保存进度，写下明天的下一步，把手机放到够不到的地方。";
    } else if (diffMinutes <= 120) {
      label = `${diffMinutes} 分钟`;
      hint = "还可以完成一个明确动作。不要开启新的信息流。";
    }
    return {
      label,
      hint,
      progress,
      isNear: diffMinutes <= 45,
    };
  }

  function exportBackup() {
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const filename = `jinri-yijin-backup-${dateKey()}.json`;
    const file = new File([blob], filename, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator
        .share({
          files: [file],
          title: "今日一进备份",
          text: "请保存到文件或发送到自己的私密存储。",
        })
        .then(() => showToast("已打开分享"))
        .catch(() => downloadBlob(blob, filename));
      return;
    }
    downloadBlob(blob, filename);
    showToast("备份文件已生成");
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.projects)) {
          throw new Error("invalid backup");
        }
        if (!window.confirm("导入会覆盖当前设备上的数据，是否继续？")) return;
        state = {
          ...createInitialState(),
          ...parsed,
          settings: { ...createInitialState().settings, ...(parsed.settings || {}) },
        };
        state.currentView = "today";
        saveState();
        closeModal();
        render();
        showToast("备份已导入");
      } catch {
        showToast("备份文件无法识别");
      }
    });
    reader.readAsText(file);
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    toastNode.textContent = message;
    toastNode.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      toastNode.classList.remove("is-visible");
    }, 2300);
  }

  function uid(prefix) {
    if (window.crypto?.randomUUID) return `${prefix}-${window.crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function dateKey(input = new Date()) {
    const date = input instanceof Date ? input : new Date(input);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function weekStartKey(input = new Date()) {
    const date = new Date(input);
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    date.setHours(0, 0, 0, 0);
    return dateKey(date);
  }

  function formatWeekRange() {
    const start = new Date(`${weekStartKey()}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `${start.getMonth() + 1}月${start.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`;
  }

  function formatHeaderDate(date) {
    const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return `${date.getMonth() + 1}月${date.getDate()}日 · ${weekdays[date.getDay()]}`;
  }

  function formatShortDate(value) {
    if (!value) return "";
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function formatClock(date) {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  function formatDuration(minutes) {
    const value = Number(minutes) || 0;
    if (value < 60) return `${value}m`;
    const hours = Math.floor(value / 60);
    const remain = value % 60;
    return remain ? `${hours}h${remain}` : `${hours}h`;
  }

  function focusMinuteText(minutes) {
    return minutes > 0 ? `今日专注 ${formatDuration(minutes)}` : "今日尚未专注";
  }

  function formatTimer(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safe / 60);
    const remain = safe % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remain).padStart(2, "0")}`;
  }

  function formatMoney(value) {
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(Number(value) || 0);
  }

  function stageLabel(key) {
    return BUSINESS_STAGES.find((stage) => stage.key === key)?.label || "案例";
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || min));
  }

  function dotsIcon() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm6 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm6 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z"/></svg>`;
  }

  function pencilIcon() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 17.5-.7 2.2 2.2-.7L18.8 6.7l-1.5-1.5L5 17.5Zm12.4-14 3.1 3.1-1.8 1.8-3.1-3.1 1.8-1.8Z"/></svg>`;
  }
})();
