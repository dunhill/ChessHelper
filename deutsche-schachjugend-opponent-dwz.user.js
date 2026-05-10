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

  function extractRating(titleText, type) {
    if (!titleText) return null;
    const match = titleText.match(new RegExp(`\\b${type}\\s+(\\d+)\\b`, 'i'));
    return match ? match[1] : null;
  }

  function cleanPointsText(text) {
    return (text || '').replace(/\s*-\s*\d+\s*$/, '').trim();
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

  function collectEntries(table) {
    const resultCells = Array.from(table.querySelectorAll('td.results, td.ergebnis'));
    const entries = [];

    for (const cell of resultCells) {
      const title = cell.getAttribute('title') || '';
      const dwz = extractRating(title, 'DWZ');
      const elo = extractRating(title, 'ELO');

      const link = cell.querySelector('a');
      if (link) {
        const linkTextNode = Array.from(link.childNodes).find(
          (node) => node.nodeType === Node.TEXT_NODE && cleanPointsText(node.textContent)
        );
        if (linkTextNode) {
          entries.push({
            textNode: linkTextNode,
            originalText: linkTextNode.textContent,
            points: cleanPointsText(linkTextNode.textContent),
            dwz,
            elo
          });
          continue;
        }
      }

      const pointsNode = findScoreTextNode(cell);
      if (!pointsNode) continue;

      entries.push({
        textNode: pointsNode,
        originalText: pointsNode.textContent,
        points: cleanPointsText(pointsNode.textContent),
        dwz,
        elo
      });
    }

    return entries;
  }

  function applyMode(entries, mode) {
    for (const entry of entries) {
      if (!entry.points) continue;

      if (mode === 'none') {
        entry.textNode.textContent = entry.originalText;
        continue;
      }

      const rating = mode === 'dwz' ? entry.dwz : entry.elo;
      if (!rating) {
        entry.textNode.textContent = entry.originalText;
        continue;
      }

      entry.textNode.textContent = ` ${entry.points} - ${rating} `;
    }
  }

  function renderToggle(heading, entries) {
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

    heading.appendChild(wrapper);
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
      renderToggle(heading, entries);
      applyMode(entries, 'none');
    }

    if (!hasTable) {
      console.info(`${LOG_PREFIX} No results table found on this page.`);
    }
  }

  run();
})();
