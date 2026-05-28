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
    return /\/tabelle(?:\/[^/?#]+)?\/?$/.test(window.location.pathname) || /\/lv\/[^/?#]+\/?$/.test(window.location.pathname);
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

  function formatDelta(val) {
    if (val == null) return '';
    if (Math.abs(val) < 1e-9) return '+0';
    const sign = val > 0 ? '+' : '-';
    const abs = Math.abs(val);
    const isHalf = Math.abs(abs % 1 - 0.5) < 1e-9;
    if (isHalf) {
      const whole = Math.floor(abs);
      return `${sign}${whole > 0 ? whole : ''}½`;
    }
    return `${sign}${Math.trunc(abs)}`;
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

  function parseCurrentRoundCountFromHeading() {
    const heading = document.querySelector('main h1');
    if (!heading) return null;
    const match = heading.textContent.match(/nach der\s+(\d+)\.\s*Runde/i);
    return match ? parseInt(match[1], 10) : null;
  }

  function parseCurrentRoundCountFromPrevLink() {
    const prevLink = document.querySelector('link[rel="prev"]');
    if (!prevLink) return null;
    const href = prevLink.getAttribute('href') || '';
    const match = href.match(/\/tabelle\/(\d+)\/?$/);
    return match ? parseInt(match[1], 10) + 1 : null;
  }

  function getTabelleBaseUrl() {
    const url = new URL(window.location.href);
    const pathname = url.pathname.replace(/\/$/, '');
    const match = pathname.match(/^(.*\/tabelle)(?:\/\d+)?$/);
    return match ? `${url.origin}${match[1]}/` : `${url.origin}${pathname}/`;
  }

  async function fetchRoundPositions(baseUrl, roundNumber) {
    // Support round 0 (initial/start list) where the URL uses 'spieler' instead of 'tabelle'
    let roundUrl;
    if (roundNumber === 0) {
      // baseUrl expected to end with '/tabelle/'
      roundUrl = baseUrl.replace(/\/tabelle\/$$/, '/spieler/');
      // fallback if replace didn't match exactly
      if (roundUrl === baseUrl) roundUrl = baseUrl.replace(/tabelle\/?$/, 'spieler/');
    } else {
      roundUrl = new URL(`${roundNumber}/`, baseUrl).toString();
    }
    try {
      const response = await fetch(roundUrl);
      if (!response.ok) {
        console.warn(`${LOG_PREFIX} No round page found`, { roundNumber, roundUrl, status: response.status });
        return null;
      }

      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const table = doc.querySelector('div.results table');
      if (!table) {
        console.warn(`${LOG_PREFIX} Round page missing main table`, { roundNumber, roundUrl });
        return null;
      }

      // For round pages we need stable ordering within ties.
      // Parse rows into objects containing displayed rank, initial standing (tuz) and points.
      const headerCells = Array.from(table.querySelectorAll('thead th'));
      const pointsHeaderIndex = headerCells.findIndex((th) => /Pkt|Punkte|Punkte/i.test(th.textContent));
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      const parsed = [];
      rows.forEach((row, index) => {
        const anchor = row.querySelector('td.person a') || row.querySelector('td a');
        const name = normalizeName(anchor?.textContent || '');
        if (!name) return;

        // Rank shown for this round
        const tzCell = row.querySelector('td.tz') || row.querySelector('td.tz.tableposition');
        let rankText = tzCell?.textContent?.trim() || '';
        if (!rankText) {
          const nested = tzCell?.querySelector('span.identical_place');
          rankText = nested?.textContent?.trim() || '';
        }
        const rank = parseInt((rankText.match(/\d+/) || [NaN])[0], 10);

        // initial standing (tuz)
        const tuzCell = row.querySelector('td.tuz');
        const initialText = tuzCell?.textContent?.trim() || '';
        const initial = parseInt((initialText.match(/\d+/) || [NaN])[0], 10);

        // points (Pkt) - try to use header index first, fallback to first matching 'tm' cell
        const cells = Array.from(row.querySelectorAll('td'));
        let points = null;
        if (pointsHeaderIndex >= 0 && cells[pointsHeaderIndex]) {
          points = parsePoints(cells[pointsHeaderIndex].textContent || '');
        }
        if (points == null) {
          const candidate = cells.find((td) => td.className && td.className.includes('tm') && /[0-9½]/.test(td.textContent || ''));
          points = parsePoints(candidate?.textContent || '');
        }

        parsed.push({ rowIndex: index, name, key: canonicalizeName(name), rank: Number.isFinite(rank) ? rank : Infinity, initial: Number.isFinite(initial) ? initial : Infinity, points: points });
      });

      // If this is the initial "spieler" page, simply map initial -> ordinal by tuz
      if (roundNumber === 0) {
        const positions = new Map();
        // sort by initial ascending
        parsed.sort((a, b) => a.initial - b.initial || a.rowIndex - b.rowIndex);
        parsed.forEach((p, i) => positions.set(p.key, { position: i + 1, points: p.points ?? null }));
        return positions;
      }

      // Group by rank, sort groups by rank, and within group sort by initial standing
      const groups = new Map();
      parsed.forEach((p) => {
        const k = String(p.rank);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(p);
      });

      const sortedRankKeys = Array.from(groups.keys()).map(Number).sort((a, b) => a - b || 0);
      const positions = new Map();
      let cursor = 1;
      for (const rk of sortedRankKeys) {
        const key = String(rk);
        const group = groups.get(key) || [];
        group.sort((a, b) => (a.initial - b.initial) || (a.rowIndex - b.rowIndex));
        group.forEach((item) => {
          positions.set(item.key, { position: cursor, points: item.points ?? null });
          cursor += 1;
        });
      }
      return positions;
    } catch (error) {
      console.error(`${LOG_PREFIX} Error fetching round positions`, { roundNumber, error });
      return null;
    }
  }

  async function buildPathToFinishData(resultsContainer) {
    const table = resultsContainer.querySelector('table');
    if (!table) {
      console.error(`${LOG_PREFIX} No main table found for path chart.`);
      return null;
    }
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const players = rows.map((row, index) => {
      const anchor = row.querySelector('td.person a') || row.querySelector('td a');
      const name = normalizeName(anchor?.textContent || '');
      const key = canonicalizeName(name);
      return name && key ? { name, key, currentPosition: index + 1 } : null;
    }).filter(Boolean);

    if (players.length === 0) {
      console.error(`${LOG_PREFIX} No players found to build path chart.`);
      return null;
    }

    let roundCount = parseCurrentRoundCountFromHeading() ?? parseCurrentRoundCountFromPrevLink();
    if (!roundCount || roundCount < 1) {
      console.error(`${LOG_PREFIX} Could not determine total number of rounds for path chart.`);
      return null;
    }

    const baseUrl = getTabelleBaseUrl();
    const positionsByRound = [];
    // Add initial positions as round 0
    const initialPositions = await fetchRoundPositions(baseUrl, 0);
    if (initialPositions && initialPositions.size > 0) positionsByRound.push(initialPositions);

    for (let round = 1; round <= roundCount; round += 1) {
      const roundPositions = await fetchRoundPositions(baseUrl, round);
      if (!roundPositions || roundPositions.size === 0) {
        console.warn(`${LOG_PREFIX} Stopping path chart fetch at missing round`, { round });
        break;
      }
      positionsByRound.push(roundPositions);
    }

    if (positionsByRound.length === 0) {
      console.error(`${LOG_PREFIX} No valid round position data available.`);
      return null;
    }

    const playersByKey = new Map();
    players.forEach((player) => {
      playersByKey.set(player.key, {
        name: player.name,
        positions: Array(positionsByRound.length).fill(null),
        points: Array(positionsByRound.length).fill(null),
        currentPosition: player.currentPosition
      });
    });

    positionsByRound.forEach((roundMap, roundIndex) => {
      roundMap.forEach((val, key) => {
        const entry = playersByKey.get(key);
        if (entry) {
          entry.positions[roundIndex] = val && typeof val === 'object' ? val.position : val;
          entry.points[roundIndex] = val && typeof val === 'object' ? (val.points ?? null) : null;
        }
      });
    });

    const sortedPlayers = Array.from(playersByKey.values()).sort((a, b) => {
      const finalA = a.positions[a.positions.length - 1] ?? a.currentPosition;
      const finalB = b.positions[b.positions.length - 1] ?? b.currentPosition;
      return finalA - finalB;
    });
    return {
      players: sortedPlayers,
      roundCount: positionsByRound.length,
      maxPosition: players.length
    };
  }

  function injectPathChartStyles() {
    if (document.getElementById('dsj-path-chart-styles')) return;
    const style = document.createElement('style');
    style.id = 'dsj-path-chart-styles';
    style.textContent = `
      .dsj-path-chart-container { margin-bottom: 1rem; }
      .dsj-path-chart-title { margin: 0 0 0.5rem; font-size: 1rem; font-weight: 600; }
      .dsj-path-chart-svg { width: 100%; height: 680px; }
      .dsj-path-chart-caption { margin-top: 0.5rem; font-size: 0.95rem; color: #222; }
      .dsj-path-chart-caption strong { font-weight: 600; }
      .dsj-path-axis line, .dsj-path-axis path { stroke: #666; stroke-width: 1; shape-rendering: crispEdges; }
      .dsj-path-axis text { fill: #333; font-size: 10px; }
      .dsj-path-line { fill: none; stroke-width: 1.5; opacity: 0.35; transition: opacity 0.2s ease, stroke-width 0.2s ease; cursor: pointer; }
      .dsj-path-line-hover, .dsj-path-line:hover { opacity: 1 !important; stroke-width: 3 !important; }
      .dsj-path-point { stroke-width: 1.5; opacity: 0.6; fill: #fff; transition: opacity 0.2s ease, r 0.2s ease; }
      .dsj-path-group:hover .dsj-path-point { opacity: 1; r: 4; }
      .dsj-path-label { font-size: 10px; fill: #000; pointer-events: none; }
    `;
    document.head.appendChild(style);
  }

  function createPathToFinishChart(container, players, roundCount, maxPosition) {
    const margin = { top: 24, right: 160, bottom: 32, left: 40 };
    const width = 900;
    const height = 680;
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const xStep = roundCount > 1 ? innerWidth / (roundCount - 1) : 0;
    const yStep = maxPosition > 1 ? innerHeight / (maxPosition - 1) : 0;
    const colors = [
      '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'
    ];

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'dsj-path-chart-svg');

    const xAxisGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    xAxisGroup.setAttribute('class', 'dsj-path-axis');
    // Label rounds starting with 0 (initial positions) up to roundCount-1
    for (let i = 0; i < roundCount; i += 1) {
      const x = margin.left + xStep * i;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x);
      line.setAttribute('y1', margin.top);
      line.setAttribute('x2', x);
      line.setAttribute('y2', height - margin.bottom);
      line.setAttribute('stroke', '#ddd');
      line.setAttribute('stroke-width', '1');
      svg.appendChild(line);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', x);
      label.setAttribute('y', height - 12);
      label.setAttribute('text-anchor', 'middle');
      label.textContent = `${i}`;
      svg.appendChild(label);
    }

    const yAxisGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    yAxisGroup.setAttribute('class', 'dsj-path-axis');
    const yTicks = maxPosition <= 12 ? Array.from({ length: maxPosition }, (_, i) => i + 1) : [1, Math.ceil(maxPosition / 2), maxPosition];
    yTicks.forEach((position) => {
      const y = margin.top + (position - 1) * yStep;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', margin.left);
      line.setAttribute('y1', y);
      line.setAttribute('x2', width - margin.right);
      line.setAttribute('y2', y);
      line.setAttribute('stroke', '#eee');
      line.setAttribute('stroke-width', '1');
      svg.appendChild(line);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', margin.left - 10);
      label.setAttribute('y', y + 3);
      label.setAttribute('text-anchor', 'end');
      label.textContent = `${position}`;
      svg.appendChild(label);
    });

    const chartTitle = document.createElement('h2');
    chartTitle.setAttribute('class', 'dsj-path-chart-title');
    chartTitle.textContent = 'Path to Finish';
    container.appendChild(chartTitle);
    container.appendChild(svg);

    const caption = document.createElement('div');
    caption.setAttribute('class', 'dsj-path-chart-caption');
    caption.textContent = 'Hover over a line or point for details.';
    container.appendChild(caption);

    const allPaths = [];

    players.forEach((player, index) => {
      const pathGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      pathGroup.setAttribute('class', 'dsj-path-group');
      const color = colors[index % colors.length] || `hsl(${(index * 40) % 360}, 70%, 50%)`;
      let pathString = '';
      let segmentOpen = false;

      player.positions.forEach((position, roundIndex) => {
        if (position == null) {
          segmentOpen = false;
          return;
        }
        const x = margin.left + xStep * roundIndex;
        const y = margin.top + (position - 1) * yStep;
        pathString += segmentOpen ? ` L${x},${y}` : `M${x},${y}`;
        segmentOpen = true;
      });

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathString);
      path.setAttribute('stroke', color);
      path.setAttribute('class', 'dsj-path-line');
      pathGroup.appendChild(path);
      allPaths.push(path);

      player.positions.forEach((position, roundIndex) => {
        if (position == null) return;
        const x = margin.left + xStep * roundIndex;
        const y = margin.top + (position - 1) * yStep;
        const point = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        point.setAttribute('cx', x);
        point.setAttribute('cy', y);
        point.setAttribute('r', '3');
        point.setAttribute('stroke', color);
        point.setAttribute('class', 'dsj-path-point');

        const pointTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        const roundLabel = roundIndex === 0 ? 'Start' : `Runde ${roundIndex}`;
        const totalPoints = player.points ? player.points[roundIndex] : null;
        const prevPoints = player.points && roundIndex > 0 ? player.points[roundIndex - 1] : null;
        const delta = (totalPoints != null && prevPoints != null) ? (totalPoints - prevPoints) : null;
        const deltaText = delta != null ? formatDelta(delta) : '';
        const pointsText = totalPoints != null ? formatPoints(totalPoints) : '';
        pointTitle.textContent = `${player.name} — ${roundLabel} — Platz ${position}\nPunkte: ${pointsText}${deltaText ? ' (' + deltaText + ')' : ''}`;
        point.appendChild(pointTitle);

        point.addEventListener('mouseenter', () => {
          const line1 = `${player.name} — ${roundLabel} — Platz ${position}`;
          const line2 = `Punkte: ${pointsText}${deltaText ? ' (' + deltaText + ')' : ''}`;
          caption.innerHTML = `${line1}<br><strong>${line2}</strong>`;
        });
        point.addEventListener('mouseleave', () => {
          caption.textContent = 'Hover over a line or point for details.';
        });

        pathGroup.appendChild(point);
      });

      const lastPositionIndex = player.positions.length - 1;
      const lastPosition = player.positions[lastPositionIndex];
      if (lastPosition != null) {
        const x = width - margin.right + 8;
        const y = margin.top + (lastPosition - 1) * yStep + 4;
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', x);
        label.setAttribute('y', y);
        label.setAttribute('text-anchor', 'start');
        label.setAttribute('class', 'dsj-path-label');
        label.textContent = player.name;
        pathGroup.appendChild(label);
      }

      const resetCaption = () => {
        caption.textContent = 'Hover over a line or point for details.';
      };

      path.addEventListener('mouseenter', () => {
        caption.textContent = player.name;
      });
      path.addEventListener('mouseleave', resetCaption);

      pathGroup.addEventListener('mouseenter', () => {
        allPaths.forEach((otherPath) => {
          if (otherPath === path) {
            otherPath.classList.add('dsj-path-line-hover');
          } else {
            otherPath.style.opacity = '0.12';
          }
        });
      });
      pathGroup.addEventListener('mouseleave', () => {
        allPaths.forEach((otherPath) => {
          otherPath.classList.remove('dsj-path-line-hover');
          otherPath.style.opacity = '';
        });
      });

      svg.appendChild(pathGroup);
    });
  }

  function isTabellePage() {
    return window.location.href.includes('/tabelle');
  }

  function createToggles(mainHeading, onCrossToggle, onBoardToggle, onPathToggle) {
    const spacer1 = document.createElement('br');
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
    const spacer2 = document.createTextNode(' • ');
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

    if (typeof onPathToggle === 'function') {
      const spacer3 = document.createTextNode(' • ');
      const link3 = document.createElement('a');
      link3.href = '#';
      link3.textContent = 'Path to Finish';
      setToggleVisualState(link3, false);
      link3.addEventListener('click', async (event) => {
        event.preventDefault();
        await onPathToggle(link3);
      });
      mainHeading.appendChild(spacer3);
      mainHeading.appendChild(link3);
    }
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

      if (!thCell || !taCell) {
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

      // Check if the result indicates a pending game ("?" or "LIVE")
      const isPendingGame = resultText === '?' || resultText === 'LIVE';

      let homePoints, awayPoints;
      if (isPendingGame) {
        homePoints = '?';
        awayPoints = '?';
      } else {
        const resultMatch = resultText.match(/(.+?)\s*:\s*(.+)/);
        if (!resultMatch) {
          console.error(`${LOG_PREFIX} DEM row has invalid structure`, {
            team: team.name,
            index,
            resultText
          });
          continue;
        }

        homePoints = parseDemSidePoints(resultMatch[1]);
        awayPoints = parseDemSidePoints(resultMatch[2]);
        if (homePoints == null || awayPoints == null) {
          console.error(`${LOG_PREFIX} DEM row points could not be parsed`, {
            team: team.name,
            index,
            resultText
          });
          continue;
        }
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

  function parseLvTable(lvTable) {
    const tbodyBlocks = [];
    const tbodies = lvTable.querySelectorAll('tbody');
    
    tbodies.forEach(tbody => {
      const rows = Array.from(tbody.querySelectorAll('tr'));
      if (rows.length === 0) return;
      
      // First row is the header
      const headerRow = rows[0];
      const dataRows = rows.slice(1);
      
      const players = [];
      dataRows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 4) return;
        
        // 4th column (index 3) is the Spieler column with the link
        const playerCell = cells[3];
        const playerLink = playerCell.querySelector('a');
        if (!playerLink) return;
        
        const playerName = normalizeName(playerLink.textContent);
        const playerHref = new URL(playerLink.getAttribute('href'), window.location.href).toString();
        
        players.push({ row, playerName, playerHref });
      });
      
      if (players.length > 0) {
        tbodyBlocks.push({ tbody, headerRow, players });
      }
    });
    
    return tbodyBlocks;
  }

  async function fetchSpielerRounds(playerHref, playerName) {
    try {
      const response = await fetch(playerHref);
      if (!response.ok) {
        console.error(`${LOG_PREFIX} Failed to fetch spieler page`, { playerName, status: response.status });
        return [];
      }

      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const spielerTable = doc.querySelector('table.spieler');
      if (!spielerTable) {
        console.error(`${LOG_PREFIX} No spieler table found on player page`, { playerName });
        return [];
      }

      const rows = Array.from(spielerTable.querySelectorAll('tbody tr'));
      const rounds = [];

      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 7) return;

        // Round number (column 0)
        const roundCell = cells[0];
        const roundLink = roundCell.querySelector('a');
        const roundText = normalizeName(roundLink ? roundLink.textContent : roundCell.textContent);
        const roundMatch = roundText.match(/(\d+)/);
        const roundNumber = roundMatch ? parseInt(roundMatch[1]) : null;

        // Result (column 4 - tm)
        const resultCell = cells[4];
        const resultLink = resultCell.querySelector('a');
        const resultText = normalizeName(resultLink ? resultLink.textContent : resultCell.textContent);

        // Check if the player is white (column 3 - th) or black (column 5 - ta)
        const whiteCell = cells[3];
        const blackCell = cells[5];
        const whiteName = extractNameFromCell(whiteCell);
        const blackName = extractNameFromCell(blackCell);

        // Determine if the player is white or black
        const isPlayerWhite = canonicalizeName(whiteName) === canonicalizeName(playerName);
        const opponentName = isPlayerWhite ? blackName : whiteName;
        
        // Opponent DWZ (column 6 for black, column 2 for white)
        const opponentDwzCell = isPlayerWhite ? cells[6] : cells[2];
        const opponentDwz = normalizeName(opponentDwzCell.textContent).replace(/[^\d]/g, '');

        // Parse points earned
        let pointsEarned;
        if (resultText === 'LIVE' || resultText === '?') {
          pointsEarned = '?';
        } else {
          const resultMatch = resultText.match(/([½\d+-]+)\s*:\s*([½\d+-]+)/);
          if (resultMatch) {
            const homePoints = parsePoints(resultMatch[1]);
            const awayPoints = parsePoints(resultMatch[2]);
            pointsEarned = isPlayerWhite ? homePoints : awayPoints;
          }
        }

        if (roundNumber !== null && pointsEarned !== undefined) {
          rounds.push({
            roundNumber,
            pointsEarned,
            opponentName,
            opponentDwz
          });
        }
      });

      // Sort rounds in descending order by round number
      rounds.sort((a, b) => b.roundNumber - a.roundNumber);

      return rounds;
    } catch (error) {
      console.error(`${LOG_PREFIX} Error fetching spieler rounds`, { playerName, error });
      return [];
    }
  }

  function renderLvRoundColumns(tbodyBlocks) {
    tbodyBlocks.forEach(block => {
      const { tbody, headerRow, players } = block;
      
      // Fetch rounds for all players to determine the round numbers
      const allRoundsPromises = players.map(player => 
        fetchSpielerRounds(player.playerHref, player.playerName)
      );
      
      Promise.all(allRoundsPromises).then(allRounds => {
        // Get unique round numbers from all players, sorted in descending order
        const roundNumbers = new Set();
        allRounds.forEach(rounds => {
          rounds.forEach(round => roundNumbers.add(round.roundNumber));
        });
        const sortedRoundNumbers = Array.from(roundNumbers).sort((a, b) => b - a);
        
        if (sortedRoundNumbers.length === 0) return;
        
        // Add headers for each round to the header row
        sortedRoundNumbers.forEach(roundNumber => {
          const th = document.createElement('th');
          th.textContent = `${roundNumber}. Runde`;
          th.className = 'dsj-lv-round-header';
          headerRow.appendChild(th);
        });
        
        // Add round data to each player row
        players.forEach((player, playerIndex) => {
          const rounds = allRounds[playerIndex];
          const roundMap = new Map();
          rounds.forEach(round => {
            roundMap.set(round.roundNumber, round);
          });
          
          sortedRoundNumbers.forEach(roundNumber => {
            const td = document.createElement('td');
            td.className = 'dsj-lv-round-cell';
            
            const round = roundMap.get(roundNumber);
            if (round) {
              const pointsText = round.pointsEarned === '?' ? '?' : formatPoints(round.pointsEarned);
              const dwzText = round.opponentDwz ? ` (${round.opponentDwz})` : '';
              td.textContent = `${pointsText} ${round.opponentName}${dwzText}`;
            } else {
              td.textContent = '';
            }
            
            player.row.appendChild(td);
          });
        });
      });
    });
  }

  function renderCrossTable(table, teams, matrix) {
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');

    // Add bxv class to rightmost original header column
    const headerRow = thead.querySelector('tr');
    if (headerRow) {
      const lastOriginalHeader = headerRow.lastElementChild;
      if (lastOriginalHeader) {
        lastOriginalHeader.classList.add('bxv');
      }

      // Add cross table headers to existing header row
      teams.forEach((team) => {
        const th = document.createElement('th');
        th.className = CROSS_CLASS;
        th.textContent = team.position;
        headerRow.appendChild(th);
      });
    }

    // Add cross table cells to existing rows
    const bodyRows = Array.from(tbody.querySelectorAll('tr'));
    teams.forEach((team, rowIndex) => {
      const row = bodyRows[rowIndex];
      if (!row) return;

      // Add bxv class to rightmost original data column
      const lastOriginalCell = row.lastElementChild;
      if (lastOriginalCell) {
        lastOriginalCell.classList.add('bxv');
      }

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

    // Check if this is an LV page
    const isLvPage = table.classList.contains('lv');
    if (isLvPage) {
      console.info(`${LOG_PREFIX} Processing LV page`);
      relaxTableLayout(resultsContainer, table);
      const tbodyBlocks = parseLvTable(table);
      if (tbodyBlocks.length > 0) {
        renderLvRoundColumns(tbodyBlocks);
      }
      return;
    }

    relaxTableLayout(resultsContainer, table);

    let crossIsBuilt = false;
    let crossIsVisible = false;
    let boardIsBuilt = false;
    let boardIsVisible = false;
    let chartIsBuilt = false;
    let chartIsVisible = false;
    const boardResults = new BoardResults();
    const isDemPage = /\/dem(?:-|\/|$)/i.test(window.location.pathname) || document.body.classList.contains('dem');

    const pathChartContainer = document.createElement('div');
    pathChartContainer.className = 'dsj-path-chart-container';
    pathChartContainer.style.display = 'none';
    if (isTabellePage()) {
      injectPathChartStyles();
      resultsContainer.parentNode.insertBefore(pathChartContainer, resultsContainer);
    }

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
    }, isTabellePage() ? async (toggleLink) => {
      try {
        if (!chartIsBuilt) {
          const chartData = await buildPathToFinishData(resultsContainer);
          if (!chartData) {
            console.error(`${LOG_PREFIX} Failed to build Path to Finish chart.`);
            return;
          }
          createPathToFinishChart(pathChartContainer, chartData.players, chartData.roundCount, chartData.maxPosition);
          chartIsBuilt = true;
        }
        chartIsVisible = !chartIsVisible;
        pathChartContainer.style.display = chartIsVisible ? '' : 'none';
        setToggleVisualState(toggleLink, chartIsVisible);
      } catch (error) {
        console.error(`${LOG_PREFIX} Error while toggling Path to Finish chart`, error);
        setToggleVisualState(toggleLink, false);
      }
    } : null);
  }

  run();
})();