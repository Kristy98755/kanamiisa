# Kanamiisa Architecture

## Routes

```
/login                  → Login page (TOTP for root, password for guests)
/login/setup            → TOTP setup (cheat code: 787898)
/stenographist/         → Main app (requires auth)
/stenographist/panel    → Admin panel (root only)
/stenographist/api/*    → Stenographist API (audio processing)
```

## Auth Flow

```
GET /stenographist/
  → no session? → 302 /login
  → session valid? → serve index.html
  → session invalid? → 302 /login

POST /login/api/auth
  → verify TOTP/password → create session → Set-Cookie → 200
```

## Storage (KV)

| Key | Value |
|-----|-------|
| `totp:secret` | TOTP secret for root |
| `user:{username}` | `{ password_hash, created_at }` |
| `session:{id}` | `{ username, is_root, created_at }` |
| `log:{ts}:{username}` | `{ ip, user_agent, device, session_start }` |

## Roles

- **Root** (`kanamiisa`): TOTP auth, can manage users, single account
- **Guest**: password auth, limited to stenographist

## Session

- Cookie: `session`, HttpOnly, SameSite=Strict, Path=/
- Expires: browser close (no Expires/Max-Age)
- Storage: KV with TTL
