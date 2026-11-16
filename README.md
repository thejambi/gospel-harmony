# Harmony of the Gospels

A reading checklist for working through the life of Christ with Dr. Doug Bookman's
**A Proposed Harmony of the Life of Christ** (212 sections) and his nine
**Harmonized Bible Reading Assignment Sheets**.

It's a static site: plain HTML, CSS and JavaScript, with no build step and no backend.
Progress and notes are saved in the browser's `localStorage`.

## Views

- **Harmony**: all 212 sections, grouped by Bookman's Units and Parts. Each gospel's
  passage (Matthew, Mark, Luke, John) has its own checkbox. Click the section number
  to mark the whole section read. Click a title to see Bookman's notes, links to the
  assignment sheets that cover it, and your own notes.
- **Assignments**: the nine reading sheets, with Bookman's note for each passage and
  his numbered study questions. Each question has an answer box. Each sheet ends with
  a "questions and points of confusion" box.
- **Notebook**: everything you've written, in harmony order. Filter it to show only
  **open questions**, or only resolved ones.

## Design decisions that go beyond the paper version

1. **Progress is tracked by verse, not by checkbox.** Ticking a passage records its
   verses as read. Every other place that shows an overlapping passage updates, in both
   views. For example, reading Mt 14:13-21 on Sheet 4 also ticks §83 in the harmony.
   A passage you've only partly covered shows as partly read.
2. **Coverage fingerprint.** The rail beside the harmony is a grid of 212 rows by
   4 gospels. It shows two things at once:
   - your progress;
   - which gospels carry each event. John's early Judean material and Luke's travel
     narrative stand out, for example.

   A band on the grid marks where you are on the page. Click any row to jump there.
3. **Parallel reader.** The book icon on each row opens the Scripture inside the app,
   in the Berean Standard Bible. On a wide screen the accounts sit side by side in
   columns. On a phone each account fills the screen, and you swipe or tap a tab to move
   to the next one; marking one read moves you on to the next unread one. A *Study notes*
   drawer holds Bookman's note, his questions and your own notes while you read. A
   *Footnotes* switch shows the BSB translators' notes.
4. **Open questions carry forward.** You can mark any note as an *open question*. It
   stays in the Notebook, with a count on the tab, until you mark it resolved.
5. **Continue.** This button jumps to the next unread section, or the next unread
   passage on the assignment sheets.

## Your data

Everything stays in this browser. Use the **⋯** menu to:

- export a JSON backup, or import one (use this to move to another device);
- download your notebook as Markdown.

Safari can clear site storage for sites you haven't visited in a while, so export a
backup now and then.

## Scripture text

The text comes from [fetch.bible](https://fetch.bible). The app loads
`https://v1.fetch.bible/bibles/eng_bsb/html/{book}.json` directly, with no client
library. Each file is one whole book, split into verses, and the app puts the requested
verse range together from it. Before display, the HTML is filtered through a short
allow-list of tags and attributes.

Each book is downloaded the first time one of its passages is opened, and is kept in the
browser's Cache Storage after that. A passage you have read once still opens offline.
The four Gospels together are about 800 KB before compression.

The Berean Standard Bible is in the public domain (CC0) and comes from BSB Publishing, LLC
([berean.bible](https://berean.bible)).

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository.
2. Under **Settings → Pages**, choose **Deploy from a branch**, then pick `main` and `/ (root)`.

`.nojekyll` is included so Pages serves the files as they are.

To run it locally:

```bash
python3 -m http.server 8000
```

## Rebuilding the data

`data.js` is generated from Bookman's Word documents by `tools/build_data.py`. That
script says how to convert the `.doc` files to HTML with `textutil` on macOS. It also
holds a short list of corrections for evident reference typos in the printed sheets.
For example, under "Prologue to John's Gospel" the sheet prints Mt 3:1-12, which should
be Jn 1:1-18. Corrected passages are marked *corrected* in the app, and hovering over
the label shows the original text.

## Credits

The harmony, reading notes, study questions and genealogy essay are by Dr. Doug Bookman
([bookmanministries.com](https://www.bookmanministries.com)). The Scripture text is the
Berean Standard Bible, served by fetch.bible.
