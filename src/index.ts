#!/usr/bin/env node
/**
 * send-to-kindle-mcp
 *
 * An MCP server exposing a tool to send document files (EPUB, PDF, etc.)
 * to a Kindle device using Amazon's "Send to Kindle" email feature.
 *
 * How Send-to-Kindle email works:
 *   - Each Kindle account has a dedicated address like `you_xxxx@kindle.com`.
 *   - Amazon only accepts documents from addresses on your
 *     "Approved Personal Document E-mail List"
 *     (Manage Your Content and Devices > Preferences > Personal Document Settings).
 *   - The document is sent as a plain email attachment. Amazon converts
 *     supported formats to a Kindle format automatically on receipt.
 *
 * Configuration is via environment variables (see README).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import nodemailer from "nodemailer";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";

// --- Configuration from environment ---------------------------------------

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  KINDLE_EMAIL,
} = process.env;

function requireEnv(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `See the README for configuration.`,
    );
  }
  return value;
}

// Amazon's supported document formats for Send to Kindle (email).
// https://www.amazon.com/sendtokindle  (EPUB supported since late 2022)
const SUPPORTED_EXTENSIONS = new Set([
  ".epub",
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".rtf",
  ".htm",
  ".html",
  ".png",
  ".gif",
  ".jpg",
  ".jpeg",
  ".bmp",
]);

// Amazon's Send-to-Kindle email limits: up to 25 attachments per email, and a
// combined size of 50 MB or less across all attachments.
const MAX_ATTACHMENTS = 25;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

// MIME types for common Kindle-supported formats.
const MIME_TYPES: Record<string, string> = {
  ".epub": "application/epub+zip",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".rtf": "application/rtf",
  ".htm": "text/html",
  ".html": "text/html",
  ".png": "image/png",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".bmp": "image/bmp",
};

function buildTransport(): nodemailer.Transporter {
  const host = requireEnv("SMTP_HOST", SMTP_HOST);
  const user = requireEnv("SMTP_USER", SMTP_USER);
  const pass = requireEnv("SMTP_PASS", SMTP_PASS);

  const port = SMTP_PORT ? Number(SMTP_PORT) : 587;
  if (Number.isNaN(port)) {
    throw new Error(`SMTP_PORT must be a number, got: ${SMTP_PORT}`);
  }

  // Default: secure=true only for port 465; STARTTLS (587) uses secure=false.
  const secure =
    SMTP_SECURE !== undefined
      ? SMTP_SECURE === "true" || SMTP_SECURE === "1"
      : port === 465;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

// Resolved at startup (see main()) so misconfiguration fails fast. We do NOT
// hold a live transport between calls: each send_to_kindle invocation builds a
// transport, sends, and closes it, so nothing SMTP-related stays alive while
// the server is idle.
let from: string;

// --- MCP server ------------------------------------------------------------

const server = new McpServer({
  name: "send-to-kindle-mcp",
  version: "1.0.0",
});

server.tool(
  "send_to_kindle",
  "Send one or more local document files (EPUB, PDF, DOCX, etc.) to a Kindle " +
    "device via Amazon's Send-to-Kindle email feature. The files are emailed as " +
    "attachments to the Kindle address (up to 25 files, 50 MB total). NOTE: the " +
    "sending email address must be on your Amazon 'Approved Personal Document " +
    "E-mail List' or Amazon will silently drop the email.",
  {
    file_paths: z
      .array(z.string())
      .min(1)
      .max(MAX_ATTACHMENTS)
      .describe(
        `Absolute paths of the document files to send (1-${MAX_ATTACHMENTS} ` +
          `files, 50 MB combined). Each must be an absolute path.`,
      ),
    kindle_email: z
      .string()
      .email()
      .optional()
      .describe(
        "Target @kindle.com address. Defaults to the KINDLE_EMAIL env var if set.",
      ),
  },
  async ({ file_paths, kindle_email }) => {
    const to = kindle_email ?? KINDLE_EMAIL;
    if (!to) {
      throw new Error(
        "No Kindle email provided. Pass `kindle_email` or set the KINDLE_EMAIL env var.",
      );
    }
    if (!/@kindle\.com$/i.test(to)) {
      throw new Error(
        `Target '${to}' does not look like a Kindle address (should end in @kindle.com).`,
      );
    }

    // Validate and read every file up front so a bad file aborts the whole
    // send before any email goes out (Amazon would otherwise reject or partly
    // deliver a malformed batch).
    const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
    let totalBytes = 0;

    for (const file_path of file_paths) {
      if (!isAbsolute(file_path)) {
        throw new Error(`file_paths must be absolute paths, got: ${file_path}`);
      }

      let info;
      try {
        info = await stat(file_path);
      } catch {
        throw new Error(`File not found or not readable: ${file_path}`);
      }
      if (!info.isFile()) {
        throw new Error(`Path is not a regular file: ${file_path}`);
      }

      const ext = extname(file_path).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        throw new Error(
          `Unsupported file type '${ext}' (${file_path}). Supported: ` +
            `${[...SUPPORTED_EXTENSIONS].join(", ")}`,
        );
      }

      totalBytes += info.size;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error(
          `Combined attachment size exceeds Amazon's 50 MB limit ` +
            `(${(totalBytes / 1024 / 1024).toFixed(1)} MB so far).`,
        );
      }

      attachments.push({
        filename: basename(file_path),
        content: await readFile(file_path),
        contentType: MIME_TYPES[ext] ?? "application/octet-stream",
      });
    }

    const names = attachments.map((a) => a.filename);

    // Build a transport per send and close it immediately afterwards, so no
    // SMTP connection or transport is kept alive while the server is idle.
    const transport = buildTransport();
    let result;
    try {
      result = await transport.sendMail({
        from,
        to,
        // Amazon requires a non-empty subject AND body, otherwise it rejects
        // the message with "E009 - No attachment" even when an attachment is
        // present. The content is otherwise ignored, so a static string is fine.
        subject: "Send to Kindle",
        text: `Sent to Kindle: ${names.join(", ")}`,
        attachments,
      });
    } finally {
      transport.close();
    }

    const count = attachments.length;
    return {
      content: [
        {
          type: "text",
          text:
            `Sent ${count} file${count === 1 ? "" : "s"} ` +
            `(${(totalBytes / 1024).toFixed(0)} KB total) to ${to}:\n` +
            `${names.map((n) => `  - ${n}`).join("\n")}\n\n` +
            `From: ${from}\nMessage ID: ${result.messageId}\n\n` +
            `If it doesn't arrive: confirm "${from}" is on your Amazon ` +
            `"Approved Personal Document E-mail List" and that the Kindle ` +
            `address is correct. Delivery can take a few minutes.`,
        },
      ],
    };
  },
);

// --- Startup ---------------------------------------------------------------

async function main() {
  // Validate SMTP config up front so misconfiguration fails fast (handled by
  // the .catch below) rather than on the first tool call. We build a transport
  // only to validate the env vars, then close it immediately -- nothing is kept
  // alive while the server is idle.
  buildTransport().close();
  from = SMTP_FROM || SMTP_USER!;

  const stdio = new StdioServerTransport();
  await server.connect(stdio);
  console.error("send-to-kindle-mcp running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
