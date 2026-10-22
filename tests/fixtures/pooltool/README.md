# pooltool test data

`hard-quartics.json` and `quartics.json` are converted from the quartic test arrays of
[pooltool](https://github.com/ekiefl/pooltool) v0.6.0 (`tests/ptmath/roots/data/`), by Evan Kiefl
and contributors, Apache License 2.0 (see `LICENSES/Apache-2.0.txt`). Each item holds the
coefficients `c` (highest power first, here reversed from pooltool's storage order), the true roots
`r` computed by pooltool with mpmath at 100 digits, and, for the hard set, pooltool's case label `k`.
The hard set is complete; the standard set keeps its first 200 items.

Files the pooltool reference simulations produce (`tools/pooltool-fixtures/`) are added here as well.
