/**
 * BG-088 — un 409 no cambia la revisión que el repositorio conoce.
 *
 * La revisión de la respuesta es la de unos datos que el cliente todavía no tiene. Se adopta con
 * ellos, en la recarga (`fetchSnapshot` + `adopt`), nunca sola.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { ServerRepository } from "@/data/serverRepository";
import { buildSeed } from "@/domain";
import { P0 } from "../helpers/periods";

afterEach(() => { vi.unstubAllGlobals(); });

const conflicto = () => new Response(JSON.stringify({ error: { code: "revision_conflict" }, revision: 7 }), { status: 409 });

describe("BG-088 · las cinco escrituras ante un 409", () => {
  it("ninguna adopta la revisión de la respuesta", async () => {
    const repo = new ServerRepository();
    vi.stubGlobal("fetch", vi.fn(async () => conflicto()));

    expect(await repo.save("A", buildSeed("local", P0))).toBe(false);
    expect(repo.conflicted).toBe(true);
    expect(await repo.closure("close")).toEqual({ ok: false, reason: "revision_conflict" });
    expect(await repo.closure("reopen")).toEqual({ ok: false, reason: "revision_conflict" });
    expect(await repo.saveStart("2026-08", 1_000)).toMatchObject({ ok: false, reason: "revision_conflict" });
    expect(await repo.applyCycles({ mode: "month" })).toMatchObject({ ok: false, code: "revision_conflict" });
    expect(await repo.previewCycles({ mode: "month" })).toMatchObject({ ok: false, code: "revision_conflict" });
    expect(repo.currentRevision).toBe(0);
  });

  it("la revisión se adopta con sus datos, en la recarga", async () => {
    const repo = new ServerRepository();
    const estado = buildSeed("local", P0);
    vi.stubGlobal("fetch", vi.fn(async (_u: unknown, req?: RequestInit) =>
      (req?.method ?? "GET") === "PUT" ? conflicto() : new Response(JSON.stringify({ revision: 7, state: estado }), { status: 200 })));

    await repo.save("A", estado);
    expect(repo.currentRevision).toBe(0);
    const snap = await repo.fetchSnapshot();
    repo.adopt(snap.revision);
    expect(repo.currentRevision).toBe(7);
    expect(repo.conflicted).toBe(false);
  });
});
