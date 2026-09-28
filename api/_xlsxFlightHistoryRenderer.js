import ExcelJS from "exceljs";

const LABELS = Object.freeze({
  es: {
    title: "Historial de vuelos de la aeronave",
    registration: "Matrícula",
    manufacturer: "Fabricante",
    model: "Modelo",
    period: "Período de exportación",
    generatedAt: "Generado",
    locale: "Idioma",
    template: "Plantilla / versión",
    openingUtilization: "Utilización inicial",
    periodUtilization: "Utilización del período",
    closingUtilization: "Utilización final",
    trackedUtilization: "Utilización registrada en App Horas",
    unavailable: "No disponible",
    allHistory: "Historial completo",
    fields: {
      flight_date: "Fecha",
      departure_location: "Origen",
      arrival_location: "Destino",
      pilot: "Piloto",
      utilization_owner: "Propietario de utilización",
      flight_time_hours: "Tiempo de vuelo",
      time_in_service_hours: "Tiempo en servicio",
      accumulated_aircraft_tis: "TIS acumulado aeronave",
      landings: "Aterrizajes",
      purpose: "Propósito",
      remarks: "Observaciones",
    },
  },
  en: {
    title: "Aircraft flight history",
    registration: "Registration",
    manufacturer: "Manufacturer",
    model: "Model",
    period: "Export period",
    generatedAt: "Generated",
    locale: "Locale",
    template: "Template / version",
    openingUtilization: "Opening utilization",
    periodUtilization: "Period utilization",
    closingUtilization: "Closing utilization",
    trackedUtilization: "Tracked in App Horas",
    unavailable: "Unavailable",
    allHistory: "All history",
    fields: {
      flight_date: "Date",
      departure_location: "Departure",
      arrival_location: "Arrival",
      pilot: "Pilot",
      utilization_owner: "Utilization owner",
      flight_time_hours: "Flight time",
      time_in_service_hours: "Time in service",
      accumulated_aircraft_tis: "Accumulated aircraft TIS",
      landings: "Landings",
      purpose: "Purpose",
      remarks: "Remarks",
    },
  },
});

const HEADER_FILL = "FF0F5B6E";
const ACCENT_FILL = "FFE6F2F5";
const BORDER_COLOR = "FFD5DEE3";

function dateValue(value) {
  if (!value) return null;
  const normalized = String(value).slice(0, 10);
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatPeriod(summary, labels) {
  if (summary.periodType === "ALL_HISTORY") return labels.allHistory;
  return `${summary.periodStartDate} — ${summary.periodEndDate}`;
}

function utilizationValue(value, labels) {
  return value === null || value === undefined ? labels.unavailable : value;
}

function styleSummarySheet(sheet) {
  sheet.columns = [{ width: 31 }, { width: 42 }];
  sheet.views = [{ state: "frozen", ySplit: 2 }];
  sheet.getRow(1).height = 28;
  sheet.getCell("A1").font = { bold: true, color: { argb: "FFFFFFFF" }, size: 16 };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  sheet.getCell("B1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };

  for (let rowNumber = 3; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.getCell(1).font = { bold: true };
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT_FILL } };
    row.eachCell((cell) => {
      cell.border = {
        bottom: { style: "thin", color: { argb: BORDER_COLOR } },
      };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
  }
}

function styleAircraftSheet(sheet, fieldCodes) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: fieldCodes.length },
  };
  const header = sheet.getRow(1);
  header.height = 26;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });

  const numericFields = new Set([
    "flight_time_hours",
    "time_in_service_hours",
    "accumulated_aircraft_tis",
  ]);
  fieldCodes.forEach((fieldCode, index) => {
    const column = sheet.getColumn(index + 1);
    column.width = fieldCode === "remarks" ? 34 : fieldCode === "flight_date" ? 14 : 20;
    if (numericFields.has(fieldCode)) column.numFmt = "0.0";
    if (fieldCode === "landings") column.numFmt = "0";
    if (fieldCode === "flight_date") column.numFmt = "yyyy-mm-dd";
  });
}

export async function renderFlightHistoryWorkbook({
  locale,
  summary,
  template,
  rows,
}) {
  const labels = LABELS[locale] || LABELS.es;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "App Horas de Vuelo";
  workbook.created = new Date(summary.generatedAt);
  workbook.modified = new Date(summary.generatedAt);
  workbook.calcProperties.fullCalcOnLoad = false;

  const summarySheet = workbook.addWorksheet("Summary", {
    properties: { defaultRowHeight: 20 },
  });
  summarySheet.mergeCells("A1:B1");
  summarySheet.getCell("A1").value = labels.title;
  summarySheet.addRow([]);
  summarySheet.addRows([
    [labels.registration, summary.registration],
    [labels.manufacturer, summary.manufacturer],
    [labels.model, summary.model],
    [labels.period, formatPeriod(summary, labels)],
    [labels.generatedAt, new Date(summary.generatedAt)],
    [labels.locale, locale],
    [labels.template, `${template.name} / v${template.versionNumber}`],
    [labels.openingUtilization, utilizationValue(summary.openingUtilization, labels)],
    [labels.periodUtilization, summary.periodUtilization],
    [labels.closingUtilization, utilizationValue(summary.closingUtilization, labels)],
    [labels.trackedUtilization, summary.trackedUtilization],
  ]);
  summarySheet.getCell("B7").numFmt = "yyyy-mm-dd hh:mm";
  for (const rowNumber of [10, 11, 12, 13]) {
    if (typeof summarySheet.getCell(`B${rowNumber}`).value === "number") {
      summarySheet.getCell(`B${rowNumber}`).numFmt = "0.0";
    }
  }
  styleSummarySheet(summarySheet);

  const aircraftSheet = workbook.addWorksheet("Aircraft", {
    properties: { defaultRowHeight: 20 },
  });
  const fields = [...template.fields].sort((left, right) => left.displayOrder - right.displayOrder);
  const fieldCodes = fields.map((field) => field.fieldCode);
  aircraftSheet.addRow(
    fields.map((field) => field.customLabel || labels.fields[field.fieldCode] || field.fieldCode)
  );
  for (const row of rows) {
    aircraftSheet.addRow(
      fieldCodes.map((fieldCode) =>
        fieldCode === "flight_date" ? dateValue(row[fieldCode]) : row[fieldCode] ?? null
      )
    );
  }
  styleAircraftSheet(aircraftSheet, fieldCodes);

  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}
