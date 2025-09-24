"use client";

import React, { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import cx from "classnames";
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
} from "chart.js";
import { Bar, Line, Pie } from "react-chartjs-2";
import ChartDataLabels from "chartjs-plugin-datalabels";

ChartJS.register(
  Title,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  ChartDataLabels
);

/* ----------------------------- Tipos ------------------------------ */
type Row = { Usuario: string; Hora: number; Unidades: number; Caixas: number };
type PivotRow = { Usuario: string; Hora: number; Valor: number };

/* --------------------------- Paleta UI ---------------------------- */
const PALETTE = {
  blue: "#2563eb",
  orange: "#f59e0b",
  green: "#16a34a",
  violet: "#6d28d9",
  gray: "#9ca3af",
  grid: "#e5e7eb",
  pie: ["#2563eb","#16a34a","#f59e0b","#8b5cf6","#ec4899","#06b6d4","#e11d48","#60a5fa","#34d399","#f97316"]
};

/* ============================= Página ============================= */
export default function Page() {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState("Envie o arquivo .xlsx com ALTO GIRO (Unidades) e BAIXO GIRO (Caixas).");
  const fileRef = useRef<HTMLInputElement>(null);

  /* ------------------------- Upload / Parse ------------------------- */
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    setStatus("Lendo arquivo…");
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const buf = ev.target?.result as ArrayBuffer;
        const wb = XLSX.read(buf, { type: "array" });

        const wsAlto = getSheetByNameLike(wb, "ALTO GIRO");
        const wsBaixo = getSheetByNameLike(wb, "BAIXO GIRO");
        if (!wsAlto || !wsBaixo) {
          setStatus("Não encontrei as abas 'ALTO GIRO' e 'BAIXO GIRO'. Verifique os nomes.");
          return;
        }

        const alto = XLSX.utils.sheet_to_json(wsAlto, { header: 1, defval: null }) as any[][];
        const baixo = XLSX.utils.sheet_to_json(wsBaixo, { header: 1, defval: null }) as any[][];

        const un: PivotRow[] = parsePivot(alto);
        const cx: PivotRow[] = parsePivot(baixo);

        if (!un.length && !cx.length) {
          setStatus("Não encontrei dados em formato USUÁRIO × HORA.");
          return;
        }

        // Combinar (Usuario,Hora)
        const key = (u: string, h: number) => `${u}__${h}`;
        const map = new Map<string, Row>();
        un.forEach((r) =>
          map.set(key(r.Usuario, r.Hora), { Usuario: r.Usuario, Hora: r.Hora, Unidades: r.Valor || 0, Caixas: 0 })
        );
        cx.forEach((r) => {
          const k = key(r.Usuario, r.Hora);
          if (map.has(k)) map.get(k)!.Caixas = r.Valor || 0;
          else map.set(k, { Usuario: r.Usuario, Hora: r.Hora, Unidades: 0, Caixas: r.Valor || 0 });
        });

        const combined = [...map.values()].sort(
          (a, b) => a.Usuario.localeCompare(b.Usuario) || a.Hora - b.Hora
        );
        setRows(combined);
        setStatus(`Arquivo processado ✓ • ${combined.length} registros`);
      } catch (err: any) {
        console.error(err);
        setStatus("Erro ao processar arquivo: " + err?.message);
      }
    };
    reader.readAsArrayBuffer(f);
  };

  /* --------------------------- Agregações -------------------------- */
  const users = useMemo(() => Array.from(new Set(rows.map((r) => r.Usuario))), [rows]);
  const hours = useMemo(
    () => Array.from(new Set(rows.map((r) => r.Hora))).sort((a, b) => a - b),
    [rows]
  );

  const perUser = useMemo(() => {
    const out = users.map((u) => {
      const un = rows.filter((r) => r.Usuario === u).reduce((a, b) => a + b.Unidades, 0);
      const cx = rows.filter((r) => r.Usuario === u).reduce((a, b) => a + b.Caixas, 0);
      return { u, un, cx, total: un + cx };
    });
    return out.sort((a, b) => b.total - a.total);
  }, [rows, users]);

  const perHour = useMemo(() => {
    return hours.map((h) => {
      const un = rows.filter((r) => r.Hora === h).reduce((a, b) => a + b.Unidades, 0);
      const cx = rows.filter((r) => r.Hora === h).reduce((a, b) => a + b.Caixas, 0);
      return { h, un, cx, total: un + cx };
    });
  }, [rows, hours]);

  const totals = useMemo(() => {
    const un = perUser.reduce((a, b) => a + b.un, 0);
    const cx = perUser.reduce((a, b) => a + b.cx, 0);
    return { un, cx, total: un + cx };
  }, [perUser]);

  /* ---------------------------- Insights --------------------------- */
  const insights = useMemo(() => {
    if (!rows.length) return [];
    const pareto = paretoCount(perUser.map((x) => x.total));
    const peak = perHour.reduce((m, h) => (h.total > m.total ? h : m), perHour[0] || { h: 0, total: 0, un: 0, cx: 0 });
    const low = perHour.reduce((m, h) => (h.total < m.total ? h : m), perHour[0] || { h: 0, total: 0, un: 0, cx: 0 });
    return [
      `Pareto: ~${pareto} usuário(s) concentram ~80% do volume.`,
      `Hora de pico: ${String(peak?.h ?? 0).padStart(2, "0")}:00.`,
      `Hora de menor movimento: ${String(low?.h ?? 0).padStart(2, "0")}:00.`,
      `Top 3 usuários: ${perUser.slice(0, 3).map((x) => x.u).join(", ") || "—"}.`,
    ];
  }, [rows, perUser, perHour]);

  /* ---------------------------- Dados Gráficos --------------------- */
  const barData = useMemo(
    () => ({
      labels: perUser.map((p) => p.u),
      datasets: [
        {
          label: "Unidades (Alto Giro)",
          data: perUser.map((p) => p.un),
          backgroundColor: PALETTE.blue,
          datalabels: { anchor: "end" as const, align: "top" as const },
        },
        {
          label: "Caixas (Baixo Giro)",
          data: perUser.map((p) => p.cx),
          backgroundColor: PALETTE.orange,
          datalabels: { anchor: "end" as const, align: "top" as const },
        },
      ],
    }),
    [perUser]
  );

  // Pareto
  const paretoSorted = useMemo(() => [...perUser].sort((a, b) => b.total - a.total), [perUser]);
  const paretoVals = paretoSorted.map((x) => x.total);
  const paretoCum = cumulative(paretoVals).map(
    (c) => (c / (paretoVals.reduce((a, b) => a + b, 0) || 1)) * 100
  );

  const lineData = useMemo(
    () => ({
      labels: perHour.map((h) => `${String(h.h).padStart(2, "0")}:00`),
      datasets: [
        {
          label: "Unidades",
          data: perHour.map((h) => h.un),
          borderColor: PALETTE.blue,
          backgroundColor: PALETTE.blue,
          tension: 0.3,
          pointRadius: 2,
          datalabels: { align: "top" as const },
        },
        {
          label: "Caixas",
          data: perHour.map((h) => h.cx),
          borderColor: PALETTE.orange,
          backgroundColor: PALETTE.orange,
          tension: 0.3,
          pointRadius: 2,
          datalabels: { align: "top" as const },
        },
        {
          label: "Tendência (MM3)",
          data: movingAvg(perHour.map((h) => h.total), 3),
          borderColor: PALETTE.violet,
          borderDash: [6, 4],
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          datalabels: { display: false },
        },
      ],
    }),
    [perHour]
  );

  const pieData = useMemo(
    () => ({
      labels: paretoSorted.map((p) => p.u),
      datasets: [{ data: paretoSorted.map((p) => p.total), backgroundColor: PALETTE.pie }],
    }),
    [paretoSorted]
  );

  /* ------------------------------ UI ------------------------------- */
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <header className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 flex flex-col md:flex-row gap-4 md:items-center">
          <div className="w-12 h-12 rounded-xl bg-blue-600 text-white grid place-items-center text-lg font-bold">BI</div>
          <div className="flex-1">
            <h1 className="text-xl font-extrabold tracking-tight">Reposição — Painel Executivo</h1>
            <p className="text-slate-600 text-sm">{status}</p>
          </div>
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept=".xlsx,.xls"
                   className="block rounded-lg border border-slate-300 px-3 py-2 text-sm"
                   onChange={onFile} />
            <button
              onClick={() => downloadCSV(rows)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white hover:bg-slate-50"
              disabled={!rows.length}
              title="Baixar CSV enriquecido"
            >
              CSV
            </button>
          </div>
        </header>

        {/* KPIs */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KPI title="Unidades (Alto Giro)" val={totals.un} color="text-blue-700" />
          <KPI title="Caixas (Baixo Giro)" val={totals.cx} color="text-orange-600" />
          <KPI title="Total" val={totals.total} color="text-green-600" />
        </section>

        {/* Gráficos */}
        <Card title="Ranking por Usuário — Unidades x Caixas (sempre visível)">
          <div className="h-[360px] md:h-[420px]">
            <Bar data={barData} options={barOptions()} plugins={[ChartDataLabels]} />
          </div>
        </Card>

        <Card title="Pareto 80/20 — Contribuição por Usuário">
          <div className="h-[360px] md:h-[420px]">
            <Bar
              data={{
                labels: paretoSorted.map((x) => x.u),
                datasets: [
                  { type: "bar" as const, label: "Total", data: paretoVals, backgroundColor: PALETTE.blue,
                    datalabels:{ anchor:"end" as const, align:"top" as const } },
                  { type: "line" as const, label: "Acumulado %", data: paretoCum, yAxisID: "y1",
                    borderColor: PALETTE.green, tension: 0.3, pointRadius: 2, datalabels:{ display:false } },
                ],
              }}
              options={{
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                scales: {
                  y: { beginAtZero: true, grid: { color: PALETTE.grid } },
                  y1: { position: "right", min: 0, max: 100, grid: { drawOnChartArea: false }, ticks: { callback: (v:any) => `${v}%` } },
                },
                plugins: {
                  legend: { position: "top" },
                  datalabels: baseLabelCfg(),
                },
              }}
              plugins={[ChartDataLabels]}
            />
          </div>
        </Card>

        <Card title="Evolução por Hora — Unidades x Caixas + Tendência (MM3)">
          <div className="h-[360px] md:h-[420px]">
            <Line data={lineData} options={lineOptions()} plugins={[ChartDataLabels]} />
          </div>
        </Card>

        <Card title="Heatmap — Usuário × Hora (Total)">
          <Heatmap users={perUser.map((x) => x.u)} hours={hours} rows={rows} />
        </Card>

        <Card title="Tabela Executiva">
          <ExecTable perUser={perUser} />
        </Card>

        {insights.length > 0 && (
          <Card title="Insights Automáticos">
            <ul className="list-disc pl-5 space-y-1 text-sm">
              {insights.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </Card>
        )}
      </div>
    </main>
  );
}

/* ============================ Componentes =========================== */

function KPI({ title, val, color }: { title: string; val: number; color: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 text-center">
      <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
      <p className={cx("text-3xl font-extrabold", color)}>{val.toLocaleString("pt-BR")}</p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
      <h3 className="font-bold mb-3">{title}</h3>
      {children}
    </div>
  );
}

function ExecTable({ perUser }: { perUser: { u: string; un: number; cx: number; total: number }[] }) {
  const grand = perUser.reduce((a, b) => a + b.total, 0) || 1;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[720px] w-full text-sm border-collapse">
        <thead>
          <tr className="bg-slate-100">
            <th className="text-left p-2 border border-slate-200">Usuário</th>
            <th className="text-right p-2 border border-slate-200">Unidades</th>
            <th className="text-right p-2 border border-slate-200">Caixas</th>
            <th className="text-right p-2 border border-slate-200">Total</th>
            <th className="text-right p-2 border border-slate-200">% do Total</th>
          </tr>
        </thead>
        <tbody>
          {perUser.map((r) => (
            <tr key={r.u}>
              <td className="p-2 border border-slate-200">{r.u}</td>
              <td className="p-2 border border-slate-200 text-right">{r.un.toLocaleString("pt-BR")}</td>
              <td className="p-2 border border-slate-200 text-right">{r.cx.toLocaleString("pt-BR")}</td>
              <td className="p-2 border border-slate-200 text-right">{r.total.toLocaleString("pt-BR")}</td>
              <td className="p-2 border border-slate-200 text-right">
                {((r.total / grand) * 100).toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-slate-100 font-semibold">
            <td className="p-2 border border-slate-200 text-right">Totais</td>
            <td className="p-2 border border-slate-200 text-right">
              {perUser.reduce((a, b) => a + b.un, 0).toLocaleString("pt-BR")}
            </td>
            <td className="p-2 border border-slate-200 text-right">
              {perUser.reduce((a, b) => a + b.cx, 0).toLocaleString("pt-BR")}
            </td>
            <td className="p-2 border border-slate-200 text-right">
              {perUser.reduce((a, b) => a + b.total, 0).toLocaleString("pt-BR")}
            </td>
            <td className="p-2 border border-slate-200 text-right">100%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Heatmap({ users, hours, rows }: { users: string[]; hours: number[]; rows: Row[] }) {
  const cell = (u: string, h: number) =>
    rows.filter((r) => r.Usuario === u && r.Hora === h).reduce((a, b) => a + b.Unidades + b.Caixas, 0);
  const matrix = users.map((u) => hours.map((h) => cell(u, h)));
  const max = Math.max(1, ...matrix.flat());

  const color = (v: number) => {
    // Gradiente azul->verde
    const t = Math.sqrt(v / max);
    const h = 200 + Math.round(40 * t); // 200 (azul) -> 240 (ciano/verde-água)
    const s = 75;
    const l = 92 - t * 50; // 92 -> 42
    return `hsl(${h} ${s}% ${l}%)`;
  };

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse w-full text-sm">
        <thead>
          <tr>
            <th className="text-left p-2 text-slate-600">Usuário \ Hora</th>
            {hours.map((h) => (
              <th key={h} className="px-2 py-1 text-slate-600">{String(h).padStart(2, "0")}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map((u, i) => (
            <tr key={u}>
              <td className="whitespace-nowrap border-t border-slate-200 py-1 pr-2 font-medium">{u}</td>
              {hours.map((h, j) => {
                const v = matrix[i][j] || 0;
                return (
                  <td key={h} title={`${u} @ ${String(h).padStart(2, "0")}: ${v.toLocaleString("pt-BR")}`}
                      className="border-t border-slate-200">
                    <div className="h-7 w-16 md:w-24 rounded" style={{ background: color(v) }} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-500 mt-2">Cores mais escuras = maior volume (Unidades + Caixas).</p>
    </div>
  );
}

/* ============================ Chart Options ======================== */

function baseLabelCfg() {
  return {
    color: "#111",
    backgroundColor: "rgba(255,255,255,0.85)",
    borderRadius: 4,
    borderColor: "#dbe3ef",
    borderWidth: 1,
    padding: 3,
    clip: true,
    formatter: (v: number) => (v ? abbr(v) : ""),
  };
}

function barOptions(): any {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "top" },
      datalabels: baseLabelCfg(),
      tooltip: { enabled: true },
    },
    scales: {
      y: { beginAtZero: true, grid: { color: PALETTE.grid } },
      x: { grid: { display: false } },
    },
  };
}

function lineOptions(): any {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "top" },
      datalabels: {
        ...baseLabelCfg(),
        align: "top",
      },
    },
    scales: { y: { beginAtZero: true, grid: { color: PALETTE.grid } } },
  };
}

/* ============================ Helpers ============================ */

function getSheetByNameLike(wb: XLSX.WorkBook, expected: string): XLSX.WorkSheet | null {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toUpperCase();
  const wanted = norm(expected);
  const name =
    wb.SheetNames.find((n) => norm(n) === wanted) ||
    wb.SheetNames.find((n) => norm(n).includes(wanted)) ||
    null;
  return name ? wb.Sheets[name] : null;
}

function parsePivot(matrix: any[][]): PivotRow[] {
  // 1) linha cabeçalho com "USUÁRIO"
  let headerRow = -1;
  for (let i = 0; i < matrix.length; i++) {
    const row = (matrix[i] || []).map((x) => String(x ?? "").toUpperCase());
    if (row.includes("USUÁRIO")) { headerRow = i; break; }
  }
  if (headerRow < 0) return [];

  const header = matrix[headerRow] || [];
  const colUser = header.findIndex((c: any) => String(c ?? "").toUpperCase().trim() === "USUÁRIO");
  if (colUser < 0) return [];

  // 2) colunas de hora tolerantes
  const hourCols: { col: number; hour: number }[] = [];
  for (let c = colUser + 1; c < header.length; c++) {
    const raw = String(header[c] ?? "");
    const m = raw.match(/(\d{1,2})/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 0 && n <= 23) hourCols.push({ col: c, hour: n });
  }
  if (!hourCols.length) return [];

  // 3) varrer linhas até "Total"
  const out: PivotRow[] = [];
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const name = String(row[colUser] ?? "").trim();
    if (!name) continue;
    if (name.toUpperCase().includes("TOTAL")) break;

    for (const hc of hourCols) {
      const cell = row[hc.col];
      const val = parseFloat(String(cell ?? "").replace(/\./g, "").replace(",", "."));
      if (Number.isFinite(val)) out.push({ Usuario: name, Hora: hc.hour, Valor: val });
    }
  }
  return out;
}

function cumulative(arr: number[]) {
  const out: number[] = [];
  arr.reduce((a, b, i) => ((out[i] = a + b), a + b), 0);
  return out;
}

function movingAvg(arr: number[], w: number) {
  const out: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    const seg = arr.slice(Math.max(0, i - w + 1), i + 1);
    out.push(seg.reduce((a, b) => a + b, 0) / seg.length);
  }
  return out;
}

function paretoCount(vals: number[]) {
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  const sorted = [...vals].sort((a, b) => b - a);
  let acc = 0, i = 0;
  for (; i < sorted.length; i++) { acc += sorted[i]; if (acc / total >= 0.8) break; }
  return i + 1;
}

function downloadCSV(data: Row[]) {
  if (!data.length) return;
  const rows = data.map(r => [r.Usuario, r.Hora, r.Unidades, r.Caixas].join(","));
  const csv = ["Usuario,Hora,Unidades,Caixas", ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "reposicao_enriquecido.csv"; a.click();
  URL.revokeObjectURL(url);
}

function abbr(v: number) {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "k";
  return v.toString();
}
