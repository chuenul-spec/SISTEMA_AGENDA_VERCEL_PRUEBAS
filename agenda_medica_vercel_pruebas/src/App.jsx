import { useState, useMemo, useRef, useEffect } from "react";

// ═══════════════════════════════════════════════════════════════════════════════
// DATOS — reemplaza estas entradas con los datos completos de tu sistema
// ═══════════════════════════════════════════════════════════════════════════════

const TIPOS_CUPO = [
  { codigo: "N",  descripcion: "NUEVO",   tipologia: "NUEVO"   },
  { codigo: "C",  descripcion: "CONTROL", tipologia: "CONTROL" },
  { codigo: "R",  descripcion: "RECETA",  tipologia: "RECETA"  },
  { codigo: "RR", descripcion: "RECETA",  tipologia: "RECETA"  },
  // ... agrega el resto de tipos de cupo aquí
];

const PROFESIONALES = new Map([
  ["724",  "FELIPE ORLANDO ACEVEDO ALARCON"],
  ["950",  "ANDRES ANTONIO ACUNA CARRASCO"],
  // ... agrega el resto de profesionales aquí
]);

const AGENDAS = new Map([
  ["5",  "BRONCOPULMONAR - CONSULTA ADULTO"],
  ["26", "CARDIOLOGIA - CONSULTA ADULTO"],
  // ... agrega el resto de agendas aquí
]);

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════════

const DIAS       = ["LUNES","MARTES","MIÉRCOLES","JUEVES","VIERNES","SÁBADO","DOMINGO"];
const DIAS_SHORT = ["LUN","MAR","MIÉ","JUE","VIE","SÁB","DOM"];
const DIAS_JS_IDX = [1,2,3,4,5,6,0];

const CUPO_COLORS = [
  "#2563eb","#16a34a","#dc2626","#9333ea","#ea580c","#0891b2","#be185d",
  "#854d0e","#065f46","#1e3a8a","#7c3aed","#b91c1c","#0369a1","#166534",
];

const INTERVALOS = [2,3,4,5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100,105,110,115,120];

const MODALIDADES = [
  "INSTITUCIONAL","HONORARIOS","CONSULTORES DE LLAMADO",
  "COMPRAS REALIZADAS AL SISTEMA","COMPRAS REALIZADAS AL EXTRA SISTEMA",
  "VENTA DE SERVICIOS","PLAN 500","OPERATIVO","CONVENIO 33.000",
];

