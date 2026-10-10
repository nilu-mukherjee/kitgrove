# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub:
**Security → Report a vulnerability** on this repository.
Do not open a public issue for a vulnerability.

You can expect an acknowledgement within a few days. Fixes are released as a patch version of
`kitgrove` and noted in the release.

## Scope

`kitgrove` is a command-line tool that writes files into your project and, for the `tenant`, `user`
and `data` commands, talks to your own database with the credentials in your project's `.env`.
It never sends data to a third party. Passwords are read from a hidden prompt or the
`KITGROVE_PASSWORD` environment variable, never from command-line flags.
