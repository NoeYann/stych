(() => {
  const STORAGE_KEY = 'stychConfidenceEntries';

  let lastIdQst = null;
  let currentConfidence = null;
  let widgetEl = null;

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
    const idQst = getIdQst();
    if (!idQst) return;
    if (idQst !== lastIdQst) {
      handleNewQuestion(idQst);
    } else {
      ensureWidget();
    }
  }

  function saveEntry(entry) {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const entries = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
      const filtered = entries.filter((e) => e.id_qst !== entry.id_qst);
      filtered.push(entry);
      chrome.storage.local.set({ [STORAGE_KEY]: filtered });
    });
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
  });
  observer.observe(document.body, { childList: true, subtree: true });

  checkForNewQuestion();
})();
