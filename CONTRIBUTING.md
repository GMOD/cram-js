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
`pnpm build:esm && pnpm build:es5`. [docs/WASM.md](docs/WASM.md) and
[docs/WORKERS.md](docs/WORKERS.md) cover how each is built; both rebuild
byte-for-byte, so `git status` after a build should be clean.

`docs/dataflow.svg` is generated from `docs/dataflow.dot` and committed, since
GitHub does not render DOT. If you edit the `.dot`, re-render it in the same
commit:

```sh
dot -Tsvg docs/dataflow.dot -o docs/dataflow.svg
```

## Publishing

```sh
pnpm version patch  # or minor/major
```

That runs lint, format, types, tests, build and `test:pack`, regenerates
CHANGELOG.md with git-cliff, then pushes the tag, which triggers the publish
workflow. Releases go out over npm
[trusted publishing](https://docs.npmjs.com/about-trusted-publishing) (OIDC, no
stored token). Once publish succeeds, the `release` job creates the GitHub
release from that version's CHANGELOG.md section, extracted by
`scripts/release-notes.sh` — run that with a version to preview what a release
will say.
