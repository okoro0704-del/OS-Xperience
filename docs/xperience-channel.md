# Xperience Channel

The initial web channel is an iframe/postMessage contract. An application receives `DIGICONOMY_XPERIENCE_HANDSHAKE`, validates the sender origin exactly, validates application ID, origin and nonce, then replies with `DIGICONOMY_XPERIENCE_READY` to the exact event origin.

Messages are never accepted based on a deep link, wildcard origin, or URL alone. The channel carries no passwords, private keys, cookies, raw biometrics, payment credentials, or arbitrary application storage. It is transport-neutral by design so a popup or native container can implement the same lifecycle later.
