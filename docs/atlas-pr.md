# Atlas registration

**Public by CID; Atlas registration not filed (PO decision, 2026-10-26).**

Every run is published and independently verifiable on public IPFS. The latest is Run 4,
manifest CID `bafkreig76n7d6oiaxwmzu2mpoww4lttnr2mkawmgkqqnekxl7x7cf4hsha`, readable from
Filebase, Pinata and orbitor. It is not registered in the Elephant Atlas
(`elephant-xyz/atlas`). The repository is public, so this is no longer a question of access.
It was a decision, taken on 2026-10-26 after reading the Atlas README, `CONTRIBUTING.md` and
`schema/entry.schema.json`, for these reasons:

1. **The archive format does not fit an Atlas page.** A page holds exactly one archive per
   county per data group: one `CountyIndex` root (`cid`) and one `CountyTables` root
   (`tables`). Run 4 publishes each group in batches: the `county` group as 10 batches and
   `property_improvement` as 5, each with its own `CountyIndex` CAR and tables directory
   (`runs/travis-full-run4-20261026/manifest.json`, 15 CARs and 15 tables roots). To register
   it, the groups would have to be re-hashed as single archives. Those would be new roots that
   are not in any published run manifest, so the Atlas entry and the run history would name
   different data.
2. **The same county page already has an open pull request.** Another contributor's pull
   request in `elephant-xyz/atlas` ("Publish TX travis property_improvement") adds
   `counties/TX/travis.json` with the `property_improvement` group. Atlas takes one file per
   county and one archive per group, so a second submission for the same file and group would
   compete with it rather than add to it.
3. **Publication is the registry owner's act.** A merge needs an approving review from an
   Elephant code owner and a green `validate` gate. That gate downloads the whole archive by
   root through public gateways (the other pull request measured about 10 KB/s on the public
   path), which a 441,961-property county archive would not finish within its limits.

**What would make it possible:** publish one unbatched archive per data group in a later run,
record those roots in that run's manifest, and open the Atlas pull request once the Travis
page is free or its owner asks for a supersede.

## Durability (unchanged by the decision)

- **Primary pin:** Filebase (Kubo RPC), with CLI readback on upload.
- **Second copy:** Pinata holds every run manifest and most table files (its free plan caps
  the rest); every CAR is attached to a GitHub Release on this fork, so anyone can re-pin it.
- **Verification:** `scripts/verify-manifest.ts` fetches every artifact by CID from two
  independent gateways (Pinata and orbitor) and checks size and SHA-256 against the manifest;
  the app's `/data/verify/<cid>` does the same in the browser.
