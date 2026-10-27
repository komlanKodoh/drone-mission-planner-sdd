Repository: https://github.com/komlanKodoh/drone-mission-planner-sdd

Specification: https://github.com/komlanKodoh/drone-mission-planner-sdd/blob/main/spec.md

I converted my Autonomous Drone Mission Planner SRS into the required Markdown outline. I condensed the context and object models into actor and object descriptions, kept four main goals, and labeled the requirements and acceptance scripts so they can be traced to one another. The project still covers equipment selection, mission planning, and supervised flight with one operator and one aircraft per active mission.

The main additions are acceptance scenarios for requirements that the original planning/start feature did not cover, including compatibility, telemetry, manual control, command outcomes, and retained records. I clarified that missing compatibility evidence blocks selection, that validation and preflight belong to a saved revision, and that duplicate or unresolved starts cannot send another start request. I also made stale manual-mode confirmation disable direct-control input. These changes reduce guesses about incomplete data and unconfirmed actions. Timing and alert thresholds are explicit configuration inputs; the example timing values are test fixtures.

I used GPT-6 through Codex to help convert the SRS, review gaps and problematic requests, check goal and acceptance coverage, and draft the added stories and scenarios. The review decisions are in review-notes.md. No additional external SDD references were consulted; the sources were the assignment instructions and my Project 1 materials.

Generated with the help of GPT-6 (Codex).
