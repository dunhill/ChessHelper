// ==UserScript==
// @name         dsj-dem-history
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Show historical photos for participants of individual German chess championships
// @author       You
// @match        https://www.deutsche-schachjugend.de/*/spieler/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      www.deutsche-schachjugend.de
// ==/UserScript==

(function() {
    'use strict';

    // Parse player name from h1 element before br
    function getPlayerName() {
        const h1 = document.querySelector('main h1');
        if (!h1) return null;
        
        // Get text before the br element, skipping abbr elements (chess titles)
        const br = h1.querySelector('br');
        if (br) {
            // Get all child nodes before the br
            const textParts = [];
            for (let node = h1.firstChild; node && node !== br; node = node.nextSibling) {
                if (node.nodeType === Node.TEXT_NODE) {
                    textParts.push(node.textContent);
                } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'ABBR') {
                    textParts.push(node.textContent);
                }
            }
            return textParts.join('').trim();
        }
        
        // Fallback: split by br if br exists in innerHTML
        const parts = h1.innerHTML.split('<br>');
        if (parts.length > 0) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = parts[0];
            // Remove abbr elements
            const abbrElements = tempDiv.querySelectorAll('abbr');
            abbrElements.forEach(abbr => abbr.remove());
            return tempDiv.textContent.trim();
        }
        
        return h1.textContent.trim();
    }

    // Parse year of birth from Jahrgang field
    function getBirthYear() {
        const rows = document.querySelectorAll('main table tr');
        for (const row of rows) {
            const th = row.querySelector('th');
            const td = row.querySelector('td');
            if (th && td && th.textContent.includes('Jahrgang')) {
                const year = parseInt(td.textContent.trim());
                return year;
            }
        }
        return null;
    }

    // Parse player data from a player page HTML
    function parsePlayerData(html, year) {        
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        const data = {
            year: year,
            photo: null,
            tournament: null,
            startPosition: null,
            finalPosition: null,
            points: null,
            dwz: null,
            elo: null
        };

        // Photo - extract both thumbnail and high-res versions
        const photoLink = doc.querySelector('.spielerbild a');
        if (photoLink) {
            data.photoHighRes = photoLink.href;
            const photoImg = photoLink.querySelector('img');
            if (photoImg) {
                data.photo = photoImg.src;
                data.photoSrcset = photoImg.srcset || null;
            }
        }

        // Tournament (from h1 after br)
        const h1 = doc.querySelector('main h1');
        if (h1) {
            const br = h1.querySelector('br');
            if (br) {
                const link = br.nextElementSibling;
                if (link && link.tagName === 'A') {
                    let tournamentName = link.textContent.trim();
                    // Remove date pattern: dd. - dd.dd.dddd or dd.dd. - dd.dd.dddd
                    tournamentName = tournamentName.replace(/\d+\.(\d+\.)?\s*–\s*\d+\.\d+\.\d{4}/, '').trim();
                    data.tournament = tournamentName;
                }
            }
        }

        // Parse table data
        const playercard = doc.querySelector('.playercard');
        if (playercard) {
            const table = playercard.querySelector('table');
            if (table) {
                const rows = table.querySelectorAll('tr');
                for (const row of rows) {
                    const th = row.querySelector('th');
                    const td = row.querySelector('td');
                    if (!th || !td) continue;

                    const thText = th.textContent.trim();
                    const tdText = td.textContent.trim();

                    if (thText.includes('Platz')) {
                        // Format: "10." (Setzliste 14)
                        const match = tdText.match(/(\d+)\.\s*\(Setzliste\s*(\d+)\)/);
                        if (match) {
                            data.finalPosition = match[1] + '.';
                            data.startPosition = match[2];
                        }
                    } else if (thText.includes('Punkte')) {
                        data.points = tdText;
                    } else if (thText.includes('Wertung')) {
                        // Format: "DWZ: 2181, Elo: 2232"
                        const dwzMatch = tdText.match(/DWZ:\s*(\d+)/);
                        const eloMatch = tdText.match(/Elo:\s*(\d+)/);
                        if (dwzMatch) data.dwz = dwzMatch[1];
                        if (eloMatch) data.elo = eloMatch[1];
                    }
                }
            }
        }

        return data;
    }

    // Generate name variants for search (e.g., Maria -> Maria, Mariia)
    function getNameVariants(playerName) {
        const variants = [playerName];
        
        // Check if name contains Maria
        if (playerName.toLowerCase().includes('maria')) {
            // Replace Maria with Mariia
            const mariiaVariant = playerName.replace(/Maria/gi, 'Mariia');
            if (mariiaVariant !== playerName) {
                variants.push(mariiaVariant);
            }
        }
        
        return variants;
    }

    // Search for player in a specific year with name variants
    function searchPlayerInYear(playerName, year) {
        return new Promise((resolve) => {
            const nameVariants = getNameVariants(playerName);
            let foundUrl = null;
            let searchIndex = 0;

            function tryNextVariant() {
                if (searchIndex >= nameVariants.length) {
                    resolve(foundUrl);
                    return;
                }

                const currentName = nameVariants[searchIndex];
                const encodedName = encodeURIComponent(currentName);
                const searchUrl = `https://www.deutsche-schachjugend.de/${year}/dem/suche/?q=${encodedName}`;

                GM_xmlhttpRequest({
                    method: 'GET',
                    url: searchUrl,
                    onload: function(response) {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(response.responseText, 'text/html');
                        
                        // Look for element with player name and href to player profile
                        const links = doc.querySelectorAll('a');
                        for (const link of links) {
                            const linkText = link.textContent.trim();
                            // Match if link text contains any of the name variants
                            if (nameVariants.some(variant => linkText === variant) && link.href.includes('/spieler/')) {
                                // Use the exact href attribute from the search page (not resolved)
                                const exactHref = link.getAttribute('href');
                                
                                // Resolve the relative URL properly using URL constructor
                                const absoluteUrl = new URL(exactHref, searchUrl).href;
                                foundUrl = absoluteUrl;
                                resolve(absoluteUrl);
                                return;
                            }
                        }
                        
                        // Try next variant
                        searchIndex++;
                        tryNextVariant();
                    },
                    onerror: function() {
                        // Try next variant on error
                        searchIndex++;
                        tryNextVariant();
                    }
                });
            }

            tryNextVariant();
        });
    }

    // Fetch player data from a specific URL
    function fetchPlayerData(url, year) {
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                onload: function(response) {
                    const data = parsePlayerData(response.responseText, year);
                    resolve(data);
                },
                onerror: function() {
                    resolve(null);
                }
            });
        });
    }

    // Create history table
    function createHistoryTable(playerDataList) {
        // Sort by year ascending
        playerDataList.sort((a, b) => a.year - b.year);

        const table = document.createElement('table');
        table.style.marginTop = '20px';
        table.style.borderCollapse = 'collapse';
        table.style.width = '100%';

        // Header row with years
        const headerRow = document.createElement('tr');
        const labelHeader = document.createElement('th');
        labelHeader.textContent = 'Category';
        labelHeader.style.border = '1px solid #ccc';
        labelHeader.style.padding = '8px';
        labelHeader.style.backgroundColor = '#f0f0f0';
        headerRow.appendChild(labelHeader);

        for (const data of playerDataList) {
            const yearHeader = document.createElement('th');
            const yearLink = document.createElement('a');
            yearLink.href = data.profileUrl;
            yearLink.textContent = data.year;
            yearLink.style.color = '#0066cc';
            yearLink.style.textDecoration = 'none';
            yearLink.style.fontWeight = 'bold';
            yearHeader.appendChild(yearLink);
            yearHeader.style.border = '1px solid #ccc';
            yearHeader.style.padding = '8px';
            yearHeader.style.backgroundColor = '#f0f0f0';
            headerRow.appendChild(yearHeader);
        }
        table.appendChild(headerRow);

        // Helper function to create data row
        function createRow(label, getValue) {
            const row = document.createElement('tr');
            const labelCell = document.createElement('td');
            labelCell.textContent = label;
            labelCell.style.border = '1px solid #ccc';
            labelCell.style.padding = '8px';
            labelCell.style.fontWeight = 'bold';
            row.appendChild(labelCell);

            for (const data of playerDataList) {
                const cell = document.createElement('td');
                const value = getValue(data);
                
                if (label === 'Photo' && value) {
                    // Create the same structure as profile page: link wrapping img with js-gallery class
                    const photoContainer = document.createElement('p');
                    photoContainer.className = 'spielerbild js-gallery';
                    
                    const photoLink = document.createElement('a');
                    photoLink.href = data.photoHighRes || value;
                    photoLink.className = 'js-img';
                    
                    const img = document.createElement('img');
                    img.src = value;
                    if (data.photoSrcset) {
                        img.srcset = data.photoSrcset;
                    }
                    img.alt = '';
                    
                    photoLink.appendChild(img);
                    photoContainer.appendChild(photoLink);
                    cell.appendChild(photoContainer);
                } else {
                    cell.textContent = value || '-';
                }
                
                cell.style.border = '1px solid #ccc';
                cell.style.padding = '8px';
                cell.style.textAlign = 'center';
                row.appendChild(cell);
            }
            table.appendChild(row);
        }

        // Create rows
        createRow('Photo', data => data.photo);
        createRow('Tournament', data => data.tournament);
        createRow('Starting Position', data => data.startPosition);
        createRow('Final Position', data => data.finalPosition);
        createRow('Points', data => data.points);
        createRow('DWZ', data => data.dwz);
        createRow('ELO', data => data.elo);

        return table;
    }

    // Main function
    async function main() {
        const playerName = getPlayerName();
        if (!playerName) {
            console.log('Could not find player name');
            return;
        }

        const birthYear = getBirthYear();
        if (!birthYear) {
            console.log('Could not find birth year');
            return;
        }

        const currentYear = new Date().getFullYear();
        const startYear = birthYear + 5;

        console.log(`Searching for ${playerName} from ${startYear} to ${currentYear}`);

        // Insert heading and loading spinner immediately
        const main = document.querySelector('main');
        if (!main) return;

        const heading = document.createElement('h2');
        heading.textContent = 'Historical Data';
        heading.style.marginTop = '30px';
        main.parentNode.insertBefore(heading, main.nextSibling);

        const loadingDiv = document.createElement('div');
        loadingDiv.id = 'dsj-history-loading';
        loadingDiv.style.marginTop = '20px';
        loadingDiv.style.padding = '20px';
        loadingDiv.style.textAlign = 'center';
        loadingDiv.style.color = '#666';
        loadingDiv.innerHTML = '<p>Loading historical data...</p>';
        main.parentNode.insertBefore(loadingDiv, heading.nextSibling);

        const playerDataList = [];

        // Search for player in each year
        for (let year = startYear; year <= currentYear; year++) {
            console.log(`Searching in year ${year}...`);
            const profileUrl = await searchPlayerInYear(playerName, year);
            
            if (profileUrl) {
                console.log(`Found profile for ${year}: ${profileUrl}`);
                const playerData = await fetchPlayerData(profileUrl, year);
                if (playerData) {
                    playerData.profileUrl = profileUrl;
                    playerDataList.push(playerData);
                }
            } else {
                console.log(`No profile found for ${year}`);
            }
        }

        // Remove loading spinner
        loadingDiv.remove();

        if (playerDataList.length === 0) {
            console.log('No historical data found');
            const noDataDiv = document.createElement('div');
            noDataDiv.style.marginTop = '20px';
            noDataDiv.style.padding = '20px';
            noDataDiv.style.textAlign = 'center';
            noDataDiv.style.color = '#666';
            noDataDiv.textContent = 'No historical data found for this player.';
            main.parentNode.insertBefore(noDataDiv, heading.nextSibling);
            return;
        }

        // Create and insert the table
        const table = createHistoryTable(playerDataList);
        main.parentNode.insertBefore(table, heading.nextSibling);
        
        // Initialize magnific-popup on the new photos if the library is available
        if (typeof $ !== 'undefined' && $.magnificPopup) {
            $('.js-gallery').magnificPopup({
                delegate: 'a.js-img',
                type: 'image',
                gallery: {
                    enabled: true
                }
            });
        }
    }

    // Run the script
    main();
})();
