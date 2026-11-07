import type { FastifyInstance } from "fastify";
import type { CodexRuntime } from "./runtime";
import type { Engine } from "./engine";
import { basename, extname, resolve } from "node:path";
import { existsSync, statSync, readFileSync, createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { localFileReferences } from "../shared/file-links";
import { localImageAttachments } from "../shared/chat-presentation";
import { isLocalFilesystemPath, requireLocalFilesystemPath } from "../shared/local-paths";
import { dataPath, storedPath } from "./paths";
import { withinDirectory } from "./file-access";

/** Chat-scoped files and private uploaded attachments share one canonical path boundary. */
export function registerFileRoutes(app: FastifyInstance, runtime: CodexRuntime, engine: Engine) {
app.get<{ Params: { id: string }; Querystring: { path: string } }>(
  "/api/chats/:id/file",
  async (request, reply) => {
    const { id } = request.params;
    const { path } = request.query;
    requireLocalFilesystemPath(path);
    let file = runtime.chatFiles.get(id)?.get(path);
    if (!file)
      for (const run of engine.runs) {
        const assignments =
          run.chatThreadId === id
            ? run.assignments
            : run.assignments.filter(
                (assignment) => assignment.threadId === id,
              );
        const reference = assignments
          .flatMap((assignment) => localFileReferences(assignment.output))
          .find((reference) => reference.path === path);
        if (reference) {
          requireLocalFilesystemPath(run.workspace);
          file = resolve(run.workspace, reference.path);
          break;
        }
      }
    if (!file) {
      await runtime.readChat(id);
      file = runtime.chatFiles.get(id)?.get(path);
    }
    if (!file || !isLocalFilesystemPath(file) || !existsSync(file) || !statSync(file).isFile())
      return reply
        .code(404)
        .send({
          error: "This file is unavailable or is not linked in this chat.",
        });
    const workspace = engine.runs.find(run => run.chatThreadId === id || run.assignments.some(a => a.threadId === id))?.workspace || (await runtime.readChat(id)).cwd;
    if (!withinDirectory(workspace, file)) return reply.code(403).send({ error: "File is outside this chat's workspace." });
    if (statSync(file).size > 1024 * 1024)
      return reply
        .code(413)
        .send({
          error: "This file is too large for the inline preview (1 MB limit).",
        });
    const text = readFileSync(file, "utf8");
    if (text.includes("\0"))
      return reply
        .code(415)
        .send({ error: "This file is not a text document." });
    return { path: file, text };
  },
);
app.get<{ Params: { id: string }; Querystring: { path: string } }>(
  "/api/chats/:id/attachment",
  async (request, reply) => {
    requireLocalFilesystemPath(request.query.path);
    const savedAttachments = engine.runs.filter(run => run.chatThreadId === request.params.id || run.options?.sourceThreadId === request.params.id || run.assignments.some(a => a.threadId === request.params.id))
      .flatMap(run => [
        ...(run.options?.attachments || []),
        ...(run.inbox || []).flatMap(message => message.attachments || []),
        ...run.assignments.flatMap(assignment => localImageAttachments(assignment.output)),
      ]);
    const pathKey = (path: string) => path.replaceAll("\\", "/").replace(/^\/([a-z]:)/i, "$1").toLowerCase();
    const savedAttachment = savedAttachments.find(item => pathKey(item.path) === pathKey(request.query.path));
    if (!savedAttachment && !runtime.chatAttachments.get(request.params.id)?.has(request.query.path)) await runtime.readChat(request.params.id);
    const originalAttachment = runtime.chatAttachments.get(request.params.id)?.get(request.query.path) || savedAttachment;
    const attachment = originalAttachment && { ...originalAttachment, path: storedPath(originalAttachment.path) };
    if (
      !attachment ||
      !isLocalFilesystemPath(attachment.path) ||
      !existsSync(attachment.path) ||
      !statSync(attachment.path).isFile()
    )
      return reply.code(404).send({ error: "Attachment unavailable" });
    const workspace = engine.runs.find(run => run.chatThreadId === request.params.id || run.assignments.some(a => a.threadId === request.params.id))?.workspace || (await runtime.readChat(request.params.id)).cwd;
    if (!withinDirectory(workspace, attachment.path) && !withinDirectory(dataPath("attachments"), attachment.path))
      return reply.code(403).send({ error: "Attachment is outside this chat's workspace." });
    const mime: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
    };
    reply.header("X-Content-Type-Options", "nosniff");
    if (attachment.kind !== "image")
      reply.header("Content-Disposition", "attachment");
    return reply
      .type(
        mime[extname(attachment.path).toLowerCase()] ||
          "application/octet-stream",
      )
      .send(createReadStream(attachment.path));
  },
);
app.get<{ Params: { name: string } }>("/api/attachments/:name", async (request, reply) => {
  const name = request.params.name;
  if (basename(name) !== name || !/^[0-9a-f-]{36}-/i.test(name)) return reply.code(404).send({ error: "Attachment not found." });
  const path = dataPath("attachments", name);
  const type = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" } as Record<string,string>)[extname(name).toLowerCase()];
  if (!type || !existsSync(path)) return reply.code(404).send({ error: "Image not found." });
  return reply.type(type).header("Cache-Control", "private, max-age=3600").send(createReadStream(path));
});
app.post(
  "/api/attachments",
  { bodyLimit: 12 * 1024 * 1024 },
  async (request) => {
    const input = z
      .object({
        name: z.string().min(1).max(255),
        data: z.string().max(11 * 1024 * 1024),
      })
      .parse(request.body);
    const match = /^data:([^;,]*);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(
      input.data,
    );
    if (!match) throw new Error("Invalid attachment data.");
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length > 8 * 1024 * 1024)
      throw new Error("Attachments must be 8 MB or smaller.");
    const name = basename(input.name)
      .replace(/[^\w. -]/g, "_")
      .slice(0, 150);
    const directory = dataPath("attachments");
    mkdirSync(directory, { recursive: true });
    const path = resolve(directory, `${randomUUID()}-${name}`);
    writeFileSync(path, bytes, { flag: "wx" });
    return {
      name,
      path,
      preview: `/api/attachments/${encodeURIComponent(basename(path))}`,
      kind: [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(
        extname(name).toLowerCase(),
      )
        ? "image"
        : "file",
    };
  },
);
}
