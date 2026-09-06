const DAY_IN_MS = 24 * 60 * 60 * 1000;
const OWNER_USAGE_START_FLIGHT_ID = "249";

const FIELD_ALIASES = {
  id: ["id", "ID"],
  dia: ["dia", "Dia"],
  mes: ["mes", "Mes"],
  anio: ["anio", "año", "Año", "year"],
  fechaIso: ["fechaIso", "fecha", "Fecha"],
  desde: ["desde", "DESDE"],
  hasta: ["hasta", "HASTA"],
  tiempoVuelo: [
    "tiempoDeVuelo",
    "tiempoVuelo",
    "tiempoVueloJPI",
    "Tiempo de Vuelo",
    "TIEMPO DE VUELO (JPI)",
  ],
  tiempoEnServicio: [
    "tiempoEnServicio",
    "tiempoEnServicioGarmin",
    "Tiempo en Servicio",
    "TIEMPO EN SERVICIO (GARMIN)",
  ],
  tiempoTotalEnServicio: ["tiempoTotalEnServicio", "Tiempo Total en Servicio"],
  piloto: ["piloto", "Piloto"],
  propietario: ["propietario", "Propietario"],
  aceiteAgregado: ["aceiteAgregado", "Aceite Agregado"],
  durg: ["durg", "D.U.R.G."],
};

function getFirstValue(record, aliases) {
  for (const alias of aliases) {
    if (record?.[alias] !== undefined && record?.[alias] !== null) {
      return record[alias];
    }
  }

  return undefined;
}

function parseNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = String(value).trim().replace(",", ".");
  const parsedValue = Number(normalized);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function padDatePart(value) {
  return String(value ?? "").padStart(2, "0");
}

function buildIsoDate(record) {
  const explicitDate = normalizeText(getFirstValue(record, FIELD_ALIASES.fechaIso));

  if (/^\d{4}-\d{2}-\d{2}$/.test(explicitDate)) {
    return explicitDate;
  }

  const dia = normalizeText(getFirstValue(record, FIELD_ALIASES.dia));
  const mes = normalizeText(getFirstValue(record, FIELD_ALIASES.mes));
  const anio = normalizeText(getFirstValue(record, FIELD_ALIASES.anio));

  if (!dia || !mes || !anio) {
    return "";
  }

  return `${anio}-${padDatePart(mes)}-${padDatePart(dia)}`;
}

function createTimestamp(isoDate) {
  if (!isoDate) {
    return 0;
  }

  const timestamp = Date.parse(`${isoDate}T00:00:00`);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function roundTo(value, decimals = 1) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function formatOwnerLabel(value) {
  const text = normalizeText(value);
  return text || "Sin propietario";
}

function normalizeFlightRecord(record) {
  const isoDate = buildIsoDate(record);

  return {
    id: normalizeText(getFirstValue(record, FIELD_ALIASES.id)),
    dateIso: isoDate,
    timestamp: createTimestamp(isoDate),
    tiempoEnServicio: parseNumber(getFirstValue(record, FIELD_ALIASES.tiempoEnServicio)),
    propietario: formatOwnerLabel(getFirstValue(record, FIELD_ALIASES.propietario)),
    aceiteAgregado: parseNumber(getFirstValue(record, FIELD_ALIASES.aceiteAgregado)),
  };
}

function normalizeFlightRecords(records) {
  return (Array.isArray(records) ? records : []).map((record, index) => ({
    ...normalizeFlightRecord(record),
    sourceIndex: index,
  }));
}

function normalizeAircraftRecord(record) {
  const isoDate = buildIsoDate(record);

  return {
    id: normalizeText(getFirstValue(record, FIELD_ALIASES.id)),
    dateIso: isoDate,
    timestamp: createTimestamp(isoDate),
    tiempoTotalEnServicio: parseNumber(
      getFirstValue(record, FIELD_ALIASES.tiempoTotalEnServicio)
    ),
  };
}

function normalizeHeliceRecord(record) {
  const normalized = normalizeAircraftRecord(record);
  return {
    ...normalized,
    durg: parseNumber(getFirstValue(record, FIELD_ALIASES.durg)),
  };
}

function sortByTimestamp(records) {
  return [...records].sort((left, right) => {
    if (left.timestamp !== right.timestamp) {
      return left.timestamp - right.timestamp;
    }

    return (left.sourceIndex ?? 0) - (right.sourceIndex ?? 0);
  });
}

function getLatestRecord(records) {
  const sortedRecords = sortByTimestamp(records);
  return sortedRecords.at(-1) ?? null;
}

function getStatusTone(value, danger, warning) {
  if (!Number.isFinite(value)) {
    return "neutral";
  }

  if (value <= danger) {
    return "danger";
  }

  if (value <= warning) {
    return "warning";
  }

  return "safe";
}

function getChangePercentage(currentValue, previousValue) {
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue) || previousValue === 0) {
    return null;
  }

  return roundTo(((currentValue - previousValue) / previousValue) * 100, 1);
}

