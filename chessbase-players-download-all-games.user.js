// ==UserScript==
// @name         ChessBase Players - Download All Games
// @namespace    https://github.com/oleksiy/ChessHelper
// @version      0.1
// @description  Add a button to collect all games from pagination and download as PGN.
// @match        https://players.chessbase.com/en/player/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const LOG_PREFIX = '[ChessBasePGN]';
  const NEXT_BUTTON_ID = 'b-btnLoadNext-0';
  const PREV_BUTTON_ID = 'b-btnLoadPrev-0';
  const MOVES_SELECTOR = '.nota-game';
  const CAPTION_SELECTOR = '#cbcaption0, #cbcaptionDesk0 .hambCaption';
  const DOWNLOAD_BUTTON_ID = 'tm-download-all-games-btn';

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  function warn(...args) {
    console.warn(LOG_PREFIX, ...args);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getMovesContainer() {
    return document.querySelector(MOVES_SELECTOR);
  }

  function getCaptionText() {
    const caption = document.querySelector(CAPTION_SELECTOR);
    return caption ? caption.textContent.trim() : '';
  }

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function currentGameSignature() {
    const movesContainer = getMovesContainer();
    const moves = normalizeText(movesContainer ? movesContainer.innerText : '');
    const caption = normalizeText(getCaptionText());
    return `${caption} || ${moves}`;
  }

  async function waitForSignatureChange(previousSignature, timeoutMs = 6000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const now = currentGameSignature();
      if (now && now !== previousSignature) {
        return true;
      }
      await sleep(120);
    }
    return false;
  }

  function getButtonById(id) {
    return document.getElementById(id);
  }

  function isButtonDisabled(button) {
    if (!button) return true;
    if (button.disabled) return true;
    if (button.getAttribute('aria-disabled') === 'true') return true;
    if (button.classList.contains('disabled')) return true;
    return false;
  }

  async function clickAndWaitForChange(button) {
    if (!button || isButtonDisabled(button)) return false;
    const before = currentGameSignature();
    button.click();
    const changed = await waitForSignatureChange(before);
    return changed;
  }

  async function goToFirstGame(maxSteps = 2000) {
    log('Rewinding to first game...');
    let moved = 0;
    for (let i = 0; i < maxSteps; i += 1) {
      const prevButton = getButtonById(PREV_BUTTON_ID);
      if (!prevButton || isButtonDisabled(prevButton)) {
        log('Reached first game. Rewind steps:', moved);
        return moved;
      }
      const changed = await clickAndWaitForChange(prevButton);
      if (!changed) {
        log('Previous click did not change game, assuming first game. Steps:', moved);
        return moved;
      }
      moved += 1;
      if (moved % 10 === 0) {
        log('Rewind progress:', moved, 'games');
      }
    }
    warn('Rewind reached max steps, continuing anyway.', maxSteps);
    return moved;
  }

  function extractResultFromMoves(movesText) {
    const match = movesText.match(/(1-0|0-1|1\/2-1\/2|\*)\s*$/);
    return match ? match[1] : '*';
  }

  function parsePlayersFromCaption(caption) {
    const cleaned = caption.replace(/\s+/g, ' ').trim();
    const dashIndex = cleaned.indexOf(' - ');
    if (dashIndex === -1) {
      return { white: '?', black: '?' };
    }
    const white = cleaned.slice(0, dashIndex).trim() || '?';
    let right = cleaned.slice(dashIndex + 3).trim();
    const commaEventIndex = right.indexOf(',');
    if (commaEventIndex !== -1) {
      right = right.slice(0, commaEventIndex).trim();
    }
    return { white, black: right || '?' };
  }

  function sanitizeMovetext(rawText) {
    return normalizeText(rawText);
  }

  function buildPgnForCurrentGame(index) {
    const movesContainer = getMovesContainer();
    if (!movesContainer) return null;

    const rawMovesText = movesContainer.innerText || movesContainer.textContent || '';
    const movetext = sanitizeMovetext(rawMovesText);
    if (!movetext) return null;

    const caption = normalizeText(getCaptionText());
    const players = parsePlayersFromCaption(caption);
    const result = extractResultFromMoves(movetext);
    const safeCaption = caption || `Game ${index}`;

    return [
      `[Event "${safeCaption.replace(/"/g, "'")}"]`,
      `[Site "players.chessbase.com"]`,
      `[Date "????.??.??"]`,
      `[Round "${index}"]`,
      `[White "${players.white.replace(/"/g, "'")}"]`,
      `[Black "${players.black.replace(/"/g, "'")}"]`,
      `[Result "${result}"]`,
      '',
      movetext,
      '',
    ].join('\n');
  }

  async function collectAllGames() {
    const movesContainer = getMovesContainer();
    if (!movesContainer) {
      throw new Error('Moves container ".nota-game" was not found.');
    }

    await goToFirstGame();

    const games = [];
    const signaturesSeen = new Set();
    const maxGames = 3000;
    let gameIndex = 1;

    while (gameIndex <= maxGames) {
      const signature = currentGameSignature();
      if (!signature) {
        warn('Empty game signature encountered, stopping.');
        break;
      }

      if (signaturesSeen.has(signature)) {
        log('Detected already processed signature; stopping at index', gameIndex);
        break;
      }

      signaturesSeen.add(signature);
      const pgn = buildPgnForCurrentGame(gameIndex);
      if (pgn) {
        games.push(pgn);
        log(`Collected game ${gameIndex}. Total collected: ${games.length}`);
      } else {
        warn(`Failed to parse game ${gameIndex}, skipping.`);
      }

      const nextButton = getButtonById(NEXT_BUTTON_ID);
      if (!nextButton || isButtonDisabled(nextButton)) {
        log('Next button unavailable/disabled; reached last game.');
        break;
      }

      const changed = await clickAndWaitForChange(nextButton);
      if (!changed) {
        log('Next click did not change game; reached last game.');
        break;
      }

      gameIndex += 1;
    }

    if (gameIndex > maxGames) {
      warn('Safety limit reached while collecting games.', maxGames);
    }

    return games;
  }

  function createDownload(filename, content) {
    const blob = new Blob([content], { type: 'application/x-chess-pgn;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function buildFilename() {
    const profileSlug = window.location.pathname.split('/').filter(Boolean).pop() || 'player';
    const date = new Date().toISOString().slice(0, 10);
    return `${profileSlug}-all-games-${date}.pgn`;
  }

  function setButtonBusy(button, busy) {
    button.disabled = busy;
    button.style.opacity = busy ? '0.7' : '1';
    button.textContent = busy ? 'Collecting games...' : 'Download all games';
  }

  function ensureDownloadButton() {
    if (document.getElementById(DOWNLOAD_BUTTON_ID)) return;

    const replayRoot = document.querySelector('.cbreplay') || document.body;
    const container = document.createElement('div');
    container.style.margin = '12px 0';

    const button = document.createElement('button');
    button.id = DOWNLOAD_BUTTON_ID;
    button.type = 'button';
    button.textContent = 'Download all games';
    button.style.padding = '10px 14px';
    button.style.cursor = 'pointer';
    button.style.fontSize = '14px';
    button.style.borderRadius = '6px';
    button.style.border = '1px solid #2f4778';
    button.style.background = '#3d5fa3';
    button.style.color = '#fff';

    button.addEventListener('click', async () => {
      setButtonBusy(button, true);
      try {
        log('Download all games started.');
        const games = await collectAllGames();
        if (!games.length) {
          alert('No games were collected from this page.');
          warn('No games collected.');
          return;
        }
        const pgnContent = games.join('\n');
        const filename = buildFilename();
        createDownload(filename, pgnContent);
        log(`Finished. Downloaded ${games.length} games as "${filename}".`);
      } catch (error) {
        console.error(LOG_PREFIX, 'Collection failed:', error);
        alert(`Failed to collect games: ${error.message}`);
      } finally {
        setButtonBusy(button, false);
      }
    });

    container.appendChild(button);
    replayRoot.parentElement.insertBefore(container, replayRoot);
    log('Download button inserted.');
  }

  function initWhenReady() {
    const observer = new MutationObserver(() => {
      if (getMovesContainer() && getButtonById(NEXT_BUTTON_ID) && getButtonById(PREV_BUTTON_ID)) {
        observer.disconnect();
        ensureDownloadButton();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    if (getMovesContainer()) {
      ensureDownloadButton();
    }
  }

  initWhenReady();
})();
