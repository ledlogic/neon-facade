# Neon Facade

Cyberpunk building paint palette randomizer. A static JavaScript page that generates five-colour paint schemes for cyberpunk buildings: two dark structural colours, one hardware accent and two lit neon colours. Every set gets a generated name, probable usage per swatch, hex and RGB values, and the closest Army Painter Warpaints Fanatic paints (including the fluorescent glow paints for the neon slots). You can rate sets and vote on individual swatches, and the generator learns from that feedback.

## Running it

It is plain HTML, CSS and ES modules with JSON data, so GitHub Pages serves it as is from `index.html`. Locally, browsers block `fetch()` of the JSON files from `file://`, so serve the folder: `python3 -m http.server 8000` then open `http://localhost:8000/`.

## Sharing a set

The URL always reflects the current set, for example `index.html?s=d-void-navy.d-slate-concrete.a-chrome-trim.l-hot-magenta.l-cyber-cyan&k=complementary`. `s` is the five colour ids in slot order and `k` is the harmony scheme. The name is derived from those, so the same link always shows the same set and the same name. Back and forward in the browser step through sets you generated.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell |
| `css/style.css` | Styling |
| `js/color.js` | sRGB, CIELAB, LCh, CIEDE2000 ΔE, mixing, seeded RNG |
| `js/generator.js` | Pure logic: paint matching, scoring, generation, learning, naming (no DOM, testable in node) |
| `js/app.js` | UI, URL handling, feedback storage |
| `data/colors.json` | The generator's colour library, tagged dark, accent or lit |
| `data/roles.json` | The five slots and their usage text |
| `data/schemes.json` | Harmony rules for the neon pair and facade tint |
| `data/paints.json` | Warpaints Fanatic names, codes, families and approximate hex |
| `data/names.json` | Word banks and patterns for set names |
| `data/feedback.json` | Committed feedback that ships with the site |

## How generation works

A scheme is picked first (weighted by `weight` in `schemes.json` and by how well you have rated that scheme). The generator then draws 160 candidate sets from the colour pools, keeping locked slots fixed, and scores each one. The score rewards neons that sit at the scheme's target hue distance, a facade that is actually dark and tinted toward the scheme's chosen hue, a structure colour that separates from the facade by a readable step without drifting into another hue family, strong lit to dark contrast, a hardware accent that neither competes with the neons nor disappears into the facade, and colours with a close Fanatic match. Learned feedback is added on top. One candidate is then picked by softmax over the scores, and the Safe to Wild slider is the softmax temperature.

Paint matching uses CIEDE2000. Under 4 is a close match, under 8 near, under 14 workable with a glaze, above that the nearest available is shown with a red badge. Lit swatches also show the nearest fluorescent glow paint.

## Tuning with feedback

Give a set 1 to 5 stars (3 is neutral) and optionally mark individual swatches with ▲ or ▼, add a note, then save. Each colour gets a score from the ratings of sets it appeared in plus its own votes, shrunk toward zero until there are several data points. The neon pair, the facade with each neon, and the scheme also get pair scores. These raise or lower both the chance a colour is drawn and the score of any set containing it.

Feedback is saved in the browser's localStorage. Use Export feedback.json and commit it as `data/feedback.json` so the tuning ships with the site and works on every device. Export merges the committed file with your local entries, so you can keep exporting and committing as you go. Import pulls an export into the current browser. The export is also the easiest thing to hand back to Claude for tuning the rules themselves (the colour library, schemes and scoring weights).

## Caveats

The paint names and codes come from the Warpaints Fanatic range, but The Army Painter does not publish hex values, so the hex numbers in `paints.json` are estimates. Correct them against real bottles or swatch cards when you have them, every match improves immediately. The hues of Plasma Coil Glow (blue) and Power Node Glow (rose) are confirmed; Data System Glow, Lens Flare Glow and Radiation Glow are guesses and are flagged with a `?` on the page until you confirm them. Paint links go to the Army Painter site search for the product code.

To add colours, put them in `colors.json` with a new id and the right tone. Do not rename ids that already have feedback, or that feedback stops applying.
