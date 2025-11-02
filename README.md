# ChessHelper
Helper tools and scripts for chess

## dwzCompare
Shows the DWZ progress for multiple players on the same chart.
Written with ChatGPT.

### Loading data
* Loads data per list of comma separated Player DWZ IDs
* Can import Player DWZ IDs from:
  * Top-N players per filter (age, sex, bundesland). See "Player Name-ID mapping"
  * chess-results table. See "Player Name-ID mapping"
* Can load only last X months
* Caches tournament dates in the browser local cache to minimize the calls to DWZ website

#### Player Name-ID mapping
The mapping from Player Name to their DWZ ID needs to fetched manually from https://www.schachbund.de/dwz-archiv-downloads-dsb.html, e.g. https://dwz.svw.info/services/files/export/csv/LV-0-csv_v2.zip


### Displaying data
* Displays DWZ progress on the time chart with the precise matching of the tournaments to the dates
* Can toggle visibility of individual players on the chart
* Can adjust the timeline to the age of the players. Usefull to compare DWZ progres when players were at the same age
* Shows the cache usage and the total number of tournaments in the cache

### Todo
* Fetch players from the history window. Order by name, checkboxes for multiple select
* Cache local location of the player-ID mapping file and automaticaly use it when needed