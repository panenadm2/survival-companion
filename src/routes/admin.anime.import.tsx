import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import { adminSnapshotQuery } from "@/api/admin-queries";
import { analyzeCsv, buildTemplateCsv, importAnimeRows, type ImportResult, type ImportRow } from "@/api/admin-anime-import";
import { Button } from "@/components/ui/button";
import { adminHead } from "@/lib/admin-head";
import { statusLabel, typeLabel } from "@/lib/format";

export const Route = createFileRoute("/admin/anime/import")({ staticData: { sitemap: false }, loader: ({ context }) => context.queryClient.ensureQueryData(adminSnapshotQuery), head: () => adminHead("Import anime CSV"), component: ImportAnime });

const badge: Record<ImportRow["status"], { label: string; className: string }> = {
  baru: { label: "Baru", className: "bg-accent text-primary" },
  duplikat: { label: "Duplikat", className: "bg-muted text-muted-foreground" },
  invalid: { label: "Tidak Valid", className: "bg-destructive/15 text-destructive" },
};

function downloadTemplate() {
  const blob = new Blob([buildTemplateCsv()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "template-import-anime.csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function ImportAnime() {
  const { data } = useSuspenseQuery(adminSnapshotQuery);
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ImportResult[] | null>(null);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    setResults(null); setError(""); setRows([]); setSelected(new Set());
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) { setError("File harus berformat .csv."); return; }
    if (file.size > 2 * 1024 * 1024) { setError("Ukuran file maksimal 2 MB."); return; }
    setFileName(file.name);
    const analysis = analyzeCsv(await file.text(), data.anime, data.tags);
    if (analysis.headerError) { setError(analysis.headerError); return; }
    if (analysis.rows.length > 500) { setError("Maksimal 500 baris dalam satu kali impor."); return; }
    setRows(analysis.rows);
    setSelected(new Set(analysis.rows.filter((r) => r.status === "baru").map((r) => r.lineNumber)));
  }

  const newRows = rows.filter((r) => r.status === "baru");
  const counts = { total: rows.length, baru: newRows.length, duplikat: rows.filter((r) => r.status === "duplikat").length, invalid: rows.filter((r) => r.status === "invalid").length };
  const allSelected = newRows.length > 0 && newRows.every((r) => selected.has(r.lineNumber));

  function toggle(line: number) {
    setSelected((prev) => { const next = new Set(prev); if (next.has(line)) next.delete(line); else next.add(line); return next; });
  }

  async function runImport() {
    const chosen = newRows.filter((r) => selected.has(r.lineNumber));
    if (!chosen.length) { toast.error("Pilih minimal satu anime baru."); return; }
    setBusy(true);
    try {
      const res = await importAnimeRows(chosen);
      setResults(res);
      await queryClient.invalidateQueries();
      const ok = res.filter((r) => r.ok).length;
      toast.success(`${ok} anime diimpor sebagai draf, ${res.length - ok} gagal.`);
      setRows([]); setSelected(new Set());
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Import gagal.");
    } finally { setBusy(false); }
  }

  return <section>
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-3xl font-bold tracking-normal">Import Anime CSV</h1>
      <Button variant="outline" asChild><Link to="/admin/anime">Kembali ke daftar anime</Link></Button>
    </div>
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      <div className="rounded-md border border-border bg-card p-5">
        <h2 className="font-semibold">Download Template CSV</h2>
        <p className="mt-1 text-sm text-muted-foreground">Kolom wajib: title, type, status. Slug dibuat otomatis dari judul. Genre dipisah koma dan harus sudah terdaftar. poster_url opsional (https://).</p>
        <Button className="mt-4" variant="outline" onClick={downloadTemplate}><Download />Download Template</Button>
      </div>
      <div className="rounded-md border border-border bg-card p-5">
        <h2 className="font-semibold">Upload Batch CSV</h2>
        <p className="mt-1 text-sm text-muted-foreground">Semua anime hasil impor disimpan sebagai draf. Data lama tidak pernah ditimpa.</p>
        <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          <Upload className="size-4" />Pilih file CSV
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { void onFile(e); }} />
        </label>
        {fileName && <p className="mt-2 text-sm text-muted-foreground">{fileName}</p>}
      </div>
    </div>
    {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

    {results && <div className="mt-6 rounded-md border border-border p-4">
      <h2 className="font-semibold">Laporan impor: {results.filter((r) => r.ok).length} berhasil, {results.filter((r) => !r.ok).length} gagal</h2>
      <ul className="mt-2 space-y-1 text-sm">{results.map((r) => <li key={r.lineNumber} className={r.ok ? "" : "text-destructive"}>{`Baris ${r.lineNumber} — ${r.title}: ${r.message}`}</li>)}</ul>
    </div>}

    {rows.length > 0 && <>
      <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
        <span>Total: <b>{counts.total}</b></span><span>Baru: <b>{counts.baru}</b></span><span>Duplikat: <b>{counts.duplikat}</b></span><span>Tidak Valid: <b>{counts.invalid}</b></span>
        <span className="ml-auto">{selected.size} dipilih</span>
        <Button onClick={() => { void runImport(); }} disabled={busy || selected.size === 0}>{busy ? "Mengimpor…" : `Import ${selected.size} anime`}</Button>
      </div>
      <div className="mt-4 min-w-0 max-w-full overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-card text-muted-foreground"><tr>
            <th className="px-3 py-3"><input type="checkbox" aria-label="Pilih semua yang baru" className="size-4 accent-primary" checked={allSelected} disabled={!newRows.length} onChange={() => setSelected(allSelected ? new Set() : new Set(newRows.map((r) => r.lineNumber)))} /></th>
            {["Baris", "Status", "Judul", "Tipe", "Status anime", "Tahun", "Rating", "Genre", "Keterangan"].map((h) => <th key={h} className="px-3 py-3 font-medium">{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-border">{rows.map((r) => <tr key={r.lineNumber}>
            <td className="px-3 py-2"><input type="checkbox" aria-label={`Pilih ${r.title}`} className="size-4 accent-primary" disabled={r.status !== "baru"} checked={selected.has(r.lineNumber)} onChange={() => toggle(r.lineNumber)} /></td>
            <td className="px-3">{r.lineNumber}</td>
            <td className="px-3"><span className={`whitespace-nowrap rounded-sm px-2 py-1 text-xs ${badge[r.status].className}`}>{badge[r.status].label}</span></td>
            <td className="px-3"><div className="font-semibold">{r.title || "—"}</div>{r.altTitle && <div className="text-xs text-muted-foreground">{r.altTitle}</div>}</td>
            <td className="px-3">{r.type ? typeLabel[r.type] : "—"}</td>
            <td className="px-3">{r.status_ ? statusLabel[r.status_] : "—"}</td>
            <td className="px-3">{r.year ?? "—"}</td>
            <td className="px-3">{r.rating ?? "—"}</td>
            <td className="px-3">{r.genres.join(", ") || "—"}</td>
            <td className="px-3 text-xs text-muted-foreground">{r.reasons.join(" ") || "Siap diimpor"}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </>}
  </section>;
}
