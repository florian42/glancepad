# We speak the device protocol ourselves

`@worklouder/device-kit-oai` and `@worklouder/wl-device-kit` are
proprietary: "All Rights Reserved", distributed through a private GitHub
Packages feed, and absent from the public npm registry. This repository
will become public. We therefore write our own transport, our own RPC
client, and our own framing, and we never add `@worklouder/*` as a
dependency.

## Consequences

Protocol facts must be recorded in our own words with citations, which is
why `research/virtual-device-options.md` describes byte layouts rather
than reproducing vendor files. It also means our reading of the protocol
is the only thing standing between us and a wrong implementation, which is
why the protocol module ships with a conformance suite and an independent
cold re-derivation rather than round-trip tests alone.

The vendor's own transport interface has ten methods. Ours has four,
because we own both sides and carry no legacy RPC path.
