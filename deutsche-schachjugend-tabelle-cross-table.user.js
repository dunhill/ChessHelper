// ==UserScript==
// @name         Deutsche Schachjugend - Tabelle Cross Table and Board Results Toggle
// @namespace    https://github.com/oleksiy/ChessHelper
// @version      1.1
// @description  Adds toggles to show/hide cross-table and board results on DSJ tabelle pages.
// @match        *://www.deutsche-schachjugend.de/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const LOG_PREFIX = '[DSJ-Tabelle]';
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

    // Handle special symbols
    if (text === '-') return 0;
    if (text === '+') return 1;

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
    if (value < 0 || value > 8 || !hasHalfPrecision) {
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
        console.error(`${LOG_PREFIX} DEM row points could not be parsed`, {
          team: team.name,
          index,
          resultText
        });
        continue;
      }

      const homeIndex = teamNameToIndex.get(canonicalizeName(homeName));
      const awayIndex = teamNameToIndex.get(canonicalizeName(awayName));
      if (homeIndex == null || awayIndex == null) {
        console.error(`${LOG_PREFIX} DEM team not found in team list`, {
          team: team.name,
          homeName,
          awayName
        });
        continue;
      }

      matrix[homeIndex][awayIndex] = homePoints;
      matrix[awayIndex][homeIndex] = awayPoints;
    }
  }

  async function fetchTeamResults(team, teamNameToIndex, matrix, isDemPage) {
    try {
      const response = await fetch(team.href);
      if (!response.ok) {
        console.error(`${LOG_PREFIX} Failed to fetch team page`, { team: team.name, status: response.status });
        return;
      }

      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const resultsTable = doc.querySelector('div.results table');
      if (!resultsTable) {
        console.error(`${LOG_PREFIX} No results table found on team page`, { team: team.name });
        return;
      }

      if (isDemPage) {
        await fetchDemTeamResults(team, teamNameToIndex, matrix, resultsTable);
      } else {
        await fetchClassicTeamResults(team, teamNameToIndex, matrix, resultsTable);
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} Error fetching team results`, { team: team.name, error });
    }
  }

  function renderCrossTable(table, teams, matrix) {
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');

    // Add cross table header row
    const crossHeaderRow = document.createElement('tr');
    crossHeaderRow.className = CROSS_CLASS;
    const emptyTh = document.createElement('th');
    emptyTh.colSpan = 2;
    crossHeaderRow.appendChild(emptyTh);

    teams.forEach((team) => {
      const th = document.createElement('th');
      th.className = CROSS_CLASS;
      th.textContent = team.position;
      crossHeaderRow.appendChild(th);
    });

    thead.appendChild(crossHeaderRow);

    // Add cross table rows
    teams.forEach((team, rowIndex) => {
      const row = document.createElement('tr');
      row.className = CROSS_CLASS;

      // Position and name cells
      const posTd = document.createElement('td');
      posTd.className = CROSS_CLASS;
      posTd.textContent = team.position;
      row.appendChild(posTd);

      const nameTd = document.createElement('td');
      nameTd.className = CROSS_CLASS;
      const link = document.createElement('a');
      link.href = team.href;
      link.textContent = team.name;
      nameTd.appendChild(link);
      row.appendChild(nameTd);

      // Result cells
      teams.forEach((opponent, colIndex) => {
        const td = document.createElement('td');
        td.className = CROSS_CLASS;
        if (rowIndex === colIndex) {
          td.textContent = '–';
        } else {
          td.textContent = formatPoints(matrix[rowIndex][colIndex]);
        }
        row.appendChild(td);
      });

      tbody.appendChild(row);
    });

    applyVisibility(table, false);
  }

  function applyVisibility(table, isVisible) {
    const crossCells = table.querySelectorAll(`.${CROSS_CLASS}`);
    crossCells.forEach((cell) => {
      cell.style.display = isVisible ? '' : 'none';
    });
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

  class BoardResults {
    constructor() {
      this.boards = new Map(); // boardNumber -> Map(playerName -> { total: 0, rounds: {round: {points, opponentInfo}}, team: teamName, teamHref: string })
      this.playerIndex = new Map(); // "playerName" -> { team, teamHref, dwz, elo }
      this.allPlayerBoardAppearances = new Map(); // "playerName_teamName" -> Set of boardNumbers
    }

    addPlayerInfo(playerName, team, teamHref, dwz, elo) {
      const key = normalizeName(playerName);
      this.playerIndex.set(key, { team, teamHref, dwz, elo });
    }

    getPlayerInfo(playerName) {
      const key = normalizeName(playerName);
      return this.playerIndex.get(key);
    }

    addResult(teamName, teamHref, playerName, boardNumber, roundNumber, points, opponentInfo = {}) {
      if (!this.boards.has(boardNumber)) {
        this.boards.set(boardNumber, new Map());
      }
      const board = this.boards.get(boardNumber);
      if (!board.has(playerName)) {
        board.set(playerName, { total: 0, rounds: {}, team: teamName, teamHref: teamHref, bhz: 0 });
      }
      const player = board.get(playerName);
      player.rounds[roundNumber] = { points, opponentInfo };
      player.total += points;

      // Track board appearances
      const appearanceKey = `${playerName}_${teamName}`;
      if (!this.allPlayerBoardAppearances.has(appearanceKey)) {
        this.allPlayerBoardAppearances.set(appearanceKey, new Set());
      }
      this.allPlayerBoardAppearances.get(appearanceKey).add(boardNumber);
    }

    isMultiBoardPlayer(playerName, teamName) {
      const key = `${playerName}_${teamName}`;
      const boards = this.allPlayerBoardAppearances.get(key);
      return boards && boards.size > 1;
    }

    getSortedPlayers(boardNumber) {
      const board = this.boards.get(boardNumber);
      if (!board) return [];
      return Array.from(board.entries()).sort((a, b) => b[1].total - a[1].total);
    }

    getMaxRounds() {
      let max = 0;
      for (const board of this.boards.values()) {
        for (const player of board.values()) {
          max = Math.max(max, ...Object.keys(player.rounds).map(Number));
        }
      }
      return max;
    }

    calculateBhzForBoard(boardNumber) {
      const board = this.boards.get(boardNumber);
      if (!board) return;

      // For each player on this board
      for (const [playerName, playerData] of board.entries()) {
        let bhz = 0;

        // For each round they played
        for (const roundNum in playerData.rounds) {
          const roundData = playerData.rounds[roundNum];
          if (!roundData || !roundData.opponentInfo) continue;

          const opponentName = roundData.opponentInfo.name;
          if (!opponentName) continue;

          // Find opponent in the same board
          const opponent = board.get(opponentName);
          if (opponent) {
            // Add opponent's total points to Bhz
            bhz += opponent.total;
          }
        }

        playerData.bhz = bhz;
      }
    }

    calculateAllBhz() {
      for (const boardNumber of this.boards.keys()) {
        this.calculateBhzForBoard(boardNumber);
      }
    }
  }

  function parseOpponentFromTitle(titleText) {
    if (!titleText) return {};

    // Format: "mit Weiß gegen Karolina Balcytis · DWZ 1653 · Elo 1713"
    const opponentMatch = titleText.match(/gegen\s+(.+?)(?:\s*·|$)/);
    const name = opponentMatch ? normalizeName(opponentMatch[1]) : '';

    const dwzMatch = titleText.match(/DWZ\s+(\d+)/);
    const dwz = dwzMatch ? dwzMatch[1] : null;

    const eloMatch = titleText.match(/Elo\s+(\d+)/);
    const elo = eloMatch ? eloMatch[1] : null;

    return { name, dwz, elo, team: null, teamHref: null };
  }

  async function fetchBoardResults(team, boardResults) {
    try {
      const response = await fetch(team.href);
      if (!response.ok) {
        console.error(`${LOG_PREFIX} Failed to fetch team page for board results`, { team: team.name, status: response.status });
        return;
      }
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const resultsTable = doc.querySelector('div.results table');
      if (!resultsTable) {
        console.error(`${LOG_PREFIX} No results table found on team page for board results`, { team: team.name });
        return;
      }

      // Extract and index player info from the table
      const bodyRows = Array.from(resultsTable.querySelectorAll('tbody tr'));
      bodyRows.forEach((row) => {
        const nameCell = row.querySelector('td:nth-child(2)');
        const playerName = normalizeName(nameCell?.textContent || '');
        if (!playerName) return;

        const dwzCell = row.querySelector('td:nth-child(5)');
        const dwz = normalizeName(dwzCell?.textContent || '');

        const eloCell = row.querySelector('td:nth-child(6)');
        const eloText = eloCell?.querySelector('a')?.textContent || eloCell?.textContent || '';
        const elo = normalizeName(eloText);

        boardResults.addPlayerInfo(playerName, team.name, team.href, dwz, elo);
      });

      const headerRow = resultsTable.querySelector('thead tr');
      const roundHeaders = Array.from(headerRow.querySelectorAll('th.number a[title]'));

      // For each round
      roundHeaders.forEach((header) => {
        const title = header.getAttribute('title') || '';
        const roundMatch = title.match(/Runde (\d+)/);
        if (!roundMatch) return;
        const actualRound = parseInt(roundMatch[1]);

        // Find column index
        const headerCell = header.closest('th');
        const columnIndex = Array.from(headerRow.children).indexOf(headerCell);

        // Collect players with results in this column
        const playersWithResults = [];
        bodyRows.forEach((row) => {
          const cell = row.children[columnIndex];
          if (!cell || !cell.classList.contains('ergebnis')) return;

          const resultText = normalizeName(cell.textContent || '');
          if (!resultText) return;

          const points = parsePoints(resultText);
          if (points == null) return;

          const nameCell = row.querySelector('td:nth-child(2)');
          const playerName = normalizeName(nameCell?.textContent || '');
          if (!playerName) return;

          // Extract opponent info from title
          const cellTitle = cell.getAttribute('title') || '';
          const opponentInfo = parseOpponentFromTitle(cellTitle);

          // Enrich opponent info with data from playerIndex
          const playerInfo = boardResults.getPlayerInfo(opponentInfo.name);
          if (playerInfo) {
            opponentInfo.team = playerInfo.team;
            opponentInfo.teamHref = playerInfo.teamHref;
            if (!opponentInfo.dwz) opponentInfo.dwz = playerInfo.dwz;
            if (!opponentInfo.elo) opponentInfo.elo = playerInfo.elo;
          }

          playersWithResults.push({ playerName, points, opponentInfo });
        });

        // Assign boards: first is board 1, etc.
        playersWithResults.forEach((item, boardIndex) => {
          const boardNumber = boardIndex + 1;
          boardResults.addResult(team.name, team.href, item.playerName, boardNumber, actualRound, item.points, item.opponentInfo);
        });
      });
    } catch (error) {
      console.error(`${LOG_PREFIX} Error fetching board results for team`, { team: team.name, error });
    }
  }

  function renderBoardTables(resultsContainer, boardResults) {
    // Calculate Bhz for all boards in two-pass mode
    boardResults.calculateAllBhz();

    const maxRounds = boardResults.getMaxRounds();
    const roundHeaders = Array.from({ length: maxRounds }, (_, i) => `R${i + 1}`);
    for (let boardNumber = 1; boardNumber <= 5; boardNumber++) {
      const sortedPlayers = boardResults.getSortedPlayers(boardNumber);
      if (sortedPlayers.length === 0) continue;
      const table = document.createElement('table');
      table.className = 'board-results-table';
      table.style.display = 'none'; // hidden by default
      // Header
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');

      const thRank = document.createElement('th');
      thRank.textContent = '#';
      thRank.style.textAlign = 'right';
      headerRow.appendChild(thRank);

      const thPlayer = document.createElement('th');
      thPlayer.textContent = `Brett ${boardNumber} - Spieler`;
      headerRow.appendChild(thPlayer);

      const thTotal = document.createElement('th');
      thTotal.textContent = 'Gesamt';
      thTotal.style.textAlign = 'center';
      headerRow.appendChild(thTotal);

      const thBhz = document.createElement('th');
      thBhz.textContent = 'Bhz';
      thBhz.style.textAlign = 'center';
      headerRow.appendChild(thBhz);

      roundHeaders.forEach(round => {
        const th = document.createElement('th');
        th.textContent = round;
        th.style.textAlign = 'center';
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      // Body
      const tbody = document.createElement('tbody');
      sortedPlayers.forEach(([playerName, data], rank) => {
        const row = document.createElement('tr');

        // Rank column
        const tdRank = document.createElement('td');
        tdRank.textContent = rank + 1;
        tdRank.style.textAlign = 'right';
        row.appendChild(tdRank);

        // Player name and team
        const tdPlayer = document.createElement('td');
        let playerDisplay = playerName;
        if (boardResults.isMultiBoardPlayer(playerName, data.team)) {
          playerDisplay += '*';
        }

        // Create team link
        const teamLink = document.createElement('a');
        teamLink.href = data.teamHref;
        teamLink.textContent = `${playerDisplay} (${data.team})`;
        tdPlayer.appendChild(teamLink);
        row.appendChild(tdPlayer);

        // Total points
        const tdTotal = document.createElement('td');
        tdTotal.textContent = formatPoints(data.total);
        tdTotal.style.textAlign = 'center';
        row.appendChild(tdTotal);

        // Bhz (pre-calculated in two-pass mode)
        const tdBhz = document.createElement('td');
        tdBhz.textContent = formatPoints(data.bhz);
        tdBhz.style.textAlign = 'center';
        row.appendChild(tdBhz);

        // Round results
        roundHeaders.forEach((_, i) => {
          const roundNum = i + 1;
          const roundData = data.rounds[roundNum];
          const td = document.createElement('td');
          td.style.textAlign = 'center';

          if (roundData) {
            td.textContent = formatPoints(roundData.points);

            if (roundData.opponentInfo) {
              const opponent = roundData.opponentInfo;
              const titleParts = [];
              if (opponent.name) titleParts.push(opponent.name);
              if (opponent.team) titleParts.push(opponent.team);
              if (opponent.dwz) titleParts.push(`DWZ: ${opponent.dwz}`);
              if (opponent.elo) titleParts.push(`Elo: ${opponent.elo}`);

              if (titleParts.length > 0) {
                td.title = titleParts.join('\n');
              }
            }
          }

          row.appendChild(td);
        });

        tbody.appendChild(row);
      });

      table.appendChild(tbody);
      resultsContainer.appendChild(table);
    }
  }

  function applyBoardVisibility(resultsContainer, isVisible) {
    const tables = resultsContainer.querySelectorAll('.board-results-table');
    tables.forEach(table => {
      table.style.display = isVisible ? 'table' : 'none';
    });
  }

  function setToggleVisualState(link, isOn) {
    link.style.fontWeight = isOn ? 'bold' : 'normal';
  }

  function createToggles(mainHeading, onCrossToggle, onBoardToggle) {
    const spacer1 = document.createTextNode(' ');
    const link1 = document.createElement('a');
    link1.href = '#';
    link1.textContent = 'Kreuztabelle';
    setToggleVisualState(link1, false);
    link1.addEventListener('click', async (event) => {
      event.preventDefault();
      await onCrossToggle(link1);
    });
    mainHeading.appendChild(spacer1);
    mainHeading.appendChild(link1);
    const spacer2 = document.createTextNode(' ');
    const link2 = document.createElement('a');
    link2.href = '#';
    link2.textContent = 'Brett Ergebnisse';
    setToggleVisualState(link2, false);
    link2.addEventListener('click', async (event) => {
      event.preventDefault();
      await onBoardToggle(link2);
    });
    mainHeading.appendChild(spacer2);
    mainHeading.appendChild(link2);
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

    let crossIsBuilt = false;
    let crossIsVisible = false;
    let boardIsBuilt = false;
    let boardIsVisible = false;
    const boardResults = new BoardResults();
    const isDemPage = /\/dem(?:-|\/|$)/i.test(window.location.pathname) || document.body.classList.contains('dem');

    createToggles(mainHeading, async (toggleLink) => {
      try {
        if (!crossIsBuilt) {
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
          crossIsBuilt = true;
        }
        crossIsVisible = !crossIsVisible;
        applyVisibility(table, crossIsVisible);
        setToggleVisualState(toggleLink, crossIsVisible);
      } catch (error) {
        console.error(`${LOG_PREFIX} Error while toggling cross table`, error);
        setToggleVisualState(toggleLink, false);
      }
    }, async (toggleLink) => {
      try {
        if (!boardIsBuilt) {
          const teams = parseTeams(table, isDemPage);
          if (teams.length === 0) {
            console.error(`${LOG_PREFIX} No teams parsed from main table.`);
            return;
          }
          await Promise.all(teams.map((team) => fetchBoardResults(team, boardResults)));
          renderBoardTables(resultsContainer, boardResults);
          boardIsBuilt = true;
        }
        boardIsVisible = !boardIsVisible;
        applyBoardVisibility(resultsContainer, boardIsVisible);
        setToggleVisualState(toggleLink, boardIsVisible);
      } catch (error) {
        console.error(`${LOG_PREFIX} Error while toggling board results`, error);
        setToggleVisualState(toggleLink, false);
      }
    });
  }

  run();
})();