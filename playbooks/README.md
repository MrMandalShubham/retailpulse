# Platform Playbooks

One file per **platform + flow**, named `<source-slug>.<flow-key>.md`:

| Flow key    | Phase   | Question the file answers                           |
| ----------- | ------- | --------------------------------------------------- |
| `discovery` | Phase 0 | How do we map this platform's full product catalog? |
| `ingestion` | Phase 1 | How do we fetch each product's raw data?            |

Each playbook is the **decision record** for that platform: which methods were
evaluated, which one was chosen and why, and the **exact tested request
contracts** (endpoints, bodies, headers) so a future fix or re-crack starts
from working knowledge instead of zero.

Rules:

- The playbook documents; the **runtime config lives in the database**
  (`sources.discovery_config` etc.). If the two disagree, the DB is what runs —
  update the playbook in the same change.
- Record rejected methods too (with the evidence) — they stop the next person
  from re-testing dead ends.
- When a platform's site/API changes, update the playbook alongside the code
  fix and note the date.

Current playbooks:

- [oliveyoung-global.discovery.md](oliveyoung-global.discovery.md)
- [oliveyoung-global.ingestion.md](oliveyoung-global.ingestion.md)
