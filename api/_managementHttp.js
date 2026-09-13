const ERROR_STATUS_BY_CODE = {
  VALIDATION_ERROR: 400,
  USER_NOT_AUTHORIZED: 403,
  FORBIDDEN: 403,
  USER_NOT_FOUND: 404,
  AIRCRAFT_NOT_FOUND: 404,
  PERMISSION_NOT_FOUND: 404,
  EMAIL_CONFLICT: 409,
  USER_INACTIVE: 409,
  AIRCRAFT_NOT_ACTIVE: 409,
  ROLE_CONFLICT: 409,
  SELF_DEACTIVATION: 409,
  INTEGRITY_ERROR: 409,
  WRITE_VERIFICATION_FAILED: 500,
};

function validationError(message) {
  const error = new Error(message);
  error.code = "VALIDATION_ERROR";
  return error;
}

export function userManagementWritesEnabled() {
  return process.env.USER_MANAGEMENT_WRITES_ENABLED === "true";
}

export function getBody(req, allowedFields) {
  const body = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw validationError("El body debe ser un objeto JSON.");
  }

  const unexpectedFields = Object.keys(body).filter(
    (field) => !allowedFields.includes(field)
  );

  if (unexpectedFields.length) {
    throw validationError("El body contiene campos no permitidos.");
  }

  return body;
}

export function requiredString(value, fieldName, maximumLength = 160) {
  const normalizedValue = String(value ?? "").trim();

  if (!normalizedValue) {
    throw validationError(`Falta ${fieldName}.`);
  }

  if (normalizedValue.length > maximumLength) {
    throw validationError(`${fieldName} es demasiado largo.`);
  }

  return normalizedValue;
}

export function optionalString(value, fieldName, maximumLength = 160) {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  return requiredString(value, fieldName, maximumLength);
}

export function requiredEmail(value) {
  const email = requiredString(value, "email", 254).toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw validationError("El email no es valido.");
  }

  return email;
}

export function optionalBoolean(value, fieldName) {
  if (value === undefined) {
    return false;
  }

  if (typeof value !== "boolean") {
    throw validationError(`${fieldName} debe ser booleano.`);
  }

  return value;
}

export function managementErrorResponse(error, fallbackMessage) {
  const status = ERROR_STATUS_BY_CODE[error?.code] || 500;

  return {
    status,
    error: status === 500 ? fallbackMessage : error.message,
  };
}
