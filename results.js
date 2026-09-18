(() => {
  const STORAGE_KEY = 'stychConfidenceEntries';
  const SCORES_KEY = 'stychExamScores';

  // The number Stych itself shows as "Examen Blanc N" is identical to the
  // testN segment of testUrl (confirmed across all 29 exams listed on the
  // home page, e.g. test7 <-> "Examen Blanc 7", also matching that page's
  // own data-num_serie="7" attribute) — no separate capture needed, and it
  // works retroactively for every exam already in storage.
  function getExamNumber(testUrl) {
    if (!testUrl) return null;
    const match = testUrl.match(/\/test(\d+)\//);
    return match ? match[1] : null;
  }

  function formatDate(iso) {
    if (!iso) return 'Date inconnue';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Date inconnue';
    return d.toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // One group per exam attempt (testUrl), newest first. Each group carries
  // its own score — either the one persisted at correction time (accurate,
  // read straight off Stych's own DOM) or, for an exam whose correction
  // page was never visited, the same matched/isCorrect fallback computeScore()
  // already used for the single-exam view.
  function getExamGroups(entries, scores) {
    const groups = new Map();
    entries.forEach((e) => {
      if (!e.testUrl) return;
      if (!groups.has(e.testUrl)) groups.set(e.testUrl, []);
      groups.get(e.testUrl).push(e);
    });

    return Array.from(groups.entries())
      .map(([testUrl, groupEntries]) => {
        const scoreInfo = computeScore(groupEntries, scores[testUrl]);
        const latestEntryTimestamp = groupEntries.reduce(
          (max, e) => (e.timestamp && e.timestamp > max ? e.timestamp : max),
          ''
        );
        const timestamp = (scores[testUrl] && scores[testUrl].timestamp) || latestEntryTimestamp;
        return { testUrl, entries: groupEntries, scoreInfo, timestamp };
      })
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  }

  function buildRows(entries) {
    const rows = [];

    entries.forEach((entry) => {
      if (entry.matched && Array.isArray(entry.subQuestions) && entry.subQuestions.length) {
        entry.subQuestions.forEach((sq) => {
          rows.push({
            orderNumber: entry.questionOrderNumber ?? entry.questionNumber ?? null,
            text: sq.text || '(question non identifiée)',
            selectedLabel:
              Array.isArray(sq.selectedAnswerLabels) && sq.selectedAnswerLabels.length
                ? sq.selectedAnswerLabels.join(' / ')
                : 'Aucune réponse',
            correctLabel:
              Array.isArray(sq.correctAnswerLabels) && sq.correctAnswerLabels.length
                ? sq.correctAnswerLabels.join(' / ')
                : '—',
            isCorrect: sq.isCorrect,
            confidence: entry.confidence,
            available: true,
          });
        });
      } else {
        const texts =
          Array.isArray(entry.questionText) && entry.questionText.length
            ? entry.questionText
            : ['(question non identifiée)'];
        texts.forEach((text) => {
          rows.push({
            orderNumber: entry.questionNumber ?? null,
            text,
            selectedLabel:
              Array.isArray(entry.selectedAnswerIds) && entry.selectedAnswerIds.length
                ? entry.selectedAnswerIds.join(' / ')
                : 'Aucune réponse',
            correctLabel: 'Non disponible',
            isCorrect: null,
            confidence: entry.confidence,
            available: false,
          });
        });
      }
    });

    rows.sort((a, b) => (a.orderNumber ?? Infinity) - (b.orderNumber ?? Infinity));
    return rows;
  }

  function computeScore(entries, storedScore) {
    if (storedScore && typeof storedScore.score === 'number' && typeof storedScore.total === 'number') {
      return storedScore;
    }
    const matched = entries.filter((e) => e.matched);
    if (!matched.length) return null;
    return { score: matched.filter((e) => e.isCorrect).length, total: matched.length };
  }

  // Average of the rows currently shown in the table — deliberately driven
  // by that same row list (not the raw entries) so it stays correct once
  // the table can show more than one exam's rows at a time: it just
  // reflects whatever's visible, no separate aggregation logic needed.
  // Rows with no confidence recorded are excluded rather than counted as 0.
  function computeAverageConfidence(rows) {
    const rated = rows.filter(
      (row) => row.confidence === 1 || row.confidence === 2 || row.confidence === 3
    );
    if (!rated.length) return null;
    return rated.reduce((sum, row) => sum + row.confidence, 0) / rated.length;
  }

  function confidenceText(confidence) {
    return confidence === null || confidence === undefined ? 'Non renseigné' : String(confidence);
  }

  // Shared red/yellow/green scale (1/2/3) — kept consistent with the badge
  // injected on Stych's own correction page, which uses the same classes.
  function confidenceClass(confidence) {
    if (confidence === 1) return 'confidence-1';
    if (confidence === 2) return 'confidence-2';
    if (confidence === 3) return 'confidence-3';
    return null;
  }

  function renderTable(rows, emptyMessage) {
    const tbody = document.getElementById('results-body');
    tbody.innerHTML = '';

    rows.forEach((row) => {
      const tr = document.createElement('tr');

      const numberTd = document.createElement('td');
      numberTd.textContent = row.orderNumber ?? '—';
      tr.appendChild(numberTd);

      const confidenceTd = document.createElement('td');
      confidenceTd.textContent = confidenceText(row.confidence);
      const confClass = confidenceClass(row.confidence);
      if (confClass) confidenceTd.classList.add(confClass);
      tr.appendChild(confidenceTd);

      const questionTd = document.createElement('td');
      questionTd.textContent = row.text;
      tr.appendChild(questionTd);

      const answerTd = document.createElement('td');
      answerTd.textContent = row.selectedLabel;
      if (row.available) {
        answerTd.classList.add(row.isCorrect ? 'cell-correct' : 'cell-incorrect');
      }
      tr.appendChild(answerTd);

      const correctTd = document.createElement('td');
      correctTd.textContent = row.correctLabel;
      tr.appendChild(correctTd);

      tbody.appendChild(tr);
    });

    document.getElementById('results-table').style.display = rows.length ? '' : 'none';
    const emptyStateEl = document.getElementById('empty-state');
    emptyStateEl.style.display = rows.length ? 'none' : '';
    if (!rows.length && emptyMessage) {
      emptyStateEl.textContent = emptyMessage;
    }
  }

  function csvEscape(value) {
    const str = String(value ?? '');
    if (/[;"\n\r]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function toCsv(rows) {
    const header = ['N', 'Confiance', 'Question', 'Ta reponse', 'Bonne reponse', 'Resultat'];
    const lines = [header.join(';')];

    rows.forEach((row) => {
      const resultText = row.available ? (row.isCorrect ? 'Juste' : 'Faux') : 'Non disponible';
      const cells = [
        row.orderNumber ?? '',
        confidenceText(row.confidence),
        row.text,
        row.selectedLabel,
        row.correctLabel,
        resultText,
      ];
      lines.push(cells.map(csvEscape).join(';'));
    });

    return lines.join('\r\n');
  }

  function downloadCsv(rows) {
    const csv = toCsv(rows);
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'stych-resultats.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Filters combine with OR when more than one is active: checking both
  // shows a row that matches EITHER condition (missed, or low confidence),
  // not just rows that satisfy both at once.
  function applyRowFilters(rows, filters) {
    if (!filters.missedOnly && !filters.lowConfidenceOnly) return rows;
    return rows.filter((row) => {
      const isMissed = filters.missedOnly && row.available && row.isCorrect === false;
      const isLowConfidence = filters.lowConfidenceOnly && (row.confidence === 1 || row.confidence === 2);
      return isMissed || isLowConfidence;
    });
  }

  function init() {
    chrome.storage.local.get([STORAGE_KEY, SCORES_KEY], (result) => {
      const allEntries = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
      const scores = result[SCORES_KEY] && typeof result[SCORES_KEY] === 'object' ? result[SCORES_KEY] : {};
      const examGroups = getExamGroups(allEntries, scores);

      const examPicker = document.getElementById('exam-picker');
      const examPickerToggle = document.getElementById('exam-picker-toggle');
      const examPickerToggleText = examPickerToggle.querySelector('.exam-picker-toggle-text');
      const examPickerList = document.getElementById('exam-picker-list');
      const scoreEl = document.getElementById('score');
      const avgConfidenceEl = document.getElementById('avg-confidence');
      const missedCheckbox = document.getElementById('filter-missed');
      const lowConfidenceCheckbox = document.getElementById('filter-low-confidence');

      if (!examGroups.length) {
        renderTable([], 'Aucun résultat trouvé. Termine un examen blanc puis reviens sur cette page.');
        scoreEl.textContent = 'Pas encore de résultat';
        avgConfidenceEl.textContent = 'Pas encore de résultat';
        examPicker.style.display = 'none';
        document.getElementById('download-csv').style.display = 'none';
        return;
      }

      function examOptionParts(group) {
        const scoreLabel = group.scoreInfo
          ? `${group.scoreInfo.score} / ${group.scoreInfo.total}`
          : 'non terminé';
        const examNumber = getExamNumber(group.testUrl);
        const examLabel = examNumber ? `Examen ${examNumber}` : 'Examen ?';
        return { examLabel, scoreLabel, dateLabel: formatDate(group.timestamp) };
      }

      function closeExamPicker() {
        examPickerList.hidden = true;
        examPickerToggle.setAttribute('aria-expanded', 'false');
      }

      function openExamPicker() {
        examPickerList.hidden = false;
        examPickerToggle.setAttribute('aria-expanded', 'true');
      }

      let selectedExamIndex = 0;
      let visibleRows = [];

      function render() {
        const group = examGroups[selectedExamIndex];
        const allRows = buildRows(group.entries);
        const filters = {
          missedOnly: missedCheckbox.checked,
          lowConfidenceOnly: lowConfidenceCheckbox.checked,
        };
        visibleRows = applyRowFilters(allRows, filters);

        renderTable(visibleRows, 'Aucune question ne correspond aux filtres sélectionnés.');
        scoreEl.textContent = group.scoreInfo
          ? `${group.scoreInfo.score} / ${group.scoreInfo.total}`
          : 'Pas encore de résultat';

        const avgConfidence = computeAverageConfidence(visibleRows);
        avgConfidenceEl.textContent =
          avgConfidence === null
            ? 'Confiance : —'
            : `Confiance : ${avgConfidence.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} / 3`;
      }

      function selectExam(index) {
        selectedExamIndex = index;
        const { examLabel, scoreLabel } = examOptionParts(examGroups[index]);
        examPickerToggleText.textContent = `${examLabel} — ${scoreLabel}`;
        Array.from(examPickerList.children).forEach((li, i) => {
          li.classList.toggle('is-selected', i === index);
          li.setAttribute('aria-selected', i === index ? 'true' : 'false');
        });
        closeExamPicker();
        render();
      }

      examGroups.forEach((group, index) => {
        const { examLabel, scoreLabel, dateLabel } = examOptionParts(group);

        const li = document.createElement('li');
        li.className = 'exam-picker-item';
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');

        const numberSpan = document.createElement('span');
        numberSpan.className = 'exam-picker-number';
        numberSpan.textContent = examLabel;

        const scoreSpan = document.createElement('span');
        scoreSpan.className = 'exam-picker-score';
        scoreSpan.textContent = scoreLabel;

        const dateSpan = document.createElement('span');
        dateSpan.className = 'exam-picker-date';
        dateSpan.textContent = dateLabel;

        li.append(numberSpan, scoreSpan, dateSpan);
        li.addEventListener('click', () => selectExam(index));
        examPickerList.appendChild(li);
      });

      examPickerToggle.addEventListener('click', () => {
        if (examPickerList.hidden) openExamPicker();
        else closeExamPicker();
      });

      document.addEventListener('click', (e) => {
        if (!examPicker.contains(e.target)) closeExamPicker();
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeExamPicker();
      });

      missedCheckbox.addEventListener('change', render);
      lowConfidenceCheckbox.addEventListener('change', render);
      document.getElementById('download-csv').addEventListener('click', () => downloadCsv(visibleRows));

      selectExam(0);
    });
  }

  init();
})();
