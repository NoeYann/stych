(() => {
  const STORAGE_KEY = 'stychConfidenceEntries';
  const SCORE_KEY = 'stychLastScore';

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

  function renderTable(rows) {
    const tbody = document.getElementById('results-body');
    tbody.innerHTML = '';

    rows.forEach((row) => {
      const tr = document.createElement('tr');

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

      const confidenceTd = document.createElement('td');
      confidenceTd.textContent = confidenceText(row.confidence);
      tr.appendChild(confidenceTd);

      tbody.appendChild(tr);
    });

    document.getElementById('results-table').style.display = rows.length ? '' : 'none';
    document.getElementById('empty-state').style.display = rows.length ? 'none' : '';
  }

  function csvEscape(value) {
    const str = String(value ?? '');
    if (/[;"\n\r]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function toCsv(rows) {
    const header = ['Question', 'Ta reponse', 'Bonne reponse', 'Confiance', 'Resultat'];
    const lines = [header.join(';')];

    rows.forEach((row) => {
      const resultText = row.available ? (row.isCorrect ? 'Juste' : 'Faux') : 'Non disponible';
      const cells = [row.text, row.selectedLabel, row.correctLabel, confidenceText(row.confidence), resultText];
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

  function init() {
    chrome.storage.local.get([STORAGE_KEY, SCORE_KEY], (result) => {
      const entries = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
      const rows = buildRows(entries);
      renderTable(rows);

      const scoreInfo = computeScore(entries, result[SCORE_KEY]);
      document.getElementById('score').textContent = scoreInfo
        ? `${scoreInfo.score} / ${scoreInfo.total}`
        : 'Pas encore de résultat';

      document.getElementById('download-csv').addEventListener('click', () => downloadCsv(rows));
    });
  }

  init();
})();
