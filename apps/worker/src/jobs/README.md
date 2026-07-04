# Worker jobs

Empty by design in Phase 1.

Phase 2 adds the scheduler and queue consumers here (crawl-job creation, job
status tracking). Heavy scraping and AI transformation run in the Python
services under `services/`, not in this Node worker — this process handles
orchestration/control-plane jobs only.
