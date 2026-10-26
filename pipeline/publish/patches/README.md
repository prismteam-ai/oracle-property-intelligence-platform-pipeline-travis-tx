# elephant-cli patches

## elephant-cli-export-oneof.patch (ERR-74, PO decision 2026-10-26)

`export-tables` builds a table's columns from a class schema's `properties`. The lexicon `address`
class is a top-level `oneOf` with no `properties`, so its table got identity columns only. The patch
gives such a class the union of its branches' properties (first-seen order; a field the branches type
differently becomes STRING). Nothing else changes.

- Base: `@elephant-xyz/cli` GitHub `44bb182b9f7f904662e9b33e1fde70bdeab62322` (still `main` on 2026-10-26).
- Patch sha256: `70dfadbe842933f165998860c6c32d80d1a77e4c72243de153d957413abff7c8`.
- `dist/services/tables-export.service.js` sha256: before `af8c9c05f1d33872c6e1a0b60afbcf10ae2a93100109395fc2d342de3948207b`,
  after `4b5e6a4a28f27a2bb672e80baec2b11c0e5a6798e782bf755ddfeefaee6258fb`.

Build the patched copy (the pinned install at `~/.local/share/elephant-cli-main` is never changed):

```sh
cp -R ~/.local/share/elephant-cli-main ~/.local/share/elephant-cli-oneof
cd ~/.local/share/elephant-cli-oneof && patch -p1 < <repo>/pipeline/publish/patches/elephant-cli-export-oneof.patch
shasum -a 256 node_modules/@elephant-xyz/cli/dist/services/tables-export.service.js   # must print the "after" digest
```

Use it only for `export-tables` (`specs/011-publish-and-runs/run3-1/p7-reexport-tables.sh`); `hash`,
`validate` and uploads keep the pinned CLI. Drop the patch when an upstream release emits `oneOf`
columns (the CLI half of drafted lexicon request R7).
