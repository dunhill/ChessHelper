# ChessHelper
Helper tools and scripts for chess

## dwzCompare
Shows the DWZ progress for multiple players on the same chart.
Written with ChatGPT.

### Loading data
* Loads data per list of comma separated DWZ IDs
* Can load only last X months
* Caches tournament dates in the browser local cache to minimiye the calls to DWZ website

### Displaying data
* Displays DWZ progress on the time chart with the precise matching of the tournaments to the dates
* Can toggle visibility of individual players on the chart
* Can adjust the timeline to the age of the players. Usefull to compare DWZ progres when players were at the same age
* Shows the cache usage and the total number of tournaments in the cache

The list of players needs to be fetched manually from https://www.schachbund.de/dwz-archiv-downloads-dsb.html, e.g. https://dwz.svw.info/services/files/export/csv/LV-0-csv_v2.zip

### Todo
* Fetch top-X players per filter (age, sex, bundesland)
* Fetch all players from the chess-results table