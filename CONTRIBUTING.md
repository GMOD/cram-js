# Contributing

## Development

```sh
pnpm install
pnpm test
pnpm build
```

`pnpm build` also rebuilds the htscodecs wasm, which needs emscripten, and the
inlined worker bundle. Both are checked into git, so if you are not touching
`htscodecs-wasm/` or the worker you can skip to
`pnpm build:esm && pnpm build:es5`. [docs/wasm.md](docs/wasm.md) and
[docs/workers.md](docs/workers.md) cover how each is built; both rebuild
byte-for-byte, so `pnpm check:wasm` after a build should pass. CI and
`preversion` both run it, and it fails on any changed or untracked file under
`src/wasm/`.

A byte-for-byte rebuild needs the emscripten version in
`htscodecs-wasm/emscripten-version`, which both CI jobs install.
`htscodecs-wasm/build.sh` refuses any other, since a different version emits
equivalent but differently shaped JS and rewrites the tracked bundle. On macOS
that version's closure compiler needs a Java runtime; without one, build inside
the official image instead:

```sh
docker run --rm -v "$PWD":/src -w /src/htscodecs-wasm \
  emscripten/emsdk:"$(cat htscodecs-wasm/emscripten-version)" ./build.sh
```

`dist/cram-bundle.js` is the standalone browser build the README points
`<script>`-tag consumers at. Keep it, although no file in this repo imports it.

`docs/img/dataflow.svg` is generated from `docs/img/dataflow.dot` and committed,
since GitHub does not render DOT. If you edit the `.dot`, re-render it in the
same commit:

```sh
dot -Tsvg docs/img/dataflow.dot -o docs/img/dataflow.svg
```

The measured tables in [docs/memory.md](docs/memory.md) are generated too. A
script writes them between `<!-- BEGIN GENERATED -->` markers, and the text
outside the markers is written by hand. Regenerate them in the same commit as
any change to what a decoded record holds:

```sh
pnpm docs:numbers
```

CI does not run `pnpm docs:numbers`, for the reason
[docs/memory.md#measuring-it](docs/memory.md#measuring-it) gives, so a stale
table stays until someone follows this note.

[docs/api.md](docs/api.md) is written by hand, and `test/apiDocs.test.ts` fails
when a public member of `IndexedCramFile`, `CramFile`, `CraiIndex` or
`CramRecord`, a constructor option, or an export is missing from it. Document
the new member, or add it to the test's `undocumented` list with the reason it
is internal.

## Publishing

```sh
pnpm version patch  # or minor/major
```

`pnpm version` runs lint, format, types, tests, build, `check:wasm` and
`test:pack`, regenerates CHANGELOG.md with git-cliff, then pushes the tag, which
triggers the publish workflow. Releases go out over npm
[trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC, no stored
token). Once publish succeeds, the `release` job creates the GitHub release from
that version's CHANGELOG.md section, extracted by `scripts/release-notes.sh` —
run that with a version to preview what a release will say.
