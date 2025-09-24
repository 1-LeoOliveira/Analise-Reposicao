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

type Row = { Usuario: string; Hora: number; Unidades: number; Caixas: number };
type PivotRow = { Usuario: string; Hora: number; Valor: number };

const PALETTE = {
  blue: "#2563eb",
  orange: "#f59e0b",
  grid: "#e5e7eb",
  pie: ["#2563eb","#16a34a","#f59e0b","#8b5cf6","#ec4899","#06b6d4","#e11d48"]
};

export default function Page() {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState("Envie o arquivo .xlsx com ALTO GIRO (Unidades) e BAIXO GIRO (Caixas).");
  const fileRef = useRef<HTMLInputElement>(null);

  /* Upload */
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    setStatus("Lendo arquivo…");
    const reader = new FileReader();
    reader.onload = (ev: ProgressEvent<FileReader>) => {
      try {
        const buf = ev.target?.result as ArrayBuffer;
        const wb = XLSX.read(buf, { type: "array" });

        const wsAlto = getSheetByNameLike(wb, "ALTO GIRO");
        const wsBaixo = getSheetByNameLike(wb, "BAIXO GIRO");
        if (!wsAlto || !wsBaixo) {
          setStatus("Não encontrei as abas ALTO GIRO e BAIXO GIRO");
          return;
        }

        const alto = XLSX.utils.sheet_to_json(wsAlto, { header: 1, defval: null }) as (string|number|null)[][];
        const baixo = XLSX.utils.sheet_to_json(wsBaixo, { header: 1, defval: null }) as (string|number|null)[][];

        const un: PivotRow[] = parsePivot(alto);
        const cx: PivotRow[] = parsePivot(baixo);

        const key = (u: string, h: number) => `${u}__${h}`;
        const map = new Map<string, Row>();
        un.forEach(r =>
          map.set(key(r.Usuario,r.Hora), {Usuario:r.Usuario,Hora:r.Hora,Unidades:r.Valor||0,Caixas:0})
        );
        cx.forEach(r=>{
          const k=key(r.Usuario,r.Hora);
          if(map.has(k)) map.get(k)!.Caixas=r.Valor||0;
          else map.set(k,{Usuario:r.Usuario,Hora:r.Hora,Unidades:0,Caixas:r.Valor||0});
        });
        const combined=[...map.values()].sort((a,b)=>a.Usuario.localeCompare(b.Usuario)||a.Hora-b.Hora);
        setRows(combined);
        setStatus(`Arquivo processado ✓ (${combined.length} registros)`);
      } catch(err: unknown){
        setStatus("Erro ao processar arquivo");
      }
    };
    reader.readAsArrayBuffer(f);
  };

  /* Agregações */
  const users = useMemo(()=>Array.from(new Set(rows.map(r=>r.Usuario))),[rows]);
  const hours = useMemo(()=>Array.from(new Set(rows.map(r=>r.Hora))).sort((a,b)=>a-b),[rows]);

  const perUser = useMemo(()=>{
    return users.map(u=>{
      const un=rows.filter(r=>r.Usuario===u).reduce((a,b)=>a+b.Unidades,0);
      const cx=rows.filter(r=>r.Usuario===u).reduce((a,b)=>a+b.Caixas,0);
      return {u,un,cx,total:un+cx};
    }).sort((a,b)=>b.total-a.total);
  },[rows,users]);

  const perHour = useMemo(()=>{
    return hours.map(h=>{
      const un=rows.filter(r=>r.Hora===h).reduce((a,b)=>a+b.Unidades,0);
      const cx=rows.filter(r=>r.Hora===h).reduce((a,b)=>a+b.Caixas,0);
      return {h,un,cx,total:un+cx};
    });
  },[rows,hours]);

  const totals = {
    un: perUser.reduce((a,b)=>a+b.un,0),
    cx: perUser.reduce((a,b)=>a+b.cx,0),
    total: perUser.reduce((a,b)=>a+b.total,0)
  };

  /* Chart data */
  const barData = {
    labels: perUser.map(p=>p.u),
    datasets:[
      {label:"Unidades", data:perUser.map(p=>p.un), backgroundColor:PALETTE.blue},
      {label:"Caixas", data:perUser.map(p=>p.cx), backgroundColor:PALETTE.orange}
    ]
  };

  const lineData = {
    labels: perHour.map(h=>`${String(h.h).padStart(2,"0")}:00`),
    datasets:[
      {label:"Unidades", data:perHour.map(h=>h.un), borderColor:PALETTE.blue, backgroundColor:PALETTE.blue, tension:.3},
      {label:"Caixas", data:perHour.map(h=>h.cx), borderColor:PALETTE.orange, backgroundColor:PALETTE.orange, tension:.3}
    ]
  };

  const pieData = {
    labels: perUser.map(p=>p.u),
    datasets:[{data:perUser.map(p=>p.total), backgroundColor:PALETTE.pie}]
  };

  /* UI */
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <header className="bg-white border rounded-xl p-5 flex flex-col md:flex-row gap-4 md:items-center">
          <div className="flex-1">
            <h1 className="text-xl font-extrabold">Reposição — Painel Executivo</h1>
            <p className="text-slate-600 text-sm">{status}</p>
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls"
            className="block rounded-lg border border-slate-300 px-3 py-2 text-sm"
            onChange={onFile}/>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KPI title="Unidades" val={totals.un} color="text-blue-700"/>
          <KPI title="Caixas" val={totals.cx} color="text-orange-600"/>
          <KPI title="Total" val={totals.total} color="text-green-600"/>
        </section>

        <Card title="Ranking por Usuário">
          <div className="h-[360px]"><Bar data={barData} options={barOptions()} plugins={[ChartDataLabels]}/></div>
        </Card>

        <Card title="Participação por Usuário (% do total)">
          <div className="h-[360px]"><Pie data={pieData} options={pieOptions()} plugins={[ChartDataLabels]}/></div>
        </Card>

        <Card title="Evolução por Hora">
          <div className="h-[360px]"><Line data={lineData} options={lineOptions()} plugins={[ChartDataLabels]}/></div>
        </Card>
      </div>
    </main>
  );
}

