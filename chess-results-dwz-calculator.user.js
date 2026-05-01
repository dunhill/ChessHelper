// ==UserScript==
// @name         Chess-Results DWZ Calculator
// @namespace    https://github.com/oleksiy/ChessHelper
// @version      0.1
// @description  Calculate a new DWZ rating for the selected player on chess-results.com pages with art=9 using Elo national values and opponent individual pages.
// @match        *://*.chess-results.com/*
// @match        *://chess-results.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  function isTargetPage() {
    const search = window.location.search;
    return search && search.includes('art=9');
  }

  function getLanZeroUrl() {
    const currentUrl = new URL(window.location.href);
    const currentLan = currentUrl.searchParams.get('lan');
    if (currentLan === '0') return null;
    currentUrl.searchParams.set('lan', '0');
    return currentUrl.toString();
  }

  function findTableByClassAndIndex(className, index) {
    const tables = Array.from(document.querySelectorAll(`table.${className}`));
    return tables[index] || null;
  }

  function parseNumericValue(text) {
    if (!text) return null;
    const normalized = text.replace(',', '.').replace(/[^0-9.+\-]/g, '').trim();
    if (!normalized) return null;
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }

  function parsePlayerDWZ(table, context = 'player') {
    if (!table) {
      console.debug(`[DWZCalc] ${context} table not found`);
      return null;
    }
    const rows = Array.from(table.querySelectorAll('tr'));
    console.debug(`[DWZCalc] ${context} table rows`, rows.length);
    let eloperformanceValue = null;

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 2) continue;
      const label = cells[0].textContent.trim().toLowerCase();
      const valueText = cells[1].textContent;
      if (label === 'elo national' || label === 'elo national:') {
        const value = parseNumericValue(valueText);
        console.debug(`[DWZCalc] ${context} parsed Elo national`, { text: valueText, value });
        if (value > 0) {
          return value;
        }
        console.debug(`[DWZCalc] ${context} Elo national is 0 or invalid, will use fallback`, { value });
        continue;
      }
      if (label === 'eloperformance' || label === 'elo performance' || label === 'elo performance:' || label === 'eloperformance:') {
        const value = parseNumericValue(valueText);
        console.debug(`[DWZCalc] ${context} parsed Elo performance fallback`, { text: valueText, value });
        eloperformanceValue = value;
      }
    }

    if (eloperformanceValue != null) {
      console.debug(`[DWZCalc] ${context} using Eloperformance fallback`, eloperformanceValue);
      return eloperformanceValue;
    }

    console.debug(`[DWZCalc] ${context} 'Elo national' row not found`);
    return null;
  }

  function parseOpponentRow(row, index) {
    const cells = Array.from(row.querySelectorAll('td'));
    if (cells.length < 6) {
      console.debug('[DWZCalc] opponent row skipped, insufficient cells', { index, cells: cells.length });
      return null;
    }

    const link = row.querySelector('a.CRdb');
    const url = link ? link.href : null;
    const name = link ? link.textContent.trim() : cells[4]?.textContent.trim();
    const rating = parseNumericValue(cells[5]?.textContent);
    const resultCell = cells[cells.length - 1];
    let resultText = resultCell ? resultCell.textContent.trim() : '';
    if (!resultText && resultCell) {
      resultText = resultCell.innerText.trim();
    }

    const result = parseResultValue(resultText);
    if (!name || result == null) {
      console.debug('[DWZCalc] opponent row skipped, missing data', { index, name, resultText, parsedResult: result });
      return null;
    }

    console.debug('[DWZCalc] parsed opponent row', { index, name, url, rating, result, resultText });
    return { name, url, rating, result };
  }

  function parseResultValue(text) {
    if (!text) return null;
    const trimmed = text.trim();
    if (trimmed === '1' || trimmed === '1:0' || trimmed === '1,0') return 1;
    if (trimmed === '0' || trimmed === '0:1' || trimmed === '0,1') return 0;
    if (trimmed === '½' || trimmed === '0.5' || trimmed === '0,5' || trimmed === '½:½') return 0.5;
    if (trimmed.includes('½')) return 0.5;
    if (/^[01]\s*[,\.]\s*5$/.test(trimmed)) return 0.5;
    if (/^[01]$/.test(trimmed)) return Number(trimmed);
    console.debug('[DWZCalc] unable to parse result value', trimmed);
    return null;
  }  

  function getCorsProxyUrls(targetUrl) {
    return [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
      `https://corsproxy.io/?u=${encodeURIComponent(targetUrl)}`,
      `https://thingproxy.freeboard.io/fetch/${targetUrl}`,
      `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`
    ];
  }

  async function fetchWithProxy(targetUrl, options = {}) {
    const proxies = getCorsProxyUrls(targetUrl);
    let lastError = null;

    for (const proxyUrl of proxies) {
      try {
        console.debug('[DWZCalc] attempting proxy fetch', proxyUrl);
        const response = await fetch(proxyUrl, options);
        if (!response.ok) {
          console.warn('[DWZCalc] proxy fetch failed', { proxyUrl, status: response.status, statusText: response.statusText });
          lastError = new Error(`Proxy failed ${proxyUrl} (${response.status})`);
          continue;
        }
        console.debug('[DWZCalc] proxy fetch succeeded', proxyUrl);
        return response;
      } catch (err) {
        console.warn('[DWZCalc] proxy fetch exception', proxyUrl, err);
        lastError = err;
      }
    }

    console.error('[DWZCalc] all proxy fetch attempts failed', { targetUrl, lastError });
    return null;
  }

  async function fetchOpponentDWZ(opponentUrl) {
    if (!opponentUrl) {
      console.debug('[DWZCalc] opponent URL missing');
      return null;
    }
    try {
      console.debug('[DWZCalc] fetch opponent page using proxy', opponentUrl);
      const response = await fetchWithProxy(opponentUrl);
      if (!response) {
        return null;
      }
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const table = doc.querySelector('table.CRs1');
      const dwz = parsePlayerDWZ(table, opponentUrl);
      console.debug('[DWZCalc] opponent page parsed DWZ', { opponentUrl, dwz });
      return dwz;
    } catch (err) {
      console.warn('[DWZCalc] Failed to fetch opponent DWZ from', opponentUrl, err);
      return null;
    }
  }

  function calculateExpectedScore(playerDWZ, opponentDWZ) {
    if (playerDWZ == null || opponentDWZ == null) return 0;
    const diff = opponentDWZ - playerDWZ;
    const exponent = diff / 400;
    return 1 / (1 + Math.pow(10, exponent));
  }

  function calculateNewDWZ(playerDWZ, opponentRatings, opponentResults) {
    const validOpponents = opponentRatings
      .map((rating, index) => ({ rating, result: opponentResults[index] }))
      .filter((entry) => entry.rating != null && entry.rating > 0 && entry.result != null);

    if (validOpponents.length === 0) return null;

    const expectedSum = validOpponents.reduce(
      (sum, opponent) => sum + calculateExpectedScore(playerDWZ, opponent.rating),
      0
    );
    const scoreSum = validOpponents.reduce((sum, opponent) => sum + opponent.result, 0);

    const correctionFactor = 20;
    const delta = (scoreSum - expectedSum) * correctionFactor;
    return {
      expectedSum,
      scoreSum,
      delta,
      newDWZ: playerDWZ + delta,
      count: validOpponents.length,
    };
  }

  function createPanel() {
    const panel = document.createElement('div');
    panel.style.border = '2px solid #334166';
    panel.style.background = '#f8f8ff';
    panel.style.padding = '12px';
    panel.style.margin = '12px 0';
    panel.style.maxWidth = '960px';
    panel.style.boxShadow = '0 2px 8px rgba(0,0,0,0.12)';
    panel.style.fontFamily = 'Arial, sans-serif';
    panel.id = 'dwzCalcPanel';
    return panel;
  }

  function renderResult(panel, playerDWZ, opponents, calculation) {
    panel.innerHTML = '';
    const heading = document.createElement('h3');
    heading.textContent = 'DWZ-Rechner für ausgewählten Spieler';
    heading.style.marginTop = '0';
    panel.appendChild(heading);

    const status = document.createElement('p');
    if (playerDWZ == null) {
      status.innerHTML = '<strong>Kein DWZ-Wert für den aktuellen Spieler gefunden.</strong>';
      panel.appendChild(status);
      return;
    }

    const summary = document.createElement('div');
    summary.innerHTML = `
      <strong>Aktuelle Elo national (DWZ):</strong> ${playerDWZ}<br>
      <strong>Auswertung gültiger Gegner:</strong> ${calculation.count}<br>
      <strong>Erzielte Punkte gegen diese Gegner:</strong> ${calculation.scoreSum.toFixed(1)}<br>
      <strong>Erwartete Punkte:</strong> ${calculation.expectedSum.toFixed(2)}<br>
      <strong>Delta:</strong> ${calculation.delta.toFixed(2)}<br>
      <strong>Neuer DWZ-Wert (berechnet):</strong> ${calculation.newDWZ.toFixed(0)}
    `;
    panel.appendChild(summary);

    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.marginTop = '12px';
    table.innerHTML = `
      <thead>
        <tr>
          <th style="border-bottom:1px solid #ccc; text-align:left; padding:6px">Gegner</th>
          <th style="border-bottom:1px solid #ccc; text-align:right; padding:6px">DWZ</th>
          <th style="border-bottom:1px solid #ccc; text-align:right; padding:6px">Ergebnis</th>
          <th style="border-bottom:1px solid #ccc; text-align:right; padding:6px">Erwartung</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');
    for (const opponent of opponents) {
      if (opponent.dwz == null || opponent.result == null) continue;
      const expected = calculateExpectedScore(playerDWZ, opponent.dwz);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding:6px; border-bottom:1px solid #eee">${opponent.name}</td>
        <td style="padding:6px; border-bottom:1px solid #eee; text-align:right">${opponent.dwz}</td>
        <td style="padding:6px; border-bottom:1px solid #eee; text-align:right">${opponent.result}</td>
        <td style="padding:6px; border-bottom:1px solid #eee; text-align:right">${expected.toFixed(2)}</td>
      `;
      tbody.appendChild(tr);
    }
    panel.appendChild(table);

    const note = document.createElement('p');
    note.style.fontSize = '0.95rem';
    note.style.color = '#444';
    note.style.marginTop = '10px';
    note.textContent = 'Gegner ohne gültige DWZ werden übersprungen. Die Berechnung verwendet das in der DWZ-Praxis übliche Erwartungswert-Modell mit einem Korrekturfaktor von 20.';
    panel.appendChild(note);
  }

  async function runCalculator() {
    console.info('[DWZCalc] runCalculator started');
    const infoTable = findTableByClassAndIndex('CRs1', 0);
    const opponentTable = findTableByClassAndIndex('CRs1', 1);
    console.debug('[DWZCalc] found infoTable', !!infoTable, 'opponentTable', !!opponentTable);

    const playerDWZ = parsePlayerDWZ(infoTable);
    console.debug('[DWZCalc] parsed player DWZ', playerDWZ);

    const opponentRows = opponentTable ? Array.from(opponentTable.querySelectorAll('tr')).slice(1) : [];
    console.debug('[DWZCalc] opponent rows count', opponentRows.length);

    const opponents = opponentRows
      .map((row, index) => parseOpponentRow(row, index))
      .filter(Boolean);
    console.debug('[DWZCalc] parsed opponents', opponents.length, opponents);

    if (opponents.length === 0) {
      console.warn('[DWZCalc] no opponent data parsed');
      alert('Keine Gegnerdaten gefunden. Bitte prüfen Sie die Tabelle der Gegner.');
      return;
    }

    const panel = document.getElementById('dwzCalcPanel');
    if (!panel) {
      console.warn('[DWZCalc] panel element not found');
      return;
    }
    panel.innerHTML = '<p>Lädt Gegner-DWZ-Werte...</p>';

    const opponentsWithDWZ = await Promise.all(opponents.map(async (opp, index) => {
      console.debug('[DWZCalc] fetching DWZ for opponent', { index, name: opp.name, url: opp.url, rating: opp.rating });
      const dwz = await fetchOpponentDWZ(opp.url);
      console.debug('[DWZCalc] fetched opponent DWZ', { index, name: opp.name, result: dwz });
      return {
        ...opp,
        dwz: dwz != null ? dwz : opp.rating,
      };
    }));

    const calculation = calculateNewDWZ(
      playerDWZ,
      opponentsWithDWZ.map((opp) => opp.dwz),
      opponentsWithDWZ.map((opp) => opp.result)
    );
    console.info('[DWZCalc] calculation result', calculation);

    if (!calculation) {
      console.warn('[DWZCalc] calculation could not be completed', { playerDWZ, opponentsWithDWZ });
    }

    renderResult(panel, playerDWZ, opponentsWithDWZ, calculation || { expectedSum: 0, scoreSum: 0, delta: 0, newDWZ: playerDWZ, count: 0 });
  }

  function addControl() {
    const wrapper = document.createElement('div');
    wrapper.style.margin = '16px 0';

    const lanZeroUrl = getLanZeroUrl();
    if (lanZeroUrl) {
      const languageHint = document.createElement('p');
      languageHint.style.margin = '0 0 10px 0';
      languageHint.style.fontSize = '0.95rem';
      languageHint.innerHTML = `Die aktuelle Sprache ist nicht <code>lan=0</code>. Für zuverlässige Label-Suche bitte auf <a href="${lanZeroUrl}">dieselbe Seite mit lan=0 wechseln</a>.`;
      wrapper.appendChild(languageHint);
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'DWZ neu berechnen';
    button.style.padding = '10px 16px';
    button.style.fontSize = '1rem';
    button.style.cursor = 'pointer';
    button.style.backgroundColor = '#334166';
    button.style.color = '#fff';
    button.style.border = 'none';
    button.style.borderRadius = '4px';
    button.style.marginBottom = '12px';

    const panel = createPanel();
    panel.textContent = 'Klicken Sie auf die Schaltfläche, um die neue DWZ anhand der Gegner-DWZ zu berechnen.';

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      console.info('[DWZCalc] button clicked');
      await runCalculator();
    });
    wrapper.appendChild(button);
    wrapper.appendChild(panel);

    const target = document.querySelector('div.defaultDialog h2');
    if (target && target.parentElement) {
      target.parentElement.insertBefore(wrapper, target.nextSibling);
    } else {
      document.body.insertBefore(wrapper, document.body.firstChild);
    }
  }

  if (isTargetPage()) {
    const observer = new MutationObserver(() => {
      console.debug('[DWZCalc] mutation observer fired');
      if (document.querySelector('table.CRs1')) {
        console.debug('[DWZCalc] table.CRs1 found, initializing control');
        observer.disconnect();
        addControl();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
