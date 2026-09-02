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
byte-for-byte, so `git status` after a build should be clean. That holds only
under the emscripten version CI pins (6.0.6 in `.github/workflows/publish.yml`);
`htscodecs-wasm/build.sh` refuses any other, since a different version emits
equivalent but differently shaped JS and rewrites the tracked bundle, and CI
fails if the tracked bundle differs from a fresh build. On macOS that version's
closure compiler needs a Java runtime; without one, build inside the official
image instead:

```sh
docker run --rm -v "$PWD":/src -w /src/htscodecs-wasm emscripten/emsdk:6.0.6 ./build.sh
```

`dist/cram-bundle.js` is the standalone browser build the README points
`<script>`-tag consumers at. Nothing in this repo imports it, so it only looks
unused.

`docs/img/dataflow.svg` is generated from `docs/img/dataflow.dot` and committed,
since GitHub does not render DOT. If you edit the `.dot`, re-render it in the
same commit:

```sh
dot -Tsvg docs/img/dataflow.dot -o docs/img/dataflow.svg
```

The measured tables in [docs/memory.md](docs/memory.md) are generated the same
way — they sit between `<!-- BEGIN GENERATED -->` markers, and anything outside
those is written by hand. Regenerate them in the same commit as any change to
what a decoded record holds:

```sh
pnpm docs:numbers
```

It is not a CI check, for the reason that section gives, so a stale table is
caught by nothing but this note.

## Publishing

```sh
pnpm version patch  # or minor/major
```

That runs lint, format, types, tests, build and `test:pack`, regenerates
CHANGELOG.md with git-cliff, then pushes the tag, which triggers the publish
workflow. Releases go out over npm
[trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC, no stored
token). Once publish succeeds, the `release` job creates the GitHub release from
that version's CHANGELOG.md section, extracted by `scripts/release-notes.sh` —
run that with a version to preview what a release will say.