/* Componentes */
function KPI({title,val,color}:{title:string;val:number;color:string}){
  return (
    <div className="bg-white border rounded-xl p-5 text-center">
      <p className="text-xs uppercase text-slate-500">{title}</p>
      <p className={cx("text-3xl font-extrabold",color)}>{val.toLocaleString("pt-BR")}</p>
    </div>
  );
}
function Card({title,children}:{title:string;children:React.ReactNode}){
  return <div className="bg-white border rounded-xl p-5"><h3 className="font-bold mb-3">{title}</h3>{children}</div>;
}

/* Chart options */
function barOptions(){
  return {
    responsive:true, maintainAspectRatio:false,
    plugins:{
      legend:{position:"top"},
      datalabels:{
        color:"#111", anchor:"end" as const, align:"top" as const,
        backgroundColor:"rgba(255,255,255,0.8)", borderRadius:4, padding:3,
        formatter:(v:number)=>v.toLocaleString("pt-BR")
      }
    },
    scales:{y:{beginAtZero:true, grid:{color:PALETTE.grid}}}
  };
}
function lineOptions(){
  return {
    responsive:true, maintainAspectRatio:false,
    plugins:{
      legend:{position:"top"},
      datalabels:{
        color:"#111", align:"top" as const,
        backgroundColor:"rgba(255,255,255,0.8)", borderRadius:4, padding:3,
        formatter:(v:number)=>v.toLocaleString("pt-BR")
      }
    },
    scales:{y:{beginAtZero:true, grid:{color:PALETTE.grid}}}
  };
}
function pieOptions(){
  return {
    plugins:{
      legend:{position:"right"},
      datalabels:{
        color:"#111",
        formatter:(v:number,ctx:{chart:ChartJS})=>{
          const total=(ctx.chart.data.datasets[0].data as number[]).reduce((a,b)=>a+b,0);
          const pct=((v/total)*100).toFixed(1)+"%";
          return `${pct}`;
        }
      }
    }
  };
}

/* Helpers */
function getSheetByNameLike(wb:XLSX.WorkBook, expected:string): XLSX.WorkSheet | null {
  const norm=(s:string)=>s.replace(/\s+/g," ").trim().toUpperCase();
  const wanted=norm(expected);
  const name=wb.SheetNames.find(n=>norm(n).includes(wanted))||null;
  return name? wb.Sheets[name]:null;
}
function parsePivot(matrix:(string|number|null)[][]): PivotRow[]{
  let headerRow=-1;
  for(let i=0;i<matrix.length;i++){
    const row=(matrix[i]||[]).map(x=>String(x??"").toUpperCase());
    if(row.includes("USUÁRIO")){headerRow=i;break;}
  }
  if(headerRow<0) return [];
  const header=matrix[headerRow]||[];
  const colUser=header.findIndex(c=>String(c??"").toUpperCase().trim()==="USUÁRIO");
  if(colUser<0) return [];
  const hourCols:{col:number;hour:number}[]=[];
  for(let c=colUser+1;c<header.length;c++){
    const raw=String(header[c]??""); const m=raw.match(/(\d{1,2})/);
    if(!m) continue; const n=parseInt(m[1],10);
    if(Number.isFinite(n)&&n>=0&&n<=23) hourCols.push({col:c,hour:n});
  }
  const out:PivotRow[]=[];
  for(let r=headerRow+1;r<matrix.length;r++){
    const row=matrix[r]||[]; const name=String(row[colUser]??"").trim();
    if(!name) continue; if(name.toUpperCase().includes("TOTAL")) break;
    for(const hc of hourCols){
      const val=parseFloat(String(row[hc.col]??"").replace(/\./g,"").replace(",","."));
      if(Number.isFinite(val)) out.push({Usuario:name,Hora:hc.hour,Valor:val});
    }
  }
  return out;
}
