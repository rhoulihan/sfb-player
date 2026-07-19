## Read the full rules subsection tree before coding a mechanic (2026-07-18)
While building the EAF shuttle-arming controls Rick interjected "read the rules thoroughly before implementing."
The J2.22/J3.1 trees hide load-bearing subrules two levels down: the turn-4+ hold cost and 9-point cap (J2.2212),
the abort-on-missed-turn energy loss (J2.2211), the no-shuttle-no-allocation gate (J1.868), and the
reserve-power-may-only-BEGIN-a-weasel-charge restriction (J3.122) — the old pay-at-launch shortcut violated that
last one outright. Rule: before implementing any mechanic, read its ENTIRE numbered subtree (including holding,
abort, energy-source, and cross-referenced J1/H7 rules), not just the headline paragraph.
