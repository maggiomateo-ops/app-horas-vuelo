import { formatHistorialDate } from "../utils/historiales";

const NUMERIC_COLUMNS = new Set([
  "tiempoEnServicio",
  "tiempoTotalEnServicio",
  "tiempoDeVuelo",
  "durg",
]);

function formatNumericValue(value) {
  if (value === null || value === undefined) {
    return "-";
  }

  const trimmedValue = String(value).trim();

  if (!trimmedValue) {
    return "-";
  }

  const normalizedValue = trimmedValue.replace(",", ".");
  const parsedValue = Number(normalizedValue);

  if (Number.isNaN(parsedValue)) {
    return trimmedValue;
  }

  return String(Math.round(parsedValue * 10) / 10);
}

function renderValue(value) {
  if (value === null || value === undefined) {
    return "-";
  }

  const trimmedValue = String(value).trim();

  if (!trimmedValue) {
    return "-";
  }

  return trimmedValue;
}

function HistorialTable({ columns, rows, emptyMessage = "Sin datos" }) {
  if (!rows.length) {
    return <p className="history-empty">{emptyMessage}</p>;
  }

  return (
    <div className="history-table-wrapper">
      <table className="history-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${formatHistorialDate(row)}-${row.desde ?? ""}-${row.hasta ?? ""}-${index}`}>
              {columns.map((column) => {
                const value =
                  column.key === "fecha"
                    ? formatHistorialDate(row)
                    : row[column.key];

                return (
                  <td key={column.key}>
                    {NUMERIC_COLUMNS.has(column.key)
                      ? formatNumericValue(value)
                      : renderValue(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default HistorialTable;
