(() => {
  const STORAGE_KEY = 'stychConfidenceEntries';
  const SCORES_KEY = 'stychExamScores';

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

      const examSelect = document.getElementById('exam-select');
      const scoreEl = document.getElementById('score');
      const missedCheckbox = document.getElementById('filter-missed');
      const lowConfidenceCheckbox = document.getElementById('filter-low-confidence');

      if (!examGroups.length) {
        renderTable([], 'Aucun résultat trouvé. Termine un examen blanc puis reviens sur cette page.');
        scoreEl.textContent = 'Pas encore de résultat';
        examSelect.style.display = 'none';
        document.getElementById('download-csv').style.display = 'none';
        return;
      }

      examGroups.forEach((group, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        const scoreLabel = group.scoreInfo
          ? `${group.scoreInfo.score} / ${group.scoreInfo.total}`
          : 'non terminé';
        option.textContent = `${formatDate(group.timestamp)} — ${scoreLabel}`;
        examSelect.appendChild(option);
      });

      let visibleRows = [];

      function render() {
        const group = examGroups[Number(examSelect.value)];
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
      }

      examSelect.addEventListener('change', render);
      missedCheckbox.addEventListener('change', render);
      lowConfidenceCheckbox.addEventListener('change', render);
      document.getElementById('download-csv').addEventListener('click', () => downloadCsv(visibleRows));

      render();
    });
  }

  init();
})();