function getYearCloseValue(records, targetYear) {
  const matches = records.filter((record) => {
    if (!record.dateIso) {
      return false;
    }

    return Number(record.dateIso.slice(0, 4)) <= targetYear;
  });

  const latestRecord = getLatestRecord(matches);
  return latestRecord?.tiempoTotalEnServicio ?? null;
}

function getAircraftRecordById(records, flightId) {
  if (!flightId) {
    return null;
  }

  return records.find((record) => String(record.id) === String(flightId)) ?? null;
}

function buildOwnerUsageRows(records) {
  const ownerUsageMap = records.reduce((accumulator, record) => {
    const owner = record.propietario;
    const currentValue = accumulator.get(owner) ?? 0;
    accumulator.set(owner, currentValue + (record.tiempoEnServicio ?? 0));
    return accumulator;
  }, new Map());

  const ownerTotalHours = [...ownerUsageMap.values()].reduce((sum, value) => sum + value, 0);

  return [...ownerUsageMap.entries()]
    .map(([owner, hours]) => ({
      owner,
      hours: roundTo(hours, 1) ?? 0,
      share: ownerTotalHours > 0 ? roundTo((hours / ownerTotalHours) * 100, 1) : 0,
    }))
    .sort((left, right) => right.hours - left.hours);
}

function findLastIndexByDate(records, dateIso) {
  if (!dateIso) {
    return -1;
  }

  let foundIndex = -1;

  records.forEach((record, index) => {
    if (record.dateIso === dateIso) {
      foundIndex = index;
    }
  });

  return foundIndex;
}

function buildOwnerUsageSection(records, title, detail, startIndex, fallbackMessage) {
  const scopedRecords = startIndex >= 0 ? records.slice(startIndex) : [];
  const startRecord = startIndex >= 0 ? records[startIndex] ?? null : null;

  return {
    id: title,
    title,
    detail,
    rows: buildOwnerUsageRows(scopedRecords),
    startFound: startIndex >= 0,
    startFlightId: startRecord?.id ?? "",
    startFlightDate: startRecord?.dateIso ?? "",
    fallbackMessage,
  };
}

