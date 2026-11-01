# Loopback HTTPS fixture

The certificates and private keys in this folder are public, disposable test material.
The loopback pair covers `127.0.0.1`; the gateway pair additionally covers the
reserved example hostname `desktop-test.example.org`. They are not production credentials and must never be used
on a server or installed into an operating-system trust store.

Node tests trust this certificate explicitly in the test-only HTTPS request helper.
Electron verification adds it only to its child process with `NODE_EXTRA_CA_CERTS`;
the product code keeps normal TLS validation and has no certificate-bypass option.

Regenerate the pair when it expires, preserving the IP subject alternative name.
