import { GoogleAuth } from "google-auth-library";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

let googleAuth = null;

function getInlineCredentials() {
  const rawCredentials = String(
    process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_JSON || ""
  ).trim();

  if (!rawCredentials) {
    return undefined;
  }

  let credentials;

  try {
    credentials = JSON.parse(rawCredentials);
  } catch {
    throw new Error("Las credenciales de Google Sheets no contienen JSON valido.");
  }

  if (!credentials?.client_email || !credentials?.private_key) {
    throw new Error("Las credenciales de Google Sheets estan incompletas.");
  }

  return {
    ...credentials,
    private_key: String(credentials.private_key).replace(/\\n/g, "\n"),
  };
}

function getGoogleAuth() {
  if (!googleAuth) {
    const credentials = getInlineCredentials();
    googleAuth = new GoogleAuth({
      scopes: [SHEETS_SCOPE],
      ...(credentials ? { credentials } : {}),
    });
  }

  return googleAuth;
}

function normalizeSpreadsheetId(spreadsheetId) {
  const normalizedSpreadsheetId = String(spreadsheetId || "").trim();

  if (!normalizedSpreadsheetId) {
    throw new Error("Falta configurar el Spreadsheet requerido.");
  }

  return normalizedSpreadsheetId;
}

function validateRows(values) {
  if (!Array.isArray(values)) {
    throw new Error("Los valores de Google Sheets deben enviarse como filas.");
  }
}

async function getAuthClient() {
  return getGoogleAuth().getClient();
}

export async function batchGetSpreadsheetValues(spreadsheetId, ranges) {
  const normalizedSpreadsheetId = normalizeSpreadsheetId(spreadsheetId);
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(normalizedSpreadsheetId)}/values:batchGet`
  );

  ranges.forEach((range) => {
    url.searchParams.append("ranges", range);
  });
  url.searchParams.set("majorDimension", "ROWS");
  url.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");

  const authClient = await getAuthClient();
  const response = await authClient.request({
    method: "GET",
    url: url.toString(),
  });

  const valueRanges = Array.isArray(response.data?.valueRanges)
    ? response.data.valueRanges
    : [];

  return ranges.map((_, index) => {
    const values = valueRanges[index]?.values;
    return Array.isArray(values) ? values : [];
  });
}

export async function batchUpdateSpreadsheetValues(spreadsheetId, updates) {
  const normalizedSpreadsheetId = normalizeSpreadsheetId(spreadsheetId);

  if (!Array.isArray(updates) || updates.length === 0) {
    throw new Error("No hay valores para actualizar en Google Sheets.");
  }

  const data = updates.map((update) => {
    const range = String(update?.range || "").trim();
    const values = update?.values;

    if (!range) {
      throw new Error("Cada actualizacion de Google Sheets requiere un rango.");
    }

    validateRows(values);

    return {
      range,
      majorDimension: "ROWS",
      values,
    };
  });

  const authClient = await getAuthClient();
  const response = await authClient.request({
    method: "POST",
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(normalizedSpreadsheetId)}/values:batchUpdate`,
    data: {
      valueInputOption: "RAW",
      data,
    },
  });

  return response.data;
}

export async function appendSpreadsheetValues(spreadsheetId, range, values) {
  const normalizedSpreadsheetId = normalizeSpreadsheetId(spreadsheetId);
  const normalizedRange = String(range || "").trim();

  if (!normalizedRange) {
    throw new Error("Falta el rango donde agregar valores en Google Sheets.");
  }

  validateRows(values);

  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(normalizedSpreadsheetId)}/values/${encodeURIComponent(normalizedRange)}:append`
  );
  url.searchParams.set("valueInputOption", "RAW");
  url.searchParams.set("insertDataOption", "INSERT_ROWS");

  const authClient = await getAuthClient();
  const response = await authClient.request({
    method: "POST",
    url: url.toString(),
    data: {
      majorDimension: "ROWS",
      values,
    },
  });

  return response.data;
}
