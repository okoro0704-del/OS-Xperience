# @digiconomy/space-package

Digiconomy Space Package V1 (SP1): a portable, immutable, publisher-signed Space that can be
packed, inspected, verified, imported and opened offline (SP1, `docs/space-package-v1.md`), and
updated, rotated, revoked and rolled back with local state kept (SP2, `docs/space-package-v2.md`).

```bash
npm run space -w @digiconomy/space-package -- pack ../../examples/space-package/lantern --key signer.json --out lantern.space
npm run space -w @digiconomy/space-package -- verify lantern.space --publishers trust.json
npm run space -w @digiconomy/space-package -- import lantern.space --state ./state --publishers trust.json
npm run space -w @digiconomy/space-package -- open org.digiconomy.demo.lantern --state ./state
npm run space -w @digiconomy/space-package -- update stage lantern-2.0.0.update.json lantern-2.0.0.space --state ./state --trust trust.json
npm test -w @digiconomy/space-package
```
