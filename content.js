(() => {
  const STORAGE_KEY = 'stychConfidenceEntries';
  const SCORE_KEY = 'stychLastScore';

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
      console.error('[Stych Confidence Tracker] storage error', err);
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

  function processCorrectionPage() {
    if (!isCorrectionPage()) return;

    const panels = getCorrectionPanels().filter((p) => !correctionOrdersProcessed.has(p.orderNumber));
    if (panels.length === 0) return;

    withStorageQueue(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get([STORAGE_KEY], (result) => {
            const entries = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
            let changed = false;

            panels.forEach((panel) => {
              const panelAnswerIds = new Set();
              panel.subQuestions.forEach((sq) => {
                sq.selectedAnswerIds.forEach((id) => panelAnswerIds.add(id));
                sq.correctAnswerIds.forEach((id) => panelAnswerIds.add(id));
              });

              // Primary match: exact question order number (see brief on
              // panel-qst-N being the shared key between both modes).
              let entry = entries.find((e) => e.questionNumber === panel.orderNumber);

              // Fallback: overlap on selected answer ids.
              if (!entry) {
                entry = entries.find(
                  (e) =>
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
              if (score !== null && total !== null) {
                chrome.storage.local.set(
                  { [SCORE_KEY]: { score, total, timestamp: new Date().toISOString() } },
                  resolve
                );
              } else {
                resolve();
              }
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
            const filtered = entries.filter((e) => e.id_qst !== entry.id_qst);
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

    // Diagnostic — remove once the questionNumber/id_qst capture bug
    // (see bug report) is confirmed fixed on a full real exam.
    console.log('[Stych Confidence Tracker] Capture', { idQst, questionNumber, totalQuestions });

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
  });
  observer.observe(document.body, { childList: true, subtree: true });

  checkForNewQuestion();
  processCorrectionPage();
})();
