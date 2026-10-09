# @digiconomy/space-package

Digiconomy Space Package V1 (SP1): a portable, immutable, publisher-signed Space that can be
packed, inspected, verified, imported and opened offline. Specification: `docs/space-package-v1.md`.

```bash
npm run space -w @digiconomy/space-package -- pack ../../examples/space-package/lantern --key signer.json --out lantern.space
npm run space -w @digiconomy/space-package -- verify lantern.space --publishers trust.json
npm run space -w @digiconomy/space-package -- import lantern.space --state ./state --publishers trust.json
npm run space -w @digiconomy/space-package -- open org.digiconomy.demo.lantern --state ./state
npm test -w @digiconomy/space-package
```
