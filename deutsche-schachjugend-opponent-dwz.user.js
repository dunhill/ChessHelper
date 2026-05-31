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
  const PLAYER_LIST_NEW_DWZ_HEADER_CLASS = 'dsj-player-new-dwz-header';
  const PLAYER_LIST_NEW_DWZ_CELL_CLASS = 'dsj-player-new-dwz-cell';
  const PLAYER_LIST_OLD_DWZ_HEADER_CLASS = 'dsj-player-old-dwz-header';
  const PLAYER_LIST_OLD_DWZ_CELL_CLASS = 'dsj-player-old-dwz-cell';
  const PLAYER_LIST_NEW_HEADER_CLASS = 'dsj-player-new-header';
  const PLAYER_LIST_NEW_CELL_CLASS = 'dsj-player-new-cell';
  const PLAYER_LIST_DIFF_HEADER_CLASS = 'dsj-player-diff-header';
  const PLAYER_LIST_DIFF_CELL_CLASS = 'dsj-player-diff-cell';
  const PLAYER_LIST_LEISTUNG_HEADER_CLASS = 'dsj-player-leistung-header';
  const PLAYER_LIST_LEISTUNG_CELL_CLASS = 'dsj-player-leistung-cell';
  const HISTORY_NEW_DWZ_ROW_CLASS = 'dsj-history-new-dwz-row';
  const HISTORY_LEISTUNG_ROW_CLASS = 'dsj-history-leistung-row';

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

  function findPlayerColumnIndex(table) {
    const headerCells = Array.from(table.querySelectorAll('thead tr th'));
    return headerCells.findIndex((th) => {
      const text = (th.textContent || '').toLowerCase().trim();
      return th.classList.contains('person') || text === 'spieler' || text === 'spieler*' || text.includes('spieler');
    });
  }

  async function fetchPlayerPageCalculations(playerHref) {
    try {
      const response = await fetch(playerHref);
      if (!response.ok) {
        console.warn(`${LOG_PREFIX} Failed to fetch player page`, { playerHref, status: response.status });
        return null;
      }

      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const playerDwz = extractPlayerDwzFromCard(doc);
      const birthYear = extractPlayerBirthYear(doc);
      const playerName = extractPlayerName(doc);
      const table = doc.querySelector('div.results table.spieler') || doc.querySelector('div.results table');


      if (!playerName || !table) {
        return null;
      }

      const games = collectIndividualTournamentGames(table, playerName);
      
      const opponentRatings = [];
      const opponentResults = [];

      for (const game of games) {
        if (game.opponentDwz != null && game.resultValue != null) {
          opponentRatings.push(game.opponentDwz);
          opponentResults.push(game.resultValue);
        }
      }


      let calc;
      if (playerDwz == null) {
        calc = calculateInitialDwz(opponentRatings, opponentResults);
      } else {
        calc = calculateNewDWZ(playerDwz, opponentRatings, opponentResults, birthYear, 1);
      }

      const performance = calculatePerformance(opponentRatings, opponentResults, playerDwz);

      const result = {
        playerHref,
        playerName,
        playerDwz,
        birthYear,
        calc,
        performance,
        opponentRatings,
        opponentResults
      };
      return result;
    } catch (error) {
      console.error(`${LOG_PREFIX} Error fetching player page`, { playerHref, error, stack: error.stack });
      return null;
    }
  }

  function removePlayerListCalculations(table) {
    table.querySelectorAll(
      `.${PLAYER_LIST_OLD_DWZ_HEADER_CLASS}, .${PLAYER_LIST_NEW_HEADER_CLASS}, .${PLAYER_LIST_DIFF_HEADER_CLASS}, .${PLAYER_LIST_LEISTUNG_HEADER_CLASS}`
    ).forEach((el) => el.remove());
    table.querySelectorAll(
      `.${PLAYER_LIST_OLD_DWZ_CELL_CLASS}, .${PLAYER_LIST_NEW_CELL_CLASS}, .${PLAYER_LIST_DIFF_CELL_CLASS}, .${PLAYER_LIST_LEISTUNG_CELL_CLASS}`
    ).forEach((el) => el.remove());
  }

  async function renderPlayerListCalculations(table) {
    removePlayerListCalculations(table);

    const headerRow = table.querySelector('thead tr');
    const playerIndex = findPlayerColumnIndex(table);
    const dwzColumnIndex = findDwzColumnIndex(table);
    if (playerIndex < 0 || !headerRow) {
      return;
    }

    const createHeader = (text, className) => {
      const th = document.createElement('th');
      th.className = className;
      th.textContent = text;
      return th;
    };

    headerRow.insertBefore(createHeader('DWZ', PLAYER_LIST_OLD_DWZ_HEADER_CLASS), headerRow.children[playerIndex + 1] || null);
    headerRow.insertBefore(createHeader('New', PLAYER_LIST_NEW_HEADER_CLASS), headerRow.children[playerIndex + 2] || null);
    headerRow.insertBefore(createHeader('Diff', PLAYER_LIST_DIFF_HEADER_CLASS), headerRow.children[playerIndex + 3] || null);
    headerRow.insertBefore(createHeader('Leistung', PLAYER_LIST_LEISTUNG_HEADER_CLASS), headerRow.children[playerIndex + 4] || null);

    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const placeholders = [];

    const currentDwzValues = rows.map((row) => {
      const cells = Array.from(row.querySelectorAll('td'));
      return dwzColumnIndex >= 0 ? parseCurrentDwz(cells[dwzColumnIndex]?.textContent || '') : null;
    });

    rows.forEach((row, rowIndex) => {
      const oldDwzCell = document.createElement('td');
      oldDwzCell.className = PLAYER_LIST_OLD_DWZ_CELL_CLASS;
      oldDwzCell.textContent = currentDwzValues[rowIndex] != null ? `${currentDwzValues[rowIndex]}` : '';
      row.insertBefore(oldDwzCell, row.children[playerIndex + 1] || null);

      const newDwzCell = document.createElement('td');
      newDwzCell.className = PLAYER_LIST_NEW_CELL_CLASS;
      newDwzCell.textContent = '...';
      row.insertBefore(newDwzCell, row.children[playerIndex + 2] || null);

      const diffCell = document.createElement('td');
      diffCell.className = PLAYER_LIST_DIFF_CELL_CLASS;
      diffCell.textContent = '...';
      row.insertBefore(diffCell, row.children[playerIndex + 3] || null);

      const leistungCell = document.createElement('td');
      leistungCell.className = PLAYER_LIST_LEISTUNG_CELL_CLASS;
      leistungCell.textContent = '...';
      row.insertBefore(leistungCell, row.children[playerIndex + 4] || null);

      placeholders.push({ oldDwzCell, newDwzCell, diffCell, leistungCell, currentDwz: currentDwzValues[rowIndex] });
    });

    const playerLinks = rows.map((row) => {
      const anchor = row.querySelector('td.person a');
      return anchor ? new URL(anchor.getAttribute('href'), window.location.href).toString() : null;
    });

    try {
      const results = await Promise.all(playerLinks.map((href) => (href ? fetchPlayerPageCalculations(href) : Promise.resolve(null))));
      results.forEach((result, index) => {
        const placeholder = placeholders[index];
        if (!placeholder) return;
        const currentDwzText = result?.playerDwz != null
          ? `${result.playerDwz}`
          : placeholder.currentDwz != null
            ? `${placeholder.currentDwz}`
            : '';

        if (!result || !result.calc) {
          placeholder.oldDwzCell.textContent = currentDwzText;
          placeholder.newDwzCell.textContent = '';
          placeholder.diffCell.textContent = '';
          placeholder.leistungCell.textContent = '';
          return;
        }

        placeholder.oldDwzCell.textContent = currentDwzText;

        placeholder.newDwzCell.textContent = `${result.calc.newDwz}`;
        placeholder.newDwzCell.title = result.playerDwz == null
          ? `Erste DWZ geschätzt: ${result.calc.newDwz}`
          : `Neue DWZ: ${result.calc.newDwz}`;

        let diffText = '';
        let diffColor = 'black';
        if (result.playerDwz == null) {
          diffText = 'neu';
        } else {
          const delta = result.calc.newDwz - result.playerDwz;
          diffText = `${delta >= 0 ? '+' : ''}${delta}`;
          diffColor = delta > 0 ? 'green' : delta < 0 ? 'red' : 'black';
          placeholder.diffCell.title = `Δ ${diffText}`;
        }
        placeholder.diffCell.textContent = diffText;
        placeholder.diffCell.style.color = diffColor;

        placeholder.leistungCell.textContent = result.performance != null ? result.performance : '';
        if (result.performance != null) {
          placeholder.leistungCell.title = `Leistung: ${result.performance}`;
        }
      });
    } catch (error) {
      console.error(`${LOG_PREFIX} Error rendering player list calculations`, { error });
    }
  }

  function renderPlayerListToggle(table) {
    const h1 = document.querySelector('main.text h1') || document.querySelector('#content h1') || document.querySelector('h1');
    if (!h1) return;
    if (h1.parentNode.querySelector('.dsj-playerlist-toggle')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'dsj-playerlist-toggle';
    wrapper.style.margin = '0.5em 0';
    wrapper.style.fontSize = '0.9em';
    wrapper.style.fontWeight = 'normal';

    const link = document.createElement('a');
    link.href = '#';
    link.textContent = 'new DWZ + Leistung';
    link.style.fontWeight = 'normal';

    let enabled = false;
    link.addEventListener('click', async (event) => {
      event.preventDefault();
      enabled = !enabled;
      if (enabled) {
        link.textContent = 'new DWZ + Leistung (loading...)';
        await renderPlayerListCalculations(table);
        link.textContent = 'new DWZ + Leistung';
        link.style.fontWeight = 'bold';
      } else {
        removePlayerListCalculations(table);
        link.style.fontWeight = 'normal';
      }
    });

    wrapper.appendChild(link);
    h1.insertAdjacentElement('afterend', wrapper);
  }

  async function renderStateListCalculations(table) {
    removePlayerListCalculations(table);

    const rows = Array.from(table.querySelectorAll('tr'));
    const headerRows = rows.filter((row) => row.querySelectorAll('th').length >= 4);
    const dataRows = rows.filter((row) => {
      const cell = row.children[3];
      return cell && cell.querySelector('a[href*="/spieler/"]');
    });

    const createCell = (isHeader, className, text) => {
      const cell = document.createElement(isHeader ? 'th' : 'td');
      cell.className = className;
      cell.textContent = text;
      return cell;
    };

    const insertAfterFourth = (row, cell) => {
      row.insertBefore(cell, row.children[4] || null);
    };

    headerRows.forEach((row) => {
      insertAfterFourth(row, createCell(true, PLAYER_LIST_LEISTUNG_HEADER_CLASS, 'Leistung'));
      insertAfterFourth(row, createCell(true, PLAYER_LIST_DIFF_HEADER_CLASS, 'Diff'));
      insertAfterFourth(row, createCell(true, PLAYER_LIST_NEW_HEADER_CLASS, 'New'));
      insertAfterFourth(row, createCell(true, PLAYER_LIST_OLD_DWZ_HEADER_CLASS, 'DWZ'));
    });

    const placeholders = dataRows.map((row) => {
      const leistungCell = createCell(false, PLAYER_LIST_LEISTUNG_CELL_CLASS, '...');
      const diffCell = createCell(false, PLAYER_LIST_DIFF_CELL_CLASS, '...');
      const newCell = createCell(false, PLAYER_LIST_NEW_CELL_CLASS, '...');
      const oldDwzCell = createCell(false, PLAYER_LIST_OLD_DWZ_CELL_CLASS, '');
      insertAfterFourth(row, leistungCell);
      insertAfterFourth(row, diffCell);
      insertAfterFourth(row, newCell);
      insertAfterFourth(row, oldDwzCell);
      return { oldDwzCell, newCell, diffCell, leistungCell };
    });

    const playerLinks = dataRows.map((row) => {
      const anchor = row.children[3].querySelector('a[href*="/spieler/"]');
      return anchor ? new URL(anchor.getAttribute('href'), window.location.href).toString() : null;
    });

    try {
      const results = await Promise.all(playerLinks.map((href) => (href ? fetchPlayerPageCalculations(href) : Promise.resolve(null))));
      results.forEach((result, index) => {
        const placeholder = placeholders[index];
        if (!placeholder) return;

        if (!result || !result.calc) {
          placeholder.oldDwzCell.textContent = result?.playerDwz != null ? `${result.playerDwz}` : '';
          placeholder.newCell.textContent = '';
          placeholder.diffCell.textContent = '';
          placeholder.leistungCell.textContent = '';
          return;
        }

        placeholder.oldDwzCell.textContent = result.playerDwz != null ? `${result.playerDwz}` : '';
        placeholder.newCell.textContent = `${result.calc.newDwz}`;
        placeholder.newCell.title = result.playerDwz == null
          ? `Erste DWZ geschätzt: ${result.calc.newDwz}`
          : `Neue DWZ: ${result.calc.newDwz}`;

        let diffText = '';
        let diffColor = 'black';
        if (result.playerDwz == null) {
          diffText = 'neu';
        } else {
          const delta = result.calc.newDwz - result.playerDwz;
          diffText = `${delta >= 0 ? '+' : ''}${delta}`;
          diffColor = delta > 0 ? 'green' : delta < 0 ? 'red' : 'black';
          placeholder.diffCell.title = `Δ ${diffText}`;
        }
        placeholder.diffCell.textContent = diffText;
        placeholder.diffCell.style.color = diffColor;

        placeholder.leistungCell.textContent = result.performance != null ? result.performance : '';
        if (result.performance != null) {
          placeholder.leistungCell.title = `Leistung: ${result.performance}`;
        }
      });
    } catch (error) {
      console.error(`${LOG_PREFIX} Error rendering state list calculations`, { error });
    }
  }

  function renderStateListToggle(table) {
    const h1 = document.querySelector('main.text h1') || document.querySelector('#content h1') || document.querySelector('h1');
    if (!h1) return;
    if (h1.parentNode.querySelector('.dsj-playerlist-toggle')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'dsj-playerlist-toggle';
    wrapper.style.margin = '0.5em 0';
    wrapper.style.fontSize = '0.9em';
    wrapper.style.fontWeight = 'normal';

    const link = document.createElement('a');
    link.href = '#';
    link.textContent = 'new DWZ + Leistung';
    link.style.fontWeight = 'normal';

    let enabled = false;
    link.addEventListener('click', async (event) => {
      event.preventDefault();
      enabled = !enabled;
      if (enabled) {
        link.textContent = 'new DWZ + Leistung (loading...)';
        await renderStateListCalculations(table);
        link.textContent = 'new DWZ + Leistung';
        link.style.fontWeight = 'bold';
      } else {
        removePlayerListCalculations(table);
        link.style.fontWeight = 'normal';
      }
    });

    wrapper.appendChild(link);
    h1.insertAdjacentElement('afterend', wrapper);
  }

  function isStatePage() {
    return window.location.href.includes('/dem/lv/') || document.querySelector('table.lv') !== null;
  }

  function isTablePage() {
    return window.location.href.includes('/tabelle/') || document.querySelector('div.results table td.person a') !== null;
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

  function isIndividualTournamentPage() {
    const url = window.location.href;
    return (url.includes('dem') || url.includes('odjm')) && url.includes('spieler');
  }

  function extractPlayerDwzFromCard(root = document) {
    const playercard = root.querySelector('div.playercard table');
    if (!playercard) return null;

    const rows = Array.from(playercard.querySelectorAll('tr'));
    for (const row of rows) {
      const th = row.querySelector('th');
      const td = row.querySelector('td');
      if (!th || !td) continue;

      const label = th.textContent.trim();
      if (label === 'Wertung:') {
        const text = td.textContent;
        const match = text.match(/DWZ:\s*(\d+)/);
        return match ? Number(match[1]) : null;
      }
    }
    return null;
  }

  function extractPlayerBirthYear(root = document) {
    const playercard = root.querySelector('div.playercard table');
    if (!playercard) return null;

    const rows = Array.from(playercard.querySelectorAll('tr'));
    for (const row of rows) {
      const th = row.querySelector('th');
      const td = row.querySelector('td');
      if (!th || !td) continue;

      const label = th.textContent.trim();
      if (label === 'Jahrgang:') {
        const year = parseInt(td.textContent.trim());
        return Number.isFinite(year) ? year : null;
      }
    }
    return null;
  }

  function extractPlayerName(root = document) {
    // Prefer breadcrumb strong (reliable on example pages)
    const crumb = root.querySelector('#breadcrumbs strong');
    if (crumb && crumb.textContent.trim()) return crumb.textContent.trim();

    const h1 = root.querySelector('h1');
    if (!h1) return null;

    // Prefer a text node that looks like a personal name (two words)
    for (const node of h1.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent.trim();
        if (t && /[A-Za-zÄÖÜäöüß]+\s+[A-Za-zÄÖÜäöüß]+/.test(t)) return t;
      }
    }

    // If no clear name, remove known event link text (like 'DEM') from h1
    const anchor = h1.querySelector('a');
    let full = h1.textContent.trim();
    if (anchor) {
      const anchorText = anchor.textContent || '';
      full = full.replace(anchorText, '');
    }
    // Remove epilog such as 'in City'
    const em = h1.querySelector('em');
    if (em) {
      full = full.replace(em.textContent, '');
    }

    // Take the first non-empty line/segment
    const parts = full.split(/\n|<br>|\r/).map(s => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      // Prefer the longest segment (likely the name)
      parts.sort((a,b) => b.length - a.length);
      return parts[0];
    }

    return full || null;
  }

  function collectIndividualTournamentGames(table, playerName) {
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const games = [];

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 7) continue;

      // Columns: 0=Runde, 1=Brett, 2=DWZ(white), 3=Weiß, 4=Ergebnis, 5=Schwarz, 6=DWZ(black)
      const whiteCell = cells[3];
      const blackCell = cells[5];
      const resultCell = cells[4];
      const whiteDwzCell = cells[2];
      const blackDwzCell = cells[6];

      const whiteName = normalizeName(whiteCell.textContent);
      const blackName = normalizeName(blackCell.textContent);

      // Determine if player is white or black
      const isPlayerWhite = canonicalizeName(whiteName) === canonicalizeName(playerName);
      const isPlayerBlack = canonicalizeName(blackName) === canonicalizeName(playerName);


      if (!isPlayerWhite && !isPlayerBlack) continue;

      // Extract opponent DWZ
      const opponentDwzText = isPlayerWhite ? blackDwzCell.textContent : whiteDwzCell.textContent;
      const opponentDwz = parseCurrentDwz(opponentDwzText);

      // Parse result
      const resultLink = resultCell.querySelector('a');
      const resultText = (resultLink ? resultLink.textContent : resultCell.textContent).trim();
      let resultValue;

      if (resultText === 'LIVE' || resultText === '?') {
        resultValue = null; // Pending game
      } else {
        const resultMatch = resultText.match(/([½\d+-]+)\s*:\s*([½\d+-]+)/);
        if (resultMatch) {
          const homePoints = parseResultValue(resultMatch[1]);
          const awayPoints = parseResultValue(resultMatch[2]);
          resultValue = isPlayerWhite ? homePoints : awayPoints;
        }
      }

      games.push({
        row,
        opponentDwz,
        resultValue,
        isPlayerWhite
      });
    }

    return games;
  }

  function normalizeName(name) {
    return (name || '').replace(/\s+/g, ' ').trim();
  }

  function canonicalizeName(name) {
    return normalizeName(name)
      .normalize('NFKC')
      .replace(/\([^)]*\)/g, '')
      .replace(/[‐‑‒–—―]/g, '-')
      .toLowerCase()
      .trim();
  }

  function renderIndividualTournamentToggle(container, table, playerDwz, birthYear, playerName) {
    // Place toggle as a new line after the player name header, not the banner header
    const h1 = document.querySelector('main.text h1') || document.querySelector('#content h1') || document.querySelector('h1');
    if (!h1) {
      console.warn(`${LOG_PREFIX} No <h1> found; cannot place toggle`);
      return;
    }
    // Avoid duplicate
    if (h1.parentNode.querySelector('.dsj-individual-toggle')) {
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'dsj-individual-toggle';
    wrapper.style.margin = '0.5em 0';
    wrapper.style.fontSize = '0.9em';
    wrapper.style.fontWeight = 'normal';

    const link = document.createElement('a');
    link.href = '#';
    link.textContent = 'new DWZ + Leistung';
    link.style.fontWeight = 'normal';
    link.addEventListener('click', async (event) => {
      event.preventDefault();
      const isEnabled = link.style.fontWeight === 'bold';
      if (isEnabled) {
        removeIndividualTournamentCalculations(table);
        const historyTable = findHistoryTable();
        if (historyTable) {
          removeHistoryCalculations(historyTable);
        }
        link.style.fontWeight = 'normal';
      } else {
        renderIndividualTournamentCalculations(table, playerDwz, birthYear, playerName);
        const historyTable = findHistoryTable();
        if (historyTable) {
          await renderHistoryCalculations(historyTable);
        } else {
        }
        link.style.fontWeight = 'bold';
      }
    });

    wrapper.appendChild(link);
    h1.insertAdjacentElement('afterend', wrapper);
  }

  function renderIndividualTournamentCalculations(table, playerDwz, birthYear, playerName) {
    removeIndividualTournamentCalculations(table);

    const games = collectIndividualTournamentGames(table, playerName);
    const opponentRatings = [];
    const opponentResults = [];
    const gameDetails = [];

    for (const game of games) {
      if (game.opponentDwz != null && game.resultValue != null) {
        opponentRatings.push(game.opponentDwz);
        opponentResults.push(game.resultValue);
        gameDetails.push(game);
      } else {
      }
    }

    // Calculate new DWZ
    let calc;
    if (playerDwz == null) {
      calc = calculateInitialDwz(opponentRatings, opponentResults);
    } else {
      calc = calculateNewDWZ(playerDwz, opponentRatings, opponentResults, birthYear, 1);
    }

    // Calculate performance
    const performance = calculatePerformance(opponentRatings, opponentResults, playerDwz);

    // Insert new row under playercard 'Wertung:' with new DWZ and Leistung
    const playercard = document.querySelector('div.playercard table');
    if (playercard) {
      const rows = Array.from(playercard.querySelectorAll('tr'));
      let wertungRow = null;
      for (const row of rows) {
        const th = row.querySelector('th');
        if (th && th.textContent.trim() === 'Wertung:') {
          wertungRow = row;
          break;
        }
      }

      if (wertungRow) {
        const newRow = document.createElement('tr');
        newRow.className = 'dsj-new-wertung-row';
        const th = document.createElement('th');
        th.textContent = 'New:';
        const td = document.createElement('td');

        if (calc) {
          if (playerDwz == null) {
            td.textContent = `DWZ: ${calc.newDwz} (neu)`;
          } else {
            const delta = calc.newDwz - playerDwz;
            const deltaText = delta > 0 ? `+${delta}` : `${delta}`;
            td.innerHTML = `DWZ: ${calc.newDwz} <span style="color:${delta > 0 ? 'green' : (delta < 0 ? 'red' : 'black')}">(${deltaText})</span>`;
          }
        }
        if (performance != null) {
          td.innerHTML += `, Leistung: ${performance}`;
        }
        if (calc) {
          const parts = [];
          parts.push(`Erwartet: ${calc.expectedSum.toFixed(2)}`);
          parts.push(`Erzielt: ${calc.scoreSum.toFixed(2)}`);
          td.innerHTML += `<br>${parts.join(', ')}`;
        }



        newRow.appendChild(th);
        newRow.appendChild(td);
        wertungRow.parentNode.insertBefore(newRow, wertungRow.nextSibling);
      }
    }

    // Add expected scores inline in Ergebnis column next to visible result
    const ratingForExpectation = playerDwz != null ? playerDwz : (calc ? calc.newDwz : null);
    if (ratingForExpectation) {
      games.forEach(game => {
        if (game.opponentDwz != null && game.resultValue != null) {
          const expected = calculateExpectedScore(ratingForExpectation, game.opponentDwz).toFixed(2);
          const resultCell = game.row.querySelector('td.tm');
          if (resultCell) {
            // Append a small span with expected points (remove existing if any)
            const existing = resultCell.querySelector('.dsj-expected');
            if (existing) existing.remove();
            const span = document.createElement('span');
            span.className = 'dsj-expected';
            span.style.marginLeft = '0.3em';
            span.style.fontSize = '0.85em';
            span.style.color = '#666';
            span.textContent = `(${expected})`;
            resultCell.appendChild(span);

            // Also set title on link if present
            const link = resultCell.querySelector('a');
            if (link) {
              const currentTitle = link.getAttribute('title') || '';
              link.setAttribute('title', `${currentTitle} · Erwartet ${expected}`.trim());
            }
          }
        }
      });
    }
  }

  function removeIndividualTournamentCalculations(table) {
    // Remove inserted New Wertung row
    const card = document.querySelector('div.playercard table');
    if (card) {
      const newRow = card.querySelector('tr.dsj-new-wertung-row');
      if (newRow) {
        newRow.remove();
      }
    }

    // Remove expected spans from Ergebnis column
    const expectedSpans = table.querySelectorAll('.dsj-expected');
    if (expectedSpans.length) {
      expectedSpans.forEach(s => s.remove());
    }

    // Remove expected text from game link titles
    const resultLinks = table.querySelectorAll('td.tm a');
    let titlesStripped = 0;
    resultLinks.forEach(link => {
      const title = link.getAttribute('title');
      if (title) {
        const stripped = title.replace(/\s*·\s*Erwartet\s*[0-9]+(?:[.,][0-9]+)?\s*$/i, '').trim();
        if (stripped !== title) {
          link.setAttribute('title', stripped);
          titlesStripped += 1;
        }
      }
    });
  }

  function findHistoryTable() {
    const table = document.querySelector('table.dsj-history-table');
    if (table && table.tagName === 'TABLE') {
      return table;
    }
    return null;
  }

  function extractHistoryYearLinks(historyTable) {
    const headerRow = historyTable.querySelector('tr');
    if (!headerRow) return [];
    const headerCells = Array.from(headerRow.querySelectorAll('th'));
    const yearLinks = [];
    for (let i = 1; i < headerCells.length; i++) {
      const link = headerCells[i].querySelector('a');
      if (link && link.href) {
        const url = new URL(link.href, window.location.href).toString();
        yearLinks.push({
          year: headerCells[i].textContent.trim(),
          href: url,
          columnIndex: i
        });
      }
    }
    return yearLinks;
  }

  function removeHistoryCalculations(historyTable) {
    const rowsRemoved = historyTable.querySelectorAll(`.${HISTORY_NEW_DWZ_ROW_CLASS}, .${HISTORY_LEISTUNG_ROW_CLASS}`).length;
    historyTable.querySelectorAll(`.${HISTORY_NEW_DWZ_ROW_CLASS}, .${HISTORY_LEISTUNG_ROW_CLASS}`).forEach((el) => el.remove());
  }

  async function renderHistoryCalculations(historyTable) {
    removeHistoryCalculations(historyTable);

    const yearLinks = extractHistoryYearLinks(historyTable);
    if (yearLinks.length === 0) {
      return;
    }

    const headerRow = historyTable.querySelector('tr');
    const allRows = Array.from(historyTable.querySelectorAll('tr'));
    const dataRows = allRows.slice(1);

    try {
      const results = await Promise.all(yearLinks.map((yl) => {
        return fetchPlayerPageCalculations(yl.href);
      }));
      
      results.forEach((result, idx) => {
        if (result) {
        } else {
        }
      });

      const newDwzRow = document.createElement('tr');
      newDwzRow.className = HISTORY_NEW_DWZ_ROW_CLASS;
      const newDwzLabel = document.createElement('td');
      newDwzLabel.style.fontWeight = 'bold';
      newDwzLabel.style.border = '1px solid rgb(204, 204, 204)';
      newDwzLabel.style.padding = '8px';
      newDwzLabel.style.textAlign = 'left';
      newDwzLabel.textContent = 'New DWZ';
      newDwzRow.appendChild(newDwzLabel);

      const leistungRow = document.createElement('tr');
      leistungRow.className = HISTORY_LEISTUNG_ROW_CLASS;
      const leistungLabel = document.createElement('td');
      leistungLabel.style.fontWeight = 'bold';
      leistungLabel.style.border = '1px solid rgb(204, 204, 204)';
      leistungLabel.style.padding = '8px';
      leistungLabel.style.textAlign = 'left';
      leistungLabel.textContent = 'Leistung';
      leistungRow.appendChild(leistungLabel);

      results.forEach((result, idx) => {
        const newDwzCell = document.createElement('td');
        newDwzCell.style.border = '1px solid rgb(204, 204, 204)';
        newDwzCell.style.padding = '8px';
        newDwzCell.style.textAlign = 'center';
        const leistungCell = document.createElement('td');
        leistungCell.style.border = '1px solid rgb(204, 204, 204)';
        leistungCell.style.padding = '8px';
        leistungCell.style.textAlign = 'center';

        if (result && result.calc) {
          newDwzCell.textContent = `${result.calc.newDwz}`;
          if (result.playerDwz != null) {
            const delta = result.calc.newDwz - result.playerDwz;
            const deltaText = delta >= 0 ? `+${delta}` : `${delta}`;
            const deltaColor = delta > 0 ? 'green' : delta < 0 ? 'red' : 'black';
            newDwzCell.innerHTML = `${result.calc.newDwz} <span style="color: ${deltaColor};">(${deltaText})</span>`;
            newDwzCell.title = `Neue DWZ: ${result.calc.newDwz}`;
          } else {
            newDwzCell.textContent = `${result.calc.newDwz} (neu)`;
            newDwzCell.title = `Erste DWZ geschätzt: ${result.calc.newDwz}`;
          }

          if (result.performance != null) {
            leistungCell.textContent = `${result.performance}`;
            leistungCell.title = `Leistung: ${result.performance}`;
          } else {
          }
        } else {
        }

        newDwzRow.appendChild(newDwzCell);
        leistungRow.appendChild(leistungCell);
      });

      const lastRow = dataRows[dataRows.length - 1];
      if (lastRow) {
        lastRow.parentNode.insertBefore(newDwzRow, lastRow.nextSibling);
        lastRow.parentNode.insertBefore(leistungRow, newDwzRow.nextSibling);
      } else {
        console.warn(`${LOG_PREFIX} renderHistoryCalculations: no lastRow found, cannot insert rows`);
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} Error rendering history calculations`, { error, stack: error.stack });
    }
  }

  function run() {

    // Check if this is an individual tournament player page
    if (isIndividualTournamentPage()) {
      const container = document.querySelector('div.results');
      const table = container?.querySelector('table.spieler');
      if (!container || !table) {
        return;
      }

      const playerDwz = extractPlayerDwzFromCard();
      const birthYear = extractPlayerBirthYear();
      const playerName = extractPlayerName();

      if (!playerName) {
        return;
      }
      renderIndividualTournamentToggle(container, table, playerDwz, birthYear, playerName);
      return;
    }

    if (isStatePage()) {
      const stateTable = document.querySelector('table.lv');
      if (stateTable) {
        renderStateListToggle(stateTable);
        return;
      }
    }

    if (isTablePage()) {
      const table = document.querySelector('div.results table');
      if (table && table.querySelector('td.person a')) {
        renderPlayerListToggle(table);
        return;
      }
    }

    // Original team tournament logic
    const resultsContainers = Array.from(document.querySelectorAll('div.results'));
    if (resultsContainers.length === 0) {
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
  }

  run();
})();
