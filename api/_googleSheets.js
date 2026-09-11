import { GoogleAuth } from "google-auth-library";

const SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

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
      scopes: [SHEETS_READONLY_SCOPE],
      ...(credentials ? { credentials } : {}),
    });
  }

  return googleAuth;
}

export async function batchGetSpreadsheetValues(spreadsheetId, ranges) {
  const normalizedSpreadsheetId = String(spreadsheetId || "").trim();

  if (!normalizedSpreadsheetId) {
    throw new Error("Falta configurar el Spreadsheet requerido.");
  }

  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(normalizedSpreadsheetId)}/values:batchGet`
  );

  ranges.forEach((range) => {
    url.searchParams.append("ranges", range);
  });
  url.searchParams.set("majorDimension", "ROWS");
  url.searchParams.set("valueRenderOption", "UNFORMATTED_VALUE");

  const authClient = await getGoogleAuth().getClient();
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
