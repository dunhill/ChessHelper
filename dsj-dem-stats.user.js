// ==UserScript==
// @name         DSJ DEM Stats Comparison
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Add comparison of statistics with previous years for DSJ DEM statistics pages
// @author       You
// @match        https://www.deutsche-schachjugend.de/*/dem/statistik/*
// @grant        GM_xmlhttpRequest
// @connect      deutsche-schachjugend.de
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
            dwz: cells[4] ? parseFloat(cells[4].textContent.replace(/\s/g, '')) || 0 : 0,
            elo: cells[5] ? parseFloat(cells[5].textContent.replace(/\s/g, '')) || 0 : 0,
            alter: cells[12] ? parseFloat(cells[12].textContent.replace(/\s/g, '').replace(',', '.')) || 0 : 0
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
        const h2Turniere = document.querySelector('h2');
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
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '-- Bitte wählen --';
        turnierSelect.appendChild(defaultOption);

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

    // Update the comparison
    async function updateComparison() {
        const param = document.getElementById('param-select').value;
        const selectedTurnier = document.getElementById('turnier-select').value;
        const yearsBack = parseInt(document.getElementById('years-input').value);
        const currentYear = getCurrentYear();

        if (!selectedTurnier) {
            alert('Bitte wählen Sie ein Turnier aus.');
            return;
        }

        // Remove existing comparison columns and chart
        removeComparisonColumns();
        removeChart();

        // Fetch data for previous years
        const yearsData = {};
        for (let i = 1; i <= yearsBack; i++) {
            const year = currentYear - i;
            const stats = await fetchYearStats(year);
            if (stats[selectedTurnier]) {
                yearsData[year] = stats[selectedTurnier];
            }
        }

        // Add comparison columns to the table
        addComparisonColumns(yearsData, param);

        // Add chart
        addChart(yearsData, param, selectedTurnier);
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
    function addComparisonColumns(yearsData, param) {
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
                    if (turnierName && yearsData[year]) {
                        const value = getParameterValue(yearsData[year], param);
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
            existingChart.remove();
        }
    }

    // Add chart below the table
    function addChart(yearsData, param, selectedTurnier) {
        const resultsDiv = document.querySelector('.results');
        if (!resultsDiv) return;

        const chartContainer = document.createElement('div');
        chartContainer.id = 'comparison-chart';
        chartContainer.style.marginTop = '30px';
        chartContainer.style.padding = '20px';
        chartContainer.style.backgroundColor = '#f9f9f9';
        chartContainer.style.borderRadius = '5px';

        const chartTitle = document.createElement('h3');
        chartTitle.textContent = `${selectedTurnier} - ${param.charAt(0).toUpperCase() + param.slice(1)} über die Jahre`;
        chartContainer.appendChild(chartTitle);

        const canvas = document.createElement('canvas');
        canvas.id = 'chart-canvas';
        canvas.style.width = '100%';
        canvas.style.height = '400px';
        chartContainer.appendChild(canvas);

        resultsDiv.parentNode.insertBefore(chartContainer, resultsDiv.nextSibling);

        // Sort years in ascending order
        const sortedYears = Object.keys(yearsData).map(Number).sort((a, b) => a - b);
        const values = sortedYears.map(year => getParameterValue(yearsData[year], param));

        // Draw simple chart using canvas
        drawChart(canvas, sortedYears, values, param);
    }

    // Draw a simple line chart
    function drawChart(canvas, years, values, param) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width = canvas.offsetWidth;
        const height = canvas.height = canvas.offsetHeight;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        if (values.length === 0) return;

        const padding = 60;
        const chartWidth = width - padding * 2;
        const chartHeight = height - padding * 2;

        // Find min and max values
        const minValue = Math.min(...values.filter(v => v > 0));
        const maxValue = Math.max(...values);

        // Draw axes
        ctx.beginPath();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.moveTo(padding, padding);
        ctx.lineTo(padding, height - padding);
        ctx.lineTo(width - padding, height - padding);
        ctx.stroke();

        // Draw Y-axis labels
        ctx.fillStyle = '#333';
        ctx.font = '12px Arial';
        ctx.textAlign = 'right';
        const ySteps = 5;
        for (let i = 0; i <= ySteps; i++) {
            const value = minValue + (maxValue - minValue) * (i / ySteps);
            const y = height - padding - (chartHeight * (i / ySteps));
            ctx.fillText(Math.round(value), padding - 10, y + 4);

            // Draw grid line
            ctx.beginPath();
            ctx.strokeStyle = '#ddd';
            ctx.lineWidth = 1;
            ctx.moveTo(padding, y);
            ctx.lineTo(width - padding, y);
            ctx.stroke();
        }

        // Draw X-axis labels
        ctx.textAlign = 'center';
        years.forEach((year, index) => {
            const x = padding + (chartWidth * (index / (years.length - 1 || 1)));
            ctx.fillText(year, x, height - padding + 20);
        });

        // Draw data line
        ctx.beginPath();
        ctx.strokeStyle = '#0066cc';
        ctx.lineWidth = 3;
        years.forEach((year, index) => {
            const x = padding + (chartWidth * (index / (years.length - 1 || 1)));
            const value = values[index];
            if (value > 0) {
                const y = height - padding - (chartHeight * ((value - minValue) / (maxValue - minValue || 1)));
                if (index === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        });
        ctx.stroke();

        // Draw data points
        years.forEach((year, index) => {
            const x = padding + (chartWidth * (index / (years.length - 1 || 1)));
            const value = values[index];
            if (value > 0) {
                const y = height - padding - (chartHeight * ((value - minValue) / (maxValue - minValue || 1)));
                ctx.beginPath();
                ctx.fillStyle = '#0066cc';
                ctx.arc(x, y, 6, 0, Math.PI * 2);
                ctx.fill();

                // Draw value label
                ctx.fillStyle = '#333';
                ctx.textAlign = 'center';
                ctx.fillText(value, x, y - 15);
            }
        });
    }

    // Initialize
    waitForElement('h2', createFilterUI);
})();
