# LexOrder picomatch backport

This private development dependency is picomatch 4.0.7 with a local parser fix for GHSA-fc5q-39xc-vjpf. The runtime files came from the official npm tarball. Its SHA-512 integrity is `sha512-qcJu88Q2IWqJsDD529JKMdwGm/dvInW4HvQnRwiH9JtihJvzGOscDtHE3x1pBKeUOTysQ8kVmLnJ2kJu7yhcGA==`. See [upstream release](https://github.com/micromatch/picomatch/releases/tag/4.0.7) and [advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).

The parser tracks unbounded output in each extglob frame and propagates it through nested groups. A repeated extglob rejects an unbounded branch unless the existing analyzer provides a safe rewrite. The guard also applies when callers disable the older recursion check, and rejects raw unbounded operators when opt-in parsing modes expose them. The emitted-token approach follows [upstream proposal #274](https://github.com/micromatch/picomatch/pull/274).

The root npm override makes the existing tools use this one audited-in-source copy. The scoped package identity distinguishes the fork from the upstream release. The original code and MIT license are included here. Use the official distribution once the advisory identifies a patched release that satisfies the toolchain.
