# Security policy

## Supported versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a vulnerability

**Do not open a public issue.** Report privately through
[GitHub Security Advisories](https://github.com/sagea-ai/cursus/security/advisories/new)
so a fix can land before details are public.

Include: what you found, where (file/route/version), and how to reproduce
it. You will get an acknowledgment within 7 days and a fix timeline once
the issue is confirmed.

## Scope notes

- API keys, session cookies, and OIDC secrets are covered like any other
  credential: the project never logs them, and neither should bug reports
  (redact keys, tokens, and `Authorization` headers).
- The self-host threat model assumes you operate Postgres, object storage,
  and TLS termination yourself — the compose files are a starting point,
  not a hardened appliance. Harden secrets, backups, and network policy
  for your environment.
