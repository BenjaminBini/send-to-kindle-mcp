# send-to-kindle-mcp

An [MCP](https://modelcontextprotocol.io) server that sends document files
(EPUB, PDF, TXT, …) to your Kindle using Amazon's **Send to Kindle** email
feature. The file is emailed as an attachment to your device's `@kindle.com`
address.

## Tool

### `send_to_kindle`

| Argument       | Type       | Required | Description |
| -------------- | ---------- | -------- | ----------- |
| `file_paths`   | string[]   | yes      | Absolute paths of the document files to send (1–25 files). |
| `kindle_email` | string     | no       | Target `@kindle.com` address. Falls back to the `KINDLE_EMAIL` env var. |

All files are sent as attachments in a single email. Amazon's limits: up to
**25 attachments** and **50 MB combined** per email.

Supported formats: `.epub`, `.pdf`, `.txt`, `.rtf`, `.htm`, `.html`, `.png`,
`.gif`, `.jpg`, `.jpeg`, `.bmp`.

## Prerequisites (do this once on Amazon's side)

Send to Kindle by email **silently drops** anything from an unapproved sender.

1. **Find your Kindle address.** Amazon → *Manage Your Content and Devices* →
   *Devices* → select your Kindle. It shows an address like
   `you_abc123@kindle.com`.
2. **Approve your sending email.** Same page → *Preferences* →
   *Personal Document Settings* → *Approved Personal Document E-mail List* →
   *Add a new approved e-mail address*. Add the address you'll send **from**
   (your `SMTP_FROM` / `SMTP_USER`).

EPUB is supported natively (Amazon converts it to a Kindle format on receipt).

## Install

No clone or build needed — the server runs via `npx` straight from npm:

```bash
npx send-to-kindle-mcp
```

(Your MCP client launches it for you using the config below; you don't normally
run this by hand.)

### Gmail note

Use an **App Password**, not your account password: Google Account → Security →
2-Step Verification → App passwords. Host `smtp.gmail.com`, port `587`.

## Register with an MCP client

### Claude Code

```bash
claude mcp add send-to-kindle \
  --env SMTP_HOST=smtp.gmail.com \
  --env SMTP_PORT=587 \
  --env SMTP_USER=you@gmail.com \
  --env SMTP_PASS=your-app-password \
  --env SMTP_FROM=you@gmail.com \
  --env KINDLE_EMAIL=you_abc123@kindle.com \
  -- npx -y send-to-kindle-mcp
```

### Generic `mcpServers` JSON (Claude Desktop, Cursor, etc.)

```json
{
  "mcpServers": {
    "send-to-kindle": {
      "command": "npx",
      "args": ["-y", "send-to-kindle-mcp"],
      "env": {
        "SMTP_HOST": "smtp.gmail.com",
        "SMTP_PORT": "587",
        "SMTP_USER": "you@gmail.com",
        "SMTP_PASS": "your-app-password",
        "SMTP_FROM": "you@gmail.com",
        "KINDLE_EMAIL": "you_abc123@kindle.com"
      }
    }
  }
}
```

### From source (development)

```bash
git clone https://github.com/BenjaminBini/send-to-kindle-mcp.git
cd send-to-kindle-mcp
npm install
npm run build
```

Then point your client's `command`/`args` at `node /path/to/dist/index.js`.

## Environment variables

| Variable      | Required | Default                         | Notes |
| ------------- | -------- | ------------------------------- | ----- |
| `SMTP_HOST`   | yes      | —                               | SMTP server hostname. |
| `SMTP_PORT`   | no       | `587`                           | SMTP port. |
| `SMTP_SECURE` | no       | `true` if port 465, else `false`| Force TLS-on-connect. |
| `SMTP_USER`   | yes      | —                               | SMTP username. |
| `SMTP_PASS`   | yes      | —                               | SMTP password / app password. |
| `SMTP_FROM`   | no       | `SMTP_USER`                     | From address; must be Amazon-approved. |
| `KINDLE_EMAIL`| no       | —                               | Default target if the tool arg is omitted. |

## Troubleshooting

- **Nothing arrives.** Almost always the sender isn't on the approved list, or
  the Kindle address is wrong. Delivery can take a few minutes.
- **SMTP auth fails.** For Gmail/Outlook you need an app password with 2FA on.
- **File rejected.** Check every file is a supported format, that there are at
  most 25 of them, and that their combined size is under 50 MB.
