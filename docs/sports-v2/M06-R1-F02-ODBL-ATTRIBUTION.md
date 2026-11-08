# F02 — ODbL attribution: authoritative evidence and implemented notice

Captured 2026-11-06 by the captain. Every statement below is quoted from the named authoritative
source; nothing is paraphrased into a licence claim and no wording was invented.

## 1. The licence that covers the ingested data

Source: <https://www.openligadb.de/> (openligadb.de home, fetched HTTP 200, 2026-11-06), section
"Woher kommen die Daten?":

> "Die über diese API bereitgestellten Daten stehen unter der Open Database License (ODbL)."

The page links `https://www.openligadb.de/lizenz` for details. That page is client-rendered and
returns no licence text to a non-JS fetch, so the licence **terms** are taken from the canonical
ODbL 1.0 specification instead (next section) — the same document the notice must link to.

Two independent secondary sources agree that the data is ODbL 1.0 and that the attribution
string should name OpenLigaDB with a link:

- <https://apify.com/m_ctim/live-football-scores>: "Match data is from OpenLigaDB and licensed under
  the Open Database License (ODbL) 1.0 … credit it as 'Data from OpenLigaDB (www.openligadb.de),
  licensed under ODbL 1.0'."
- <https://publicapis.dev/resource/openligadb/10brcxfg>: "Data provided through the API is released
  under the Open Database License (ODbL)."

These are corroboration only. The load-bearing sources are openligadb.de (licence identity) and
opendatacommons.org (licence text and notice requirement).

## 2. What ODbL 1.0 actually requires (authoritative)

Source: <https://opendatacommons.org/licenses/odbl/1-0/> (fetched HTTP 200, 2026-11-06).

**4.3 — Notice for using output (Contents).** This is the obligation that applies to GuíaTV, because
GuíaTV publicly shows match pages built from the data (a "Produced Work"), it does not redistribute
the OpenLigaDB database itself:

> "Creating and Using a Produced Work does not require the notice in Section 4.2. However, if you
> Publicly Use a Produced Work, You must include a notice associated with the Produced Work
> reasonably calculated to make any Person that uses, views, accesses, interacts with, or is
> otherwise exposed to the Produced Work aware that Content was obtained from the Database,
> Derivative Database, or the Database as part of a Collective Database, and that it is available
> under this License."

**4.3(a) — the example notice the licence itself supplies**, including how links must be filled in:

> "Contains information from DATABASE NAME, which is made available here under the Open Database
> License (ODbL)."
>
> "DATABASE NAME should be replaced with the name of the Database and a hyperlink to the URI of the
> Database. 'Open Database License' should contain a hyperlink to the URI of the text of this
> License."

**4.4 — Share alike.** Applies to a *Derivative Database*: "Any Derivative Database that You Publicly
Use must be only under the terms of: This License; A later version…; or A compatible license."
Section 4.5(b) is decisive for GuíaTV's shape: "Using this Database … to create a Produced Work does
not create a Derivative Database for purposes of Section 4.4."

**4.6 — Access to Derivative Databases.** Only binds when a Derivative Database (or a Produced Work
from one) is Publicly Used; it then requires offering a machine-readable copy of the derivative
database or of the alterations.

**4.2 — Notices.** Binds when the Database, a Derivative Database, or a Collective Database is
*Conveyed* (copies transferred). GuíaTV conveys no database copy to users, so 4.2 does not govern the
public pages; 4.3 does.

## 3. Applied to this implementation

| Question | Answer, with basis |
|---|---|
| Upstream attribution party | OpenLigaDB (the database named by the licensor on openligadb.de) |
| Required visible text | The ODbL 4.3 example text with DATABASE NAME = OpenLigaDB |
| Required licence reference and URL | "Open Database License (ODbL)" linked to <https://opendatacommons.org/licenses/odbl/1-0/> |
| Database URL that must be linked | <https://www.openligadb.de/> |
| Must it accompany individual presentations? | Yes — 4.3 attaches the notice to "a Produced Work" that is Publicly Used; each public match presentation is such a work |
| Additional share-alike obligation? | **Not triggered while GuíaTV publishes Produced Works only.** A produced work is not a Derivative Database (4.5 b). It becomes a Derivative Database only if the community also offers a database copy for extraction/re-utilisation (4.6 then applies) |
| Is the intended public use permitted? | Yes. 3.1 grants a worldwide, royalty-free licence explicitly including commercial use, "subject to the terms and conditions" — i.e. including 4.3 |

## 4. Implemented notice (verbatim)

Public sports pages render, in a `<footer>` with `role="contentinfo"`:

> Contiene información de **OpenLigaDB**, disponible aquí bajo la [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/).

plus the database link: <https://www.openligadb.de/>

Accessibility: it is real text (not an image), reachable by keyboard as ordinary inline links, with
the link purpose readable out of context, announced inside a `contentinfo` landmark. It is rendered on
every public page that shows ingested football content, including when a page shows only data
unavailable/uncovered states, because those pages still discuss the same subject data.

**Attribution is applied, the provider stays enabled.** No unresolved legal condition was found that
would require disabling the provider, so the eligibility layer was not used to override anything.

## 5. Residual legal note (not a blocker for engineering, owner-facing)

The ODbL covers the *database* rights. Individual match facts may also be subject to rights in the
Contents (ODbL 2.4). OpenLigaDB is a volunteer community project that supplies its API for exactly
this kind of reuse (openligadb.de: "fürs eigene Tippspiel … in ihren Applikationen bzw. Webseiten
aktuelle Fußball- … Ergebnisse automatisiert beziehen"). This report records the licence position as
implemented; it does not constitute legal advice, and the owner may wish for counsel to confirm the
Contents-rights position before commercial launch. No data was altered, and no attribution wording
was softened to preserve coverage.
