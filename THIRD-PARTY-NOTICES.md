# Third-party notices

This extension is MIT licensed (see LICENSE). The packages it bundles carry
their own terms: MIT and Apache 2.0 for most, BSD-3-Clause for `diff`, ISC for
`@ungap/structured-clone`.

Every build writes the full list, with each package's licence and NOTICE files,
to `public/THIRD-PARTY-NOTICES.txt`, which ships inside the extension.
`scripts/notices.mjs` collects it from `pnpm licenses list --prod`, so a new
dependency cannot be left out.
