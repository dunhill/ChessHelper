// ==UserScript==
// @name         Deutsche Schachjugend - Opponent DWZ in Results
// @namespace    https://github.com/oleksiy/ChessHelper
// @version      1.0
// @description  Adds opponent DWZ from title attribute to visible result points.
// @match        *://www.deutsche-schachjugend.de/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const LOG_PREFIX = '[DSJ-DWZ]';
  const NEW_DWZ_HEADER_CLASS = 'dsj-new-dwz-header';
  const NEW_DWZ_CELL_CLASS = 'dsj-new-dwz-cell';

  function extractRating(titleText, type) {
    if (!titleText) return null;
    const match = titleText.match(new RegExp(`\\b${type}\\s+(\\d+)\\b`, 'i'));
    return match ? Number(match[1]) : null;
  }

  function cleanPointsText(text) {
    return (text || '').replace(/\s*-\s*\d+\s*$/, '').trim();
  }

  function parseResultValue(text) {
    const normalized = (text || '').trim();
    if (!normalized) return null;
    if (normalized === '1') return 1;
    if (normalized === '0') return 0;
    if (normalized === '½') return 0.5;
    return null;
  }

  function parseCurrentDwz(cellText) {
    const text = (cellText || '').trim();
    if (!text) return null;
    const numeric = Number(text.replace(/[^0-9]/g, ''));
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return numeric;
  }

  function calculateExpectedScore(playerDWZ, opponentDWZ) {
    if (playerDWZ == null || opponentDWZ == null) return 0;
    const diff = opponentDWZ - playerDWZ;
    return 1 / (1 + Math.pow(10, diff / 400));
  }

  function calculateNewDWZ(playerDWZ, opponentRatings, opponentResults) {
    const validOpponents = opponentRatings
      .map((rating, index) => ({ rating, result: opponentResults[index] }))
      .filter((entry) => entry.rating != null && entry.rating > 0 && entry.result != null);

    if (playerDWZ == null || validOpponents.length === 0) return null;

    const expectedSum = validOpponents.reduce(
      (sum, opponent) => sum + calculateExpectedScore(playerDWZ, opponent.rating),
      0
    );
    const scoreSum = validOpponents.reduce((sum, opponent) => sum + opponent.result, 0);
    const correctionFactor = 20;
    const delta = (scoreSum - expectedSum) * correctionFactor;
    return {
      newDwz: Math.round(playerDWZ + delta),
      expectedSum,
      scoreSum
    };
  }

  function calculateInitialDwz(opponentRatings, opponentResults) {
    const validOpponents = opponentRatings
      .map((rating, index) => ({ rating, result: opponentResults[index] }))
      .filter((entry) => entry.rating != null && entry.rating > 0 && entry.result != null);

    // Relaxed rule requested by user: allow first DWZ from >=1 valid game.
    if (validOpponents.length < 1) return null;

    const scoreSum = validOpponents.reduce((sum, opponent) => sum + opponent.result, 0);
    const targetAverage = scoreSum / validOpponents.length;
    const clampedTarget = Math.min(0.99, Math.max(0.01, targetAverage));

    let low = 100;
    let high = 3000;
    for (let i = 0; i < 40; i += 1) {
      const mid = (low + high) / 2;
      const expectedAverage =
        validOpponents.reduce((sum, opponent) => sum + calculateExpectedScore(mid, opponent.rating), 0) /
        validOpponents.length;

      if (expectedAverage < clampedTarget) {
        low = mid;
      } else {
        high = mid;
      }
    }

    const ri = Math.round((low + high) / 2);
    const newDwz = ri <= 800 ? Math.round(700 + ri / 8) : ri;
    const expectedSum = validOpponents.reduce(
      (sum, opponent) => sum + calculateExpectedScore(newDwz, opponent.rating),
      0
    );
    return {
      newDwz,
      expectedSum,
      scoreSum
    };
  }

  function stripExpectedSuffix(title) {
    return (title || '').replace(/\s*·\s*Erwartet\s*[0-9]+(?:[.,][0-9]+)?\s*$/i, '').trim();
  }

  function findScoreTextNode(cell) {
    for (const node of cell.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const points = cleanPointsText(node.textContent);
      if (points) {
        return node;
      }
    }
    return null;
  }

  function getOrCreateTextNode(parent) {
    const existing = Array.from(parent.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE
    );
    if (existing) return existing;
    const node = document.createTextNode('');
    parent.appendChild(node);
    return node;
  }

  function collectEntries(table) {
    const resultCells = Array.from(table.querySelectorAll('td.results, td.ergebnis'));
    const entries = [];

    for (const cell of resultCells) {
      const title = cell.getAttribute('title') || '';
      const dwz = extractRating(title, 'DWZ');
      const elo = extractRating(title, 'ELO');
      const hasOpponent = /\bGegner\b/i.test(title);

      const link = cell.querySelector('a');
      if (link) {
        const linkTextNode = getOrCreateTextNode(link);
        entries.push({
          textNode: linkTextNode,
          originalText: linkTextNode.textContent,
          points: cleanPointsText(linkTextNode.textContent),
          dwz,
          elo,
          hasOpponent
        });
        continue;
      }

      const pointsNode = findScoreTextNode(cell);
      const targetTextNode = pointsNode || getOrCreateTextNode(cell);

      entries.push({
        textNode: targetTextNode,
        originalText: targetTextNode.textContent,
        points: cleanPointsText(targetTextNode.textContent),
        dwz,
        elo,
        hasOpponent
      });
    }

    return entries;
  }

  function applyMode(entries, mode) {
    for (const entry of entries) {
      if (mode === 'none') {
        entry.textNode.textContent = entry.originalText;
        continue;
      }

      const rating = mode === 'dwz' ? entry.dwz : entry.elo;
      if (!rating) {
        entry.textNode.textContent = entry.originalText;
        continue;
      }

      const pointsOrPending = entry.points || (entry.hasOpponent ? '?' : '');
      if (!pointsOrPending) {
        entry.textNode.textContent = entry.originalText;
        continue;
      }

      entry.textNode.textContent = ` ${pointsOrPending} - ${rating} `;
    }
  }

  function findDwzColumnIndex(table) {
    const headerCells = Array.from(table.querySelectorAll('thead tr th'));
    return headerCells.findIndex((th) => {
      const abbr = th.querySelector('abbr');
      const title = (abbr?.getAttribute('title') || '').toLowerCase();
      const text = (abbr?.textContent || th.textContent || '').toLowerCase().trim();
      return title.includes('deutsche wertungszahl') || text === 'dwz';
    });
  }

  function collectRowCalculations(table, dwzColumnIndex) {
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const calculations = [];

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('td'));
      const currentDwz = parseCurrentDwz(cells[dwzColumnIndex]?.textContent || '');

      const gameCells = cells.filter((cell) => cell.matches('td.results, td.ergebnis'));
      const opponentRatings = [];
      const opponentResults = [];
      const gameDetails = [];

      for (const cell of gameCells) {
        const title = cell.getAttribute('title') || '';
        const oppDwz = extractRating(title, 'DWZ');
        if (oppDwz == null) continue;

        const resultTextNode = findScoreTextNode(cell);
        const resultText = cleanPointsText(resultTextNode ? resultTextNode.textContent : cell.textContent);
        const resultValue = parseResultValue(resultText);
        if (resultValue == null) continue;

        opponentRatings.push(oppDwz);
        opponentResults.push(resultValue);
        gameDetails.push({ cell, oppDwz, resultValue });
      }

      if (currentDwz == null) {
        const initialCalc = calculateInitialDwz(opponentRatings, opponentResults);
        if (initialCalc == null) {
          console.info(`${LOG_PREFIX} No current DWZ and insufficient valid games for first DWZ estimate.`, {
            rowId: row.id || null
          });
          calculations.push(null);
          continue;
        }

        calculations.push({
          currentDwz: null,
          newDwz: initialCalc.newDwz,
          delta: null,
          isFirstDwz: true,
          expectedSum: initialCalc.expectedSum,
          scoreSum: initialCalc.scoreSum,
          gameDetails
        });
        continue;
      }

      const updateCalc = calculateNewDWZ(currentDwz, opponentRatings, opponentResults);
      if (updateCalc == null) {
        calculations.push(null);
        continue;
      }

      calculations.push({
        currentDwz,
        newDwz: updateCalc.newDwz,
        delta: updateCalc.newDwz - currentDwz,
        isFirstDwz: false,
        expectedSum: updateCalc.expectedSum,
        scoreSum: updateCalc.scoreSum,
        gameDetails
      });
    }

    return calculations;
  }

  function removeNewDwzColumn(table) {
    table.querySelectorAll(`.${NEW_DWZ_HEADER_CLASS}, .${NEW_DWZ_CELL_CLASS}`).forEach((el) => el.remove());
  }

  function renderNewDwzColumn(table) {
    removeNewDwzColumn(table);

    const dwzColumnIndex = findDwzColumnIndex(table);
    if (dwzColumnIndex < 0) {
      console.info(`${LOG_PREFIX} Could not find DWZ header for new DWZ column.`);
      return;
    }

    const headerRow = table.querySelector('thead tr');
    if (!headerRow) return;

    const calculations = collectRowCalculations(table, dwzColumnIndex);

    const newHeader = document.createElement('th');
    newHeader.className = NEW_DWZ_HEADER_CLASS;
    const newHeaderAbbr = document.createElement('abbr');
    newHeaderAbbr.title = 'Nur Vermuttung und kein offizieles DWZ';
    newHeaderAbbr.textContent = 'new DWZ';
    newHeader.appendChild(newHeaderAbbr);
    headerRow.insertBefore(newHeader, headerRow.children[dwzColumnIndex + 1] || null);

    const rows = Array.from(table.querySelectorAll('tbody tr'));
    rows.forEach((row, idx) => {
      const cell = document.createElement('td');
      cell.className = NEW_DWZ_CELL_CLASS;

      const calc = calculations[idx];
      if (!calc) {
        cell.textContent = '';
      } else if (calc.isFirstDwz) {
        const tag = document.createElement('span');
        tag.textContent = ' (neu)';
        tag.style.color = '#555';
        cell.textContent = `${calc.newDwz}`;
        cell.appendChild(tag);
      } else {
        const deltaText = calc.delta > 0 ? `+${calc.delta}` : `${calc.delta}`;
        const deltaSpan = document.createElement('span');
        deltaSpan.textContent = ` (${deltaText})`;
        if (calc.delta > 0) deltaSpan.style.color = 'green';
        if (calc.delta < 0) deltaSpan.style.color = 'red';
        cell.textContent = `${calc.newDwz}`;
        cell.appendChild(deltaSpan);
      }

      if (calc) {
        cell.title = `Erwartete Punkte: ${calc.expectedSum.toFixed(2)} · Erzielte Punkte: ${calc.scoreSum.toFixed(2)}`;
      }

      row.insertBefore(cell, row.children[dwzColumnIndex + 1] || null);
    });

    calculations.forEach((calc) => {
      if (!calc) return;
      const ratingForExpectation = calc.currentDwz != null ? calc.currentDwz : calc.newDwz;
      calc.gameDetails.forEach((detail) => {
        const expected = calculateExpectedScore(ratingForExpectation, detail.oppDwz).toFixed(2);
        const baseTitle = stripExpectedSuffix(detail.cell.getAttribute('title') || '');
        const combined = `${baseTitle} · Erwartet ${expected}`.trim();
        detail.cell.setAttribute('title', combined);
      });
    });
  }

  function renderToggle(heading, entries, table) {
    if (!heading || heading.querySelector('.dsj-rating-toggle')) return;

    const wrapper = document.createElement('span');
    wrapper.className = 'dsj-rating-toggle';
    wrapper.style.marginLeft = '0.75em';
    wrapper.style.fontSize = '0.9em';
    wrapper.style.fontWeight = 'normal';
    wrapper.style.whiteSpace = 'nowrap';

    const links = [
      { key: 'none', label: 'none' },
      { key: 'dwz', label: 'DWZ' },
      { key: 'elo', label: 'ELO' }
    ];

    let activeMode = 'none';
    const anchors = new Map();
    let newDwzEnabled = false;

    function refreshActiveLink() {
      for (const [key, anchor] of anchors) {
        anchor.style.fontWeight = key === activeMode ? 'bold' : 'normal';
        anchor.style.textDecoration = key === activeMode ? 'none' : '';
      }
    }

    links.forEach((item, index) => {
      const link = document.createElement('a');
      link.href = '#';
      link.textContent = item.label;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        activeMode = item.key;
        applyMode(entries, activeMode);
        refreshActiveLink();
      });
      anchors.set(item.key, link);
      wrapper.appendChild(link);

      if (index < links.length - 1) {
        wrapper.appendChild(document.createTextNode(' | '));
      }
    });

    const newDwzWrapper = document.createElement('span');
    newDwzWrapper.style.marginLeft = '0.75em';
    const newDwzLink = document.createElement('a');
    newDwzLink.href = '#';
    newDwzLink.textContent = 'new DWZ';
    newDwzLink.style.fontWeight = 'normal';
    newDwzLink.addEventListener('click', (event) => {
      event.preventDefault();
      newDwzEnabled = !newDwzEnabled;
      if (newDwzEnabled) {
        renderNewDwzColumn(table);
      } else {
        removeNewDwzColumn(table);
      }
      newDwzLink.style.fontWeight = newDwzEnabled ? 'bold' : 'normal';
    });
    newDwzWrapper.appendChild(newDwzLink);

    heading.appendChild(wrapper);
    heading.appendChild(newDwzWrapper);
    refreshActiveLink();
  }

  function run() {
    const resultsContainers = Array.from(document.querySelectorAll('div.results'));
    if (resultsContainers.length === 0) {
      console.info(`${LOG_PREFIX} No results table found on this page.`);
      return;
    }

    let hasTable = false;
    for (const container of resultsContainers) {
      const table = container.querySelector('table');
      if (!table) continue;
      hasTable = true;

      const entries = collectEntries(table);
      const heading = container.previousElementSibling?.matches('h3')
        ? container.previousElementSibling
        : null;
      renderToggle(heading, entries, table);
      applyMode(entries, 'none');
    }

    if (!hasTable) {
      console.info(`${LOG_PREFIX} No results table found on this page.`);
    }
  }

  run();
})();
