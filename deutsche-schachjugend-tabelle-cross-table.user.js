// ==UserScript==
// @name         Deutsche Schachjugend - Tabelle Cross Table Toggle
// @namespace    https://github.com/oleksiy/ChessHelper
// @version      1.0
// @description  Adds a toggle to show/hide cross-table results on DSJ tabelle pages.
// @match        *://www.deutsche-schachjugend.de/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const LOG_PREFIX = '[DSJ-CrossTable]';
  const CROSS_CLASS = 'dsj-cross-cell';

  function isTargetPage() {
    if (!window.location.href.startsWith('https://www.deutsche-schachjugend.de')) return false;
    return /\/tabelle(?:\/[^/?#]+)?\/?$/.test(window.location.pathname);
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

  function parsePoints(rawText) {
    const text = (rawText || '').trim();
    if (!text) return null;

    const normalized = text
      .replace(',', '.')
      .replace(/½/g, '.5')
      .replace(/[^0-9.]/g, '');

    if (!normalized) return null;
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }

  function extractNameFromCell(cell) {
    if (!cell) return '';
    const anchorName = normalizeName(cell.querySelector('a')?.textContent || '');
    const strongAnchorName = normalizeName(cell.querySelector('strong a')?.textContent || '');
    const strongName = normalizeName(cell.querySelector('strong')?.textContent || '');
    const rawName = normalizeName(cell.textContent || '');
    return normalizeName(strongAnchorName || anchorName || strongName || rawName);
  }

  function parsePosition(rawText) {
    const text = (rawText || '').trim();
    const match = text.match(/\d+/);
    return match ? match[0] : text;
  }

  function formatPoints(value) {
    if (value === '?') return '?';
    if (value == null) return '';
    const isHalf = Math.abs(value % 1 - 0.5) < 1e-9;
    if (isHalf) {
      const whole = Math.floor(value);
      return whole > 0 ? `${whole}½` : '½';
    }
    return String(Math.trunc(value));
  }

  function validatePoints(value, context) {
    if (value === '?') return true;
    if (value == null) {
      console.error(`${LOG_PREFIX} Missing points value`, context);
      return false;
    }
    const doubled = value * 2;
    const hasHalfPrecision = Math.abs(doubled - Math.round(doubled)) < 1e-9;
    if (value < 0 || value > 4 || !hasHalfPrecision) {
      console.error(`${LOG_PREFIX} Invalid points range/precision`, { ...context, value });
      return false;
    }
    return true;
  }

  function isEmptyResultCell(cell) {
    if (!cell) return false;
    const text = normalizeName(cell.textContent || '').replace(/\u00a0/g, '').trim();
    return text === '';
  }

  function isClassicRoundPending(resultsTable, opponentHeaderLink) {
    const headerCell = opponentHeaderLink?.closest('th');
    const headerRow = resultsTable.querySelector('thead tr');
    if (!headerCell || !headerRow) return false;

    const columnIndex = Array.from(headerRow.children).indexOf(headerCell);
    if (columnIndex < 0) return false;

    const bodyRows = Array.from(resultsTable.querySelectorAll('tbody tr'));
    for (const row of bodyRows) {
      const cell = row.children[columnIndex];
      if (!cell) continue;
      if (!cell.matches('td.ergebnis, td.results')) continue;
      if (isEmptyResultCell(cell)) {
        return true;
      }
    }
    return false;
  }

  function parseTeams(table, isDemPage) {
    const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
    const teams = [];

    for (const [rowIndex, row] of bodyRows.entries()) {
      const positionCell = row.querySelector('td.tz.tableposition');
      const nameCellLink = isDemPage
        ? row.querySelector('td.person a')
        : row.querySelector('td:nth-child(2) a');
      const position = parsePosition(positionCell?.textContent || '');
      const name = normalizeName(nameCellLink?.textContent || '');
      const href = nameCellLink ? new URL(nameCellLink.getAttribute('href'), window.location.href).toString() : null;

      if (!position || !name || !href) {
        console.error(`${LOG_PREFIX} Failed to parse team row`, { rowIndex, position, name, href });
        continue;
      }

      teams.push({ row, position, name, href });
    }

    return teams;
  }

  function extractOpponentFromHeaderTitle(titleText) {
    const text = (titleText || '').trim();
    const match = text.match(/Gegner\s+(.+)$/i);
    return match ? normalizeName(match[1]) : null;
  }

  function parseDemSidePoints(rawSidePoints) {
    const value = parsePoints(rawSidePoints);
    if (value == null) return null;
    if (value !== 0 && value !== 0.5 && value !== 1) return null;
    return value;
  }

  async function fetchClassicTeamResults(team, teamNameToIndex, matrix, resultsTable) {
    const opponentHeaders = Array.from(
      resultsTable.querySelectorAll('thead th.number a[title]')
    );
    const tfootRows = Array.from(resultsTable.querySelectorAll('tfoot tr'));
    const brettpunkteRow = tfootRows.find((row) => {
      const labelCell = row.querySelector('th:nth-child(2), td:nth-child(2)');
      const label = normalizeName(labelCell?.textContent || '').toLowerCase();
      return label === 'brettpunkte';
    }) || tfootRows[0];

    const pointsCells = brettpunkteRow
      ? Array.from(brettpunkteRow.querySelectorAll('th.number, td.number'))
      : [];

    for (let i = 0; i < opponentHeaders.length; i += 1) {
      const opponentName = extractOpponentFromHeaderTitle(opponentHeaders[i].getAttribute('title') || '');
      if (!opponentName) {
        console.error(`${LOG_PREFIX} Could not parse opponent name from header`, {
          team: team.name,
          title: opponentHeaders[i].getAttribute('title') || '',
          index: i
        });
        continue;
      }

      const opponentIndex = teamNameToIndex.get(canonicalizeName(opponentName));
      if (opponentIndex == null) {
        console.error(`${LOG_PREFIX} Opponent not found in team list`, {
          team: team.name,
          opponent: opponentName,
          url: team.href
        });
        continue;
      }

      const rawPoints = pointsCells[i]?.textContent || '';
      const isPendingRound = isClassicRoundPending(resultsTable, opponentHeaders[i]);
      if (!normalizeName(rawPoints) && isPendingRound) {
        matrix[teamNameToIndex.get(canonicalizeName(team.name))][opponentIndex] = '?';
        console.info(`${LOG_PREFIX} Round has planned/unplayed games; using '?'`, {
          team: team.name,
          opponent: opponentName,
          index: i
        });
        continue;
      }

      const pointsValue = parsePoints(rawPoints);
      const isValid = validatePoints(pointsValue, {
        team: team.name,
        opponent: opponentName,
        rawPoints,
        url: team.href
      });
      if (!isValid) continue;

      matrix[teamNameToIndex.get(canonicalizeName(team.name))][opponentIndex] = pointsValue;
    }
  }

  async function fetchDemTeamResults(team, teamNameToIndex, matrix, resultsTable) {
    const rows = Array.from(resultsTable.querySelectorAll('tbody tr'));
    if (rows.length === 0) {
      console.error(`${LOG_PREFIX} DEM table has no body rows`, { team: team.name, url: team.href });
      return;
    }

    for (const [index, row] of rows.entries()) {
      const thCell = row.querySelector('td.th');
      const taCell = row.querySelector('td.ta');
      const tmCell = row.querySelector('td.tm');
      const resultText = normalizeName(tmCell?.textContent || '');
      const resultMatch = resultText.match(/(.+?)\s*:\s*(.+)/);

      if (!thCell || !taCell || !resultMatch) {
        console.error(`${LOG_PREFIX} DEM row has invalid structure`, {
          team: team.name,
          index,
          resultText
        });
        continue;
      }

      const homeName = extractNameFromCell(thCell);
      const awayName = extractNameFromCell(taCell);
      if (!homeName || !awayName) {
        console.error(`${LOG_PREFIX} DEM row team names could not be parsed`, {
          team: team.name,
          index,
          homeName,
          awayName
        });
        continue;
      }

      const homePoints = parseDemSidePoints(resultMatch[1]);
      const awayPoints = parseDemSidePoints(resultMatch[2]);

      if (homePoints == null || awayPoints == null) {
        console.error(`${LOG_PREFIX} DEM result points are invalid`, {
          team: team.name,
          resultText,
          index
        });
        continue;
      }

      const currentTeamCanonical = canonicalizeName(team.name);
      const homeCanonical = canonicalizeName(homeName);
      const awayCanonical = canonicalizeName(awayName);
      const teamIsHome = homeCanonical === currentTeamCanonical;
      const teamIsAway = awayCanonical === currentTeamCanonical;
      if (!teamIsHome && !teamIsAway) {
        console.error(`${LOG_PREFIX} Current team not found in DEM row`, {
          team: team.name,
          homeName,
          awayName,
          index
        });
        continue;
      }

      const opponentName = teamIsHome ? awayName : homeName;
      const opponentIndex = teamNameToIndex.get(canonicalizeName(opponentName));
      if (opponentIndex == null) {
        console.error(`${LOG_PREFIX} Opponent not found in team list`, {
          team: team.name,
          opponent: opponentName,
          url: team.href
        });
        continue;
      }

      const pointsValue = teamIsHome ? homePoints : awayPoints;
      const isValid = validatePoints(pointsValue, {
        team: team.name,
        opponent: opponentName,
        rawPoints: resultText,
        url: team.href
      });
      if (!isValid) continue;

      matrix[teamNameToIndex.get(currentTeamCanonical)][opponentIndex] = pointsValue;
    }
  }

  async function fetchTeamResults(team, teamNameToIndex, matrix, isDemPage) {
    try {
      console.info(`${LOG_PREFIX} Fetching team page`, { team: team.name, url: team.href, mode: isDemPage ? 'dem' : 'classic' });
      const response = await fetch(team.href, { credentials: 'same-origin' });
      if (!response.ok) {
        console.error(`${LOG_PREFIX} Failed to fetch team page`, { team: team.name, url: team.href, status: response.status });
        return;
      }

      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const resultsTable = isDemPage
        ? doc.querySelector('div.results table.spieler')
        : doc.querySelector('div.results table');
      if (!resultsTable) {
        console.error(`${LOG_PREFIX} Team page has no expected results table`, {
          team: team.name,
          url: team.href,
          expected: isDemPage ? 'div.results table.spieler' : 'div.results table'
        });
        return;
      }

      if (isDemPage) {
        await fetchDemTeamResults(team, teamNameToIndex, matrix, resultsTable);
      } else {
        await fetchClassicTeamResults(team, teamNameToIndex, matrix, resultsTable);
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} Unexpected error while fetching team results`, {
        team: team.name,
        url: team.href,
        error
      });
    }
  }

  function applyVisibility(table, visible) {
    const cells = table.querySelectorAll(`.${CROSS_CLASS}`);
    cells.forEach((cell) => {
      cell.style.display = visible ? '' : 'none';
    });
  }

  function renderCrossTable(table, teams, matrix) {
    const headerRow = table.querySelector('thead tr');
    const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
    if (!headerRow) {
      console.error(`${LOG_PREFIX} Missing header row on tabelle page.`);
      return;
    }

    const originalHeaderCount = headerRow.children.length;
    const lastOriginalHeaderCell = headerRow.children[originalHeaderCount - 1];
    if (lastOriginalHeaderCell) {
      lastOriginalHeaderCell.classList.add('bxv');
    }
    bodyRows.forEach((row) => {
      const lastOriginalBodyCell = row.children[originalHeaderCount - 1];
      if (lastOriginalBodyCell) {
        lastOriginalBodyCell.classList.add('bxv');
      }
    });

    const separatorSample = table.querySelector('th.tsum, td.tsum');
    const separatorBorderLeft = separatorSample
      ? getComputedStyle(separatorSample).borderLeft
      : '';
    const crossColumnWidth = '3ch';

    for (let colIndex = 0; colIndex < teams.length; colIndex += 1) {
      const team = teams[colIndex];
      const th = document.createElement('th');
      th.className = CROSS_CLASS;
      th.textContent = team.position;
      th.title = team.name;
      th.style.width = crossColumnWidth;
      th.style.minWidth = crossColumnWidth;
      th.style.maxWidth = crossColumnWidth;
      th.style.whiteSpace = 'nowrap';
      th.style.textAlign = 'center';
      if (colIndex === 0 && separatorBorderLeft) {
        th.style.borderLeft = separatorBorderLeft;
      }
      headerRow.appendChild(th);
    }

    for (let rowIndex = 0; rowIndex < bodyRows.length; rowIndex += 1) {
      const row = bodyRows[rowIndex];
      for (let colIndex = 0; colIndex < teams.length; colIndex += 1) {
        const td = document.createElement('td');
        td.className = CROSS_CLASS;
        td.style.width = crossColumnWidth;
        td.style.minWidth = crossColumnWidth;
        td.style.maxWidth = crossColumnWidth;
        td.style.whiteSpace = 'nowrap';
        td.style.textAlign = 'center';
        if (colIndex === 0 && separatorBorderLeft) {
          td.style.borderLeft = separatorBorderLeft;
        }

        if (rowIndex === colIndex) {
          td.textContent = '–';
        } else {
          td.textContent = formatPoints(matrix[rowIndex][colIndex]);
        }
        row.appendChild(td);
      }
    }

    applyVisibility(table, false);
  }

  function relaxTableLayout(resultsContainer, table) {
    resultsContainer.style.overflowX = 'auto';
    resultsContainer.style.maxWidth = '100%';
    table.style.width = 'max-content';
    table.style.minWidth = '100%';

    const cells = table.querySelectorAll('th, td');
    cells.forEach((cell) => {
      cell.style.whiteSpace = 'nowrap';
    });
  }

  function setToggleVisualState(link, isOn) {
    link.style.fontWeight = isOn ? 'bold' : 'normal';
  }

  function createToggle(mainHeading, onToggle) {
    const spacer = document.createTextNode(' ');
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = 'Kreuztabelle';
    setToggleVisualState(link, false);

    link.addEventListener('click', async (event) => {
      event.preventDefault();
      await onToggle(link);
    });

    mainHeading.appendChild(spacer);
    mainHeading.appendChild(link);
  }

  async function run() {
    if (!isTargetPage()) return;

    const resultsContainer = document.querySelector('div.results');
    const table = resultsContainer?.querySelector('table');
    if (!table) {
      console.info(`${LOG_PREFIX} No results table found on this page.`);
      return;
    }

    const mainHeading = document.querySelector('main h1');
    if (!mainHeading) {
      console.error(`${LOG_PREFIX} Could not find main h1 for toggle placement.`);
      return;
    }

    relaxTableLayout(resultsContainer, table);

    let isBuilt = false;
    let isVisible = false;
    const isDemPage = /\/dem(?:-|\/|$)/i.test(window.location.pathname) || document.body.classList.contains('dem');

    createToggle(mainHeading, async (toggleLink) => {
      try {
        if (!isBuilt) {
          const teams = parseTeams(table, isDemPage);
          if (teams.length === 0) {
            console.error(`${LOG_PREFIX} No teams parsed from main table.`);
            return;
          }

          const teamNameToIndex = new Map();
          teams.forEach((team, idx) => {
            const key = canonicalizeName(team.name);
            if (teamNameToIndex.has(key)) {
              console.error(`${LOG_PREFIX} Duplicate canonical team name key`, {
                name: team.name,
                key
              });
            }
            teamNameToIndex.set(key, idx);
          });
          const matrix = Array.from({ length: teams.length }, () => Array(teams.length).fill(null));

          await Promise.all(teams.map((team) => fetchTeamResults(team, teamNameToIndex, matrix, isDemPage)));
          const filledCells = matrix.flat().filter((value) => value != null).length;
          if (filledCells === 0) {
            console.error(`${LOG_PREFIX} Cross table matrix is empty after fetching all teams.`);
          } else {
            console.info(`${LOG_PREFIX} Cross table matrix built`, { teams: teams.length, filledCells });
          }
          renderCrossTable(table, teams, matrix);
          isBuilt = true;
        }

        isVisible = !isVisible;
        applyVisibility(table, isVisible);
        setToggleVisualState(toggleLink, isVisible);
      } catch (error) {
        console.error(`${LOG_PREFIX} Error while toggling cross table`, error);
        setToggleVisualState(toggleLink, false);
      }
    });
  }

  run();
})();
