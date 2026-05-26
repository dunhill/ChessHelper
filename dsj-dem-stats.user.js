// ==UserScript==
// @name         DSJ DEM Stats Comparison
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Add comparison of statistics with previous years for DSJ DEM statistics pages
// @author       You
// @match        https://www.deutsche-schachjugend.de/*/dem/statistik/*
// @grant        GM_xmlhttpRequest
// @connect      deutsche-schachjugend.de
// @require      https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js
// ==/UserScript==

(function() {
    'use strict';

    // Wait for the page to load
    function waitForElement(selector, callback) {
        const element = document.querySelector(selector);
        if (element) {
            callback(element);
        } else {
            setTimeout(() => waitForElement(selector, callback), 100);
        }
    }

    // Extract the current year from the URL
    function getCurrentYear() {
        const match = window.location.href.match(/\/(\d{4})\/dem\/statistik\//);
        return match ? parseInt(match[1]) : null;
    }

    // Extract tournament name from table row
    function getTournamentName(row) {
        const link = row.querySelector('td:first-child a');
        return link ? link.textContent.trim() : null;
    }

    // Extract statistics from a table row
    function extractStats(row) {
        const cells = row.querySelectorAll('td.tz');
        return {
            teilnehmer: cells[0] ? parseFloat(cells[0].textContent.replace(/\s/g, '')) || 0 : 0,
            dwz: cells[3] ? parseFloat(cells[3].textContent.replace(/\s/g, '')) || 0 : 0,
            elo: cells[4] ? parseFloat(cells[4].textContent.replace(/\s/g, '')) || 0 : 0,
            alter: cells[11] ? parseFloat(cells[11].textContent.replace(/\s/g, '').replace(',', '.')) || 0 : 0
        };
    }

    // Fetch statistics for a specific year
    function fetchYearStats(year) {
        return new Promise((resolve, reject) => {
            const url = `https://www.deutsche-schachjugend.de/${year}/dem/statistik/`;
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                onload: function(response) {
                    if (response.status === 200) {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(response.responseText, 'text/html');
                        const tbody = doc.querySelector('#js-statistik');
                        if (tbody) {
                            const stats = {};
                            const rows = tbody.querySelectorAll('tr');
                            rows.forEach(row => {
                                const name = getTournamentName(row);
                                if (name) {
                                    stats[name] = extractStats(row);
                                }
                            });
                            resolve(stats);
                        } else {
                            resolve({});
                        }
                    } else {
                        resolve({});
                    }
                },
                onerror: function() {
                    resolve({});
                }
            });
        });
    }

    // Create the filter UI
    function createFilterUI() {
        // Remove existing filter if it exists
        const existingFilter = document.getElementById('vergleich-filter');
        if (existingFilter) {
            existingFilter.remove();
        }

        // Find the first h2 element with text "Turniere"
        const allH2s = document.querySelectorAll('h2');
        let h2Turniere = null;
        for (const h2 of allH2s) {
            if (h2.textContent.trim() === 'Turniere') {
                h2Turniere = h2;
                break;
            }
        }
        if (!h2Turniere) return;

        const filterDiv = document.createElement('div');
        filterDiv.id = 'vergleich-filter';
        filterDiv.style.marginBottom = '20px';
        filterDiv.style.padding = '15px';
        filterDiv.style.backgroundColor = '#f0f0f0';
        filterDiv.style.borderRadius = '5px';

        const h2 = document.createElement('h2');
        h2.textContent = 'Vergleich filter';
        filterDiv.appendChild(h2);

        // Parameter selector
        const paramLabel = document.createElement('label');
        paramLabel.textContent = 'Parameter: ';
        paramLabel.style.marginRight = '10px';
        filterDiv.appendChild(paramLabel);

        const paramSelect = document.createElement('select');
        paramSelect.id = 'param-select';
        paramSelect.style.marginRight = '20px';
        ['DWZ', 'Teilnehmer', 'ELO', 'Alter'].forEach(param => {
            const option = document.createElement('option');
            option.value = param.toLowerCase();
            option.textContent = param;
            if (param === 'DWZ') option.selected = true;
            paramSelect.appendChild(option);
        });
        filterDiv.appendChild(paramSelect);

        // Tournament selector
        const turnierLabel = document.createElement('label');
        turnierLabel.textContent = 'Turnier: ';
        turnierLabel.style.marginRight = '10px';
        filterDiv.appendChild(turnierLabel);

        const turnierSelect = document.createElement('select');
        turnierSelect.id = 'turnier-select';
        turnierSelect.style.marginRight = '20px';

        // Add special options
        const specialOptions = [
            { value: 'all_dem', label: 'all DEM' },
            { value: 'all_dem_w', label: 'all DEM w' },
            { value: 'all_dem_m', label: 'all DEM m' }
        ];
        specialOptions.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt.value;
            option.textContent = opt.label;
            if (opt.value === 'all_dem_w') option.selected = true;
            turnierSelect.appendChild(option);
        });

        // Add separator
        const separator = document.createElement('option');
        separator.disabled = true;
        separator.textContent = '---';
        turnierSelect.appendChild(separator);

        // Populate tournament options from the table
        const tbody = document.querySelector('#js-statistik');
        if (tbody) {
            const rows = tbody.querySelectorAll('tr');
            rows.forEach(row => {
                const name = getTournamentName(row);
                if (name) {
                    const option = document.createElement('option');
                    option.value = name;
                    option.textContent = name;
                    turnierSelect.appendChild(option);
                }
            });
        }
        filterDiv.appendChild(turnierSelect);

        // Years input
        const yearsLabel = document.createElement('label');
        yearsLabel.textContent = 'Jahre zurück: ';
        yearsLabel.style.marginRight = '10px';
        filterDiv.appendChild(yearsLabel);

        const yearsInput = document.createElement('input');
        yearsInput.type = 'number';
        yearsInput.id = 'years-input';
        yearsInput.value = '5';
        yearsInput.min = '1';
        yearsInput.max = '20';
        yearsInput.style.width = '60px';
        yearsInput.style.marginRight = '20px';
        filterDiv.appendChild(yearsInput);

        // Top players input
        const topPlayersLabel = document.createElement('label');
        topPlayersLabel.textContent = 'Anzahl Top Spieler: ';
        topPlayersLabel.style.marginRight = '10px';
        filterDiv.appendChild(topPlayersLabel);

        const topPlayersInput = document.createElement('input');
        topPlayersInput.type = 'number';
        topPlayersInput.id = 'top-players-input';
        topPlayersInput.value = '0';
        topPlayersInput.min = '0';
        topPlayersInput.max = '50';
        topPlayersInput.style.width = '60px';
        topPlayersInput.style.marginRight = '20px';
        filterDiv.appendChild(topPlayersInput);

        // Update button
        const updateButton = document.createElement('button');
        updateButton.textContent = 'Aktualisieren';
        updateButton.style.padding = '5px 15px';
        updateButton.style.cursor = 'pointer';
        updateButton.addEventListener('click', updateComparison);
        filterDiv.appendChild(updateButton);

        // Insert before the h2 Turniere
        h2Turniere.parentNode.insertBefore(filterDiv, h2Turniere);
    }

    // Get parameter value based on selection
    function getParameterValue(stats, param) {
        switch(param) {
            case 'dwz': return stats.dwz;
            case 'teilnehmer': return stats.teilnehmer;
            case 'elo': return stats.elo;
            case 'alter': return stats.alter;
            default: return 0;
        }
    }

    // Get the set of turniers based on selection
    function getTurnierSet(selectedTurnier) {
        const tbody = document.querySelector('#js-statistik');
        if (!tbody) return [];

        const allTurniers = [];
        const rows = tbody.querySelectorAll('tr');
        rows.forEach(row => {
            const name = getTournamentName(row);
            if (name) allTurniers.push(name);
        });

        switch(selectedTurnier) {
            case 'all_dem':
                return allTurniers.filter(t => t.startsWith('DEM '));
            case 'all_dem_w':
                return allTurniers.filter(t => t.startsWith('DEM ') && t.endsWith('w'));
            case 'all_dem_m':
                return allTurniers.filter(t => t.startsWith('DEM ') && !t.endsWith('w'));
            default:
                return [selectedTurnier];
        }
    }

    // Extract current year stats from the table
    function extractCurrentYearStats() {
        const tbody = document.querySelector('#js-statistik');
        if (!tbody) return {};

        const stats = {};
        const rows = tbody.querySelectorAll('tr');
        rows.forEach(row => {
            const name = getTournamentName(row);
            if (name) {
                stats[name] = extractStats(row);
            }
        });
        return stats;
    }

    // Convert tournament name to URL format (e.g., "DEM U14w" -> "dem-u14w")
    function tournamentNameToUrl(tournamentName) {
        return tournamentName.toLowerCase().replace(/\s+/g, '-');
    }

    // Fetch player data from tournament page
    function fetchPlayerData(year, tournamentName) {
        return new Promise((resolve) => {
            const urlTournament = tournamentNameToUrl(tournamentName);
            const url = `https://www.deutsche-schachjugend.de/${year}/${urlTournament}/spieler/`;
            console.log(`Fetching ${tournamentName} ${year} from ${url}`);
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                timeout: 30000,
                onload: function(response) {
                    if (response.status === 200) {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(response.responseText, 'text/html');
                        const tbody = doc.querySelector('#spieler');
                        if (tbody) {
                            const rows = tbody.querySelectorAll('tr');
                            
                            // Find DWZ and ELO column indices from header row
                            let dwzIndex = -1;
                            let eloIndex = -1;
                            const table = tbody.closest('table');
                            const thead = table ? table.querySelector('thead') : null;
                            const headerRow = thead ? thead.querySelector('tr') : null;
                            if (headerRow) {
                                const headerCells = headerRow.querySelectorAll('th');
                                headerCells.forEach((th, index) => {
                                    const abbr = th.querySelector('abbr');
                                    const text = abbr ? abbr.textContent.trim().toLowerCase() : th.textContent.trim().toLowerCase();
                                    if (text.includes('dwz')) {
                                        dwzIndex = index;
                                    }
                                    if (text.includes('elo')) {
                                        eloIndex = index;
                                    }
                                });
                            }
                            
                            if (dwzIndex === -1 || eloIndex === -1) {
                                console.log(`${tournamentName} ${year}: Could not find DWZ or ELO columns`);
                                resolve([]);
                                return;
                            }
                            
                            const players = [];
                            rows.forEach((row) => {
                                const cells = row.querySelectorAll('td');
                                if (cells.length > Math.max(dwzIndex, eloIndex)) {
                                    const dwz = cells[dwzIndex] ? parseFloat(cells[dwzIndex].textContent.trim()) || 0 : 0;
                                    const elo = cells[eloIndex] ? parseFloat(cells[eloIndex].textContent.trim()) || 0 : 0;
                                    if (dwz > 0 || elo > 0) {
                                        players.push({ dwz, elo });
                                    }
                                }
                            });
                            console.log(`${tournamentName} ${year}: Fetched ${players.length} players`);
                            resolve(players);
                        } else {
                            console.log(`${tournamentName} ${year}: No player table found`);
                            resolve([]);
                        }
                    } else {
                        console.log(`${tournamentName} ${year}: Failed to fetch (status ${response.status})`);
                        resolve([]);
                    }
                },
                onerror: function(response) {
                    console.log(`${tournamentName} ${year}: Error fetching - page did not open`);
                    resolve([]);
                },
                ontimeout: function() {
                    console.log(`${tournamentName} ${year}: Timeout`);
                    resolve([]);
                }
            });
        });
    }

    // Calculate average of top N players for a parameter
    function calculateTopPlayersAverage(players, param, topN) {
        if (topN <= 0 || players.length === 0) return null;

        // Use original order of rows (do not sort)
        // Take first N players from the list
        const topPlayers = players.slice(0, Math.min(topN, players.length));

        // Calculate average
        const sum = topPlayers.reduce((acc, player) => {
            return acc + (param === 'dwz' ? player.dwz : player.elo);
        }, 0);

        const avg = sum / topPlayers.length;
        return Math.round(avg);
    }

    // Update the comparison
    async function updateComparison() {
        const param = document.getElementById('param-select').value;
        const selectedTurnier = document.getElementById('turnier-select').value;
        const yearsBack = parseInt(document.getElementById('years-input').value);
        const topPlayersN = parseInt(document.getElementById('top-players-input').value);
        const currentYear = getCurrentYear();

        if (!selectedTurnier) {
            alert('Bitte wählen Sie ein Turnier aus.');
            return;
        }

        // Get the set of turniers to compare
        const turnierSet = getTurnierSet(selectedTurnier);

        // Remove existing comparison columns and chart
        removeComparisonColumns();
        removeChart();

        // Fetch data for current year and previous years
        const yearsData = {};
        // Add current year data from the table
        yearsData[currentYear] = extractCurrentYearStats();
        // Fetch previous years
        for (let i = 1; i <= yearsBack; i++) {
            const year = currentYear - i;
            const stats = await fetchYearStats(year);
            yearsData[year] = stats;
        }

        // If top players is non-zero and param is DWZ or ELO, fetch player data and calculate averages
        if (topPlayersN > 0 && (param === 'dwz' || param === 'elo')) {
            for (const year in yearsData) {
                for (const turnierName of turnierSet) {
                    if (yearsData[year][turnierName]) {
                        await new Promise(resolve => setTimeout(resolve, 200)); // Add delay between requests
                        const players = await fetchPlayerData(parseInt(year), turnierName);
                        const avg = calculateTopPlayersAverage(players, param, topPlayersN);
                        if (avg !== null) {
                            // Create a modified stats object with the calculated average
                            yearsData[year][turnierName] = {
                                ...yearsData[year][turnierName],
                                [param]: avg,
                                _topPlayersAvg: true
                            };
                            console.log(`${turnierName} ${year}: Top ${topPlayersN} ${param.toUpperCase()} average = ${avg}`);
                        } else {
                            console.log(`${turnierName} ${year}: Could not calculate average - removing stats entry`);
                            // Remove the stats entry to show empty cells
                            delete yearsData[year][turnierName];
                        }
                    }
                }
            }
        }

        // Add comparison columns to the table
        addComparisonColumns(yearsData, param, turnierSet);

        // Add chart
        addChart(yearsData, param, turnierSet, selectedTurnier);
    }

    // Remove existing comparison columns
    function removeComparisonColumns() {
        const table = document.querySelector('.results table');
        if (!table) return;

        const thead = table.querySelector('thead tr');
        const tbody = table.querySelector('#js-statistik');
        const tfoot = table.querySelector('tfoot tr');

        // Remove comparison columns from header
        const headerCells = thead.querySelectorAll('th.comparison-col');
        headerCells.forEach(cell => cell.remove());

        // Remove comparison columns from body rows
        if (tbody) {
            const rows = tbody.querySelectorAll('tr');
            rows.forEach(row => {
                const cells = row.querySelectorAll('td.comparison-col');
                cells.forEach(cell => cell.remove());
            });
        }

        // Remove comparison columns from footer
        const footerCells = tfoot.querySelectorAll('th.comparison-col');
        footerCells.forEach(cell => cell.remove());
    }

    // Add comparison columns to the table
    function addComparisonColumns(yearsData, param, turnierSet) {
        const table = document.querySelector('.results table');
        if (!table) return;

        const thead = table.querySelector('thead tr');
        const tbody = table.querySelector('#js-statistik');
        const tfoot = table.querySelector('tfoot tr');

        // Sort years in ascending order
        const sortedYears = Object.keys(yearsData).map(Number).sort((a, b) => a - b);

        // Add header columns
        sortedYears.forEach(year => {
            const th = document.createElement('th');
            th.textContent = year;
            th.className = 'comparison-col tz';
            thead.appendChild(th);
        });

        // Add data columns for each row
        if (tbody) {
            const rows = tbody.querySelectorAll('tr');
            rows.forEach(row => {
                const turnierName = getTournamentName(row);
                sortedYears.forEach(year => {
                    const td = document.createElement('td');
                    td.className = 'comparison-col tz';
                    if (turnierName && turnierSet.includes(turnierName) && yearsData[year] && yearsData[year][turnierName]) {
                        const value = getParameterValue(yearsData[year][turnierName], param);
                        td.textContent = value > 0 ? value : '-';
                    } else {
                        td.textContent = '-';
                    }
                    row.appendChild(td);
                });
            });
        }

        // Add footer columns
        sortedYears.forEach(year => {
            const th = document.createElement('th');
            th.className = 'comparison-col tz';
            th.textContent = '-';
            tfoot.appendChild(th);
        });
    }

    // Remove existing chart
    function removeChart() {
        const existingChart = document.getElementById('comparison-chart');
        if (existingChart) {
            // Destroy chart instance if it exists
            const canvas = existingChart.querySelector('#chart-canvas');
            if (canvas && canvas.chart) {
                canvas.chart.destroy();
            }
            existingChart.remove();
        }
    }

    // Add chart below the table
    function addChart(yearsData, param, turnierSet, selectedTurnier) {
        const resultsDiv = document.querySelector('.results');
        if (!resultsDiv) return;

        const chartContainer = document.createElement('div');
        chartContainer.id = 'comparison-chart';
        chartContainer.style.marginTop = '30px';
        chartContainer.style.padding = '20px';
        chartContainer.style.backgroundColor = '#f9f9f9';
        chartContainer.style.borderRadius = '5px';
        chartContainer.style.maxWidth = '100%';
        chartContainer.style.overflow = 'hidden';

        const chartTitle = document.createElement('h3');
        chartTitle.textContent = `${selectedTurnier} - ${param.charAt(0).toUpperCase() + param.slice(1)} über die Jahre`;
        chartContainer.appendChild(chartTitle);

        const canvasWrapper = document.createElement('div');
        canvasWrapper.style.position = 'relative';
        canvasWrapper.style.height = '500px';
        canvasWrapper.style.width = '100%';
        chartContainer.appendChild(canvasWrapper);

        const canvas = document.createElement('canvas');
        canvas.id = 'chart-canvas';
        canvasWrapper.appendChild(canvas);

        resultsDiv.parentNode.insertBefore(chartContainer, resultsDiv.nextSibling);

        // Sort years in ascending order
        const sortedYears = Object.keys(yearsData).map(Number).sort((a, b) => a - b);

        // Prepare data for each turnier
        const turnierData = {};
        turnierSet.forEach(turnier => {
            turnierData[turnier] = sortedYears.map(year => {
                if (yearsData[year] && yearsData[year][turnier]) {
                    return getParameterValue(yearsData[year][turnier], param);
                }
                return null;
            });
        });

        // Draw multi-line chart using Chart.js
        drawChart(canvas, sortedYears, turnierData);
    }

    // Draw a multi-line chart using Chart.js
    function drawChart(canvas, years, turnierData) {
        const turnierNames = Object.keys(turnierData);
        if (turnierNames.length === 0) return;

        // Define colors for different turniers
        const colors = ['#0066cc', '#cc0066', '#00cc66', '#ff6600', '#6600cc', '#00cccc', '#cc6600', '#660000'];

        // Prepare datasets for Chart.js
        const datasets = turnierNames.map((turnierName, index) => {
            const color = colors[index % colors.length];
            return {
                label: turnierName,
                data: years.map((year, i) => ({ x: year, y: turnierData[turnierName][i] })),
                borderColor: color,
                backgroundColor: color,
                pointRadius: 6,
                pointHoverRadius: 8,
                tension: 0.1,
                spanGaps: true
            };
        });

        // Destroy existing chart if it exists
        if (canvas.chart) {
            canvas.chart.destroy();
        }

        // Create new chart
        canvas.chart = new Chart(canvas, {
            type: 'line',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                aspectRatio: 2,
                scales: {
                    x: {
                        type: 'linear',
                        title: {
                            display: true,
                            text: 'Jahr'
                        },
                        ticks: {
                            stepSize: 1,
                            callback: function(value) {
                            return Math.round(value);
                            }
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Wert'
                        },
                        beginAtZero: false
                    }
                },
                plugins: {
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            title: function(context) {
                                return `Jahr: ${context[0].parsed.x}`;
                            },
                            label: function(context) {
                                return `${context.dataset.label}: ${context.parsed.y}`;
                            }
                        }
                    },
                    legend: {
                        display: true,
                        position: 'bottom'
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                }
            }
        });
    }

    // Initialize
    waitForElement('h2', createFilterUI);
})();
