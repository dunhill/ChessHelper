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
  const LEISTUNG_HEADER_CLASS = 'dsj-leistung-header';
  const LEISTUNG_CELL_CLASS = 'dsj-leistung-cell';

  // K factor calculation constants
  const K_MAX = 80;
  const T_DIVISOR = 30; // Divisor for youth acceleration
  const U_SHIFT = 800; // Shift for braking factor
  const A1_BONUS = 4; // Success bonus for juniors
  const A2_BONUS = 4; // Success bonus for adults

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

  function calculateKFactor(currentDwz, birthYear, index, scoreSum, expectedSum) {
    // Determine age category
    const currentYear = new Date().getFullYear();
    const age = birthYear ? currentYear - birthYear : null;
    const isYouth = age !== null && age <= 25;
    const isJunior = age !== null && age >= 21 && age <= 25;
    const isAdult = age === null || age >= 26;
    const isYouthUnder20 = age !== null && age <= 20;

    // Determine K0 based on index, age, and DWZ
    let k0;
    const indexValue = index > 10 ? 11 : index;
    const indexArray = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

    if (isYouth && currentDwz < 2200) {
      // Youth/Juniors under 2200 DWZ
      const youthK0 = [60, 60, 48, 46, 44, 42, 40, 38, 36, 34, 32];
      k0 = youthK0[indexValue - 1];
    } else if (isAdult && currentDwz < 2000) {
      // Adults under 2000 DWZ
      const adultK0 = [60, 60, 44, 42, 40, 38, 36, 34, 32, 30, 28];
      k0 = adultK0[indexValue - 1];
    } else {
      // Adults >=2000 DWZ and Youth/Juniors >=2200 DWZ
      const highK0 = [60, 60, 41, 39, 37, 35, 33, 31, 29, 27, 25];
      k0 = highK0[indexValue - 1];
    }

    // Calculate Erfolgsaufschlag a
    let a = 0;
    if (scoreSum >= expectedSum) {
      if (isYouthUnder20 && currentDwz < 2000) {
        a = (2000 - currentDwz) / T_DIVISOR;
      } else if (age !== null && age >= 21 && currentDwz < 1600) {
        a = isJunior ? A1_BONUS : A2_BONUS;
      }
    }

    // Calculate Bremsfaktor b
    let b = 1;
    if (scoreSum < expectedSum && currentDwz < 1600) {
      b = (currentDwz + U_SHIFT) / (1600 + U_SHIFT);
    }

    // Calculate K
    let k = (k0 * b) + a;
    k = Math.round(k * 10) / 10; // Round to 1 decimal
    k = Math.min(k, K_MAX); // Limit by Kmax

    return k;
  }

  function calculateNewDWZ(playerDWZ, opponentRatings, opponentResults, birthYear, index) {
    const validOpponents = opponentRatings
      .map((rating, index) => ({ rating, result: opponentResults[index] }))
      .filter((entry) => entry.rating != null && entry.rating > 0 && entry.result != null);

    if (playerDWZ == null || validOpponents.length === 0) return null;

    const expectedSum = validOpponents.reduce(
      (sum, opponent) => sum + calculateExpectedScore(playerDWZ, opponent.rating),
      0
    );
    const scoreSum = validOpponents.reduce((sum, opponent) => sum + opponent.result, 0);

    // Calculate K factor based on new formula
    const k = calculateKFactor(playerDWZ, birthYear, index, scoreSum, expectedSum);

    // New formula: Rn = R0 + K * (W - We)
    const delta = (scoreSum - expectedSum) * k;
    let newDwz = Math.round(playerDWZ + delta);

    // Minimum DWZ is 1100
    if (newDwz < 1100) newDwz = 1100;

    return {
      newDwz,
      expectedSum,
      scoreSum,
      k
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

  function calculatePerformance(opponentRatings, opponentResults, currentDwz) {
    const validOpponents = opponentRatings
      .map((rating, index) => ({ rating, result: opponentResults[index] }))
      .filter((entry) => entry.rating != null && entry.rating > 0 && entry.result != null);

    // Performance only for established players with at least 5 games
    if (currentDwz == null || validOpponents.length < 5) return null;

    const scoreSum = validOpponents.reduce((sum, opponent) => sum + opponent.result, 0);

    // If result is 0%, no performance number
    if (scoreSum === 0) return null;

    // If result is 100%, add fictitious draw against opponent average
    let ratingsForCalc = validOpponents.map(op => op.rating);
    if (scoreSum === validOpponents.length) {
      const avgRating = ratingsForCalc.reduce((sum, r) => sum + r, 0) / ratingsForCalc.length;
      ratingsForCalc.push(avgRating);
    }

    // Iteration to find Rh where expected score equals actual score
    const targetScore = scoreSum / ratingsForCalc.length;
    const clampedTarget = Math.min(0.99, Math.max(0.01, targetScore));

    let low = 100;
    let high = 3000;
    for (let i = 0; i < 40; i += 1) {
      const mid = (low + high) / 2;
      const expectedAverage =
        ratingsForCalc.reduce((sum, rating) => sum + calculateExpectedScore(mid, rating), 0) /
        ratingsForCalc.length;

      if (expectedAverage < clampedTarget) {
        low = mid;
      } else {
        high = mid;
      }
    }

    const rh = Math.round((low + high) / 2);
    return rh;
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

      // Extract birth year from 4th column (Geburtsjahr) - index 3
      const birthYearCell = cells[3];
      const birthYear = birthYearCell ? parseInt(birthYearCell.textContent.trim()) : null;

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

      // Calculate performance (Leistung)
      const performance = calculatePerformance(opponentRatings, opponentResults, currentDwz);

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
          gameDetails,
          birthYear,
          performance
        });
        continue;
      }

      // Use row index + 1 as the index for K factor calculation
      const rowIndex = rows.indexOf(row) + 1;
      const updateCalc = calculateNewDWZ(currentDwz, opponentRatings, opponentResults, birthYear, rowIndex);
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
        gameDetails,
        birthYear,
        performance,
        k: updateCalc.k
      });
    }

    return calculations;
  }

  function removeNewDwzColumn(table) {
    const hasColumn = table.querySelector(`.${NEW_DWZ_HEADER_CLASS}`) !== null;
    table.querySelectorAll(`.${NEW_DWZ_HEADER_CLASS}, .${NEW_DWZ_CELL_CLASS}`).forEach((el) => el.remove());
    table.querySelectorAll(`.${LEISTUNG_HEADER_CLASS}, .${LEISTUNG_CELL_CLASS}`).forEach((el) => el.remove());

    // Decrement colspan in tfoot only if column was present (decrement by 2 for both columns)
    if (hasColumn) {
      const tfoot = table.querySelector('tfoot');
      if (tfoot) {
        const tfootRows = tfoot.querySelectorAll('tr');
        tfootRows.forEach((row) => {
          const secondTh = row.querySelector('th:nth-child(2)');
          if (secondTh) {
            const currentColspan = parseInt(secondTh.getAttribute('colspan') || 1);
            if (currentColspan > 2) {
              secondTh.setAttribute('colspan', currentColspan - 2);
            }
          }
        });
      }
    }

    // Restore original titles by stripping expected suffix
    const resultCells = table.querySelectorAll('td.results, td.ergebnis');
    resultCells.forEach(cell => {
      const title = cell.getAttribute('title');
      if (title) {
        const stripped = stripExpectedSuffix(title);
        cell.setAttribute('title', stripped);
      }
    });
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

    // Add New DWZ header
    const newHeader = document.createElement('th');
    newHeader.className = NEW_DWZ_HEADER_CLASS;
    const newHeaderAbbr = document.createElement('abbr');
    newHeaderAbbr.title = 'Nur Vermuttung und kein offizieles DWZ';
    newHeaderAbbr.textContent = 'new DWZ';
    newHeader.appendChild(newHeaderAbbr);
    headerRow.insertBefore(newHeader, headerRow.children[dwzColumnIndex + 1] || null);

    // Add Leistung header
    const leistungHeader = document.createElement('th');
    leistungHeader.className = LEISTUNG_HEADER_CLASS;
    const leistungHeaderAbbr = document.createElement('abbr');
    leistungHeaderAbbr.title = 'Turnierleistung';
    leistungHeaderAbbr.textContent = 'Leistung';
    leistungHeader.appendChild(leistungHeaderAbbr);
    headerRow.insertBefore(leistungHeader, headerRow.children[dwzColumnIndex + 2] || null);

    const rows = Array.from(table.querySelectorAll('tbody tr'));
    rows.forEach((row, idx) => {
      const calc = calculations[idx];

      // Add New DWZ cell
      const newDwzCell = document.createElement('td');
      newDwzCell.className = NEW_DWZ_CELL_CLASS;

      if (!calc) {
        newDwzCell.textContent = '';
      } else if (calc.isFirstDwz) {
        const tag = document.createElement('span');
        tag.textContent = ' (neu)';
        tag.style.color = '#555';
        newDwzCell.textContent = `${calc.newDwz}`;
        newDwzCell.appendChild(tag);
      } else {
        const deltaText = calc.delta > 0 ? `+${calc.delta}` : `${calc.delta}`;
        const deltaSpan = document.createElement('span');
        deltaSpan.textContent = ` (${deltaText})`;
        if (calc.delta > 0) deltaSpan.style.color = 'green';
        if (calc.delta < 0) deltaSpan.style.color = 'red';
        newDwzCell.textContent = `${calc.newDwz}`;
        newDwzCell.appendChild(deltaSpan);
      }

      if (calc) {
        newDwzCell.title = `Erwartete Punkte: ${calc.expectedSum.toFixed(2)} · Erzielte Punkte: ${calc.scoreSum.toFixed(2)}${calc.k !== undefined ? ` · K: ${calc.k}` : ''}`;
      }

      row.insertBefore(newDwzCell, row.children[dwzColumnIndex + 1] || null);

      // Add Leistung cell
      const leistungCell = document.createElement('td');
      leistungCell.className = LEISTUNG_CELL_CLASS;

      if (!calc || calc.performance == null) {
        leistungCell.textContent = '';
      } else {
        leistungCell.textContent = calc.performance;
      }

      row.insertBefore(leistungCell, row.children[dwzColumnIndex + 2] || null);
    });

    // Increment colspan in tfoot by 2 for both columns
    const tfoot = table.querySelector('tfoot');
    if (tfoot) {
      const tfootRows = tfoot.querySelectorAll('tr');
      tfootRows.forEach((row) => {
        const secondTh = row.querySelector('th:nth-child(2)');
        if (secondTh) {
          const currentColspan = parseInt(secondTh.getAttribute('colspan') || 1);
          secondTh.setAttribute('colspan', currentColspan + 2);
        }
      });
    }

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
    newDwzLink.textContent = 'new DWZ + Leistung';
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
