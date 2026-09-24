# @digiconomy/space-runtime development artifact wiring

The maintained source of `@digiconomy/space-runtime` lives in this package.
The package is a development-wiring artifact for the Space Runtime V1
extraction; it is not a published distribution channel.

## Rebuild and verify

From this package directory:

```powershell
npm run build
node --import tsx --test test/*.test.ts
npm pack --pack-destination ..\\..\\.artifacts
```

The final command produces a versioned tarball in `OS SHELL/.artifacts/`.

## Consume from mybrandOS

`mybrandOS/package.json` references the versioned tarball with a local
`file:` dependency. After producing a new artifact, update that filename in
the consumer manifest and run this from the mybrandOS root:

```powershell
npm install
node --input-type=module -e "console.log(await import.meta.resolve('@digiconomy/space-runtime'))"
```

The resolved entry point must be the installed tarball's
`node_modules/@digiconomy/space-runtime/dist/index.js`. The tarball is built
only from this canonical package; consumers must not import OS SHELL source by
absolute path or copy the runtime implementation.
