# Security policy

We take the security of Palmyn and the privacy of the people who try it seriously. If you find a
vulnerability, please tell us privately so we can fix it before it is disclosed.

*¿Hablás español? Podés escribirnos en español a la misma dirección.*

## Scope

- The public demo at [demo.palmyn.com](https://demo.palmyn.com) and its API.
- The website at [palmyn.com](https://palmyn.com).
- The code in this repository.

## How to report

Email **[admin@palmyn.com](mailto:admin@palmyn.com)** with the subject `Security report`, and
include:

- what you found and where (URL, endpoint or file);
- the steps to reproduce it;
- the impact you think it has;
- your name or handle if you want to be credited.

Please do **not** open a public GitHub issue for security problems.

We will acknowledge your report as soon as we can and keep you informed while we work on a fix. Once it is fixed, we are happy to credit you, unless you prefer to stay anonymous.

## Guidelines

When testing, please:

- only use your own hand and your own tokens: never capture, submit or try to match someone else's
  palm;
- not access, modify or delete data that is not yours;
- not run denial-of-service attacks, high-volume automated traffic or spam;
- not use social engineering or physical attacks against people or our providers;
- stop and contact us as soon as you confirm an issue, without going further than needed to show it.

## Known limitations

The limitations listed in
[What this demo does not do](README.md#what-this-demo-does-not-do) are already known and out of
scope, unless you find a way to exploit them beyond what is described there. That includes
accepting photos or screens of a palm, AI-generated or injected images, the lack of liveness
checks, and the lack of anti-Sybil protection.

Also out of scope:

- rate limits that can only be exhausted with high-volume traffic;
- missing best-practice headers or settings with no demonstrable impact;
- issues in third-party services (hosting, CDN, GitHub) that should be reported to them directly.
