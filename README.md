# ChessHelper
Helper tools and scripts for chess

## Todo
* create app to collect statistics of player's mistakes per game stage (opening, middle game, endspiel) and average centipawns per opponents DWZ rating. Use lichess API or any other open API for chess game analysis. Take the games from the official DEM, DVM, DLM sources
* add save/merge browser cache
* publish the app on the web

## dwzCompare
Shows the DWZ progress for multiple players on the same chart.
Written with ChatGPT.

### Loading data
* Loads data per list of comma separated Player DWZ IDs
* Can import Player DWZ IDs from:
  * Top-N players per filter (age, sex, bundesland). See "Player Name-ID mapping"
  * chess-results table. See "Player Name-ID mapping"
  * history of earlier lookups
* Can load only last X months
* Caches tournament dates in the browser local cache to minimize the calls to DWZ website

#### Presets
* **Save to Preset**: Allows saving the current list of selected players as a named preset. Users can either enter a new preset name or select an existing preset to overwrite. Presets are stored in the browser's local storage.
* **Load from Preset**: Allows loading a previously saved preset, replacing the current player list with the preset's player list. Users select a preset from a list of all saved presets.

#### Player Name-ID mapping
The mapping from Player Name to their DWZ ID needs to fetched manually from https://www.schachbund.de/dwz-archiv-downloads-dsb.html, e.g. https://dwz.svw.info/services/files/export/csv/LV-0-csv_v2.zip


### Displaying data
* Displays DWZ progress on the time chart with the precise matching of the tournaments to the dates
* Can toggle visibility of individual players on the chart
* Can adjust the timeline to the age of the players. Usefull to compare DWZ progres when players were at the same age
* Shows the cache usage and the total number of tournaments in the cache

## Chess Time Entry

A web-based tool for entering remaining time information for chess moves from PGN notation. The tool parses PGN format, extracts moves, and allows users to input time remaining after each move, then generates a cleaned PGN output with time annotations.

### Input

The tool accepts standard PGN (Portable Game Notation) format as input. The PGN can include:
* Metadata tags in square brackets (e.g., `[Event "Tournament"]`, `[White "Player1"]`, `[Black "Player2"]`)
* Move notation with move numbers and moves
* Comments in curly brackets `{ }`
* Side lines/variations in parentheses `( )`
* Game outcome (0-1, 1-0, or 1/2-1/2)

After parsing, users can enter remaining time for each move in minutes (integer values) in the provided input fields.

### Parsing Rules

The parser processes the PGN input with strict validation and the following rules:

1. **Metadata Extraction**: Lines starting with `[` and ending with `]` are extracted and preserved as metadata tags.

2. **Comment Removal**: All content within curly brackets `{ }` is removed, including nested comments. Unmatched brackets are detected and reported as errors.

3. **Side Line Removal**: All content within parentheses `( )` is removed, including nested variations. Only the main line of moves is processed. Unmatched parentheses are detected and reported as errors.

4. **Game Outcome Extraction**: The parser extracts the game result (0-1, 1-0, or 1/2-1/2) from the original PGN and excludes it from move parsing to prevent it from being treated as a move.

5. **Move Detection**: Moves are detected by their ordinal number followed by a dot:
   * White moves appear immediately after the move number with a single dot (e.g., `1. e4`)
   * Black moves can appear in two formats:
     * Immediately after the white move (e.g., `1. e4 e5`)
     * After the move number with three dots (e.g., `1. e4 1... e5`)

6. **Strict Validation**: The parser enforces strict format validation:
   * Moves must be in strict ascending order by move number (1, 2, 3, ...)
   * No gaps in move numbers (moves must be consecutive)
   * Black moves with three dots must have a corresponding white move
   * All moves must be followed by valid move notation
   * Duplicate move numbers are not allowed
   * Any format violation stops processing and displays a specific error message

### Time Entry

Users can enter remaining time for each move:
* Time is entered as an integer number of minutes (e.g., `90` for 90 minutes)
* Time entry is optional - if not provided, no time comment is added to that move
* Time can be entered for both white and black moves independently

### Output

The tool generates a cleaned PGN output that includes:

1. **Original Metadata**: All metadata tags from the input are preserved in their original format.

2. **Cleaned Moves with Time Comments**: The main line moves are formatted as:
   * Each move pair starts with the move number followed by a dot
   * White move immediately follows the move number
   * If time is provided for white move, a time comment is added in the format `{ [%clk hh:mm:ss] }` where hours and minutes are calculated from the entered minutes, and seconds are always `00`
   * Black move format depends on whether white move has a time comment:
     * If white move has a time comment: black move uses the format `1... e5` (move number with three dots)
     * If white move has no time comment: black move follows immediately after white move (e.g., `1. e4 e5`)
   * If time is provided for black move, a time comment is added after the black move
   * Moves are separated by single spaces
   * Example formats:
     * `1. e4 { [%clk 1:30:00] } 1... e5 { [%clk 1:25:00] }` (both moves have time)
     * `1. e4 { [%clk 1:30:00] } 1... e5` (only white has time)
     * `1. e4 e5 { [%clk 1:25:00] }` (only black has time)
     * `1. e4 e5` (no time provided)

3. **Game Outcome**: The original game result (0-1, 1-0, or 1/2-1/2) is appended at the end.

The output is displayed in a textarea below the move entry rows, allowing users to copy the cleaned PGN for further use.