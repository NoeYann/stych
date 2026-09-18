(() => {
  const STORAGE_KEY = 'stychConfidenceEntries';
  // Keyed by testUrl (not a single "last score" slot) so the history view
  // can show the correct score for any past exam, not just the latest one.
  const SCORES_KEY = 'stychExamScores';

  let lastIdQst = null;
  let currentConfidence = null;
  let widgetEl = null;
  const correctionOrdersProcessed = new Set();

  // Every read-modify-write on STORAGE_KEY goes through this queue. Without
  // it, two chrome.storage.local.get()+set() round-trips fired close
  // together (e.g. clicking through questions quickly) can race: the second
  // get() reads the state from before the first set() committed, so its
  // set() silently overwrites the first entry instead of appending to it.
  let storageQueue = Promise.resolve();

  function withStorageQueue(task) {
    storageQueue = storageQueue.then(task).catch((err) => {
      console.error('[Stych Suivi] storage error', err);
    });
    return storageQueue;
  }

  function getIdQst() {
    const input = document.querySelector('#id_qst');
    return input ? input.value : null;
  }

  function getTestUrl() {
    for (const script of document.querySelectorAll('script')) {
      const match = script.textContent.match(/var\s+test_url\s*=\s*'([^']*)'/);
      if (match) return match[1];
    }
    return null;
  }

  function getQuestionNumbers() {
    const el = document.querySelector('.questionnaire_test_numquestion');
    if (!el) return { questionNumber: null, totalQuestions: null };
    const [num, total] = el.textContent.split('/').map((s) => parseInt(s.trim(), 10));
    return {
      questionNumber: Number.isNaN(num) ? null : num,
      totalQuestions: Number.isNaN(total) ? null : total,
    };
  }

  function getQuestionTexts() {
    return Array.from(document.querySelectorAll('.questionnaire_test_qst')).map((el) =>
      el.textContent.trim()
    );
  }

  function getSelectedAnswerIds() {
    return Array.from(document.querySelectorAll('.check_response'))
      .filter((input) => input.checked)
      .map((input) => input.value);
  }

  function resetConfidence() {
    currentConfidence = null;
    if (!widgetEl) return;
    widgetEl.querySelectorAll('.stych-confidence-btn').forEach((btn) => {
      btn.classList.remove('is-selected');
    });
    widgetEl.classList.remove('stych-confidence-missing');
  }

  function setConfidence(level) {
    currentConfidence = level;
    if (!widgetEl) return;
    widgetEl.querySelectorAll('.stych-confidence-btn').forEach((btn) => {
      btn.classList.toggle('is-selected', Number(btn.dataset.level) === level);
    });
    widgetEl.classList.remove('stych-confidence-missing');
  }

  function buildWidget() {
    const container = document.createElement('div');
    container.className = 'stych-confidence-widget';

    const label = document.createElement('span');
    label.className = 'stych-confidence-label';
    label.textContent = 'Confiance :';
    container.appendChild(label);

    [1, 2, 3].forEach((level) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'stych-confidence-btn';
      btn.dataset.level = String(level);
      btn.textContent = String(level);
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setConfidence(level);
      });
      container.appendChild(btn);
    });

    return container;
  }

  function ensureWidget() {
    const loadNextEl = document.querySelector('#loadNext');
    if (!loadNextEl) return;
    if (widgetEl && document.contains(widgetEl)) return;

    widgetEl = buildWidget();
    loadNextEl.parentNode.insertBefore(widgetEl, loadNextEl);
  }

  function handleNewQuestion(idQst) {
    lastIdQst = idQst;
    widgetEl = null;
    ensureWidget();
    resetConfidence();
  }

  function checkForNewQuestion() {
    if (isCorrectionPage()) return;
    const idQst = getIdQst();
    if (!idQst) return;
    if (idQst !== lastIdQst) {
      handleNewQuestion(idQst);
    } else {
      ensureWidget();
    }
  }

  // --- Multi-exam scoping ---
  //
  // stychConfidenceEntries accumulates entries across every exam attempt
  // ever taken (kept deliberately, so a future history/aggregation view
  // isn't foreclosed). The "current" exam is identified as whichever
  // testUrl owns the most recent entry by timestamp — the correction page
  // always immediately follows that same exam's last question, so this is
  // a reliable way to scope matching/display without testUrl being present
  // anywhere on the correction page itself (verified absent from the DOM).

  function getCurrentTestUrl(entries) {
    let latest = null;
    entries.forEach((e) => {
      if (!e.testUrl || !e.timestamp) return;
      if (!latest || e.timestamp > latest.timestamp) latest = e;
    });
    return latest ? latest.testUrl : null;
  }

  // Before the storage-write race condition was fixed, clicking through an
  // exam quickly meant only the last click's write reliably survived,
  // leaving a single matched:false entry stranded for that exam. Detect
  // such orphan groups (never matched, and holding fewer entries than the
  // exam's own reported totalQuestions) and drop them — except the current
  // exam's group, which is legitimately incomplete while still in progress.
  function cleanupOrphanEntries(entries, currentTestUrl) {
    const groups = new Map();
    entries.forEach((e) => {
      const key = e.testUrl || '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    });

    const toRemove = new Set();
    groups.forEach((group, testUrl) => {
      if (testUrl === currentTestUrl) return;
      if (group.some((e) => e.matched)) return;
      const expectedTotal = group.reduce((max, e) => Math.max(max, e.totalQuestions || 0), 0);
      if (expectedTotal > 0 && group.length < expectedTotal) {
        group.forEach((e) => toRemove.add(e));
      }
    });

    return entries.filter((e) => !toRemove.has(e));
  }

  function cleanupStorage() {
    withStorageQueue(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get([STORAGE_KEY], (result) => {
            const entries = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
            const currentTestUrl = getCurrentTestUrl(entries);
            const cleaned = cleanupOrphanEntries(entries, currentTestUrl);
            if (cleaned.length !== entries.length) {
              chrome.storage.local.set({ [STORAGE_KEY]: cleaned }, resolve);
            } else {
              resolve();
            }
          });
        })
    );
  }

  // --- Correction page (final recap) ---

  function isCorrectionPage() {
    return !!document.querySelector('.wrapper-resume-result') && !!document.querySelector('.note-result');
  }

  function parseScore() {
    const el = document.querySelector('.note-result');
    if (!el) return { score: null, total: null };
    const scoreEl = el.querySelector('span');
    const score = scoreEl ? parseInt(scoreEl.textContent.trim(), 10) : NaN;
    const totalMatch = el.textContent.match(/\/\s*(\d+)/);
    const total = totalMatch ? parseInt(totalMatch[1], 10) : NaN;
    return {
      score: Number.isNaN(score) ? null : score,
      total: Number.isNaN(total) ? null : total,
    };
  }

  // The class name for a correctly-selected answer isn't confirmed anywhere
  // in the DOM samples available, so correctness is derived by elimination
  // from the two confirmed classes (badAnswer / forgetAnswer) rather than by
  // guessing a "good answer" class name.
  function parseSubQuestion(qstBox) {
    const textEl = qstBox.querySelector('.questionnaire_test_qst');
    const text = textEl ? textEl.textContent.trim() : '';

    const selectedIds = [];
    const badIds = [];
    const forgetIds = [];
    const labelsById = {};

    qstBox.querySelectorAll('.questionnaire_test_reponse').forEach((opt) => {
      const input = opt.querySelector('.check_response');
      if (!input) return;
      const value = input.value;
      const labelEl = opt.querySelector('label');
      labelsById[value] = labelEl ? labelEl.textContent.trim().replace(/\s+/g, ' ') : value;

      if (opt.classList.contains('selected')) selectedIds.push(value);
      if (opt.classList.contains('badAnswer')) badIds.push(value);
      if (opt.classList.contains('forgetAnswer')) forgetIds.push(value);
    });

    const correctIds = Array.from(
      new Set([...forgetIds, ...selectedIds.filter((id) => !badIds.includes(id))])
    );

    const explanationEl = qstBox.querySelector('p.text-left');
    const explanation = explanationEl ? explanationEl.textContent.trim() : '';

    return {
      text,
      selectedAnswerIds: selectedIds,
      correctAnswerIds: correctIds,
      selectedAnswerLabels: selectedIds.map((id) => labelsById[id] || id),
      correctAnswerLabels: correctIds.map((id) => labelsById[id] || id),
      isCorrect: badIds.length === 0 && forgetIds.length === 0,
      explanation,
    };
  }

  function getCorrectionPanels() {
    return Array.from(document.querySelectorAll('.panel-qst'))
      .map((panelEl) => {
        const numClass = Array.from(panelEl.classList).find((c) => /^panel-qst-\d+$/.test(c));
        if (!numClass) return null;
        const orderNumber = parseInt(numClass.replace('panel-qst-', ''), 10);
        const subQuestions = Array.from(panelEl.querySelectorAll('.qst_box')).map(parseSubQuestion);
        return { orderNumber, subQuestions };
      })
      .filter(Boolean);
  }

  // Badge injected under each numbered pastille on the recap
  // (.box-resume-result#panel-qst-N), showing the confidence recorded for
  // that question. Separate from processCorrectionPage()'s panel matching:
  // the pastilles are always visible (unlike the .panel-qst detail blocks,
  // which are CSS-hidden), so this must not be gated on new panels existing.
  function confidenceBadgeClass(confidence) {
    if (confidence === 1) return 'stych-confidence-badge-1';
    if (confidence === 2) return 'stych-confidence-badge-2';
    if (confidence === 3) return 'stych-confidence-badge-3';
    return null;
  }

  function injectConfidenceBadges(entries, currentTestUrl, pastilles) {
    pastilles.forEach((pastille) => {
      // Already wrapped on a previous pass — idempotent, skip.
      if (pastille.parentElement && pastille.parentElement.classList.contains('stych-confidence-wrap')) {
        return;
      }

      const orderNumber = parseInt(pastille.id.replace('panel-qst-', ''), 10);
      if (Number.isNaN(orderNumber)) return;

      const entry = entries.find(
        (e) => e.testUrl === currentTestUrl && e.questionNumber === orderNumber
      );
      const badgeClass = confidenceBadgeClass(entry ? entry.confidence : null);
      if (!badgeClass) return; // no confidence recorded: no badge, no clutter.

      const wrapper = document.createElement('div');
      wrapper.className = 'stych-confidence-wrap';
      pastille.parentNode.insertBefore(wrapper, pastille);
      wrapper.appendChild(pastille);

      const badge = document.createElement('div');
      badge.className = 'stych-confidence-badge ' + badgeClass;
      badge.textContent = String(entry.confidence);
      wrapper.appendChild(badge);
    });
  }

  function injectConfidenceBadgesIfNeeded() {
    if (!isCorrectionPage()) return;

    const pastilles = Array.from(document.querySelectorAll('.box-resume-result[id^="panel-qst-"]'));
    if (!pastilles.length) return;

    const hasUnwrapped = pastilles.some(
      (p) => !p.parentElement || !p.parentElement.classList.contains('stych-confidence-wrap')
    );
    if (!hasUnwrapped) return;

    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const entries = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
      const currentTestUrl = getCurrentTestUrl(entries);
      injectConfidenceBadges(entries, currentTestUrl, pastilles);
    });
  }

  // "Voir mes résultats" button injected directly on Stych's own pages
  // (evaluations list and correction recap), in addition to the popup.
  // Uses window.open rather than chrome.tabs.create because this runs as
  // a content script inside Stych's page, not in the extension's own
  // privileged context — results.html must be listed in
  // web_accessible_resources for that page to load at all from here.
  function isEvaluationPage() {
    return /^\/elearning\/formation\/\d+\/evaluation\/?$/.test(location.pathname);
  }

  function buildResultsButton(variant) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'stych-confidence-results-button';
    button.className = 'stych-confidence-results-button ' + variant;
    button.title = 'Stych Suivi';
    button.textContent = 'Voir mes résultats';
    button.addEventListener('click', () => {
      window.open(chrome.runtime.getURL('results.html'), '_blank');
    });
    return button;
  }

  function injectResultsButtonIfNeeded() {
    if (document.getElementById('stych-confidence-results-button')) return;

    if (isEvaluationPage()) {
      // Inline in the page's own top-right button row (notifications, cart,
      // account), so it lines up with them instead of floating separately.
      const navList = document.querySelector('nav.topbar ul.nav');
      if (!navList) return;
      const li = document.createElement('li');
      li.className = 'nav-item stych-confidence-nav-item';
      li.appendChild(buildResultsButton('stych-confidence-inline'));
      navList.insertBefore(li, navList.firstChild);
    } else if (isCorrectionPage()) {
      // Inline in the header's own button row (.btn-gp-log: "Mon compte" /
      // "Deconnexion"), so it scrolls away with the header like those
      // buttons instead of staying fixed over the page content below.
      const btnGroup = document.querySelector('.btn-gp-log');
      if (btnGroup) {
        btnGroup.appendChild(buildResultsButton('stych-confidence-header'));
      } else {
        // Fallback in case this header variant doesn't have that row.
        document.body.appendChild(buildResultsButton('stych-confidence-floating'));
      }
    }
  }

  function processCorrectionPage() {
    if (!isCorrectionPage()) return;

    const panels = getCorrectionPanels().filter((p) => !correctionOrdersProcessed.has(p.orderNumber));
    if (panels.length === 0) return;

    withStorageQueue(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get([STORAGE_KEY], (result) => {
            const entries = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
            const currentTestUrl = getCurrentTestUrl(entries);
            let changed = false;

            panels.forEach((panel) => {
              const panelAnswerIds = new Set();
              panel.subQuestions.forEach((sq) => {
                sq.selectedAnswerIds.forEach((id) => panelAnswerIds.add(id));
                sq.correctAnswerIds.forEach((id) => panelAnswerIds.add(id));
              });

              // Matching is scoped to the current exam's testUrl first:
              // questionNumber alone repeats across every exam attempt
              // (1..totalQuestions each time), so without this an older
              // attempt's entry sharing the same questionNumber could be
              // matched instead of the exam actually being corrected.

              // Primary match: exact question order number (see brief on
              // panel-qst-N being the shared key between both modes).
              let entry = entries.find(
                (e) => e.testUrl === currentTestUrl && e.questionNumber === panel.orderNumber
              );

              // Fallback: overlap on selected answer ids.
              if (!entry) {
                entry = entries.find(
                  (e) =>
                    e.testUrl === currentTestUrl &&
                    Array.isArray(e.selectedAnswerIds) &&
                    e.selectedAnswerIds.some((id) => panelAnswerIds.has(id))
                );
              }

              correctionOrdersProcessed.add(panel.orderNumber);
              if (!entry) return;

              entry.matched = true;
              entry.questionOrderNumber = panel.orderNumber;
              entry.correctAnswerIds = Array.from(
                new Set(panel.subQuestions.flatMap((sq) => sq.correctAnswerIds))
              );
              entry.isCorrect = panel.subQuestions.every((sq) => sq.isCorrect);
              entry.explanation = panel.subQuestions
                .map((sq) => sq.explanation)
                .filter(Boolean)
                .join('\n\n');
              entry.subQuestions = panel.subQuestions.map((sq) => ({
                text: sq.text,
                selectedAnswerIds: sq.selectedAnswerIds,
                correctAnswerIds: sq.correctAnswerIds,
                selectedAnswerLabels: sq.selectedAnswerLabels,
                correctAnswerLabels: sq.correctAnswerLabels,
                isCorrect: sq.isCorrect,
                explanation: sq.explanation,
              }));

              changed = true;
            });

            const finishWithScore = () => {
              const { score, total } = parseScore();
              if (score === null || total === null) {
                resolve();
                return;
              }
              chrome.storage.local.get([SCORES_KEY], (scoreResult) => {
                const scores =
                  scoreResult[SCORES_KEY] && typeof scoreResult[SCORES_KEY] === 'object'
                    ? scoreResult[SCORES_KEY]
                    : {};
                scores[currentTestUrl] = { score, total, timestamp: new Date().toISOString() };
                chrome.storage.local.set({ [SCORES_KEY]: scores }, resolve);
              });
            };

            if (changed) {
              chrome.storage.local.set({ [STORAGE_KEY]: entries }, finishWithScore);
            } else {
              finishWithScore();
            }
          });
        })
    );
  }

  function saveEntry(entry) {
    withStorageQueue(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get([STORAGE_KEY], (result) => {
            const entries = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
            // id_qst identifies the exam attempt server-side, not the
            // question — it's identical across every question of one exam
            // (confirmed: the same id_qst was captured at question 6/40 and
            // at question 40/40 of the same attempt). Deduping on it alone
            // made every new save delete the previous question's entry,
            // leaving only the last question's capture per exam. The
            // question's real identity within an exam is (testUrl,
            // questionNumber) — already the key used for correction
            // matching in processCorrectionPage().
            const filtered = entries.filter(
              (e) => !(e.testUrl === entry.testUrl && e.questionNumber === entry.questionNumber)
            );
            filtered.push(entry);
            chrome.storage.local.set({ [STORAGE_KEY]: filtered }, resolve);
          });
        })
    );
  }

  function handleValidateClick(e) {
    const target = e.target.closest && e.target.closest('#loadNext');
    if (!target) return;

    const idQst = getIdQst();
    if (!idQst) return;

    if (currentConfidence === null && widgetEl) {
      widgetEl.classList.add('stych-confidence-missing');
    }

    const { questionNumber, totalQuestions } = getQuestionNumbers();

    saveEntry({
      id_qst: idQst,
      testUrl: getTestUrl(),
      questionNumber,
      totalQuestions,
      questionText: getQuestionTexts(),
      selectedAnswerIds: getSelectedAnswerIds(),
      confidence: currentConfidence,
      timestamp: new Date().toISOString(),
      matched: false,
    });
  }

  document.addEventListener('click', handleValidateClick, true);

  const observer = new MutationObserver(() => {
    checkForNewQuestion();
    processCorrectionPage();
    injectConfidenceBadgesIfNeeded();
    injectResultsButtonIfNeeded();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  cleanupStorage();
  checkForNewQuestion();
  processCorrectionPage();
  injectConfidenceBadgesIfNeeded();
  injectResultsButtonIfNeeded();
})();