export function buildDashboardMetrics(historiales = {}, settings, now = new Date()) {
  const computacionHoras = sortByTimestamp(normalizeFlightRecords(historiales.computacionHoras));
  const historialAeronave = sortByTimestamp(
    (Array.isArray(historiales.historialAeronave) ? historiales.historialAeronave : []).map(
      normalizeAircraftRecord
    )
  );
  const historialMotor = sortByTimestamp(
    (Array.isArray(historiales.historialMotor) ? historiales.historialMotor : []).map(
      normalizeAircraftRecord
    )
  );
  const historialHelice = sortByTimestamp(
    (Array.isArray(historiales.historialHelice) ? historiales.historialHelice : []).map(
      normalizeHeliceRecord
    )
  );
  const ownerUsageTotalStartIndex = computacionHoras.findIndex(
    (record) => String(record.id) === OWNER_USAGE_START_FLIGHT_ID
  );
  const inspection50Date = normalizeText(settings.kpiParams.inspection50?.lastInspectionDate);
  const inspection100Date = normalizeText(settings.kpiParams.inspection100?.lastInspectionDate);
  const ownerUsageFrom50StartIndex = findLastIndexByDate(computacionHoras, inspection50Date);
  const ownerUsageFrom100StartIndex = findLastIndexByDate(
    computacionHoras,
    inspection100Date
  );

  const latestAircraft = getLatestRecord(historialAeronave);
  const latestMotor = getLatestRecord(historialMotor);
  const latestHelice = getLatestRecord(historialHelice);

  const annualThresholds = settings.kpiParams.thresholds.annualInspection;
  const inspection50Thresholds = settings.kpiParams.thresholds.inspection50;
  const inspection100Thresholds = settings.kpiParams.thresholds.inspection100;

  const nextDueDate = settings.kpiParams.annualInspection.nextDueDate;
  const dueTimestamp = nextDueDate ? Date.parse(`${nextDueDate}T00:00:00`) : null;
  const todayTimestamp = Date.parse(
    `${now.getFullYear()}-${padDatePart(now.getMonth() + 1)}-${padDatePart(now.getDate())}T00:00:00`
  );
  const daysToAnnualInspection =
    Number.isFinite(dueTimestamp) && Number.isFinite(todayTimestamp)
      ? Math.ceil((dueTimestamp - todayTimestamp) / DAY_IN_MS)
      : null;

  const currentAircraftTotal = latestAircraft?.tiempoTotalEnServicio ?? null;
  const inspection50StartFlight = ownerUsageFrom50StartIndex >= 0
    ? computacionHoras[ownerUsageFrom50StartIndex]
    : null;
  const inspection100StartFlight = ownerUsageFrom100StartIndex >= 0
    ? computacionHoras[ownerUsageFrom100StartIndex]
    : null;
  const cutoff50 = inspection50StartFlight
    ? getAircraftRecordById(historialAeronave, inspection50StartFlight.id)?.tiempoTotalEnServicio ?? null
    : null;
  const cutoff100 = inspection100StartFlight
    ? getAircraftRecordById(historialAeronave, inspection100StartFlight.id)?.tiempoTotalEnServicio ?? null
    : null;

  const inspection50Remaining =
    Number.isFinite(currentAircraftTotal) && Number.isFinite(cutoff50)
      ? roundTo(50 - (currentAircraftTotal - cutoff50), 1)
      : null;
  const inspection100Remaining =
    Number.isFinite(currentAircraftTotal) && Number.isFinite(cutoff100)
      ? roundTo(100 - (currentAircraftTotal - cutoff100), 1)
      : null;

  const ownerUsageSections = [
    buildOwnerUsageSection(
      computacionHoras,
      "Total uso por propietario",
      `Medido desde el vuelo ID ${OWNER_USAGE_START_FLIGHT_ID}.`,
      ownerUsageTotalStartIndex,
      `No se encontro el vuelo ID ${OWNER_USAGE_START_FLIGHT_ID}.`
    ),
    buildOwnerUsageSection(
      computacionHoras,
      "Uso por propietario desde INSP 50 Hrs.",
      inspection50Date
        ? `Fecha configurada: ${inspection50Date}`
        : "Configurar fecha de ultima inspeccion en Settings > Inspecciones.",
      ownerUsageFrom50StartIndex,
      inspection50Date
        ? `No se encontraron vuelos en la fecha ${inspection50Date}.`
        : "No hay fecha de corte configurada para INSP 50 Hrs."
    ),
    buildOwnerUsageSection(
      computacionHoras,
      "Uso por propietario desde INSP 100 Hrs.",
      inspection100Date
        ? `Fecha configurada: ${inspection100Date}`
        : "Configurar fecha de ultima inspeccion en Settings > Inspecciones.",
      ownerUsageFrom100StartIndex,
      inspection100Date
        ? `No se encontraron vuelos en la fecha ${inspection100Date}.`
        : "No hay fecha de corte configurada para INSP 100 Hrs."
    ),
  ];

  const currentYear = now.getFullYear();
  const legacy2022 = parseNumber(settings.kpiParams.annualUtilizationLegacy["2022"]);
  const annualUtilization = [];

  for (let year = 2022; year <= currentYear; year += 1) {
    let hours = null;

    if (year === 2022 && Number.isFinite(legacy2022)) {
      hours = legacy2022;
    } else {
      const yearClose = getYearCloseValue(historialAeronave, year);
      const previousClose = getYearCloseValue(historialAeronave, year - 1);

      if (Number.isFinite(yearClose) && Number.isFinite(previousClose)) {
        hours = roundTo(yearClose - previousClose, 1);
      }
    }

    const previousYearHours = annualUtilization.at(-1)?.hours ?? null;

    annualUtilization.push({
      year,
      hours,
      variationPct: getChangePercentage(hours, previousYearHours),
      isLegacy: year === 2022 && Number.isFinite(legacy2022),
    });
  }

  const windowMonths = Math.max(
    1,
    parseNumber(settings.kpiParams.oil.analysisWindowMonths) ?? 6
  );
  const windowStart = new Date(now.getFullYear(), now.getMonth() - windowMonths, now.getDate());
  const oilWindowRecords = computacionHoras.filter((record) => record.timestamp >= windowStart.getTime());
  const totalOilAdded = oilWindowRecords.reduce(
    (sum, record) => sum + (record.aceiteAgregado ?? 0),
    0
  );
  const totalServiceHours = oilWindowRecords.reduce(
    (sum, record) => sum + (record.tiempoEnServicio ?? 0),
    0
  );
  const oilPerHour =
    totalServiceHours > 0 ? roundTo(totalOilAdded / totalServiceHours, 3) : null;
  const oilPerTenHours =
    Number.isFinite(oilPerHour) ? roundTo(oilPerHour * 10, 2) : null;
  const currentOilPrice = parseNumber(settings.kpiParams.oil.currentPrice);
  const oilCostPerHour =
    Number.isFinite(oilPerHour) && Number.isFinite(currentOilPrice)
      ? roundTo(oilPerHour * currentOilPrice, 2)
      : null;

  return {
    totals: {
      aeronave: latestAircraft?.tiempoTotalEnServicio ?? null,
      motor: latestMotor?.tiempoTotalEnServicio ?? null,
      helice: latestHelice?.tiempoTotalEnServicio ?? null,
      durg: latestHelice?.durg ?? null,
    },
    inspections: [
      {
        id: "annual",
        label: "Inspeccion anual",
        value: daysToAnnualInspection,
        suffix: "dias",
        tone: getStatusTone(
          daysToAnnualInspection,
          annualThresholds.dangerDays,
          annualThresholds.warningDays
        ),
        detail: nextDueDate ? `Vence el ${nextDueDate}` : "Configurar fecha en Settings",
      },
      {
        id: "50",
        label: "Inspeccion 50 hrs",
        value: inspection50Remaining,
        suffix: "hrs",
        tone: getStatusTone(
          inspection50Remaining,
          inspection50Thresholds.dangerHours,
          inspection50Thresholds.warningHours
        ),
        detail: Number.isFinite(cutoff50)
          ? `Fecha ${inspection50Date} | Vuelo ID ${inspection50StartFlight?.id ?? "--"} | Total ${roundTo(cutoff50, 1)}`
          : "Configurar fecha de ultima inspeccion en Settings",
      },
      {
        id: "100",
        label: "Inspeccion 100 hrs",
        value: inspection100Remaining,
        suffix: "hrs",
        tone: getStatusTone(
          inspection100Remaining,
          inspection100Thresholds.dangerHours,
          inspection100Thresholds.warningHours
        ),
        detail: Number.isFinite(cutoff100)
          ? `Fecha ${inspection100Date} | Vuelo ID ${inspection100StartFlight?.id ?? "--"} | Total ${roundTo(cutoff100, 1)}`
          : "Configurar fecha de ultima inspeccion en Settings",
      },
    ],
    ownerUsageSections,
    annualUtilization,
    oil: {
      windowMonths,
      totalOilAdded: roundTo(totalOilAdded, 2),
      totalServiceHours: roundTo(totalServiceHours, 1),
      perHour: oilPerHour,
      perTenHours: oilPerTenHours,
      costPerHour: oilCostPerHour,
    },
    meta: {
      hasComputacionHoras: computacionHoras.length > 0,
      aircraftRecords: historialAeronave.length,
      flightRecords: computacionHoras.length,
      ownerUsageStartFlightId: OWNER_USAGE_START_FLIGHT_ID,
    },
  };
}