function generateTimeSlots() {
  const slots = [];
  for (let h = 7; h <= 20; h++)
    for (let m = 0; m < 60; m += 5)
      slots.push(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`);
  return slots;
}
const TIME_SLOTS = generateTimeSlots();

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function getColorForCodigo(codigo) {
  const idx = TIPOS_CUPO.findIndex(t => t.codigo === codigo);
  return CUPO_COLORS[Math.max(0, idx) % CUPO_COLORS.length];
}

function homologarTipologia(codigo) {
  if (codigo === "R" || codigo === "RR") return "RECETA";
  return TIPOS_CUPO.find(t => t.codigo === codigo)?.tipologia || "NUEVO";
}

function fmtFecha(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${d}-${m}-${y}`;
}

function getLunes(d) {
  const tmp = new Date(d.getTime());
  const day = tmp.getDay();
  tmp.setDate(tmp.getDate() + (day === 0 ? -6 : 1 - day));
  tmp.setHours(0, 0, 0, 0);
  return tmp;
}

function addDays(d, n) {
  const tmp = new Date(d.getTime());
  tmp.setDate(tmp.getDate() + n);
  return tmp;
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// ── Expande bloques para modo "SI (Dación de hora libre)" ────────────────────
// Convierte 1 bloque de N cupos → N bloques de 1 cupo cada uno con hora propia
function expandirBloquesDacion(bloques, escalonada) {
  if (escalonada !== "SI (Dación de hora libre)") return bloques;
  const result = [];
  bloques.forEach(b => {
    if (b.cantidad <= 1) { result.push(b); return; }
    for (let i = 0; i < b.cantidad; i++) {
      const minBase = toMinutes(b.horaInicio) + b.intervalo * i;
      const hh = String(Math.floor(minBase / 60)).padStart(2, "0");
      const mm = String(minBase % 60).padStart(2, "0");
      result.push({ ...b, horaInicio: `${hh}:${mm}`, cantidad: 1 });
    }
  });
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

export default function AgendaMedica() {
  const [step, setStep] = useState(1);
  const [cabecera, setCabecera] = useState({
    codigoRecurso: "", codigoAgenda: "", nombreProfesional: "", nombreAgenda: "",
    especialidad: "", fechaInicio: "", fechaTermino: "",
    escalonada: "SI", modalidadFinanciamiento: "INSTITUCIONAL",
    requiereFicha: "SI", permiteVariasHoras: "NO", comentarioGeneral: "",
  });
  const [bloques, setBloques]               = useState([]);
  const [vistaCalendario, setVistaCalendario] = useState("semanal");
  const [semanaActual, setSemanaActual]     = useState(1);
  const [modalOpen, setModalOpen]           = useState(false);
  const [modalData, setModalData]           = useState({ dia: "", hora: "", semana: 1 });
  const [formBloque, setFormBloque]         = useState({ tipoCupo: "", cantidad: 1, intervalo: 15 });
  const [busquedaCupo, setBusquedaCupo]     = useState("");
  const [editIndex, setEditIndex]           = useState(null);
  const [conflicto, setConflicto]           = useState(null);
  const [modalCopiar, setModalCopiar]       = useState(false);
  const [generandoPDF, setGenerandoPDF]     = useState(false);
  const [xmlError, setXmlError]             = useState("");
  const xmlInputRef = useRef(null);

  // jsPDF se carga bajo demanda en handlePrint

  // ── Cálculo de semanas ───────────────────────────────────────────────────────
  const semanas = useMemo(() => {
    if (!cabecera.fechaInicio || !cabecera.fechaTermino) return [];
    const start = new Date(cabecera.fechaInicio + "T00:00:00");
    const end   = new Date(cabecera.fechaTermino + "T00:00:00");
    if (end < start) return [];
    let lunes = getLunes(start);
    const result = [];
    let idx = 1;
    while (lunes <= getLunes(end)) {
      const domingo = addDays(lunes, 6);
      result.push({
        num: idx,
        lunes: new Date(lunes),
        domingo: new Date(domingo),
        label: `Sem ${idx} (${fmtFecha(lunes.toISOString().slice(0,10))} → ${fmtFecha(domingo.toISOString().slice(0,10))})`,
        labelLargo: `Semana ${idx} — ${fmtFecha(lunes.toISOString().slice(0,10))} al ${fmtFecha(domingo.toISOString().slice(0,10))}`,
      });
      lunes = addDays(lunes, 7);
      idx++;
    }
    return result;
  }, [cabecera.fechaInicio, cabecera.fechaTermino]);

  // ── Días disponibles por semana ──────────────────────────────────────────────
  const diasDisponiblesPorSemana = useMemo(() => {
    const mapa = {};
    const start = new Date(cabecera.fechaInicio + "T00:00:00");
    const end   = new Date(cabecera.fechaTermino + "T00:00:00");
    semanas.forEach(s => {
      mapa[s.num] = DIAS.filter((_, i) => {
        const jsIdx  = DIAS_JS_IDX[i];
        const offset = jsIdx === 0 ? 6 : jsIdx - 1;
        const fechaDia = addDays(s.lunes, offset);
        return fechaDia >= start && fechaDia <= end;
      });
    });
    return mapa;
  }, [semanas, cabecera.fechaInicio, cabecera.fechaTermino]);

  const diasDisponibles = (n) => diasDisponiblesPorSemana[n] || DIAS;

  // ── Resumen de cupos ─────────────────────────────────────────────────────────
  const resumenCupos = useMemo(() => {
    const mapa = {};
    bloques.forEach(b => {
      if (!mapa[b.tipoCupo]) {
        const tipo = TIPOS_CUPO.find(t => t.codigo === b.tipoCupo);
        mapa[b.tipoCupo] = {
          descripcion: tipo?.descripcion || b.tipoCupo,
          tipologia: homologarTipologia(b.tipoCupo),
          total: 0,
        };
      }
      mapa[b.tipoCupo].total += b.cantidad;
    });
    const items        = Object.entries(mapa).map(([cod, v]) => ({ codigo: cod, ...v }));
    const totalNuevo   = items.filter(i => i.tipologia === "NUEVO").reduce((s,i) => s+i.total, 0);
    const totalControl = items.filter(i => i.tipologia === "CONTROL").reduce((s,i) => s+i.total, 0);
    const totalReceta  = items.filter(i => i.tipologia === "RECETA").reduce((s,i) => s+i.total, 0);
    const totalGeneral = bloques.reduce((s,b) => s+b.cantidad, 0);
    const porSemana    = {};
    bloques.forEach(b => {
      const key = b.semana ?? 0;
      if (!porSemana[key]) porSemana[key] = { total:0, nuevo:0, control:0, receta:0 };
      const tip = homologarTipologia(b.tipoCupo);
      porSemana[key].total += b.cantidad;
      if (tip === "NUEVO")   porSemana[key].nuevo   += b.cantidad;
      if (tip === "CONTROL") porSemana[key].control += b.cantidad;
      if (tip === "RECETA")  porSemana[key].receta  += b.cantidad;
    });
    return { items, totalNuevo, totalControl, totalReceta, totalGeneral, porSemana };
  }, [bloques]);

  // ── Detección de conflictos ──────────────────────────────────────────────────
  function rangoBloque(b) {
    const inicio = toMinutes(b.horaInicio);
    const esEscalonada = cabecera.escalonada === "SI" || cabecera.escalonada === "SI (Dación de hora libre)";
    return { inicio, fin: inicio + b.intervalo * (esEscalonada ? b.cantidad : 1) };
  }

  function detectarConflicto(nuevo, excluirIdx = null) {
    const { inicio: nI, fin: nF } = rangoBloque(nuevo);
    for (let i = 0; i < bloques.length; i++) {
      if (i === excluirIdx) continue;
      const b = bloques[i];
      if (b.dia !== nuevo.dia || (b.semana||0) !== (nuevo.semana||0)) continue;
      const { inicio: bI, fin: bF } = rangoBloque(b);
      if (nI < bF && nF > bI)
        return { mensaje: `Se superpone con ${b.tipoCupo} (${b.horaInicio}) que ocupa hasta las ${String(Math.floor(bF/60)).padStart(2,"0")}:${String(bF%60).padStart(2,"0")}.` };
    }
    return null;
  }

  // ── Cupos filtrados en buscador ──────────────────────────────────────────────
  const cuposFiltrados = useMemo(() =>
    TIPOS_CUPO.filter(t =>
      t.codigo.toLowerCase().includes(busquedaCupo.toLowerCase()) ||
      t.descripcion.toLowerCase().includes(busquedaCupo.toLowerCase())
    ), [busquedaCupo]);

  // ── Horas visibles en la grilla ──────────────────────────────────────────────
  const bloquesEnVista = useMemo(() =>
    vistaCalendario === "semanal"
      ? bloques.filter(b => !b.semana || b.semana === semanaActual)
      : bloques,
    [bloques, vistaCalendario, semanaActual]);

  const horasConBloques = useMemo(() => {
    const set = new Set();
    bloquesEnVista.forEach(b => {
      if ((cabecera.escalonada === "SI" || cabecera.escalonada === "SI (Dación de hora libre)") && b.cantidad > 1) {
        const { inicio, fin } = rangoBloque(b);
        TIME_SLOTS.forEach(t => { const m = toMinutes(t); if (m >= inicio && m < fin) set.add(t); });
      } else {
        set.add(b.horaInicio);
      }
    });
    return TIME_SLOTS.filter(t => set.has(t));
  }, [bloquesEnVista, cabecera.escalonada]);

  const horasVisibles = useMemo(() => {
    const base  = TIME_SLOTS.filter((_, i) => i % 4 === 0);
    const extra = new Set([...horasConBloques, ...base]);
    return TIME_SLOTS.filter(t => extra.has(t));
  }, [horasConBloques]);

  function chipsParaCelda(dia, hora) {
    const slotMin = toMinutes(hora);
    return bloques.filter(b => {
      if (b.dia !== dia) return false;
      if (vistaCalendario === "semanal" && b.semana && b.semana !== semanaActual) return false;
      if ((cabecera.escalonada === "SI" || cabecera.escalonada === "SI (Dación de hora libre)") && b.cantidad > 1) {
        const { inicio, fin } = rangoBloque(b);
        return slotMin >= inicio && slotMin < fin;
      }
      return b.horaInicio === hora;
    });
  }

  // ── XML export / import ──────────────────────────────────────────────────────
  function generarXML() {
    const esc = s => String(s||"")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    const c = cabecera;
    const bXml = bloques.map(b =>
      `    <bloque dia="${esc(b.dia)}" horaInicio="${esc(b.horaInicio)}" semana="${b.semana??""}" tipoCupo="${esc(b.tipoCupo)}" cantidad="${b.cantidad}" intervalo="${b.intervalo}"/>`
    ).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<agenda>
  <cabecera
    codigoRecurso="${esc(c.codigoRecurso)}"
    codigoAgenda="${esc(c.codigoAgenda)}"
    nombreProfesional="${esc(c.nombreProfesional)}"
    nombreAgenda="${esc(c.nombreAgenda)}"
    especialidad="${esc(c.especialidad)}"
    fechaInicio="${esc(c.fechaInicio)}"
    fechaTermino="${esc(c.fechaTermino)}"
    escalonada="${esc(c.escalonada)}"
    modalidadFinanciamiento="${esc(c.modalidadFinanciamiento)}"
    requiereFicha="${esc(c.requiereFicha)}"
    permiteVariasHoras="${esc(c.permiteVariasHoras)}"
    comentarioGeneral="${esc(c.comentarioGeneral)}"
  />
  <bloques>
${bXml}
  </bloques>
</agenda>`;
  }

  function descargarXML(xmlStr) {
    const blob = new Blob([xmlStr], { type:"application/xml" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `agenda_${cabecera.codigoAgenda || "medica"}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function cargarDesdeXML(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setXmlError("");
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const parser = new DOMParser();
        const doc    = parser.parseFromString(ev.target.result, "application/xml");
        if (doc.querySelector("parsererror")) throw new Error();
        const cab = doc.querySelector("cabecera");
        if (!cab) throw new Error();
        const g = k => cab.getAttribute(k) || "";
        setCabecera({
          codigoRecurso:          g("codigoRecurso"),
          codigoAgenda:           g("codigoAgenda"),
          nombreProfesional:      g("nombreProfesional"),
          nombreAgenda:           g("nombreAgenda"),
          especialidad:           g("especialidad"),
          fechaInicio:            g("fechaInicio"),
          fechaTermino:           g("fechaTermino"),
          escalonada:             g("escalonada")             || "SI",
          modalidadFinanciamiento:g("modalidadFinanciamiento")|| "INSTITUCIONAL",
          requiereFicha:          g("requiereFicha")          || "SI",
          permiteVariasHoras:     g("permiteVariasHoras")     || "NO",
          comentarioGeneral:      g("comentarioGeneral"),
        });
        setBloques([...doc.querySelectorAll("bloque")].map(b => ({
          dia:       b.getAttribute("dia"),
          horaInicio:b.getAttribute("horaInicio"),
          semana:    b.getAttribute("semana") ? Number(b.getAttribute("semana")) : null,
          tipoCupo:  b.getAttribute("tipoCupo"),
          cantidad:  Number(b.getAttribute("cantidad"))  || 1,
          intervalo: Number(b.getAttribute("intervalo")) || 15,
        })));
        setSemanaActual(1);
      } catch {
        setXmlError("Archivo .xml inválido. Asegúrate de que sea un archivo generado por esta app.");
      } finally {
        if (xmlInputRef.current) xmlInputRef.current.value = "";
      }
    };
    reader.readAsText(file);
  }

  // ── Generar PDF con jsPDF puro (sin html2canvas, funciona en Vercel/Chrome) ──
  async function handlePrint() {
    setGenerandoPDF(true);
    try {
      // Cargar jsPDF desde CDN si no está disponible
      if (!window.jspdf) {
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      const { jsPDF } = window.jspdf;

      // ── Configuración de página ──────────────────────────────────────────────
      const doc     = new jsPDF({ orientation:"landscape", unit:"mm", format:"a4" });
      const PW      = doc.internal.pageSize.getWidth();   // 297mm
      const PH      = doc.internal.pageSize.getHeight();  // 210mm
      const MAR     = 10;   // margen lateral
      const COL_W   = (PW - MAR * 2) / 2;  // ancho de cada columna de la cabecera
      const LINE_H  = 6.5;  // alto de fila estándar
      const HEADER_H= 8;    // alto de fila de encabezados de tabla
      let y = MAR;

      // ── Helpers de dibujo ────────────────────────────────────────────────────
      const setFont = (style, size) => {
        doc.setFont("helvetica", style);
        doc.setFontSize(size);
      };
      const setColor = (r, g, b) => doc.setTextColor(r, g, b);
      const setFill  = (r, g, b) => doc.setFillColor(r, g, b);
      const setDraw  = (r, g, b) => doc.setDrawColor(r, g, b);

      const rect = (x, rx, ry, rw, rh, fill) => {
        if (fill) { setFill(...fill); doc.rect(rx, ry, rw, rh, "F"); }
        setDraw(180, 180, 180);
        doc.rect(rx, ry, rw, rh, "S");
      };

      // Dibuja celda con borde, fondo opcional y texto
      const cell = (x, cy, w, h, text, opts = {}) => {
        const { fill, bold, size = 9, align = "left", color = [30,30,30] } = opts;
        if (fill) { setFill(...fill); doc.rect(x, cy, w, h, "F"); }
        setDraw(160, 160, 160);
        doc.rect(x, cy, w, h, "S");
        setFont(bold ? "bold" : "normal", size);
        setColor(...color);
        const pad = 2;
        const tw  = w - pad * 2;
        const lines = doc.splitTextToSize(String(text || ""), tw);
        const ty  = cy + h / 2 + size * 0.18;
        const tx  = align === "center" ? x + w / 2 : x + pad;
        doc.text(lines[0] || "", tx, ty, { align });
      };

      // Celda de altura variable para texto largo (multilinea)
      // Devuelve el alto real utilizado para que el llamador pueda avanzar y
      const cellMultiline = (x, cy, w, text, opts = {}) => {
        const { fill, bold, size = 8, color = [30,30,30], minH = LINE_H } = opts;
        const pad   = 2.5;
        const tw    = w - pad * 2;
        setFont(bold ? "bold" : "normal", size);
        const lines = doc.splitTextToSize(String(text || "—"), tw);
        const lineH = size * 0.45;   // espacio entre líneas en mm
        const h     = Math.max(minH, lines.length * lineH + pad * 2);
        if (fill) { setFill(...fill); doc.rect(x, cy, w, h, "F"); }
        setDraw(160, 160, 160);
        doc.rect(x, cy, w, h, "S");
        setFont(bold ? "bold" : "normal", size);
        setColor(...color);
        lines.forEach((line, i) => {
          doc.text(line, x + pad, cy + pad + size * 0.72 + i * lineH);
        });
        return h;
      };

      // Comprueba si hay espacio; si no, añade página
      const checkPage = (needed = LINE_H + 2) => {
        if (y + needed > PH - MAR - 6) {
          doc.addPage();
          y = MAR;
          return true;
        }
        return false;
      };

      // ── TÍTULO ───────────────────────────────────────────────────────────────
      setFill(30, 58, 138);
      doc.rect(MAR, y, PW - MAR * 2, 9, "F");
      setFont("bold", 13);
      setColor(255, 255, 255);
      doc.text("CREAR AGENDA", PW / 2, y + 6.2, { align: "center" });
      y += 11;

      // ── CABECERA (2 columnas) ─────────────────────────────────────────────────
      // Filas 1–5 de cabecera: texto corto, altura fija
      const cabeceraRows = [
        ["CÓDIGO RECURSO",                 cabecera.codigoRecurso,          "CÓDIGO AGENDA",               cabecera.codigoAgenda],
        ["NOMBRE PROFESIONAL",             cabecera.nombreProfesional,      "NOMBRE AGENDA",               cabecera.nombreAgenda || "—"],
        ["ESPECIALIDAD / ESTAMENTO",       cabecera.especialidad,           "FECHA INICIO",                fmtFecha(cabecera.fechaInicio)],
        ["ESCALONADA",                     cabecera.escalonada,             "FECHA TÉRMINO",               fmtFecha(cabecera.fechaTermino)],
        ["MODALIDAD FINANCIAMIENTO",       cabecera.modalidadFinanciamiento,"REQUIERE FICHA",              cabecera.requiereFicha],
      ];
      const LBL_W = 50;
      const VAL_W = COL_W - LBL_W;
      cabeceraRows.forEach(([lbl1, val1, lbl2, val2]) => {
        const x0 = MAR;
        cell(x0,            y, LBL_W, LINE_H, lbl1, { fill:[226,232,240], bold:true, size:8 });
        cell(x0 + LBL_W,    y, VAL_W, LINE_H, val1, { size:8 });
        cell(x0 + COL_W,    y, LBL_W, LINE_H, lbl2, { fill:[226,232,240], bold:true, size:8 });
        cell(x0 + COL_W + LBL_W, y, VAL_W, LINE_H, val2, { size:8 });
        y += LINE_H;
      });

      // Fila 6: "PERMITE..." + "COMENTARIO GENERAL" — comentario puede ser largo
      {
        const x0   = MAR;
        const TW_F = PW - MAR * 2;   // ancho total de la fila
        // Calculamos primero el alto que necesitará el comentario
        const comentTxt = cabecera.comentarioGeneral || "—";
        setFont("normal", 8);
        const comentLines = doc.splitTextToSize(comentTxt, VAL_W - 2.5 * 2);
        const lineHc = 8 * 0.45;
        const comentH = Math.max(LINE_H, comentLines.length * lineHc + 2.5 * 2);

        // Columna izquierda: label + valor con altura = comentH
        cell(x0,         y, LBL_W, comentH, "PERMITE MÁS DE UNA HORA AL DÍA", { fill:[226,232,240], bold:true, size:8 });
        cell(x0 + LBL_W, y, VAL_W, comentH, cabecera.permiteVariasHoras,        { size:8 });
        // Columna derecha: label + valor multilinea
        cell(x0 + COL_W,       y, LBL_W,       comentH, "COMENTARIO GENERAL", { fill:[226,232,240], bold:true, size:8 });
        cellMultiline(x0 + COL_W + LBL_W, y, VAL_W,       comentTxt,           { size:8, minH:comentH });
        y += comentH;
      }
      y += 4;

      // ── RESUMEN DE CUPOS ──────────────────────────────────────────────────────
      const { items: ri, totalGeneral, totalNuevo, totalControl, totalReceta, porSemana } = resumenCupos;
      const semOrd = Object.keys(porSemana).map(Number).sort((a, b) => a - b);
      const hayReceta = totalReceta > 0;

      checkPage(10);
      setFill(30, 58, 138);
      doc.rect(MAR, y, PW - MAR * 2, 7.5, "F");
      setFont("bold", 9);
      setColor(255, 255, 255);
      const resumenTxt = `RESUMEN DE CUPOS   Total: ${totalGeneral}   NUEVO: ${totalNuevo}   CONTROL: ${totalControl}${hayReceta ? `   RECETA: ${totalReceta}` : ""}`;
      doc.text(resumenTxt, MAR + 3, y + 5);
      y += 8;

      // Chips de tipos de cupo
      const CHIP_H = 6;
      let cx = MAR;
      ri.forEach(item => {
        const txt  = `${item.codigo}: ${item.descripcion} x${item.total} (${item.tipologia})`;
        const tw   = doc.getTextWidth(txt) + 6;
        if (cx + tw > PW - MAR) { cx = MAR; y += CHIP_H + 1; checkPage(CHIP_H + 2); }
        setFill(240, 244, 255);
        setDraw(199, 210, 254);
        doc.rect(cx, y, tw, CHIP_H, "FD");
        setFont("bold", 7.5);
        setColor(30, 58, 138);
        doc.text(txt, cx + 3, y + 4.2);
        cx += tw + 3;
      });
      y += CHIP_H + 4;

      // Tabla de cupos por semana (solo si hay más de una)
      if (semOrd.length > 1) {
        checkPage(HEADER_H + semOrd.length * LINE_H + LINE_H + 4);
        setFont("bold", 8);
        setColor(50, 50, 50);
        doc.text("CUPOS POR SEMANA", MAR, y + 4);
        y += 6;

        const SW  = PW - MAR * 2;
        const SC  = hayReceta ? [SW*0.45, SW*0.15, SW*0.15, SW*0.15, SW*0.10] : [SW*0.52, SW*0.16, SW*0.16, SW*0.16];
        const SH  = ["Semana","Total","Nuevo","Control", ...(hayReceta?["Receta"]:[])];

        // Header
        let sx = MAR;
        SH.forEach((h, i) => {
          cell(sx, y, SC[i], HEADER_H - 1, h, { fill:[30,58,138], bold:true, size:8, align:"center", color:[255,255,255] });
          sx += SC[i];
        });
        y += HEADER_H - 1;

        semOrd.forEach((sn, idx) => {
          checkPage(LINE_H + 1);
          const s  = porSemana[sn];
          const si = semanas.find(x => x.num === sn);
          const rango = si ? `${fmtFecha(si.lunes.toISOString().slice(0,10))} – ${fmtFecha(si.domingo.toISOString().slice(0,10))}` : "";
          const rowFill = idx % 2 === 0 ? [255,255,255] : [245,247,255];
          sx = MAR;
          const cols = [
            { v:`Sem ${sn}  ${rango}`, align:"left"   },
            { v:String(s.total),       align:"center"  },
            { v:String(s.nuevo),       align:"center"  },
            { v:String(s.control),     align:"center"  },
            ...(hayReceta ? [{ v:String(s.receta), align:"center" }] : []),
          ];
          cols.forEach((col, i) => {
            cell(sx, y, SC[i], LINE_H, col.v, { fill:rowFill, size:8, align:col.align });
            sx += SC[i];
          });
          y += LINE_H;
        });

        // Fila total
        checkPage(LINE_H + 1);
        sx = MAR;
        const totCols = [
          { v:"TOTAL",              align:"left"   },
          { v:String(totalGeneral), align:"center" },
          { v:String(totalNuevo),   align:"center" },
          { v:String(totalControl), align:"center" },
          ...(hayReceta ? [{ v:String(totalReceta), align:"center" }] : []),
        ];
        totCols.forEach((col, i) => {
          cell(sx, y, SC[i], LINE_H, col.v, { fill:[224,231,255], bold:true, size:8, align:col.align });
          sx += SC[i];
        });
        y += LINE_H + 4;
      }

      // ── DETALLE DE AGENDA ─────────────────────────────────────────────────────
      // Filas con 2 líneas de texto (nombre+fecha): alto de fila mayor
      const ROW_H = 13;   // alto fila de datos (acomoda 2 líneas)
      const TW    = PW - MAR * 2;
      // Columnas: SEMANA, DÍA, HORA INICIO, INTERVALO (min), TIPO CUPO, CUPOS
      const TC    = [TW*0.10, TW*0.14, TW*0.09, TW*0.10, TW*0.46, TW*0.11];
      const TH_LABELS = ["SEMANA","DÍA","HORA INICIO","INTERVALO (min)","TIPO CUPO","CUPOS"];

      // Helper: color hex del chip → [r, g, b]
      const hexToRgb = (hex) => {
        const h = hex.replace("#","");
        return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
      };

      // Dibuja celda de dos líneas: línea1 bold + línea2 pequeña gris debajo
      const cell2 = (x, cy, w, h, line1, line2, opts = {}) => {
        const { fill, bold1 = true, size1 = 8, size2 = 6.5, align = "center", color1 = [30,30,30], color2 = [100,116,139] } = opts;
        if (fill) { setFill(...fill); doc.rect(x, cy, w, h, "F"); }
        setDraw(160, 160, 160);
        doc.rect(x, cy, w, h, "S");
        const cx = align === "center" ? x + w / 2 : x + 2;
        const midY = cy + h / 2;
        if (line2) {
          // dos líneas: primera en el tercio superior, segunda en el tercio inferior
          const topY    = cy + h * 0.36;
          const bottomY = cy + h * 0.72;
          setFont(bold1 ? "bold" : "normal", size1);
          setColor(...color1);
          doc.text(String(line1 || ""), cx, topY, { align });
          setFont("normal", size2);
          setColor(...color2);
          doc.text(String(line2 || ""), cx, bottomY, { align });
        } else {
          setFont(bold1 ? "bold" : "normal", size1);
          setColor(...color1);
          doc.text(String(line1 || ""), cx, midY + size1 * 0.18, { align });
        }
      };

      // Dibuja chip de color + texto de descripción en la celda de tipo cupo
      const cellChip = (x, cy, w, h, codigo, descripcion, rowFill) => {
        if (rowFill) { setFill(...rowFill); doc.rect(x, cy, w, h, "F"); }
        setDraw(160, 160, 160);
        doc.rect(x, cy, w, h, "S");

        const chipColor = hexToRgb(getColorForCodigo(codigo));
        const chipW = doc.getTextWidth(codigo) + 5;
        const chipH = 4.5;
        const chipX = x + 3;
        const chipY = cy + h / 2 - chipH / 2;

        // Rectángulo del chip
        setFill(...chipColor);
        setDraw(...chipColor);
        doc.roundedRect(chipX, chipY, chipW, chipH, 1, 1, "F");

        // Texto del código dentro del chip
        setFont("bold", 6.5);
        setColor(255, 255, 255);
        doc.text(codigo, chipX + chipW / 2, chipY + chipH / 2 + 0.8, { align: "center" });

        // Descripción a la derecha del chip
        setFont("normal", 7.5);
        setColor(30, 30, 30);
        const descX = chipX + chipW + 3;
        const maxDescW = w - chipW - 10;
        const descLines = doc.splitTextToSize(descripcion || "", maxDescW);
        doc.text(descLines[0] || "", descX, cy + h / 2 + 0.8);
      };

      // Encabezado tabla detalle
      checkPage(HEADER_H + ROW_H + 4);
      setFont("bold", 9);
      setColor(30, 30, 30);
      doc.text("DETALLE DE AGENDA", MAR, y + 4);
      y += 6;

      const drawTableHeader = () => {
        let tx = MAR;
        TH_LABELS.forEach((h, i) => {
          cell(tx, y, TC[i], HEADER_H, h, { fill:[29,78,216], bold:true, size:7.5, align:"center", color:[255,255,255] });
          tx += TC[i];
        });
        y += HEADER_H;
      };
      drawTableHeader();

      if (bloques.length === 0) {
        checkPage(ROW_H + 2);
        cell(MAR, y, TW, ROW_H, "Sin bloques agregados", { size:8, align:"center" });
        y += ROW_H;
      } else {
        const bloquesOrd = expandirBloquesDacion([...bloques], cabecera.escalonada).sort((a, b) => {
          const sA = a.semana||0, sB = b.semana||0;
          if (sA !== sB) return sA - sB;
          const dA = DIAS.indexOf(a.dia), dB = DIAS.indexOf(b.dia);
          if (dA !== dB) return dA - dB;
          return a.horaInicio.localeCompare(b.horaInicio);
        });

        bloquesOrd.forEach((b, idx) => {
          checkPage(ROW_H + 2);
          if (y === MAR) drawTableHeader();

          const tipo     = TIPOS_CUPO.find(t => t.codigo === b.tipoCupo);
          const si       = semanas.find(s => s.num === b.semana);
          const dIdx     = DIAS.indexOf(b.dia);
          let fechaDia   = "";
          if (si && dIdx !== -1) {
            const off  = DIAS_JS_IDX[dIdx] === 0 ? 6 : DIAS_JS_IDX[dIdx] - 1;
            fechaDia   = fmtFecha(addDays(si.lunes, off).toISOString().slice(0,10));
          }
          const rowFill  = idx % 2 === 0 ? [255,255,255] : [248,250,252];
          const semLine1 = b.semana ? `S${b.semana}` : "";
          const semLine2 = si ? fmtFecha(si.lunes.toISOString().slice(0,10)) : "";

          let tx = MAR;

          // Col 0: SEMANA — "S1" + fecha lunes
          cell2(tx, y, TC[0], ROW_H, semLine1, semLine2, { fill:rowFill, bold1:true });
          tx += TC[0];

          // Col 1: DÍA — nombre día + fecha específica
          cell2(tx, y, TC[1], ROW_H, b.dia, fechaDia, { fill:rowFill, bold1:true });
          tx += TC[1];

          // Col 2: HORA INICIO — monospace bold
          cell2(tx, y, TC[2], ROW_H, b.horaInicio, null, { fill:rowFill, bold1:true, size1:8.5 });
          tx += TC[2];

          // Col 3: INTERVALO
          cell2(tx, y, TC[3], ROW_H, String(b.intervalo), null, { fill:rowFill, bold1:false, size1:8 });
          tx += TC[3];

          // Col 4: TIPO CUPO — chip de color + descripción
          cellChip(tx, y, TC[4], ROW_H, b.tipoCupo, tipo?.descripcion || "", rowFill);
          tx += TC[4];

          // Col 5: CUPOS
          cell2(tx, y, TC[5], ROW_H, String(b.cantidad), null, { fill:rowFill, bold1:true, size1:9 });

          y += ROW_H;
        });
      }

      // ── Paginación ───────────────────────────────────────────────────────────
      const totalPages = doc.internal.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(150, 150, 150);
        doc.text(`Página ${p} de ${totalPages}`, PW - MAR, PH - 4, { align:"right" });
        doc.text(`Agenda: ${cabecera.nombreAgenda || cabecera.codigoAgenda}   Profesional: ${cabecera.nombreProfesional}`, MAR, PH - 4);
      }

      doc.save(`agenda_${cabecera.codigoAgenda || "medica"}.pdf`);
    } catch (err) {
      console.error("Error generando PDF:", err);
      alert("Error al generar el PDF. Revisa la consola para más detalles.");
    } finally {
      setGenerandoPDF(false);
    }

    descargarXML(generarXML());
  }
  // ── Acciones del modal de bloque ─────────────────────────────────────────────
  function abrirModal(dia, hora) {
    setModalData({ dia, hora, semana: semanaActual });
    setFormBloque({ tipoCupo:"", cantidad:1, intervalo:15 });
    setBusquedaCupo(""); setEditIndex(null); setConflicto(null); setModalOpen(true);
  }

  function abrirEdicion(idx) {
    const b = bloques[idx];
    setModalData({ dia:b.dia, hora:b.horaInicio, semana:b.semana || semanaActual });
    setFormBloque({ tipoCupo:b.tipoCupo, cantidad:b.cantidad, intervalo:b.intervalo });
    setBusquedaCupo(""); setEditIndex(idx); setConflicto(null); setModalOpen(true);
  }

  function guardarBloque() {
    if (!formBloque.tipoCupo) return;
    const nuevo = {
      dia:       modalData.dia,
      horaInicio:modalData.hora,
      semana:    vistaCalendario === "semanal" ? modalData.semana : null,
      tipoCupo:  formBloque.tipoCupo,
      cantidad:  formBloque.cantidad,
      intervalo: formBloque.intervalo,
    };
    const c = detectarConflicto(nuevo, editIndex);
    if (c) { setConflicto(c); return; }
    setConflicto(null);
    if (editIndex !== null) setBloques(p => p.map((b,i) => i === editIndex ? nuevo : b));
    else setBloques(p => [...p, nuevo]);
    setModalOpen(false);
  }

  function eliminarBloque(idx) {
    setBloques(p => p.filter((_,i) => i !== idx));
    setModalOpen(false);
  }

  function copiarSemana1() {
    const s1 = bloques.filter(b => b.semana === 1);
    if (!s1.length) return;
    setBloques([
      ...s1,
      ...semanas.filter(s => s.num !== 1).flatMap(s =>
        s1.filter(b => diasDisponibles(s.num).includes(b.dia)).map(b => ({ ...b, semana:s.num }))
      ),
    ]);
    setModalCopiar(false);
  }

  // ── Derivados ────────────────────────────────────────────────────────────────
  const cabeceraCompleta = !!(
    cabecera.codigoRecurso && cabecera.codigoAgenda &&
    cabecera.nombreProfesional && cabecera.especialidad &&
    cabecera.fechaInicio && cabecera.fechaTermino
  );
  const semActualObj = semanas.find(s => s.num === semanaActual);
  const diasDisp     = vistaCalendario === "mensual" ? DIAS : (semActualObj ? diasDisponibles(semanaActual) : DIAS);

  // ── Tokens de estilo ─────────────────────────────────────────────────────────
  const S = {
    card:     { background:"#fff", borderRadius:14, padding:28, boxShadow:"0 1px 4px rgba(0,0,0,0.07)" },
    btnP:     { background:"#1d4ed8", color:"#fff", border:"none", borderRadius:8, padding:"10px 22px", fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"inherit" },
    btnS:     { background:"#fff", color:"#1d4ed8", border:"1.5px solid #1d4ed8", borderRadius:8, padding:"10px 22px", fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"inherit" },
    btnD:     { background:"#fee2e2", color:"#dc2626", border:"none", borderRadius:8, padding:"8px 16px", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"inherit" },
    inp:      { width:"100%", padding:"9px 13px", border:"1.5px solid #cbd5e1", borderRadius:8, fontSize:14, fontFamily:"inherit", outline:"none", background:"#fff" },
    sel:      { width:"100%", padding:"9px 13px", border:"1.5px solid #cbd5e1", borderRadius:8, fontSize:14, fontFamily:"inherit", outline:"none", background:"#fff", cursor:"pointer" },
    lbl:      { fontSize:12, fontWeight:600, color:"#475569", textTransform:"uppercase", letterSpacing:"0.05em", marginBottom:5, display:"block" },
    roFilled: { background:"#f0fdf4", color:"#166534", cursor:"not-allowed", paddingRight:32 },
    roEmpty:  { background:"#f8fafc", color:"#94a3b8", cursor:"not-allowed" },
  };

  // ── Sub-componente ResumenCupos ───────────────────────────────────────────────
  function ResumenCupos({ compact = false }) {
    if (!bloques.length) return (
      <div style={{ background:"#f8fafc", border:"1.5px solid #e2e8f0", borderRadius:10, padding:"10px 16px", fontSize:13, color:"#94a3b8" }}>
        Aún no hay cupos agregados.
      </div>
    );
    const semOrd = Object.keys(resumenCupos.porSemana).map(Number).sort((a,b)=>a-b);
    return (
      <div style={{ background:compact?"#f8fafc":"#fff", border:"1.5px solid #e2e8f0", borderRadius:10, padding:compact?"10px 14px":"16px 20px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:8 }}>
          <span style={{ fontSize:12, fontWeight:700, color:"#475569", textTransform:"uppercase" }}>Total cupos:</span>
          <span style={{ fontWeight:800, fontSize:15, color:"#0f172a" }}>{resumenCupos.totalGeneral}</span>
          <span style={{ background:"#dbeafe", color:"#1d4ed8", borderRadius:6, padding:"2px 10px", fontSize:12, fontWeight:700 }}>NUEVO: {resumenCupos.totalNuevo}</span>
          <span style={{ background:"#dcfce7", color:"#16a34a", borderRadius:6, padding:"2px 10px", fontSize:12, fontWeight:700 }}>CONTROL: {resumenCupos.totalControl}</span>
          {resumenCupos.totalReceta > 0 && <span style={{ background:"#fef9c3", color:"#854d0e", borderRadius:6, padding:"2px 10px", fontSize:12, fontWeight:700 }}>RECETA: {resumenCupos.totalReceta}</span>}
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:semOrd.length>1?10:0 }}>
          {resumenCupos.items.map(item => (
            <div key={item.codigo} style={{ display:"flex", alignItems:"center", gap:4, background:"#fff", border:"1px solid #e2e8f0", borderRadius:6, padding:"3px 8px", fontSize:11 }}>
              <span style={{ background:getColorForCodigo(item.codigo), color:"#fff", borderRadius:3, padding:"1px 5px", fontWeight:700 }}>{item.codigo}</span>
              <span style={{ color:"#475569" }}>{item.descripcion}</span>
              <span style={{ fontWeight:700, color:"#0f172a" }}>×{item.total}</span>
            </div>
          ))}
        </div>
        {semOrd.length > 1 && (
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:"#475569", textTransform:"uppercase", marginBottom:5, borderTop:"1px solid #e2e8f0", paddingTop:8 }}>Cupos por semana</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
              {semOrd.map(sn => {
                const s  = resumenCupos.porSemana[sn];
                const si = semanas.find(x => x.num === sn);
                return (
                  <div key={sn} style={{ background:"#f0f4ff", border:"1px solid #c7d2fe", borderRadius:7, padding:"5px 10px", fontSize:11 }}>
                    <div style={{ fontWeight:700, color:"#1d4ed8" }}>
                      Sem {sn}
                      {si && <span style={{ fontWeight:400, color:"#6366f1", marginLeft:5, fontSize:10 }}>{fmtFecha(si.lunes.toISOString().slice(0,10))}</span>}
                    </div>
                    <div style={{ display:"flex", gap:6 }}>
                      <span style={{ fontWeight:700 }}>{s.total}</span>
                      {s.nuevo   > 0 && <span style={{ color:"#1d4ed8" }}>N:{s.nuevo}</span>}
                      {s.control > 0 && <span style={{ color:"#16a34a" }}>C:{s.control}</span>}
                      {s.receta  > 0 && <span style={{ color:"#854d0e" }}>R:{s.receta}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ fontFamily:"'DM Sans',sans-serif", minHeight:"100vh", background:"#f0f4f8" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        .cal-cell{min-height:44px;border:1px solid #e2e8f0;padding:3px;cursor:pointer;vertical-align:top;}
        .cal-cell:hover{background:#eff6ff;}
        .cal-cell-blocked{min-height:44px;border:1px solid #e2e8f0;padding:3px;background:#f1f5f9;cursor:not-allowed;vertical-align:top;}
        .cal-hdr{background:#1d4ed8;color:#fff;padding:10px 8px;font-size:12px;font-weight:700;text-align:center;}
        .cal-hdr-off{background:#94a3b8;color:#fff;padding:10px 8px;font-size:12px;font-weight:700;text-align:center;}
        .cal-time{background:#f8fafc;padding:8px 10px;font-size:11px;font-weight:600;color:#64748b;font-family:'DM Mono',monospace;text-align:right;white-space:nowrap;border:1px solid #e2e8f0;}
        .chip{border-radius:5px;padding:3px 6px;font-size:11px;font-weight:700;color:#fff;margin:1px;display:inline-flex;align-items:center;gap:3px;cursor:pointer;white-space:nowrap;}
        .chip-cont{border-radius:5px;padding:2px 5px;font-size:10px;font-weight:600;color:#fff;margin:1px;display:inline-flex;align-items:center;gap:2px;opacity:0.5;white-space:nowrap;border-left:3px solid rgba(255,255,255,0.5);}
        .cupo-opt{padding:8px 12px;border-radius:7px;cursor:pointer;display:flex;align-items:center;gap:10px;}
        .cupo-opt:hover{background:#eff6ff;}
        .sem-tab{padding:5px 10px;border-radius:6px;font-size:11px;font-weight:600;border:1.5px solid #cbd5e1;cursor:pointer;font-family:inherit;white-space:nowrap;}
        .btn-p:hover{background:#1e40af!important;}
        .btn-p:disabled{background:#93c5fd!important;cursor:not-allowed!important;}
      `}</style>

      {/* ── Header ── */}
      <div style={{ background:"#1d4ed8", color:"#fff", padding:"16px 32px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <div style={{ width:36, height:36, background:"rgba(255,255,255,0.2)", borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🏥</div>
          <div>
            <div style={{ fontSize:16, fontWeight:700 }}>Generador de Agendas Médicas</div>
            <div style={{ fontSize:12, opacity:0.8 }}>Sistema de confección de agendas</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          {[1,2,3].map(s => (
            <div key={s} style={{ display:"flex", alignItems:"center", gap:6 }}>
              <div style={{ width:step===s?14:10, height:step===s?14:10, borderRadius:"50%", background:step>=s?"#fff":"rgba(255,255,255,0.3)", transition:"all 0.2s" }} />
              {s < 3 && <div style={{ width:24, height:2, background:step>s?"#fff":"rgba(255,255,255,0.3)" }} />}
            </div>
          ))}
          <span style={{ fontSize:12, opacity:0.9, marginLeft:8 }}>Paso {step} de 3</span>
        </div>
      </div>

      <div style={{ maxWidth:1200, margin:"0 auto", padding:"28px 20px" }}>

        {/* ════════════════════ PASO 1 ════════════════════ */}
        {step === 1 && (
          <div>
            <div style={{ marginBottom:20 }}>
              <h2 style={{ fontSize:22, fontWeight:700, color:"#0f172a" }}>Datos de la Agenda</h2>
              <p style={{ color:"#64748b", fontSize:14, marginTop:4 }}>Complete la información del profesional y configuración de la agenda.</p>
            </div>

            {/* Panel cargar XML */}
            <div style={{ ...S.card, padding:"16px 20px", marginBottom:16, background:"#f0f4ff", border:"1.5px solid #c7d2fe" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:"#1d4ed8", textTransform:"uppercase", marginBottom:4 }}>Cargar agenda desde archivo XML</div>
                  <div style={{ fontSize:11, color:"#4338ca" }}>Selecciona un .xml generado anteriormente para precargar todos los datos.</div>
                </div>
                <div>
                  <input ref={xmlInputRef} type="file" accept=".xml" style={{ display:"none" }} onChange={cargarDesdeXML} />
                  <button style={S.btnP} className="btn-p" onClick={() => xmlInputRef.current?.click()}>Seleccionar archivo .xml</button>
                </div>
              </div>
              {xmlError && (
                <div style={{ marginTop:10, fontSize:11, color:"#dc2626", background:"#fef2f2", padding:"7px 10px", borderRadius:6, border:"1px solid #fca5a5" }}>
                  ⚠ {xmlError}
                </div>
              )}
            </div>

            <div style={S.card}>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>

                {/* Código Recurso */}
                <div>
                  <label style={S.lbl}>Código Recurso *</label>
                  <input style={S.inp} value={cabecera.codigoRecurso} placeholder="Ej: 724"
                    onChange={e => {
                      const cod    = e.target.value;
                      const nombre = PROFESIONALES.get(cod) || "";
                      // FIX: sin || p.nombreProfesional → limpia si el código no existe
                      setCabecera(p => ({ ...p, codigoRecurso:cod, nombreProfesional:nombre }));
                    }} />
                  {cabecera.codigoRecurso && !PROFESIONALES.has(cabecera.codigoRecurso) && (
                    <div style={{ fontSize:11, color:"#f59e0b", marginTop:4 }}>⚠ Código no encontrado en el mantenedor</div>
                  )}
                </div>

                {/* Código Agenda */}
                <div>
                  <label style={S.lbl}>Código Agenda *</label>
                  <input style={S.inp} value={cabecera.codigoAgenda} placeholder="Ej: 5"
                    onChange={e => {
                      const cod    = e.target.value;
                      const nombre = AGENDAS.get(cod) || "";
                      // FIX: sin || p.nombreAgenda → limpia si el código no existe
                      setCabecera(p => ({ ...p, codigoAgenda:cod, nombreAgenda:nombre }));
                    }} />
                  {cabecera.codigoAgenda && !AGENDAS.has(cabecera.codigoAgenda) && (
                    <div style={{ fontSize:11, color:"#f59e0b", marginTop:4 }}>⚠ Código no encontrado en el mantenedor</div>
                  )}
                </div>

                {/* Nombre Profesional — SOLO LECTURA, autocompletado por código */}
                <div style={{ gridColumn:"span 2" }}>
                  <label style={S.lbl}>Nombre Profesional *</label>
                  <div style={{ position:"relative" }}>
                    <input
                      style={{ ...S.inp, ...(cabecera.nombreProfesional ? S.roFilled : S.roEmpty) }}
                      value={cabecera.nombreProfesional}
                      readOnly
                      placeholder="Se completa automáticamente al ingresar el Código Recurso"
                    />
                    {cabecera.nombreProfesional && (
                      <span style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", fontSize:14 }}>✓</span>
                    )}
                  </div>
                </div>

                {/* Nombre Agenda — SOLO LECTURA, autocompletado por código */}
                <div style={{ gridColumn:"span 2" }}>
                  <label style={S.lbl}>Nombre Agenda</label>
                  <div style={{ position:"relative" }}>
                    <input
                      style={{ ...S.inp, ...(cabecera.nombreAgenda ? S.roFilled : S.roEmpty) }}
                      value={cabecera.nombreAgenda || ""}
                      readOnly
                      placeholder="Se completa automáticamente al ingresar el Código Agenda"
                    />
                    {cabecera.nombreAgenda && (
                      <span style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", fontSize:14 }}>✓</span>
                    )}
                  </div>
                </div>

                {/* Especialidad */}
                <div style={{ gridColumn:"span 2" }}>
                  <label style={S.lbl}>Especialidad o Estamento *</label>
                  <input style={S.inp} value={cabecera.especialidad} placeholder="Ej: Medicina Interna, Enfermería..."
                    onChange={e => setCabecera(p => ({ ...p, especialidad:e.target.value }))} />
                </div>

                {/* Fechas */}
                <div>
                  <label style={S.lbl}>Fecha Inicio *</label>
                  <input type="date" style={S.inp} value={cabecera.fechaInicio}
                    onChange={e => setCabecera(p => ({ ...p, fechaInicio:e.target.value }))} />
                </div>
                <div>
                  <label style={S.lbl}>Fecha Término *</label>
                  <input type="date" style={S.inp} value={cabecera.fechaTermino}
                    onChange={e => setCabecera(p => ({ ...p, fechaTermino:e.target.value }))} />
                </div>
              </div>

              {/* Configuración */}
              <div style={{ borderTop:"1.5px solid #f1f5f9", marginTop:24, paddingTop:24 }}>
                <div style={{ fontSize:13, fontWeight:700, color:"#475569", textTransform:"uppercase", marginBottom:16 }}>Configuración</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:16 }}>
                  {[
                    { key:"escalonada",        label:"Escalonada",         opts:["SI","SI (Dación de hora libre)","NO"] },
                    { key:"requiereFicha",      label:"Requiere Ficha",     opts:["SI","NO"] },
                    { key:"permiteVariasHoras", label:"Permite +1 hora/día",opts:["NO","SI"] },
                  ].map(({ key, label, opts }) => (
                    <div key={key}>
                      <label style={S.lbl}>{label}</label>
                      <select style={S.sel} value={cabecera[key]}
                        onChange={e => setCabecera(p => ({ ...p, [key]:e.target.value }))}>
                        {opts.map(o => <option key={o}>{o}</option>)}
                      </select>
                    </div>
                  ))}
                  <div>
                    <label style={S.lbl}>Modalidad Financiamiento</label>
                    <select style={S.sel} value={cabecera.modalidadFinanciamiento}
                      onChange={e => setCabecera(p => ({ ...p, modalidadFinanciamiento:e.target.value }))}>
                      {MODALIDADES.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Comentario */}
              <div style={{ borderTop:"1.5px solid #f1f5f9", marginTop:24, paddingTop:24 }}>
                <label style={S.lbl}>Comentario General (opcional)</label>
                <textarea style={{ ...S.inp, resize:"vertical" }} rows={4}
                  placeholder="Observaciones generales sobre la agenda... (máx. 1000 caracteres)"
                  maxLength={1000}
                  value={cabecera.comentarioGeneral}
                  onChange={e => setCabecera(p => ({ ...p, comentarioGeneral:e.target.value }))} />
                <div style={{ textAlign:"right", fontSize:11, color: cabecera.comentarioGeneral?.length >= 900 ? "#dc2626" : "#94a3b8", marginTop:4 }}>
                  {cabecera.comentarioGeneral?.length || 0} / 1000 caracteres
                </div>
              </div>

              <div style={{ marginTop:28, display:"flex", justifyContent:"flex-end" }}>
                <button style={{ ...S.btnP, opacity:cabeceraCompleta?1:0.5 }} className="btn-p"
                  disabled={!cabeceraCompleta} onClick={() => setStep(2)}>
                  Continuar → Calendario
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════ PASO 2 ════════════════════ */}
        {step === 2 && (
          <div>
            <div style={{ marginBottom:14, display:"flex", alignItems:"flex-start", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
              <div>
                <h2 style={{ fontSize:22, fontWeight:700, color:"#0f172a" }}>Calendario de Cupos</h2>
                <p style={{ color:"#64748b", fontSize:14, marginTop:4 }}>{cabecera.nombreProfesional} — {cabecera.especialidad}</p>
              </div>
              <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
                <div style={{ display:"flex", border:"1.5px solid #cbd5e1", borderRadius:8, overflow:"hidden" }}>
                  {["semanal","mensual"].map(v => (
                    <button key={v} onClick={() => setVistaCalendario(v)}
                      style={{ padding:"7px 16px", fontSize:13, fontWeight:600, border:"none", cursor:"pointer", fontFamily:"inherit",
                        background:vistaCalendario===v?"#1d4ed8":"#fff",
                        color:vistaCalendario===v?"#fff":"#475569" }}>
                      {v.charAt(0).toUpperCase()+v.slice(1)}
                    </button>
                  ))}
                </div>
                <button style={S.btnS} onClick={() => setStep(1)}>← Volver</button>
                <button style={{ ...S.btnP, opacity:bloques.length?1:0.5 }} className="btn-p"
                  disabled={!bloques.length} onClick={() => setStep(3)}>Ver Resumen →</button>
              </div>
            </div>

            <div style={{ marginBottom:12 }}><ResumenCupos compact /></div>

            {/* Tabs semanas */}
            {vistaCalendario === "semanal" && semanas.length > 1 && (
              <div style={{ ...S.card, padding:"14px 18px", marginBottom:12 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", justifyContent:"space-between" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                    <span style={{ fontSize:12, fontWeight:700, color:"#64748b", textTransform:"uppercase" }}>Período:</span>
                    <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                      {semanas.map(s => (
                        <button key={s.num} className="sem-tab" onClick={() => setSemanaActual(s.num)}
                          style={{ background:semanaActual===s.num?"#1d4ed8":"#fff", color:semanaActual===s.num?"#fff":"#475569", borderColor:semanaActual===s.num?"#1d4ed8":"#cbd5e1" }}>
                          {s.label}
                          {bloques.filter(b => b.semana===s.num).length > 0 && (
                            <span style={{ marginLeft:5, background:semanaActual===s.num?"rgba(255,255,255,0.3)":"#e0e7ff", color:semanaActual===s.num?"#fff":"#1d4ed8", borderRadius:10, padding:"1px 6px", fontSize:10 }}>
                              {bloques.filter(b => b.semana===s.num).length}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                  {bloques.filter(b => b.semana===1).length > 0 && (
                    <button onClick={() => setModalCopiar(true)}
                      style={{ background:"#f0fdf4", color:"#16a34a", border:"1.5px solid #86efac", borderRadius:8, padding:"7px 14px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap" }}>
                      📋 Copiar Sem 1 → Todas
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Grilla */}
            <div style={{ ...S.card, padding:0, overflow:"hidden" }}>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%", borderCollapse:"collapse", minWidth:700 }}>
                  <thead>
                    <tr>
                      <th style={{ background:"#0f172a", color:"#fff", padding:"10px 12px", fontSize:11, fontWeight:700, textAlign:"left", width:80 }}>HORA</th>
                      {DIAS.map((dia, i) => {
                        const ok = diasDisp.includes(dia);
                        let fds  = "";
                        if (vistaCalendario==="semanal" && semActualObj) {
                          const jsIdx  = DIAS_JS_IDX[i];
                          const offset = jsIdx===0?6:jsIdx-1;
                          fds = fmtFecha(addDays(semActualObj.lunes, offset).toISOString().slice(0,10));
                        }
                        return (
                          <th key={dia} className={ok?"cal-hdr":"cal-hdr-off"}>
                            {vistaCalendario==="semanal"
                              ? (<><div>{DIAS_SHORT[i]}</div>{fds && <div style={{ fontSize:9, fontWeight:400, opacity:0.9, marginTop:2 }}>{fds}</div>}</>)
                              : dia}
                            {!ok && <div style={{ fontSize:9, opacity:0.75, fontWeight:400, marginTop:1 }}>fuera del período</div>}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {horasVisibles.map(hora => (
                      <tr key={hora}>
                        <td className="cal-time">{hora}</td>
                        {DIAS.map(dia => {
                          const ok = diasDisp.includes(dia);
                          if (!ok) return (
                            <td key={dia} className="cal-cell-blocked">
                              <div style={{ width:"100%", height:"100%", background:"repeating-linear-gradient(45deg,transparent,transparent 4px,rgba(0,0,0,0.04) 4px,rgba(0,0,0,0.04) 8px)" }} />
                            </td>
                          );
                          const chips = chipsParaCelda(dia, hora);
                          const ini   = chips.filter(b => b.horaInicio === hora);
                          const cont  = chips.filter(b => b.horaInicio !== hora);
                          return (
                            <td key={dia} className="cal-cell" onClick={() => abrirModal(dia, hora)}>
                              {ini.map(b => {
                                const idx = bloques.findIndex(x => x === b);
                                return (
                                  <div key={idx} className="chip" style={{ background:getColorForCodigo(b.tipoCupo) }}
                                    onClick={e => { e.stopPropagation(); abrirEdicion(idx); }}>
                                    <span>{b.tipoCupo}</span>
                                    <span style={{ opacity:.85, fontSize:10 }}>×{b.cantidad}</span>
                                  </div>
                                );
                              })}
                              {cont.map((b, ci) => (
                                <div key={ci} className="chip-cont" style={{ background:getColorForCodigo(b.tipoCupo) }}>
                                  <span>{b.tipoCupo}</span><span style={{ fontSize:9 }}>↓</span>
                                </div>
                              ))}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ padding:"10px 16px", background:"#f8fafc", borderTop:"1px solid #e2e8f0", fontSize:11, color:"#64748b" }}>
                💡 Clic en celda disponible para agregar cupos. Días con trama gris están fuera del período. Chips con ↓ indican continuación de bloque escalonado.
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════ PASO 3 ════════════════════ */}
        {step === 3 && (
          <div>
            <div style={{ marginBottom:20, display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
              <div>
                <h2 style={{ fontSize:22, fontWeight:700, color:"#0f172a" }}>Resumen de Agenda</h2>
                <p style={{ color:"#64748b", fontSize:14, marginTop:4 }}>Revisa los datos y genera el PDF con el formato oficial.</p>
              </div>
              <div style={{ display:"flex", gap:10 }}>
                <button style={S.btnS} onClick={() => setStep(2)}>← Volver</button>
                <button style={{ ...S.btnP, opacity:generandoPDF?0.7:1 }} className="btn-p"
                  onClick={handlePrint} disabled={generandoPDF}>
                  {generandoPDF ? "⏳ Generando..." : "⬇️ Descargar PDF + XML"}
                </button>
              </div>
            </div>

            <div style={{ marginBottom:20 }}><ResumenCupos /></div>

            {/* Solo XML */}
            <div style={{ ...S.card, padding:"14px 18px", marginBottom:16, background:"#f0fdf4", border:"1.5px solid #86efac" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
                <div>
                  <div style={{ fontSize:12, fontWeight:700, color:"#166534", textTransform:"uppercase", marginBottom:4 }}>Guardar agenda como archivo XML</div>
                  <div style={{ fontSize:11, color:"#166534" }}>Descarga el .xml para recargar y modificar esta agenda en el futuro.</div>
                </div>
                <button onClick={() => descargarXML(generarXML())}
                  style={{ background:"#fff", color:"#16a34a", border:"1.5px solid #16a34a", borderRadius:8, padding:"8px 18px", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
                  Descargar .xml
                </button>
              </div>
            </div>

            {/* Vista previa */}
            <div style={{ ...S.card, fontFamily:"Arial,sans-serif" }}>
              <div style={{ textAlign:"center", marginBottom:16, fontSize:16, fontWeight:700, color:"#0f172a", letterSpacing:1 }}>
                CREAR AGENDA — VISTA PREVIA
              </div>
              <table style={{ width:"100%", borderCollapse:"collapse", marginBottom:4, fontSize:12 }}>
                <tbody>
                  {[
                    [["CÓDIGO RECURSO",cabecera.codigoRecurso],["CÓDIGO AGENDA",cabecera.codigoAgenda]],
                    [["NOMBRE PROFESIONAL",cabecera.nombreProfesional],["NOMBRE AGENDA",cabecera.nombreAgenda||"—"]],
                    [["ESPECIALIDAD / ESTAMENTO",cabecera.especialidad],["FECHA INICIO",fmtFecha(cabecera.fechaInicio)]],
                    [["ESCALONADA",cabecera.escalonada],["FECHA TÉRMINO",fmtFecha(cabecera.fechaTermino)]],
                    [["MODALIDAD FINANCIAMIENTO",cabecera.modalidadFinanciamiento],["REQUIERE FICHA",cabecera.requiereFicha]],
                    [["PERMITE MÁS DE UNA HORA AL DÍA",cabecera.permiteVariasHoras],["COMENTARIO GENERAL",cabecera.comentarioGeneral||"—"]],
                  ].map((row, ri) => (
                    <tr key={ri}>
                      {row.map(([label, val], ci) => [
                        <td key={`h${ci}`} style={{ border:"1px solid #000", padding:"5px 8px", fontWeight:700, background:"#e2e8f0", width:"20%" }}>{label}</td>,
                        <td key={`v${ci}`} style={{ border:"1px solid #000", padding:"5px 8px", width:"30%" }}>{val}</td>,
                      ])}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* ── Resumen de cupos en vista previa ── */}
              {bloques.length > 0 && (() => {
                const semOrd = Object.keys(resumenCupos.porSemana).map(Number).sort((a,b)=>a-b);
                return (
                  <div style={{ margin:"12px 0", border:"1px solid #c7d2fe", borderRadius:8, overflow:"hidden" }}>
                    <div style={{ background:"#1e3a8a", color:"#fff", padding:"7px 12px", display:"flex", flexWrap:"wrap", gap:16, alignItems:"center", fontSize:12 }}>
                      <span style={{ fontWeight:700, fontSize:13 }}>RESUMEN DE CUPOS</span>
                      <span>Total: <strong>{resumenCupos.totalGeneral}</strong></span>
                      <span style={{ background:"rgba(255,255,255,0.2)", borderRadius:4, padding:"2px 8px" }}>NUEVO: <strong>{resumenCupos.totalNuevo}</strong></span>
                      <span style={{ background:"rgba(255,255,255,0.2)", borderRadius:4, padding:"2px 8px" }}>CONTROL: <strong>{resumenCupos.totalControl}</strong></span>
                      {resumenCupos.totalReceta > 0 && (
                        <span style={{ background:"rgba(255,255,255,0.2)", borderRadius:4, padding:"2px 8px" }}>RECETA: <strong>{resumenCupos.totalReceta}</strong></span>
                      )}
                    </div>
                    <div style={{ background:"#f0f4ff", padding:"8px 12px", display:"flex", flexWrap:"wrap", gap:6, borderBottom:semOrd.length>1?"1px solid #c7d2fe":"none" }}>
                      {resumenCupos.items.map(item => (
                        <div key={item.codigo} style={{ display:"flex", alignItems:"center", gap:4, background:"#fff", border:"1px solid #e2e8f0", borderRadius:5, padding:"3px 8px", fontSize:11 }}>
                          <span style={{ background:getColorForCodigo(item.codigo), color:"#fff", borderRadius:3, padding:"1px 5px", fontWeight:700 }}>{item.codigo}</span>
                          <span style={{ color:"#374151" }}>{item.descripcion}</span>
                          <span style={{ fontWeight:700, color:"#0f172a" }}>x{item.total}</span>
                          <span style={{ color:"#6b7280", fontSize:10 }}>({item.tipologia})</span>
                        </div>
                      ))}
                    </div>
                    {semOrd.length > 1 && (
                      <div style={{ background:"#fff", padding:"8px 12px" }}>
                        <div style={{ fontSize:11, fontWeight:700, color:"#374151", textTransform:"uppercase", marginBottom:6 }}>Cupos por semana</div>
                        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                          <thead>
                            <tr style={{ background:"#e0e7ff" }}>
                              <th style={{ border:"1px solid #c7d2fe", padding:"4px 8px", textAlign:"left" }}>Semana</th>
                              <th style={{ border:"1px solid #c7d2fe", padding:"4px 8px", textAlign:"center" }}>Total</th>
                              <th style={{ border:"1px solid #c7d2fe", padding:"4px 8px", textAlign:"center" }}>NUEVO</th>
                              <th style={{ border:"1px solid #c7d2fe", padding:"4px 8px", textAlign:"center" }}>CONTROL</th>
                              {semOrd.some(sn => resumenCupos.porSemana[sn].receta > 0) && (
                                <th style={{ border:"1px solid #c7d2fe", padding:"4px 8px", textAlign:"center" }}>RECETA</th>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {semOrd.map((sn, idx) => {
                              const s = resumenCupos.porSemana[sn];
                              const si = semanas.find(x => x.num === sn);
                              const hayReceta = semOrd.some(n => resumenCupos.porSemana[n].receta > 0);
                              return (
                                <tr key={sn} style={{ background:idx%2===0?"#fff":"#f5f7ff" }}>
                                  <td style={{ border:"1px solid #e2e8f0", padding:"4px 8px", fontWeight:600, color:"#1d4ed8" }}>
                                    Sem {sn}
                                    {si && <span style={{ fontWeight:400, color:"#6366f1", marginLeft:6, fontSize:10 }}>{fmtFecha(si.lunes.toISOString().slice(0,10))} al {fmtFecha(si.domingo.toISOString().slice(0,10))}</span>}
                                  </td>
                                  <td style={{ border:"1px solid #e2e8f0", padding:"4px 8px", textAlign:"center", fontWeight:700 }}>{s.total}</td>
                                  <td style={{ border:"1px solid #e2e8f0", padding:"4px 8px", textAlign:"center", color:"#1d4ed8" }}>{s.nuevo}</td>
                                  <td style={{ border:"1px solid #e2e8f0", padding:"4px 8px", textAlign:"center", color:"#16a34a" }}>{s.control}</td>
                                  {hayReceta && <td style={{ border:"1px solid #e2e8f0", padding:"4px 8px", textAlign:"center", color:"#854d0e" }}>{s.receta}</td>}
                                </tr>
                              );
                            })}
                            <tr style={{ background:"#e0e7ff", fontWeight:700 }}>
                              <td style={{ border:"1px solid #c7d2fe", padding:"4px 8px" }}>TOTAL</td>
                              <td style={{ border:"1px solid #c7d2fe", padding:"4px 8px", textAlign:"center" }}>{resumenCupos.totalGeneral}</td>
                              <td style={{ border:"1px solid #c7d2fe", padding:"4px 8px", textAlign:"center", color:"#1d4ed8" }}>{resumenCupos.totalNuevo}</td>
                              <td style={{ border:"1px solid #c7d2fe", padding:"4px 8px", textAlign:"center", color:"#16a34a" }}>{resumenCupos.totalControl}</td>
                              {semOrd.some(sn => resumenCupos.porSemana[sn].receta > 0) && (
                                <td style={{ border:"1px solid #c7d2fe", padding:"4px 8px", textAlign:"center", color:"#854d0e" }}>{resumenCupos.totalReceta}</td>
                              )}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div style={{ fontWeight:700, margin:"10px 0 6px", fontSize:13 }}>DETALLE DE AGENDA</div>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                <thead>
                  <tr>
                    {["SEMANA","DÍA","HORA INICIO","INTERVALO (min)","TIPO CUPO","CUPOS"].map(h => (
                      <th key={h} style={{ border:"1px solid #000", padding:"5px 6px", background:"#1d4ed8", color:"#fff", fontSize:11, textAlign:"center" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!bloques.length
                    ? <tr><td colSpan={6} style={{ border:"1px solid #000", padding:12, textAlign:"center", color:"#94a3b8" }}>Sin bloques agregados</td></tr>
                    : expandirBloquesDacion([...bloques], cabecera.escalonada).sort((a,b) => {
                        const sA=a.semana||0,sB=b.semana||0; if(sA!==sB) return sA-sB;
                        const dA=DIAS.indexOf(a.dia),dB=DIAS.indexOf(b.dia); if(dA!==dB) return dA-dB;
                        return a.horaInicio.localeCompare(b.horaInicio);
                      }).map((b, i) => {
                        const tipo = TIPOS_CUPO.find(t => t.codigo===b.tipoCupo);
                        const si   = semanas.find(s => s.num===b.semana);
                        let fd     = "";
                        if (si) {
                          const dIdx = DIAS.indexOf(b.dia);
                          if (dIdx !== -1) {
                            const offset = DIAS_JS_IDX[dIdx]===0?6:DIAS_JS_IDX[dIdx]-1;
                            fd = fmtFecha(addDays(si.lunes, offset).toISOString().slice(0,10));
                          }
                        }
                        return (
                          <tr key={i} style={{ background:i%2===0?"#fff":"#f8fafc" }}>
                            <td style={{ border:"1px solid #d1d5db", padding:"4px 6px", textAlign:"center", fontSize:11 }}>
                              {b.semana?`S${b.semana}`:""}{si&&<div style={{ fontSize:9, color:"#64748b" }}>{fmtFecha(si.lunes.toISOString().slice(0,10))}</div>}
                            </td>
                            <td style={{ border:"1px solid #d1d5db", padding:"4px 6px", textAlign:"center" }}>
                              {b.dia}{fd&&<div style={{ fontSize:9, color:"#64748b" }}>{fd}</div>}
                            </td>
                            <td style={{ border:"1px solid #d1d5db", padding:"4px 6px", textAlign:"center", fontFamily:"monospace" }}>{b.horaInicio}</td>
                            <td style={{ border:"1px solid #d1d5db", padding:"4px 6px", textAlign:"center" }}>{b.intervalo}</td>
                            <td style={{ border:"1px solid #d1d5db", padding:"4px 6px" }}>
                              <span style={{ background:getColorForCodigo(b.tipoCupo), color:"#fff", borderRadius:4, padding:"2px 6px", fontSize:11, fontWeight:700 }}>{b.tipoCupo}</span>
                              <span style={{ marginLeft:6, color:"#475569" }}>{tipo?.descripcion}</span>
                            </td>
                            <td style={{ border:"1px solid #d1d5db", padding:"4px 6px", textAlign:"center" }}>{b.cantidad}</td>
                          </tr>
                        );
                      })
                  }
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ════════ Modal agregar / editar bloque ════════ */}
      {modalOpen && (
        <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}
          onClick={() => setModalOpen(false)}>
          <div style={{ background:"#fff", borderRadius:16, padding:28, width:440, maxWidth:"95vw", maxHeight:"90vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }}
            onClick={e => e.stopPropagation()}>

            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div>
                <div style={{ fontSize:16, fontWeight:700, color:"#0f172a" }}>{editIndex!==null?"Editar bloque":"Agregar cupos"}</div>
                <div style={{ fontSize:13, color:"#64748b", marginTop:2 }}>
                  {modalData.dia} — {modalData.hora}
                  {vistaCalendario==="semanal" && semanas.length>1 && ` — ${semanas.find(s=>s.num===modalData.semana)?.labelLargo||""}`}
                </div>
              </div>
              <button onClick={() => setModalOpen(false)} style={{ border:"none", background:"none", fontSize:20, cursor:"pointer", color:"#94a3b8" }}>×</button>
            </div>

            {/* Hora de inicio */}
            <div style={{ marginBottom:16 }}>
              <label style={S.lbl}>Hora de inicio</label>
              <select style={S.sel} value={modalData.hora}
                onChange={e => { setConflicto(null); setModalData(p => ({ ...p, hora:e.target.value })); }}>
                {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* Intervalo + cantidad */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:16 }}>
              <div>
                <label style={S.lbl}>Intervalo (minutos)</label>
                <select style={S.sel} value={formBloque.intervalo}
                  onChange={e => { setConflicto(null); setFormBloque(p => ({ ...p, intervalo:Number(e.target.value) })); }}>
                  {INTERVALOS.map(i => <option key={i} value={i}>{i} min</option>)}
                </select>
              </div>
              <div>
                <label style={S.lbl}>Cantidad de cupos</label>
                <input type="number" min={1} max={99} style={S.inp} value={formBloque.cantidad}
                  onChange={e => { setConflicto(null); setFormBloque(p => ({ ...p, cantidad:Number(e.target.value) })); }} />
              </div>
            </div>

            {/* Info escalonado */}
            {(cabecera.escalonada==="SI" || cabecera.escalonada==="SI (Dación de hora libre)") && formBloque.cantidad>1 && (
              <div style={{ background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:8, padding:"8px 12px", marginBottom:14, fontSize:12, color:"#1d4ed8" }}>
                {cabecera.escalonada==="SI (Dación de hora libre)" ? "🔓 Dación de hora libre" : "📅 Escalonado"}: desde {modalData.hora} hasta {(() => {
                  const fin = toMinutes(modalData.hora) + formBloque.intervalo * formBloque.cantidad;
                  return `${String(Math.floor(fin/60)).padStart(2,"0")}:${String(fin%60).padStart(2,"0")}`;
                })()}
                {cabecera.escalonada==="SI (Dación de hora libre)" && formBloque.cantidad>1 && (
                  <div style={{ marginTop:5, fontSize:11, opacity:0.85 }}>
                    Se generarán {formBloque.cantidad} cupos individuales en el paso 3
                  </div>
                )}
              </div>
            )}

            {/* Buscador tipo de cupo */}
            <div style={{ marginBottom:20 }}>
              <label style={S.lbl}>Tipo de cupo *</label>
              <input style={{ ...S.inp, marginBottom:8 }} placeholder="Buscar por código o nombre..."
                value={busquedaCupo} onChange={e => setBusquedaCupo(e.target.value)} />
              <div style={{ maxHeight:180, overflowY:"auto", border:"1.5px solid #e2e8f0", borderRadius:8 }}>
                {cuposFiltrados.slice(0,20).map(t => (
                  <div key={t.codigo} className="cupo-opt"
                    style={{ background:formBloque.tipoCupo===t.codigo?"#eff6ff":undefined }}
                    onClick={() => { setConflicto(null); setFormBloque(p => ({ ...p, tipoCupo:t.codigo })); }}>
                    <div style={{ width:32, height:24, borderRadius:5, background:getColorForCodigo(t.codigo), display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:"#fff", flexShrink:0 }}>
                      {t.codigo}
                    </div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:500, color:"#0f172a" }}>{t.descripcion}</div>
                      <div style={{ fontSize:11, color:"#64748b" }}>{homologarTipologia(t.codigo)}</div>
                    </div>
                    {formBloque.tipoCupo===t.codigo && <span style={{ marginLeft:"auto", color:"#1d4ed8", fontSize:16 }}>✓</span>}
                  </div>
                ))}
                {!cuposFiltrados.length && (
                  <div style={{ padding:16, color:"#94a3b8", fontSize:13, textAlign:"center" }}>Sin resultados</div>
                )}
              </div>
            </div>

            {/* Conflicto */}
            {conflicto && (
              <div style={{ background:"#fef2f2", border:"1.5px solid #fca5a5", borderRadius:10, padding:"12px 14px", marginBottom:16, display:"flex", gap:10, alignItems:"flex-start" }}>
                <span style={{ fontSize:18, flexShrink:0 }}>⚠️</span>
                <div>
                  <div style={{ fontWeight:700, color:"#dc2626", fontSize:13, marginBottom:3 }}>Superposición de horarios detectada</div>
                  <div style={{ color:"#7f1d1d", fontSize:12, lineHeight:1.5 }}>{conflicto.mensaje}</div>
                  <div style={{ color:"#7f1d1d", fontSize:12, marginTop:4 }}>Ajusta la hora, el intervalo o la cantidad de cupos.</div>
                </div>
              </div>
            )}

            {/* Botones modal */}
            <div style={{ display:"flex", gap:10, justifyContent:"space-between" }}>
              {editIndex !== null && (
                <button style={S.btnD} onClick={() => eliminarBloque(editIndex)}>🗑 Eliminar</button>
              )}
              <div style={{ display:"flex", gap:10, marginLeft:"auto" }}>
                <button style={S.btnS} onClick={() => setModalOpen(false)}>Cancelar</button>
                <button style={{ ...S.btnP, opacity:formBloque.tipoCupo?1:0.5 }} className="btn-p"
                  disabled={!formBloque.tipoCupo} onClick={guardarBloque}>
                  {editIndex!==null ? "Guardar cambios" : "Agregar bloque"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════ Modal copiar semana 1 ════════ */}
      {modalCopiar && (
        <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}
          onClick={() => setModalCopiar(false)}>
          <div style={{ background:"#fff", borderRadius:16, padding:28, width:420, maxWidth:"95vw", boxShadow:"0 20px 60px rgba(0,0,0,0.2)", textAlign:"center" }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize:40, marginBottom:12 }}>📋</div>
            <div style={{ fontSize:17, fontWeight:700, color:"#0f172a", marginBottom:8 }}>Copiar Semana 1 a todas las semanas</div>
            <div style={{ fontSize:13, color:"#64748b", lineHeight:1.6, marginBottom:20 }}>
              Se copiarán los {bloques.filter(b=>b.semana===1).length} bloques de la Semana 1 a las demás semanas,
              respetando los días disponibles de cada período.
            </div>
            <div style={{ display:"flex", gap:10, justifyContent:"center" }}>
              <button style={S.btnS} onClick={() => setModalCopiar(false)}>Cancelar</button>
              <button style={S.btnP} className="btn-p" onClick={copiarSemana1}>✓ Sí, copiar a todas</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}